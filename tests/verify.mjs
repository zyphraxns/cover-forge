/* ============================================================================
 * CoverForge · 独立对抗性验证（verify.mjs）
 *
 * 目的：不依赖实现者自写的 qa.mjs，用**真实解码回读像素**的方式独立攻击盲区：
 *   1. 真实像素级验证：下载文件重新解码 → 尺寸 / 居中裁剪内容 / 拖动方向语义
 *   2. 预估 vs 实际字节级一致
 *   3. 透明语义（PNG 保透明 / JPG 填背景色）
 *   4. 竞态抖动（快速切换 ~20 次不等渲染）
 *   5. 边界与压力（1×1 / 4×4 / 8000×6000 / 100:1 / 1:100 / 同文件连选两次）
 *   6. 格式覆盖（WebP / GIF / BMP）
 *   7. 全局清洁度（console / 网络 / 未捕获异常 累计）
 *
 * 运行：cd tests && node verify.mjs
 * 产物：tests/output-verify/**（独立根目录，避开 qa.mjs 的 fs.rmSync(tests/output)）
 * 报告：tests/output/VERIFY-REPORT.md（另存一份到 tests/output-verify/）
 * ========================================================================= */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = 'file://' + path.resolve(here, '..', 'index.html');
const OUT = path.join(here, 'output');            // 报告落点（规格要求）
const ROOT = path.join(here, 'output-verify');    // 独立根目录：qa.mjs 只清 output/，清不到这里
const FIX = path.join(ROOT, 'fixtures');
const DL = path.join(ROOT, 'downloads');

fs.mkdirSync(OUT, { recursive: true });
fs.rmSync(ROOT, { recursive: true, force: true });
for (const d of [ROOT, FIX, DL]) fs.mkdirSync(d, { recursive: true });

/* ── 结果记录 ─────────────────────────────────────────────────────────── */
const results = [];
const measurements = {};
let currentGroup = '';

function group(name) { currentGroup = name; console.log('\n### ' + name); }

function record(id, testCase, expected, actual, pass) {
  results.push({ group: currentGroup, id, testCase, expected, actual, pass: !!pass });
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${id} ${testCase}\n        预期: ${expected}\n        实测: ${actual}`);
  return !!pass;
}

/* ── Node 侧字节工具 ──────────────────────────────────────────────────── */
function magicOf(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { name: 'JPEG', mime: 'image/jpeg' };
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { name: 'PNG', mime: 'image/png' };
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { name: 'WEBP', mime: 'image/webp' };
  if (buf.length >= 2 && buf.toString('ascii', 0, 2) === 'BM') return { name: 'BMP', mime: 'image/bmp' };
  if (buf.length >= 3 && buf.toString('ascii', 0, 3) === 'GIF') return { name: 'GIF', mime: 'image/gif' };
  return { name: 'UNKNOWN', mime: 'application/octet-stream' };
}

/* ── 手工编码 GIF / BMP（canvas.toBlob 不支持这两种格式）──────────────── */
function bandColorAt(x, y, w, h, palette) {
  return Math.min(palette.length - 1, Math.floor(x / (w / palette.length)));
}

function makeGIF(w, h, palette) {
  // 用「每个像素前都插入一个 clear code」的合法解法：
  // 解码器读数后 prevCode 立刻被 reset，字典永不增长，codeSize 恒为 minCodeSize+1。
  const nBits = Math.max(2, Math.ceil(Math.log2(palette.length)));
  const minCodeSize = nBits;
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  const codeSize = minCodeSize + 1;

  const out = [];
  let cur = 0, curBits = 0;
  const emit = (code) => {
    cur |= code << curBits; curBits += codeSize;
    while (curBits >= 8) { out.push(cur & 0xff); cur >>>= 8; curBits -= 8; }
  };
  emit(clearCode);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) { emit(bandColorAt(x, y, w, h, palette)); emit(clearCode); }
  }
  emit(endCode);
  if (curBits > 0) out.push(cur & 0xff);

  const tbl = [];
  // 调色板必须补齐到 2^nBits 项
  for (let i = 0; i < (1 << nBits); i++) {
    const c = palette[i] || [0, 0, 0];
    tbl.push(c[0], c[1], c[2]);
  }

  const chunks = [];
  chunks.push(Buffer.from('GIF89a', 'ascii'));
  const lsd = Buffer.alloc(7);
  lsd.writeUInt16LE(w, 0); lsd.writeUInt16LE(h, 2);
  lsd[4] = 0x80 | 0x10 | (nBits - 1);   // 全局色表 + 色深 + 表大小
  lsd[5] = 0; lsd[6] = 0;
  chunks.push(lsd);
  chunks.push(Buffer.from(tbl));

  const imgDesc = Buffer.alloc(10);
  imgDesc[0] = 0x2c;
  imgDesc.writeUInt16LE(0, 1); imgDesc.writeUInt16LE(0, 3);
  imgDesc.writeUInt16LE(w, 5); imgDesc.writeUInt16LE(h, 7);
  imgDesc[9] = 0;   // 无局部色表 / 非交错
  chunks.push(imgDesc);

  chunks.push(Buffer.from([minCodeSize]));
  for (let i = 0; i < out.length; i += 255) {
    const slice = out.slice(i, i + 255);
    chunks.push(Buffer.from([slice.length]));
    chunks.push(Buffer.from(slice));
  }
  chunks.push(Buffer.from([0x00]));      // block terminator
  chunks.push(Buffer.from([0x3b]));      // trailer
  return Buffer.concat(chunks);
}

function makeBMP(w, h, palette) {
  const rowSize = Math.ceil(w * 3 / 4) * 4;
  const dataSize = rowSize * h;
  const buf = Buffer.alloc(54 + dataSize);
  buf.write('BM', 0, 'ascii');
  buf.writeUInt32LE(54 + dataSize, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(w, 18); buf.writeInt32LE(h, 22);
  buf.writeUInt16LE(1, 26); buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(dataSize, 34);
  buf.writeInt32LE(2835, 38); buf.writeInt32LE(2835, 42);
  for (let y = 0; y < h; y++) {
    const srcY = h - 1 - y;
    let off = 54 + y * rowSize;
    for (let x = 0; x < w; x++) {
      const c = palette[bandColorAt(x, srcY, w, h, palette)];
      buf[off++] = c[2]; buf[off++] = c[1]; buf[off++] = c[0];
    }
  }
  return buf;
}

/* ── 注入页面的读取/解码助手 ──────────────────────────────────────────── */
const HELPERS = `
function parseBytes(t) {
  const m = t.match(/([\\d.]+)\\s*(B|KB|MB)/i);
  if (!m) return null;
  const v = parseFloat(m[1]); const u = m[2].toUpperCase();
  return u === 'B' ? v : (u === 'KB' ? v * 1024 : v * 1048576);
}
window.__qa = {
  dimsText: () => document.getElementById('sm-dims').textContent.trim(),
  dims: () => {
    const m = document.getElementById('sm-dims').textContent.match(/(\\d+)\\s*×\\s*(\\d+)/);
    return m ? { w: +m[1], h: +m[2] } : null;
  },
  actualText: () => document.getElementById('sm-actual').textContent.trim(),
  actual: () => parseBytes(document.getElementById('sm-actual').textContent),
  targetText: () => document.getElementById('sm-target').textContent.trim(),
  target: () => /不限/.test(document.getElementById('sm-target').textContent) ? null : parseBytes(document.getElementById('sm-target').textContent),
  verdict: () => document.getElementById('sm-verdict').textContent.trim(),
  quality: () => document.getElementById('sm-quality').textContent.trim(),
  scaleTxt: () => document.getElementById('sm-scale').textContent.trim(),
  timeTxt: () => document.getElementById('sm-time').textContent.trim(),
  foot: () => document.getElementById('sm-foot').textContent.trim(),
  status: () => { const p = document.getElementById('ro-status'); return p.dataset.state + '/' + p.textContent.trim(); },
  focus: () => document.getElementById('focus-readout').textContent.trim(),
  cropRectText: () => document.getElementById('crop-rect').textContent.trim(),
  dlLabel: () => document.getElementById('download-label').textContent.trim(),
  dlNote: () => document.getElementById('download-note').textContent.trim(),
  inputValue: () => document.getElementById('file-input').value,
  canvasSize: () => { const c = document.getElementById('stage-canvas'); return { w: c.width, h: c.height }; },
  viewMode: () => { const a = document.querySelector('#view-mode .segmented__btn.is-active'); return a ? a.dataset.view : null; },
  infoDims: () => {
    const m = document.getElementById('info-dims').textContent.match(/(\\d+)\\s*×\\s*(\\d+)/);
    return m ? { w: +m[1], h: +m[2] } : null;
  },
  cropRect: () => {
    const m = document.getElementById('crop-rect').textContent.match(/(\\d+)\\s*×\\s*(\\d+)\\s*@\\s*\\((\\d+),\\s*(\\d+)\\)/);
    return m ? { w: +m[1], h: +m[2], x: +m[3], y: +m[4] } : null;
  },
  frameAspect: () => {
    const r = document.getElementById('stage-frame').getBoundingClientRect();
    return r.height ? r.width / r.height : 0;
  },
  /** #stage-crop 的 bounding box 换算回源图像素坐标。
   *  注意：全局是 box-sizing:border-box，所以 CSS 里 left/width 的百分比设的正是
   *  border box，其外沿恰好落在裁切边界上 —— 必须用 border box 比对，不能扣边框。 */
  cropBoxInSourcePx: () => {
    const frame = document.getElementById('stage-frame');
    const box = document.getElementById('stage-crop');
    if (box.hidden) return null;
    const sd = window.__qa.infoDims();
    if (!sd) return null;
    const fr = frame.getBoundingClientRect();
    const fcs = getComputedStyle(frame);
    const fl = parseFloat(fcs.borderLeftWidth) || 0;
    const ft = parseFloat(fcs.borderTopWidth) || 0;
    const frr = parseFloat(fcs.borderRightWidth) || 0;
    const fb = parseFloat(fcs.borderBottomWidth) || 0;
    const pbW = fr.width - fl - frr;      // padding box（绝对定位的百分比基准）
    const pbH = fr.height - ft - fb;
    const br = box.getBoundingClientRect();
    return {
      x: (br.left - (fr.left + fl)) / pbW * sd.w,
      y: (br.top - (fr.top + ft)) / pbH * sd.h,
      w: br.width / pbW * sd.w,
      h: br.height / pbH * sd.h
    };
  },
  rectOf: (id) => {
    const e = document.getElementById(id);
    if (!e || e.hidden) return null;
    const r = e.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  },
  pasteItemsOnly: (b64, name, mime) => {
    const bin = atob(b64); const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const file = new File([u8], name, { type: mime });
    // 只填 items、files 为空 —— 复现「部分应用粘贴图片时只填 items」
    const fake = { files: [], items: [{ kind: 'file', type: mime, getAsFile: () => file }] };
    const ev = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clipboardData', { value: fake });
    window.dispatchEvent(ev);
    return true;
  },
  toasts: () => Array.prototype.map.call(document.querySelectorAll('#toasts .toast'), (n) => ({ kind: n.dataset.kind, title: (n.querySelector('.toast__title') || {}).textContent || '' })),
  clearToasts: () => { document.getElementById('toasts').innerHTML = ''; },
  emptyVisible: () => {
    const e = document.getElementById('stage-empty');
    return !!e && !e.hidden && e.offsetParent !== null;
  },
  /* ── 解码回读：真实像素 ── */
  b64ToBlob(b64, mime) {
    const bin = atob(b64); const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], mime ? { type: mime } : undefined);
  },
  async info(b64, mime) {
    const bmp = await createImageBitmap(this.b64ToBlob(b64, mime));
    return { w: bmp.width, h: bmp.height };
  },
  async classify(b64, mime, palette, tol) {
    const bmp = await createImageBitmap(this.b64ToBlob(b64, mime));
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const t2 = tol * tol;
    const counts = new Array(palette.length).fill(0);
    let other = 0;
    for (let i = 0; i < d.length; i += 4) {
      let best = -1, bd = Infinity;
      for (let p = 0; p < palette.length; p++) {
        const dr = d[i] - palette[p][0], dg = d[i + 1] - palette[p][1], db = d[i + 2] - palette[p][2];
        const dd = dr * dr + dg * dg + db * db;
        if (dd < bd) { bd = dd; best = p; }
      }
      if (bd <= t2) counts[best]++; else other++;
    }
    return { w: bmp.width, h: bmp.height, counts, other, total: c.width * c.height };
  },
  async sample(b64, mime, pts) {
    const bmp = await createImageBitmap(this.b64ToBlob(b64, mime));
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0);
    return pts.map(([nx, ny]) => {
      const x = Math.min(c.width - 1, Math.max(0, Math.round(nx * (c.width - 1))));
      const y = Math.min(c.height - 1, Math.max(0, Math.round(ny * (c.height - 1))));
      const d = g.getImageData(x, y, 1, 1).data;
      return { x, y, r: d[0], g: d[1], b: d[2], a: d[3] };
    });
  }
};
`;

/* ── Playwright 侧操作助手 ────────────────────────────────────────────── */
async function waitIdle(page, timeout = 240000) {
  await page.waitForFunction(() => {
    const busy = document.getElementById('stage-busy');
    const actual = document.getElementById('sm-actual').textContent;
    const dims = document.getElementById('sm-dims').textContent;
    return busy && busy.hidden === true &&
      actual.indexOf('计算中') === -1 && actual.indexOf('—') === -1 &&
      dims.indexOf('—') === -1;
  }, null, { timeout, polling: 120 });
}

async function grabDownload(page, label) {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 180000 }),
    page.click('#btn-download')
  ]);
  const name = download.suggestedFilename();
  const dest = path.join(DL, `${label}__${name}`);
  await download.saveAs(dest);
  const buf = fs.readFileSync(dest);
  return { name, bytes: buf.length, buf, path: dest };
}

async function decodeInPage(page, dl) {
  const m = magicOf(dl.buf);
  const b64 = dl.buf.toString('base64');
  const info = await page.evaluate(({ b64, mime }) => window.__qa.info(b64, mime), { b64, mime: m.mime });
  return { ...m, b64, w: info.w, h: info.h };
}

/* ── fixtures ─────────────────────────────────────────────────────────── */
async function makeFixtures(page) {
  await page.goto('about:blank');
  const spec = {
    'bands-900x300.png': { w: 900, h: 300, type: 'image/png', kind: 'bands' },
    'alpha-800x800.png': { w: 800, h: 800, type: 'image/png', kind: 'alpha' },
    'px-1x1.png': { w: 1, h: 1, type: 'image/png', kind: 'solid' },
    'sq-4x4.png': { w: 4, h: 4, type: 'image/png', kind: 'solid' },
    'photo-1600x900.jpg': { w: 1600, h: 900, type: 'image/jpeg', q: 0.92, kind: 'rich' },
    'mid-3000x2000.jpg': { w: 3000, h: 2000, type: 'image/jpeg', q: 0.9, kind: 'rich' },
    'huge-8000x6000.jpg': { w: 8000, h: 6000, type: 'image/jpeg', q: 0.85, kind: 'plain' },
    'pic-640x480.webp': { w: 640, h: 480, type: 'image/webp', q: 0.9, kind: 'rich' }
  };

  const files = {};
  for (const [name, s] of Object.entries(spec)) {
    const b64 = await page.evaluate(async (s) => {
      const c = document.createElement('canvas');
      c.width = s.w; c.height = s.h;
      const g = c.getContext('2d');
      const BANDS = ['#E4002B', '#00A651', '#0057B8'];
      if (s.kind === 'bands') {
        const bw = s.w / 3;
        BANDS.forEach((col, i) => { g.fillStyle = col; g.fillRect(Math.round(i * bw), 0, Math.ceil(bw), s.h); });
      } else if (s.kind === 'alpha') {
        g.clearRect(0, 0, s.w, s.h);                 // 全透明
        g.fillStyle = '#FF7A33';
        g.fillRect(s.w * 0.25, s.h * 0.25, s.w * 0.5, s.h * 0.5);
      } else if (s.kind === 'solid') {
        g.fillStyle = '#2E6BE6'; g.fillRect(0, 0, s.w, s.h);
      } else if (s.kind === 'rich') {
        const grad = g.createLinearGradient(0, 0, s.w, s.h);
        grad.addColorStop(0, '#1d3557'); grad.addColorStop(0.5, '#c9762f'); grad.addColorStop(1, '#f2e3c8');
        g.fillStyle = grad; g.fillRect(0, 0, s.w, s.h);
        for (let i = 0; i < 30; i++) {
          g.fillStyle = 'hsla(' + ((i * 41) % 360) + ',60%,' + (26 + (i % 5) * 10) + '%,0.8)';
          g.fillRect((i * 131) % Math.max(1, s.w - 200), (i * 97) % Math.max(1, s.h - 120), s.w * 0.09, s.h * 0.11);
        }
        g.fillStyle = '#0b0d10';
        g.font = Math.round(s.h * 0.1) + 'px sans-serif';
        g.textBaseline = 'middle';
        g.fillText('CoverForge verify', s.w * 0.05, s.h * 0.5);
        g.font = Math.round(s.h * 0.045) + 'px monospace';
        g.fillText(s.w + 'x' + s.h + ' pixel-verification-pattern 0123456789', s.w * 0.05, s.h * 0.64);
      } else { // plain（大图：只画渐变 + 少量色块，控制生成耗时）
        const grad = g.createLinearGradient(0, 0, s.w, s.h);
        grad.addColorStop(0, '#102542'); grad.addColorStop(0.6, '#b06a2c'); grad.addColorStop(1, '#e8dcc4');
        g.fillStyle = grad; g.fillRect(0, 0, s.w, s.h);
        for (let i = 0; i < 18; i++) {
          g.fillStyle = 'hsla(' + ((i * 53) % 360) + ',58%,' + (30 + (i % 4) * 9) + '%,0.85)';
          g.fillRect((i * 811) % Math.max(1, s.w - 900), (i * 587) % Math.max(1, s.h - 500), 700, 600);
        }
      }
      const blob = await new Promise((r) => c.toBlob(r, s.type, s.q));
      const ab = await blob.arrayBuffer();
      let bin = ''; const u8 = new Uint8Array(ab);
      for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
      return btoa(bin);
    }, s);
    const p = path.join(FIX, name);
    fs.writeFileSync(p, Buffer.from(b64, 'base64'));
    files[name] = { path: p, b64, bytes: fs.statSync(p).size, mime: s.type };
  }

  // 手工 GIF / BMP
  const BANDS = [[228, 0, 43], [0, 166, 81], [0, 87, 184], [255, 209, 0]];
  fs.writeFileSync(path.join(FIX, 'pic-120x80.gif'), makeGIF(120, 80, BANDS));
  fs.writeFileSync(path.join(FIX, 'pic-120x80.bmp'), makeBMP(120, 80, BANDS));
  files['pic-120x80.gif'] = { path: path.join(FIX, 'pic-120x80.gif'), bytes: fs.statSync(path.join(FIX, 'pic-120x80.gif')).size, mime: 'image/gif' };
  files['pic-120x80.bmp'] = { path: path.join(FIX, 'pic-120x80.bmp'), bytes: fs.statSync(path.join(FIX, 'pic-120x80.bmp')).size, mime: 'image/bmp' };

  return files;
}

/* ── 主流程 ───────────────────────────────────────────────────────────── */
(async () => {
  const consoleMsgs = [];
  const pageErrors = [];
  const externalRequests = [];

  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  // 先做 fixture 有效性自检（尤其是手工编码的 GIF/BMP）
  const checkCtx = await browser.newContext();
  const checkPage = await checkCtx.newPage();
  const files = await makeFixtures(checkPage);
  const fixtureCheck = {};
  for (const [name, f] of Object.entries(files)) {
    if (!f.b64) {
      // 手工编码：读盘转 base64 后在页面自检
      f.b64 = fs.readFileSync(f.path).toString('base64');
    }
    fixtureCheck[name] = await checkPage.evaluate(async ({ b64, mime }) => {
      try {
        const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: mime }));
        return { ok: true, w: bmp.width, h: bmp.height };
      } catch (e) { return { ok: false, err: String(e && e.message || e) }; }
    }, { b64: f.b64, mime: f.mime });
  }
  await checkCtx.close();
  console.log('fixture 自检：', JSON.stringify(fixtureCheck));

  const context = await browser.newContext({
    viewport: { width: 1512, height: 950 },
    acceptDownloads: true,
    deviceScaleFactor: 1
  });
  const page = await context.newPage();

  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') consoleMsgs.push(`[${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => pageErrors.push(String((e && e.message) || e)));
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith('file://') && !u.startsWith('data:') && !u.startsWith('blob:')) externalRequests.push(u);
  });

  await page.goto(APP);
  await page.addScriptTag({ content: HELPERS });

  const load = async (name) => {
    await page.setInputFiles('#file-input', files[name].path);
    await waitIdle(page);
  };
  const pickRatio = async (w, h) => {
    await page.click(`#generic-ratios .chip[data-rw="${w}"][data-rh="${h}"]`);
    await waitIdle(page);
  };
  const setFormat = async (fmt) => {
    await page.click(`#format-group .segmented__btn[data-format="${fmt}"]`);
    await waitIdle(page);
  };
  const setMode = async (mode) => {
    await page.click(`#size-modes .chip[data-mode="${mode}"]`);
    await waitIdle(page);
  };
  const setTargetKB = async (kb) => {
    await page.click('#size-unit .segmented__btn[data-unit="KB"]');
    await page.fill('#size-value', String(kb));
    await page.click('#btn-apply-size');
    await waitIdle(page);
  };
  const setView = async (mode) => {
    const cur = await page.evaluate(() => window.__qa.viewMode());
    if (cur === mode) return;
    await page.click(`#view-mode .segmented__btn[data-view="${mode}"]`);
    await page.waitForTimeout(140);
  };
  /** 把焦点拖到饱和：单次拖动可能不足以触边，重复几次即可 clamp 到 0/1。 */
  const dragFrame = async (axis, fromF, toF, steps = 20) => {
    await page.locator('#stage-frame').scrollIntoViewIfNeeded();
    const box = await page.locator('#stage-frame').boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    let sx, sy, ex, ey;
    if (axis === 'x') { sx = box.x + box.width * fromF; sy = cy; ex = box.x + box.width * toF; ey = cy; }
    else { sx = cx; sy = box.y + box.height * fromF; ex = cx; ey = box.y + box.height * toF; }
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(ex, ey, { steps });
    await page.mouse.up();
    await waitIdle(page);
  };

  const BANDS = [[228, 0, 43], [0, 166, 81], [0, 87, 184]];   // 左红 / 中绿 / 右蓝
  const BAND_TOL = 60;

  /* ═══ A · 真实像素级验证 ═══════════════════════════════════════════ */
  group('A · 真实像素级验证（解码回读）');
  await load('bands-900x300.png');
  await pickRatio(1, 1);
  await setFormat('image/png');
  const aPanelDims = await page.evaluate(() => window.__qa.dims());
  const aPanelDimsText = await page.evaluate(() => window.__qa.dimsText());
  const aDl = await grabDownload(page, 'A-center-11');
  const aDec = await decodeInPage(page, aDl);
  const aCls = await page.evaluate(({ b64, mime, pal, tol }) => window.__qa.classify(b64, mime, pal, tol),
    { b64: aDec.b64, mime: aDec.mime, pal: BANDS, tol: BAND_TOL });
  measurements.centerCrop = { panel: aPanelDims, decoded: { w: aDec.w, h: aDec.h }, counts: aCls.counts, other: aCls.other };

  record('A1', '居中 1:1 裁剪 → 解码尺寸与面板一致',
    `${aPanelDimsText} == 解码尺寸`,
    `面板 ${aPanelDimsText} / 解码 ${aDec.w} × ${aDec.h}`,
    !!aPanelDims && aPanelDims.w === aDec.w && aPanelDims.h === aDec.h);

  const centerOnly = aCls.counts[1] > aCls.total * 0.9 && aCls.counts[0] === 0 && aCls.counts[2] === 0;
  record('A2', '居中裁剪内容正确：只保留中间带，左右边缘被裁掉',
    '中带(绿) > 90%，左(红)=0，右(蓝)=0',
    `绿 ${aCls.counts[1]}/${aCls.total}，红 ${aCls.counts[0]}，蓝 ${aCls.counts[2]}，其他 ${aCls.other}`,
    centerOnly);

  // 九宫格焦点 → 左
  await page.click('#focus-grid .focus-grid__cell[data-fx="0"][data-fy="0.5"]');
  await waitIdle(page);
  const aL = await grabDownload(page, 'A-focus-left');
  const aLDec = await decodeInPage(page, aL);
  const aLCls = await page.evaluate(({ b64, mime, pal, tol }) => window.__qa.classify(b64, mime, pal, tol),
    { b64: aLDec.b64, mime: aLDec.mime, pal: BANDS, tol: BAND_TOL });
  record('A3', '焦点置左（focus 0%）→ 保留原图左侧内容',
    '左带(红) 为绝对主色，右(蓝)=0',
    `红 ${aLCls.counts[0]}，绿 ${aLCls.counts[1]}，蓝 ${aLCls.counts[2]}（共 ${aLCls.total}）`,
    aLCls.counts[0] > aLCls.total * 0.9 && aLCls.counts[2] === 0);

  // 九宫格焦点 → 右
  await page.click('#focus-grid .focus-grid__cell[data-fx="1"][data-fy="0.5"]');
  await waitIdle(page);
  const aR = await grabDownload(page, 'A-focus-right');
  const aRDec = await decodeInPage(page, aR);
  const aRCls = await page.evaluate(({ b64, mime, pal, tol }) => window.__qa.classify(b64, mime, pal, tol),
    { b64: aRDec.b64, mime: aRDec.mime, pal: BANDS, tol: BAND_TOL });
  record('A4', '焦点置右（focus 100%）→ 保留原图右侧内容',
    '右带(蓝) 为绝对主色，左(红)=0',
    `红 ${aRCls.counts[0]}，绿 ${aRCls.counts[1]}，蓝 ${aRCls.counts[2]}（共 ${aRCls.total}）`,
    aRCls.counts[2] > aRCls.total * 0.9 && aRCls.counts[0] === 0);

  // ── 拖动方向语义（最容易写反）──
  await page.click('#btn-reset-crop');
  await waitIdle(page);
  const frame = await page.locator('#stage-frame').boundingBox();
  const cy = frame.y + frame.height / 2;
  // 指针向右拖（从左侧拖到右侧）→ 应露出原图左侧
  await page.mouse.move(frame.x + frame.width * 0.08, cy);
  await page.mouse.down();
  await page.mouse.move(frame.x + frame.width * 0.92, cy, { steps: 24 });
  await page.mouse.up();
  await waitIdle(page);
  const dragRightFocus = await page.evaluate(() => window.__qa.focus());
  const aDR = await grabDownload(page, 'A-drag-right');
  const aDRDec = await decodeInPage(page, aDR);
  const aDRCls = await page.evaluate(({ b64, mime, pal, tol }) => window.__qa.classify(b64, mime, pal, tol),
    { b64: aDRDec.b64, mime: aDRDec.mime, pal: BANDS, tol: BAND_TOL });
  measurements.dragRight = { focus: dragRightFocus, counts: aDRCls.counts };
  const dragRightX = Number((dragRightFocus.match(/(\d+)%/) || [])[1]);
  record('A5', '指针向右拖 → 保留原图左侧内容（拖拽语义未反）',
    'focus < 50% 且 左带(红) 主色（>75%）、右(蓝)=0',
    `${dragRightFocus} · 红 ${aDRCls.counts[0]}，绿 ${aDRCls.counts[1]}，蓝 ${aDRCls.counts[2]}`,
    dragRightX < 50 && aDRCls.counts[0] > aDRCls.total * 0.75 && aDRCls.counts[2] === 0);

  await page.click('#btn-reset-crop');
  await waitIdle(page);
  // 指针向左拖（从右侧拖到左侧）→ 应露出原图右侧
  await page.mouse.move(frame.x + frame.width * 0.92, cy);
  await page.mouse.down();
  await page.mouse.move(frame.x + frame.width * 0.08, cy, { steps: 24 });
  await page.mouse.up();
  await waitIdle(page);
  const dragLeftFocus = await page.evaluate(() => window.__qa.focus());
  const aDL = await grabDownload(page, 'A-drag-left');
  const aDLDec = await decodeInPage(page, aDL);
  const aDLCls = await page.evaluate(({ b64, mime, pal, tol }) => window.__qa.classify(b64, mime, pal, tol),
    { b64: aDLDec.b64, mime: aDLDec.mime, pal: BANDS, tol: BAND_TOL });
  measurements.dragLeft = { focus: dragLeftFocus, counts: aDLCls.counts };
  const dragLeftX = Number((dragLeftFocus.match(/(\d+)%/) || [])[1]);
  record('A6', '指针向左拖 → 保留原图右侧内容（拖拽语义未反）',
    'focus > 50% 且 右带(蓝) 主色（>75%）、左(红)=0',
    `${dragLeftFocus} · 红 ${aDLCls.counts[0]}，绿 ${aDLCls.counts[1]}，蓝 ${aDLCls.counts[2]}`,
    dragLeftX > 50 && aDLCls.counts[2] > aDLCls.total * 0.75 && aDLCls.counts[0] === 0);

  /* ═══ B · 预估 vs 实际字节级一致 ═══════════════════════════════════ */
  group('B · 预估 vs 实际字节级一致');
  await load('photo-1600x900.jpg');
  await pickRatio(16, 9);
  await setFormat('image/jpeg');
  await setMode('max');
  await page.click('#size-presets .chip:text-is("不限")');
  await waitIdle(page);

  const b1Panel = await page.evaluate(() => ({ t: window.__qa.actualText(), n: window.__qa.actual() }));
  const b1Dl = await grabDownload(page, 'B-unlimited');
  measurements.estimateUnlimited = { panelText: b1Panel.t, panelBytes: b1Panel.n, fileBytes: b1Dl.bytes };
  record('B1', '不限体积：预估 vs 下载字节',
    '偏差 ≈ 0（仅面板显示取整）',
    `面板 ${b1Panel.t} / 文件 ${b1Dl.bytes} B → 差 ${Math.abs((b1Panel.n || 0) - b1Dl.bytes).toFixed(1)} B`,
    Math.abs((b1Panel.n || 0) - b1Dl.bytes) <= 64);

  await setTargetKB(500);
  const b2Panel = await page.evaluate(() => ({ t: window.__qa.actualText(), n: window.__qa.actual() }));
  const b2Dl = await grabDownload(page, 'B-500k');
  measurements.estimate500k = { panelText: b2Panel.t, panelBytes: b2Panel.n, fileBytes: b2Dl.bytes };
  record('B2', '500KB 目标：预估 vs 下载字节',
    '偏差 ≈ 0（仅面板显示取整）',
    `面板 ${b2Panel.t} / 文件 ${b2Dl.bytes} B → 差 ${Math.abs((b2Panel.n || 0) - b2Dl.bytes).toFixed(1)} B`,
    Math.abs((b2Panel.n || 0) - b2Dl.bytes) <= 64);

  /* ═══ B3 · 单位切换必须重算目标体积（外部探针报告的 P1）═══════════ */
  await page.click('#size-unit .segmented__btn[data-unit="KB"]');
  await page.fill('#size-value', '2');
  await page.waitForTimeout(900);              // 等 420ms 防抖
  const kbTxt = await page.evaluate(() => window.__qa.targetText());
  await page.click('#size-unit .segmented__btn[data-unit="MB"]');
  await page.waitForTimeout(900);
  const mbState = await page.evaluate(() => ({
    sm: window.__qa.targetText(),
    ro: document.getElementById('ro-target').textContent.trim(),
    bytes: window.__qa.target(),
    value: document.getElementById('size-value').value,
    unit: document.querySelector('#size-unit .segmented__btn.is-active').dataset.unit
  }));
  measurements.unitSwitch = { kbTxt, mbState };
  record('B3', 'KB→MB 单位切换后，目标体积随输入值按新单位重算',
    '输入 2 + MB 高亮 → 面板目标 = 「2 MB」(2097152 B)，而非停留「2 KB」',
    `切换前「${kbTxt}」→ 切换后 输入框=${mbState.value} 单位=${mbState.unit} 面板「${mbState.sm}」顶栏「${mbState.ro}」= ${mbState.bytes} B`,
    mbState.unit === 'MB' && kbTxt === '2 KB' && /^2 MB$/.test(mbState.sm) &&
    Math.abs((mbState.bytes || 0) - 2097152) <= 1);

  /* ═══ C · 透明语义 ═════════════════════════════════════════════════ */
  group('C · 透明语义');
  await load('alpha-800x800.png');
  await pickRatio(1, 1);
  await setFormat('image/png');
  await page.click('#size-presets .chip:text-is("不限")');
  await waitIdle(page);
  const cPanel = await page.evaluate(() => window.__qa.dims());
  const cDl = await grabDownload(page, 'C-alpha-png');
  const cDec = await decodeInPage(page, cDl);
  const cCorner = await page.evaluate(({ b64, mime }) => window.__qa.sample(b64, mime, [[0.01, 0.01], [0.99, 0.01], [0.01, 0.99], [0.5, 0.5]]),
    { b64: cDec.b64, mime: cDec.mime });
  measurements.alphaPng = { corner: cCorner[0], center: cCorner[3], dims: { w: cDec.w, h: cDec.h } };
  record('C1', '透明 PNG → PNG 导出：角落 alpha = 0（透明未被烧成黑底）',
    '四角 alpha = 0，中心 alpha = 255',
    `角 ${cCorner.slice(0, 3).map((p) => `rgba(${p.r},${p.g},${p.b},${p.a})`).join(' ')} · 中心 a=${cCorner[3].a}`,
    cCorner.slice(0, 3).every((p) => p.a === 0) && cCorner[3].a === 255 &&
    cPanel && cPanel.w === cDec.w && cPanel.h === cDec.h);

  await setFormat('image/jpeg');
  await page.click('#bg-swatches .swatch[data-color="#0A0C0F"]');
  await waitIdle(page);
  const cPanel2 = await page.evaluate(() => window.__qa.dims());
  const cDl2 = await grabDownload(page, 'C-alpha-jpg');
  const cDec2 = await decodeInPage(page, cDl2);
  const cCorner2 = await page.evaluate(({ b64, mime }) => window.__qa.sample(b64, mime, [[0.01, 0.01], [0.99, 0.99]]),
    { b64: cDec2.b64, mime: cDec2.mime });
  measurements.alphaJpg = { corners: cCorner2 };
  const near = (p) => Math.abs(p.r - 10) <= 14 && Math.abs(p.g - 12) <= 14 && Math.abs(p.b - 15) <= 14;
  record('C2', '透明 PNG → JPG + 背景 #0A0C0F：角落 ≈ 该颜色（填充生效、未变白）',
    '两角 RGB ≈ (10,12,15)',
    cCorner2.map((p) => `(${p.r},${p.g},${p.b})`).join(' '),
    cCorner2.every(near) && cPanel2 && cPanel2.w === cDec2.w && cPanel2.h === cDec2.h);

  /* ═══ D · 目标体积触发降分辨率时的尺寸一致性（对抗性重点）═══════════ */
  group('D · 降分辨率后的尺寸一致性');
  await load('mid-3000x2000.jpg');
  await pickRatio(1, 1);
  await setFormat('image/jpeg');
  await setMode('max');
  await setTargetKB(60);
  const dPanel = await page.evaluate(() => ({ dims: window.__qa.dims(), txt: window.__qa.dimsText(), scale: window.__qa.scaleTxt(), note: window.__qa.dlNote(), label: window.__qa.dlLabel(), foot: window.__qa.foot(), quality: window.__qa.quality() }));
  const dDl = await grabDownload(page, 'D-60k-downscale');
  const dDec = await decodeInPage(page, dDl);
  measurements.downscale = { panel: dPanel, file: { name: dDl.name, bytes: dDl.bytes, w: dDec.w, h: dDec.h } };
  record('D1', '目标 60KB 触发降分辨率后：面板尺寸 = 解码真实尺寸',
    '面板尺寸 == 解码尺寸',
    `面板 ${dPanel.txt} / 解码 ${dDec.w} × ${dDec.h} / 文件名 ${dDl.name}`,
    !!dPanel.dims && dPanel.dims.w === dDec.w && dPanel.dims.h === dDec.h);

  record('D2', '文件名中的 宽x高 = 解码真实尺寸',
    '文件名 <W>x<H> == 解码尺寸',
    `文件名 ${dDl.name} / 解码 ${dDec.w}x${dDec.h}`,
    new RegExp(`-${dDec.w}x${dDec.h}\\.jpg$`).test(dDl.name));

  record('D3', '降分辨率时面板「分辨率变化」如实标注降至的尺寸',
    'scale 字段提示尺寸被优化',
    `${dPanel.scale}｜脚注「${dPanel.foot.slice(0, 70)}」`,
    /降至|优化/.test(dPanel.scale) || /分辨率已由/.test(dPanel.foot));

  /* ═══ E · 竞态 / 抖动 ══════════════════════════════════════════════ */
  group('E · 竞态 / 抖动（快速切换不等渲染）');
  await load('photo-1600x900.jpg');
  const chaosRatio = [[16, 9], [1, 1], [9, 16], [4, 5], [3, 2]];
  const chaosFmt = ['image/png', 'image/jpeg'];
  const chaosSz = ['不限', '200 KB', '500 KB', '1 MB'];
  for (let i = 0; i < 20; i++) {         // 任意时刻不等渲染完成
    const [rw, rh] = chaosRatio[i % chaosRatio.length];
    await page.click(`#generic-ratios .chip[data-rw="${rw}"][data-rh="${rh}"]`, { noWaitAfter: true });
    await page.click(`#format-group .segmented__btn[data-format="${chaosFmt[i % 2]}"]`, { noWaitAfter: true });
    await page.click(`#size-presets .chip:text-is("${chaosSz[i % chaosSz.length]}")`, { noWaitAfter: true });
  }
  // 抖动收尾：明确落到最终参数
  await page.click(`#generic-ratios .chip[data-rw="16"][data-rh="9"]`, { noWaitAfter: true });
  await page.click('#size-modes .chip[data-mode="max"]', { noWaitAfter: true });
  await page.click('#format-group .segmented__btn[data-format="image/jpeg"]', { noWaitAfter: true });
  await page.click('#size-presets .chip:text-is("500 KB")', { noWaitAfter: true });
  await waitIdle(page);
  await page.waitForTimeout(600);        // 静置：确认没有后续写回把界面改回旧值

  const ePanel = await page.evaluate(() => ({
    dims: window.__qa.dims(), actual: window.__qa.actual(), actualText: window.__qa.actualText(),
    target: window.__qa.target(), verdict: window.__qa.verdict(), status: window.__qa.status(),
    fmt: document.getElementById('sm-format').textContent.trim(), ratio: document.getElementById('sm-ratio').textContent.trim(),
    note: window.__qa.dlNote(), label: window.__qa.dlLabel()
  }));
  const eDl = await grabDownload(page, 'E-race');
  const eDec = await decodeInPage(page, eDl);
  measurements.race = { panel: ePanel, file: { bytes: eDl.bytes, w: eDec.w, h: eDec.h } };

  const eSelfConsistent =
    !!ePanel.dims && ePanel.dims.w === eDec.w && ePanel.dims.h === eDec.h &&
    Math.abs((ePanel.actual || 0) - eDl.bytes) <= 64 &&
    ePanel.fmt === 'JPG' && /^16:9/.test(ePanel.ratio) &&
    ePanel.target !== null && ePanel.actual <= ePanel.target &&
    /达标/.test(ePanel.verdict) && /ok/.test(ePanel.status);
  record('E1', '20 次快速抖动后静置：面板尺寸/体积/格式/达标判定/状态 五者自洽',
    '面板 = 文件；JPG；16:9；500KB 达标；状态 ok',
    `面板 ${ePanel.dimsText || (ePanel.dims.w + '×' + ePanel.dims.h)} 文件 ${eDl.bytes}B（面板 ${ePanel.actualText}）；${ePanel.fmt} · ${ePanel.ratio} · ${ePanel.verdict} · ${ePanel.status}`,
    eSelfConsistent);

  // 与「重新载入同图 + 相同参数」对比
  await page.click('#btn-reset-all');
  await load('photo-1600x900.jpg');
  await pickRatio(16, 9);
  await setMode('max');
  await setFormat('image/jpeg');
  await setTargetKB(500);
  const f2Panel = await page.evaluate(() => ({ dims: window.__qa.dims(), actual: window.__qa.actual() }));
  const f2Dl = await grabDownload(page, 'E-fresh');
  measurements.raceFresh = { panel: f2Panel, fileBytes: f2Dl.bytes };
  record('E2', '抖动结果 == 重新载入同图同参数的结果（无残留状态）',
    '尺寸一致 且 字节完全一致',
    `抖动 ${eDec.w}×${eDec.h}/${eDl.bytes}B vs 干净 ${f2Panel.dims.w}×${f2Panel.dims.h}/${f2Dl.bytes}B`,
    eDec.w === f2Panel.dims.w && eDec.h === f2Panel.dims.h && eDl.bytes === f2Dl.bytes);

  /* ═══ F · 边界与压力 ══════════════════════════════════════════════ */
  group('F · 边界与压力输入');
  // 1×1
  await page.click('#btn-reset-all');
  await load('px-1x1.png');
  const f1 = await page.evaluate(() => ({ dims: window.__qa.dims(), txt: window.__qa.dimsText(), alive: !!document.getElementById('sm-dims') }));
  record('F1', '1×1 源图：不崩溃、尺寸非 0',
    '面板尺寸存在且 w,h ≥ 16',
    `${f1.txt}`, f1.dims && f1.dims.w >= 16 && f1.dims.h >= 16);

  // 4×4
  await page.click('#btn-reset-all');
  await load('sq-4x4.png');
  await pickRatio(4, 3);
  const f2 = await page.evaluate(() => ({ dims: window.__qa.dims(), txt: window.__qa.dimsText(), ratio: document.getElementById('sm-ratio').textContent.trim() }));
  record('F2', '4×4 源图 + 4:3：不崩溃、尺寸非 0',
    '面板尺寸存在且 w,h ≥ 16',
    `${f2.txt}`, f2.dims && f2.dims.w >= 16 && f2.dims.h >= 16);

  // F7 · Issue #2 回归：小图比例保真（此前记为 P2「已知限制，仅记录不修」，
  // 现被真实用户撞上 → 根因已修于 app.js computeGeometry()/scaleToMinEdge()）。
  const f7err = Math.abs((f2.dims.w / f2.dims.h) / (4 / 3) - 1);
  record('F7', '小图比例保真（Issue #2）：4×4 源 + 4:3 不得被 16px 下限抹平比例',
    '输出 24×18（比例 4:3，误差 < 1%），且短边 ≥ 16',
    `${f2.txt} → 宽高比误差 ${(f7err * 100).toFixed(3)}%（面板比例字段「${f2.ratio}」）`,
    f2.dims && f2.dims.w === 24 && f2.dims.h === 18 && f7err < 0.01);

  // 自定义极端比例 100:1 / 1:100（用 3000×2000 中图）
  await page.click('#btn-reset-all');
  await load('mid-3000x2000.jpg');
  await page.fill('#ratio-w', '100');
  await page.fill('#ratio-h', '1');
  await page.click('#btn-apply-ratio');
  await waitIdle(page);
  const f3 = await page.evaluate(() => ({ dims: window.__qa.dims(), txt: window.__qa.dimsText() }));
  const f3err = Math.abs((f3.dims.w / f3.dims.h) / 100 - 1);
  record('F3', '自定义极端比例 100:1', '输出宽高比误差 < 1%',
    `${f3.txt} → ${(f3err * 100).toFixed(3)}%`, f3err < 0.01);

  await page.fill('#ratio-w', '1');
  await page.fill('#ratio-h', '100');
  await page.click('#btn-apply-ratio');
  await waitIdle(page);
  const f4 = await page.evaluate(() => ({ dims: window.__qa.dims(), txt: window.__qa.dimsText() }));
  const f4err = Math.abs((f4.dims.w / f4.dims.h) / 0.01 - 1);
  record('F4', '自定义极端比例 1:100', '输出宽高比误差 < 1%',
    `${f4.txt} → ${(f4err * 100).toFixed(3)}%`, f4err < 0.01);

  // 8000×6000 大图
  await page.click('#btn-reset-all');
  const tBig0 = Date.now();
  await page.setInputFiles('#file-input', files['huge-8000x6000.jpg'].path);
  await waitIdle(page);
  const tBig1 = Date.now();
  await pickRatio(16, 9);
  const tBig2 = Date.now();
  const f5 = await page.evaluate(() => ({
    dims: window.__qa.dims(), txt: window.__qa.dimsText(), time: window.__qa.timeTxt(),
    panelTime: window.__qa.timeTxt(), flagLarge: !document.getElementById('flag-large').hidden
  }));
  measurements.huge = { loadMs: tBig1 - tBig0, renderMs: tBig2 - tBig1, panel: f5.txt, panelTime: f5.time };
  record('F5', '8000×6000 大图：能处理、尺寸正常、无卡死',
    '输出尺寸有效且显示「大尺寸图片」提示',
    `${f5.txt}｜载入+首渲 ${(tBig1 - tBig0)}ms，改比例再渲 ${(tBig2 - tBig1)}ms，面板耗时 ${f5.time}｜大图提示=${f5.flagLarge}`,
    f5.dims && f5.dims.w >= 1000 && f5.dims.h >= 100 && f5.flagLarge === true);

  // 同一文件连续选择两次
  await page.click('#btn-reset-all');
  await page.setInputFiles('#file-input', files['photo-1600x900.jpg'].path);
  const afterFirst = await page.evaluate(() => window.__qa.inputValue());
  await waitIdle(page);
  await page.setInputFiles('#file-input', files['photo-1600x900.jpg'].path);
  const afterSecond = await page.evaluate(() => window.__qa.inputValue());
  await waitIdle(page);
  const f6name = await page.textContent('#info-name');
  record('F6', '同一文件连续选择两次：input.value 复位、第二次仍正常载入',
    '每次选择后 value 均为空，且图片正常载入',
    `value1="${afterFirst}" value2="${afterSecond}" · name=${f6name}`,
    afterFirst === '' && afterSecond === '' && f6name === 'photo-1600x900.jpg');

  /* ═══ G · 格式覆盖 ════════════════════════════════════════════════ */
  group('G · 格式覆盖（WebP / GIF / BMP）');
  const fmtCases = [
    ['pic-640x480.webp', 'WebP', 640, 480],
    ['pic-120x80.gif', 'GIF', 120, 80],
    ['pic-120x80.bmp', 'BMP', 120, 80]
  ];
  for (const [name, label, ew, eh] of fmtCases) {
    await page.click('#btn-reset-all');
    const srcInfo = await page.evaluate(async (p) => {
      return null;
    }, null);
    void srcInfo;
    await page.setInputFiles('#file-input', files[name].path);
    let decoded = false, dimsTxt = '', fmtTxt = '';
    try {
      await waitIdle(page);
      decoded = true;
    } catch (e) { decoded = false; }
    const info = await page.evaluate(() => ({
      dims: document.getElementById('info-dims').textContent.trim(),
      fmt: document.getElementById('info-format').textContent.trim(),
      name: document.getElementById('info-name').textContent.trim()
    }));
    dimsTxt = info.dims; fmtTxt = info.fmt;
    await pickRatio(1, 1);
    await setFormat('image/jpeg');
    const dl = await grabDownload(page, `G-${label}`);
    const dec = await decodeInPage(page, dl);
    const exp = await page.evaluate(() => window.__qa.dims());
    record(`G·${label}`, `${label} 上传可解码且能导出`,
      `源尺寸 ${ew}×${eh}，导出可解码且尺寸 = 面板`,
      `源 ${dimsTxt}（${fmtTxt}）· 导出 ${dec.w}×${dec.h} / 面板 ${exp ? exp.w + '×' + exp.h : '—'} · ${dec.name} ${dl.bytes}B`,
      decoded && dimsTxt.includes(String(ew)) && dimsTxt.includes(String(eh)) &&
      dec.w > 0 && dec.h > 0 && (!exp || (exp.w === dec.w && exp.h === dec.h)));
  }

  /* ═══ I · 双视图「原图取景」（新增功能）════════════════════════════ */
  group('I · 双视图「原图取景」');
  await page.click('#btn-reset-all');
  await load('bands-900x300.png');
  await pickRatio(1, 1);
  await setFormat('image/jpeg');
  await setMode('max');
  await page.click('#size-presets .chip:text-is("不限")');
  await waitIdle(page);

  // I1 · 裁剪框 bounding box ↔ 源像素换算（居中 + 非对称两种状态）
  await setView('source');
  const measureCrop = () => page.evaluate(() => ({
    box: window.__qa.cropBoxInSourcePx(), rect: window.__qa.cropRect(),
    src: window.__qa.infoDims(), view: window.__qa.viewMode()
  }));
  const errOf = (m) => (m.box && m.rect) ? Math.max(
    Math.abs(m.box.x - m.rect.x), Math.abs(m.box.y - m.rect.y),
    Math.abs(m.box.w - m.rect.w), Math.abs(m.box.h - m.rect.h)) : Infinity;
  const m1 = await measureCrop();
  await dragFrame('x', 0.4, 0.62);                 // 非对称取景
  const m2 = await measureCrop();
  const e1 = errOf(m1), e2 = errOf(m2);
  measurements.cropBox = { centered: { ...m1, errPx: e1 }, offset: { ...m2, errPx: e2 } };
  const fmtM = (m, e) => m.box
    ? `框 ${m.box.w.toFixed(2)}×${m.box.h.toFixed(2)} @ (${m.box.x.toFixed(2)}, ${m.box.y.toFixed(2)}) vs 读数 ${m.rect.w}×${m.rect.h} @ (${m.rect.x}, ${m.rect.y}) → ${e.toFixed(2)}px`
    : '裁剪框不可见';
  record('I1', '裁剪框 bounding box 换算回源像素 = #crop-rect（居中 + 非对称，误差 ≤ 1px）',
    '两种状态下 w/h/x/y 误差均 ≤ 1px',
    `居中：${fmtM(m1, e1)}；非对称：${fmtM(m2, e2)}`,
    e1 <= 1 && e2 <= 1);

  await page.click('#btn-reset-crop'); await waitIdle(page);

  // I2 · 原图取景视图拖动方向（与成片视图相反）
  await page.click('#btn-reset-crop'); await waitIdle(page);
  const i2a = await page.evaluate(() => window.__qa.cropRect());
  await dragFrame('x', 0.4, 0.6);                       // 向右拖框
  const i2b = await page.evaluate(() => window.__qa.cropRect());
  await page.click('#btn-reset-crop'); await waitIdle(page);
  await dragFrame('x', 0.6, 0.4);                       // 向左拖框
  const i2c = await page.evaluate(() => window.__qa.cropRect());
  measurements.sourceDrag = { right: [i2a.x, i2b.x], left: [i2a.x, i2c.x] };
  record('I2', '原图取景视图：向右拖框 → #crop-rect 的 x 增大（方向与成片视图相反）',
    'x 随「向右拖」增大、随「向左拖」减小',
    `起始 x=${i2a.x} → 右拖后 x=${i2b.x}（增）→ 左拖后 x=${i2c.x}（减）`,
    i2b.x > i2a.x && i2c.x < i2a.x);

  // I3 · 两条拖动路径殊途同归
  await page.click('#btn-reset-crop'); await waitIdle(page);
  await setView('crop');
  for (let i = 0; i < 3; i++) await dragFrame('x', 0.85, 0.15);   // 成片视图向左拖 → 饱和 focus=100%
  const i3c = await page.evaluate(() => ({ rect: window.__qa.cropRect(), dims: window.__qa.dimsText(), focus: window.__qa.focus() }));
  const i3cDl = await grabDownload(page, 'I3-cropview');
  await page.click('#btn-reset-crop'); await waitIdle(page);
  await setView('source');
  for (let i = 0; i < 3; i++) await dragFrame('x', 0.15, 0.85);   // 原图取景向右拖 → 饱和 focus=100%
  const i3s = await page.evaluate(() => ({ rect: window.__qa.cropRect(), dims: window.__qa.dimsText(), focus: window.__qa.focus() }));
  const i3sDl = await grabDownload(page, 'I3-sourceview');
  measurements.twoPaths = { crop: i3c, source: i3s, cropBytes: i3cDl.bytes, sourceBytes: i3sDl.bytes };
  const sameRect = i3c.rect && i3s.rect &&
    i3c.rect.x === i3s.rect.x && i3c.rect.y === i3s.rect.y &&
    i3c.rect.w === i3s.rect.w && i3c.rect.h === i3s.rect.h;
  record('I3', '两条拖动路径殊途同归：两视图拖到同一焦点 → 裁切区/尺寸/导出字节完全一致',
    'crop-rect 相同 且 #sm-dims 相同 且 导出字节相同',
    `成片 ${i3c.rect.x},${i3c.rect.y} ${i3c.dims} ${i3cDl.bytes}B（${i3c.focus}）vs 原图取景 ${i3s.rect.x},${i3s.rect.y} ${i3s.dims} ${i3sDl.bytes}B（${i3s.focus}）`,
    sameRect && i3c.dims === i3s.dims && i3cDl.bytes === i3sDl.bytes);

  // I4 · 切换视图零副作用
  await setView('crop');
  await page.click('#btn-reset-crop'); await waitIdle(page);
  const snap = () => page.evaluate(() => ({
    dims: window.__qa.dimsText(), actual: window.__qa.actualText(), verdict: window.__qa.verdict(),
    time: window.__qa.timeTxt(), foot: window.__qa.foot(), scale: window.__qa.scaleTxt()
  }));
  const i4before = await snap();
  const i4dl1 = await grabDownload(page, 'I4-before');
  for (let i = 0; i < 5; i++) { await setView('source'); await setView('crop'); }
  await page.waitForTimeout(500);
  const i4after = await snap();
  const i4dl2 = await grabDownload(page, 'I4-after');
  measurements.viewToggle = { before: i4before, after: i4after, bytes: [i4dl1.bytes, i4dl2.bytes] };
  const sameSnap = ['dims', 'actual', 'verdict', 'time', 'foot', 'scale'].every((k) => i4before[k] === i4after[k]);
  record('I4', '来回切视图 5 次零副作用：面板四项 + 下载字节 + #sm-time 全不变',
    'dims/actual/verdict/time/scale 及导出字节完全不变',
    `切换前 ${i4before.dims} · ${i4before.actual} · ${i4before.verdict} · time=${i4before.time} · ${i4dl1.bytes}B；切换后 ${i4after.dims} · ${i4after.actual} · ${i4after.verdict} · time=${i4after.time} · ${i4dl2.bytes}B`,
    sameSnap && i4dl1.bytes === i4dl2.bytes);

  // I5 · 帧比例
  await setView('crop');
  const i5c = await page.evaluate(() => ({ ar: window.__qa.frameAspect(), dims: window.__qa.dims() }));
  await setView('source');
  const i5s = await page.evaluate(() => ({ ar: window.__qa.frameAspect(), src: window.__qa.infoDims() }));
  const e5c = Math.abs(i5c.ar / (i5c.dims.w / i5c.dims.h) - 1);
  const e5s = Math.abs(i5s.ar / (i5s.src.w / i5s.src.h) - 1);
  measurements.frameAspect = { crop: [i5c.ar, e5c], source: [i5s.ar, e5s] };
  record('I5', '帧比例：成片视图 ≈ 输出比例；原图取景视图 ≈ 原图比例（容差 2%）',
    '两者误差均 < 2%',
    `成片 ${i5c.ar.toFixed(4)} vs ${(i5c.dims.w / i5c.dims.h).toFixed(4)} → ${(e5c * 100).toFixed(2)}%；原图取景 ${i5s.ar.toFixed(4)} vs ${(i5s.src.w / i5s.src.h).toFixed(4)} → ${(e5s * 100).toFixed(2)}%`,
    e5c < 0.02 && e5s < 0.02);

  // I6 · 框外压暗只是视觉：两视图导出像素逐字节相同，且仍是「裁切后」而非整张原图
  await setFormat('image/png');
  await setView('crop');
  const i6a = await grabDownload(page, 'I6-cropview');
  await setView('source');
  const i6b = await grabDownload(page, 'I6-sourceview');
  const i6bDec = await decodeInPage(page, i6b);
  const i6Panel = await page.evaluate(() => ({ dims: window.__qa.dims(), src: window.__qa.infoDims() }));
  const i6byteIdentical = i6a.bytes === i6b.bytes && Buffer.compare(i6a.buf, i6b.buf) === 0;
  const i6isCrop = i6bDec.w === i6Panel.dims.w && i6bDec.h === i6Panel.dims.h &&
    !(i6bDec.w === i6Panel.src.w && i6bDec.h === i6Panel.src.h);
  measurements.crossViewPixels = { bytes: [i6a.bytes, i6b.bytes], decoded: [i6bDec.w, i6bDec.h], panel: i6Panel.dims, src: i6Panel.src };
  record('I6', '框外压暗只是视觉：两视图导出逐字节相同，且导出的是裁切结果而非整张原图',
    '字节完全一致，且解码尺寸 = 裁切输出尺寸 ≠ 原图尺寸',
    `成片 ${i6a.bytes}B vs 原图取景 ${i6b.bytes}B（逐字节相同=${i6byteIdentical}）；解码 ${i6bDec.w}×${i6bDec.h} = 裁切 ${i6Panel.dims.w}×${i6Panel.dims.h}，原图 ${i6Panel.src.w}×${i6Panel.src.h}`,
    i6byteIdentical && i6isCrop);

  // I7 · 空态健壮性
  await page.click('#btn-reset-all');
  const cBefore = consoleMsgs.length, pBefore = pageErrors.length;
  for (let i = 0; i < 5; i++) { await setView('source'); await setView('crop'); }
  await page.click('#steps-list .steps__item[data-step="crop"]');
  await page.waitForTimeout(400);
  const i7 = await page.evaluate(() => ({ empty: window.__qa.emptyVisible(), dims: window.__qa.dimsText() }));
  const i7console = consoleMsgs.length - cBefore, i7errors = pageErrors.length - pBefore;
  record('I7', '空态健壮性：无图片时切视图 / 点「05 取景」不报错、无 console 异常',
    '空态仍显示、面板仍为「—」、0 新增 console/异常',
    `空态可见=${i7.empty} · 面板「${i7.dims}」· 新增 console ${i7console} 条 / 异常 ${i7errors} 条`,
    i7.empty === true && i7.dims === '—' && i7console === 0 && i7errors === 0);
  await setView('crop');

  // I8 · 三分线跟随裁剪框
  await load('bands-900x300.png');
  await pickRatio(1, 1);
  await waitIdle(page);
  if ((await page.getAttribute('#btn-toggle-grid', 'aria-pressed')) !== 'true') await page.click('#btn-toggle-grid');
  await setView('source');
  const i8 = await page.evaluate(() => {
    const spans = Array.prototype.map.call(document.querySelectorAll('#stage-thirds span'), (s) => {
      const r = s.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    });
    return { crop: window.__qa.rectOf('stage-crop'), thirds: window.__qa.rectOf('stage-thirds'), spans };
  });
  const inside = (a, b, tol) => a && b && a.x >= b.x - tol && a.y >= b.y - tol &&
    a.x + a.w <= b.x + b.w + tol && a.y + a.h <= b.y + b.h + tol;
  const i8thirdsOk = inside(i8.thirds, i8.crop, 1);
  const i8spansOk = i8.spans.every((s) => inside(s, i8.crop, 1));
  measurements.thirds = { crop: i8.crop, thirds: i8.thirds, spansInside: i8spansOk };
  record('I8', '三分线跟随裁剪框：#stage-thirds 及其 4 条线都落在 #stage-crop 内（容差 1px）',
    '三分线容器与 4 条线均在裁剪框内（≤1px）',
    i8.crop ? `crop ${i8.crop.w.toFixed(1)}×${i8.crop.h.toFixed(1)} @ (${i8.crop.x.toFixed(1)}, ${i8.crop.y.toFixed(1)})；thirds 落入=${i8thirdsOk}；4 条线落入=${i8spansOk}` : '裁剪框不可见',
    i8thirdsOk && i8spansOk);

  // I9 · warn toast：PNG + 目标体积且未达标
  await page.click('#btn-reset-all');
  await load('photo-1600x900.jpg');
  await pickRatio(1, 1);
  await setFormat('image/png');
  await setMode('max');
  await setTargetKB(200);
  await page.evaluate(() => window.__qa.clearToasts());
  const i9Panel = await page.evaluate(() => ({ actual: window.__qa.actual(), target: window.__qa.target(), verdict: window.__qa.verdict() }));
  const i9Dl = await grabDownload(page, 'I9-warn');
  const i9Toasts = await page.evaluate(() => window.__qa.toasts());
  const i9kinds = i9Toasts.map((t) => t.kind);
  measurements.warnToast = { kinds: i9kinds, panel: i9Panel, bytes: i9Dl.bytes };
  record('I9', 'PNG + 目标体积且未达标：导出时同时出现 success 与 data-kind="warn"',
    'toast 种类同时含 success 与 warn；面板判定未达标',
    `toast=[${i9kinds.join(', ')}]｜面板 ${i9Panel.actual} > 目标 ${i9Panel.target}｜${i9Panel.verdict}｜文件 ${i9Dl.bytes}B`,
    i9kinds.indexOf('success') > -1 && i9kinds.indexOf('warn') > -1 &&
    i9Panel.actual !== null && i9Panel.target !== null && i9Panel.actual > i9Panel.target);

  // I10 · 粘贴 items 兜底（files 为空）
  await page.click('#btn-reset-all');
  await page.evaluate(({ b64 }) => window.__qa.pasteItemsOnly(b64, 'items-only.png', 'image/png'),
    { b64: files['bands-900x300.png'].b64 });
  await waitIdle(page);
  const i10 = await page.evaluate(() => ({
    name: document.getElementById('info-name').textContent.trim(),
    dims: document.getElementById('info-dims').textContent.trim()
  }));
  measurements.pasteItems = i10;
  record('I10', '粘贴兜底：files 为空、只有 items(kind:file) 时也能载入',
    '载入 items-only.png / 900 × 300 px',
    `${i10.name} / ${i10.dims}`,
    i10.name === 'items-only.png' && i10.dims.indexOf('900') > -1 && i10.dims.indexOf('300') > -1);

  // I11 · 独立复核设计同事对 1024–1279px 布局改动的结论（无溢出 / 步骤条不被拉伸）
  const widths = [1024, 1100, 1279, 1440];
  const resp = [];
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: 950 });
    await page.waitForTimeout(240);
    resp.push(await page.evaluate((w) => {
      const ws = document.querySelector('.workspace');
      return {
        w,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        cols: getComputedStyle(ws).gridTemplateColumns.split(' ').length,
        stepsH: Math.round(document.getElementById('steps-list').getBoundingClientRect().height),
        railH: Math.round(document.querySelector('.rail').getBoundingClientRect().height)
      };
    }, w));
  }
  await page.setViewportSize({ width: 1512, height: 950 });
  await page.waitForTimeout(240);
  measurements.responsive = resp;
  const narrowW = resp.filter((r) => r.w < 1280);
  const wideW = resp.filter((r) => r.w >= 1280);
  record('I11', '复核 ≤1279px 布局改动：无横向溢出、步骤条保持横向单行（1440px 属设计内 3 列布局）',
    '所有断点 overflow ≤ 1px；<1280px 为 2 列且 steps < 120px；≥1280px 为 3 列且 steps 为纵向',
    resp.map((r) => `${r.w}px: overflow ${r.overflow} · ${r.cols} 列 · steps ${r.stepsH}px · rail ${r.railH}px`).join('；'),
    resp.every((r) => r.overflow <= 1) &&
    narrowW.every((r) => r.cols === 2 && r.stepsH < 120) &&
    wideW.every((r) => r.cols === 3 && r.stepsH > 120));

  /* ═══ J · 右栏面板布局完整性（设计侧 Critical 修复的独立验证）═══════ */
  group('J · 右栏面板布局完整性');
  await page.click('#btn-reset-all');
  await load('photo-1600x900.jpg');
  await pickRatio(1, 1);
  await setFormat('image/jpeg');
  await setTargetKB(200);          // 触发标志位，使面板进入较高的默认状态
  const j = await page.evaluate(() => {
    const panels = Array.prototype.map.call(document.querySelectorAll('.panel'), (p) => ({
      id: p.id || '(no-id)', client: p.clientHeight, scroll: p.scrollHeight
    }));
    const ins = document.querySelector('.inspector');
    return {
      panels,
      inspectorClient: ins.clientHeight,
      inspectorScroll: ins.scrollHeight,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  });
  const squashed = j.panels.filter((p) => p.scroll > p.client + 1);
  measurements.panels = j;
  record('J1', '设定目标体积后，全部面板内容未被压扁（scrollHeight == clientHeight）',
    '每个 .panel 的 scrollHeight ≤ clientHeight + 1px（内容不溢出面板）',
    j.panels.map((p) => `${p.id}:${p.client}/${p.scroll}`).join(' ') +
    (squashed.length ? ` ← 压扁：${squashed.map((p) => p.id).join(',')}` : '（无压扁）'),
    squashed.length === 0);

  // J1b · 阴性对照：临时在页面内撤销该修复（还原为 flex 默认的 0 1 auto），
  // 确认 J1 能把「面板被压扁」检出来 —— 证明 J1 不是空断言。
  const negCtl = await page.evaluate(() => {
    const st = document.createElement('style');
    st.textContent = '.rail > *, .inspector > * { flex: 0 1 auto !important; }';
    document.head.appendChild(st);
    void document.body.offsetHeight;                 // 强制 reflow
    const bad = Array.prototype.map.call(document.querySelectorAll('.panel'), (p) => ({ id: p.id, client: p.clientHeight, scroll: p.scrollHeight }))
      .filter((p) => p.scroll > p.client + 1);
    st.remove();
    void document.body.offsetHeight;
    return { bad: bad.map((p) => `${p.id}:${p.client}/${p.scroll}`) };
  });
  record('J1b', '阴性对照：临时撤销该 flex 修复后 J1 能检出压扁（J1 非空断言）',
    '撤销修复后至少 1 个面板 scroll > client + 1',
    negCtl.bad.length ? `复现压扁：${negCtl.bad.join(' ')}` : '未能复现压扁（J1 可能空断言，需复核）',
    negCtl.bad.length > 0);
  // 对照后确认面板已恢复正常（避免污染 J2）
  const jRestored = await page.evaluate(() => Array.prototype.map.call(document.querySelectorAll('.panel'), (p) => p.scrollHeight - p.clientHeight).filter((d) => d > 1).length);
  record('J1c', '撤销阴性对照后布局恢复（不污染后续断言）', '0 个面板仍压扁', `仍压扁 ${jRestored} 个`, jRestored === 0);

  record('J2', '右栏以「自身滚动」代替「压扁面板」，且无横向溢出',
    '.inspector scrollHeight > clientHeight；页面 overflowX ≤ 1px',
    `inspector ${j.inspectorClient}/${j.inspectorScroll}；overflowX ${j.overflowX}px`,
    j.inspectorScroll > j.inspectorClient && j.overflowX <= 1);

  // J3 · 设计侧文案与视图语义对齐（index.html）
  // 注：原断言把「不主动降分辨率」写进了期望，而该文案本身是缺陷——
  //     目标体积过小时压缩算法确实会降分辨率，这句承诺并不成立。
  //     断言改为「不再承诺不降分辨率」，比原来更严。
  const j3 = await page.evaluate(() => ({
    modeMeta: Array.prototype.map.call(document.querySelectorAll('#size-modes .chip__meta'), (n) => n.textContent.trim()),
    cropLead: (document.querySelector('#panel-crop .panel__lead') || {}).textContent.replace(/\s+/g, ' ').trim()
  }));
  measurements.copyAlignment = j3;
  record('J3', 'index.html 文案与视图语义对齐（尺寸策略不承诺「不降分辨率」/ 取景说明为视图中性）',
    '尺寸策略含「按原图可用像素」且全组不含「不降分辨率」；取景说明同时提及「成片」与「原图取景」',
    `${j3.modeMeta.join(' | ')} ／ 取景说明「${j3.cropLead.slice(0, 70)}…」`,
    j3.modeMeta.indexOf('按原图可用像素') > -1 &&
    j3.modeMeta.join(' ').indexOf('不降分辨率') === -1 &&
    /成片/.test(j3.cropLead) && /原图取景/.test(j3.cropLead));

  // J4 · 右栏面板不被压扁（回归防护）
  // 背景：`.panel { overflow: hidden }` 会让 flex 子项的自动最小尺寸按 0 计算，
  // 在 `.inspector` 的 max-height 约束下，面板被压成只剩标题的细条、文字溢出边框。
  // 修复是 `.rail > *, .inspector > * { flex: 0 0 auto }`。矮屏最容易复现，故在 1366×768 下断言。
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.waitForTimeout(300);
  const j4 = await page.evaluate(() => Array.prototype.map.call(
    document.querySelectorAll('.inspector > .panel'),
    (p) => ({ id: p.id || '(no-id)', h: Math.round(p.getBoundingClientRect().height), s: Math.round(p.scrollHeight) })
  ));
  await page.setViewportSize({ width: 1512, height: 950 });
  await page.waitForTimeout(250);
  measurements.panelHeights = j4;
  const squashedNarrow = j4.filter((p) => p.h < p.s - 2);
  record('J4', '1366×768 下右栏每个面板按内容撑开、未被 flex 压缩',
    '全部面板 h ≥ scrollHeight − 2',
    squashedNarrow.length ? squashedNarrow.map((p) => `${p.id} ${p.h}<${p.s}`).join(', ') : `${j4.length} 个面板均未被压缩`,
    squashedNarrow.length === 0);

  /* ═══ H · 全局清洁度 ══════════════════════════════════════════════ */
  group('H · 全局清洁度（整轮累计）');
  record('H1', '整轮运行 0 条 console error / warning', '0 条',
    consoleMsgs.length ? consoleMsgs.slice(0, 6).join(' | ') : '0', consoleMsgs.length === 0);
  record('H2', '整轮运行 0 个非 file:// / data: / blob: 网络请求', '0 个',
    externalRequests.length ? externalRequests.slice(0, 6).join(', ') : '0', externalRequests.length === 0);
  record('H3', '整轮运行 0 个未捕获页面异常', '0 条',
    pageErrors.length ? pageErrors.join(' | ') : '0', pageErrors.length === 0);

  await context.close();
  await browser.close();

  /* ── 报告 ──────────────────────────────────────────────────────────── */
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  const L = [];
  L.push('# CoverForge 独立验证报告（VERIFY-REPORT.md）');
  L.push('');
  L.push('> 由 `tests/verify.mjs` 生成 —— **独立于实现者自写的 `tests/qa.mjs`**，');
  L.push('> 采用「下载文件重新解码回读真实像素」的对抗式验证，专攻既有套件盲区。');
  L.push('');
  L.push(`运行时间：${new Date().toISOString()}`);
  L.push('');
  L.push(`**用例总数 ${results.length} · 通过 ${passed} · 失败 ${failed.length}**`);
  L.push('');
  L.push('## 用例明细');
  L.push('');
  L.push('| # | 用例 | 预期 | 实测 | 结论 |');
  L.push('|---|---|---|---|---|');
  for (const r of results) {
    L.push(`| ${r.id} | ${r.testCase} | ${String(r.expected).replace(/\|/g, '\\|')} | ${String(r.actual).replace(/\|/g, '\\|')} | ${r.pass ? '✅ 通过' : '❌ 失败'} |`);
  }
  L.push('');
  L.push('## 关键实测数据');
  L.push('');
  L.push('### 真实像素级（解码回读）');
  L.push('');
  L.push('| 场景 | 面板尺寸 | 解码尺寸 | 各色带像素计数（红/绿/蓝） |');
  L.push('|---|---|---|---|');
  const cm = measurements.centerCrop;
  if (cm) L.push(`| 居中 1:1 | ${cm.panel.w}×${cm.panel.h} | ${cm.decoded.w}×${cm.decoded.h} | ${cm.counts.join(' / ')}（其他 ${cm.other}） |`);
  if (measurements.dragRight) L.push(`| 指针右拖 | — | — | ${measurements.dragRight.counts.join(' / ')}（焦点 ${measurements.dragRight.focus}） |`);
  if (measurements.dragLeft) L.push(`| 指针左拖 | — | — | ${measurements.dragLeft.counts.join(' / ')}（焦点 ${measurements.dragLeft.focus}） |`);
  L.push('');
  L.push('### 预估 vs 实际字节');
  L.push('');
  L.push('| 场景 | 面板显示 | 面板解析字节 | 下载真实字节 | 差值 |');
  L.push('|---|---|---|---|---|');
  for (const [k, m] of [['不限体积', measurements.estimateUnlimited], ['500 KB 目标', measurements.estimate500k]]) {
    if (m) L.push(`| ${k} | ${m.panelText} | ${m.panelBytes && m.panelBytes.toFixed(1)} | ${m.fileBytes} | ${Math.abs((m.panelBytes || 0) - m.fileBytes).toFixed(1)} |`);
  }
  L.push('');
  L.push('### 透明语义');
  L.push('');
  if (measurements.alphaPng) L.push(`- PNG 导出角落像素：rgba(${measurements.alphaPng.corner.r},${measurements.alphaPng.corner.g},${measurements.alphaPng.corner.b},**${measurements.alphaPng.corner.a}**)，中心 a=${measurements.alphaPng.center.a}`);
  if (measurements.alphaJpg) L.push(`- JPG(背景 #0A0C0F) 角落像素：${measurements.alphaJpg.corners.map((p) => `(${p.r},${p.g},${p.b})`).join('，')}`);
  L.push('');
  L.push('### 降分辨率一致性（对抗性重点）');
  L.push('');
  if (measurements.downscale) {
    const d = measurements.downscale;
    L.push(`- 面板尺寸 **${d.panel.txt}**（${d.panel.scale}）`);
    L.push(`- 下载文件 **${d.file.name}** · ${d.file.bytes} B · 真实解码 **${d.file.w} × ${d.file.h}**`);
    L.push(`- 面板「分辨率变化」：${d.panel.scale}`);
  }
  L.push('');
  L.push('### 竞态 / 抖动');
  L.push('');
  if (measurements.race) L.push(`- 抖动后：面板 ${measurements.race.panel.dims.w}×${measurements.race.panel.dims.h} · 文件 ${measurements.race.file.bytes} B（${measurements.race.file.w}×${measurements.race.file.h}）· ${measurements.race.panel.verdict}`);
  if (measurements.raceFresh) L.push(`- 干净重载：面板 ${measurements.raceFresh.panel.dims.w}×${measurements.raceFresh.panel.dims.h} · 文件 ${measurements.raceFresh.fileBytes} B`);
  L.push('');
  L.push('### 双视图「原图取景」（新增功能）');
  L.push('');
  if (measurements.cropBox && measurements.cropBox.centered && measurements.cropBox.centered.box) {
    const cc = measurements.cropBox.centered, oo = measurements.cropBox.offset;
    L.push(`- 裁剪框换算回源像素（居中）：**${cc.box.w.toFixed(2)} × ${cc.box.h.toFixed(2)} @ (${cc.box.x.toFixed(2)}, ${cc.box.y.toFixed(2)})** vs 读数 ${cc.rect.w} × ${cc.rect.h} @ (${cc.rect.x}, ${cc.rect.y}) → 误差 **${cc.errPx.toFixed(3)} px**`);
    if (oo && oo.box) L.push(`- 裁剪框换算回源像素（非对称）：${oo.box.w.toFixed(2)} × ${oo.box.h.toFixed(2)} @ (${oo.box.x.toFixed(2)}, ${oo.box.y.toFixed(2)}) vs 读数 ${oo.rect.w} × ${oo.rect.h} @ (${oo.rect.x}, ${oo.rect.y}) → 误差 **${oo.errPx.toFixed(3)} px**`);
  }
  if (measurements.sourceDrag) L.push(`- 原图取景拖动方向：起始 x=${measurements.sourceDrag.right[0]} → 向右拖 x=${measurements.sourceDrag.right[1]}；向左拖 x=${measurements.sourceDrag.left[1]}`);
  if (measurements.twoPaths) {
    const t = measurements.twoPaths;
    L.push(`- 两条拖动路径收敛：成片视图 ${t.crop.rect.x},${t.crop.rect.y}（${t.crop.dims}，${t.cropBytes} B）vs 原图取景 ${t.source.rect.x},${t.source.rect.y}（${t.source.dims}，${t.sourceBytes} B）`);
  }
  if (measurements.viewToggle) {
    const v = measurements.viewToggle;
    L.push(`- 切换视图 5 次：dims ${v.before.dims}→${v.after.dims}｜actual ${v.before.actual}→${v.after.actual}｜time ${v.before.time}→${v.after.time}｜字节 ${v.bytes[0]}→${v.bytes[1]}`);
  }
  if (measurements.frameAspect) {
    L.push(`- 帧比例：成片 ${measurements.frameAspect.crop[0].toFixed(4)}（误差 ${(measurements.frameAspect.crop[1] * 100).toFixed(2)}%）｜原图取景 ${measurements.frameAspect.source[0].toFixed(4)}（误差 ${(measurements.frameAspect.source[1] * 100).toFixed(2)}%）`);
  }
  if (measurements.crossViewPixels) {
    const c = measurements.crossViewPixels;
    L.push(`- 跨视图像素：${c.bytes[0]} B vs ${c.bytes[1]} B；解码 ${c.decoded[0]}×${c.decoded[1]}（裁切 ${c.panel.w}×${c.panel.h}，原图 ${c.src.w}×${c.src.h}）`);
  }
  if (measurements.warnToast) L.push(`- warn toast：种类 [${measurements.warnToast.kinds.join(', ')}]，导出 ${measurements.warnToast.bytes} B`);
  if (measurements.pasteItems) L.push(`- 粘贴 items-only 兜底：${measurements.pasteItems.name} / ${measurements.pasteItems.dims}`);
  if (measurements.responsive) L.push(`- 响应式复核：${measurements.responsive.map((r) => `${r.w}px overflow=${r.overflow}/${r.cols}列/steps=${r.stepsH}px`).join('，')}`);
  if (measurements.panels) {
    const p = measurements.panels;
    L.push(`- 面板完整性（client/scroll）：${p.panels.map((x) => `${x.id} ${x.client}/${x.scroll}`).join('，')}`);
    L.push(`- 右栏（.inspector）client/scroll：${p.inspectorClient}/${p.inspectorScroll}（可滚动=以其自身滚动代替压扁面板）`);
  }
  L.push('');
  L.push('### 大图压力');
  if (measurements.huge) L.push(`- 8000×6000：载入+首渲 ${measurements.huge.loadMs} ms，改比例再渲 ${measurements.huge.renderMs} ms，面板耗时 ${measurements.huge.panelTime}，输出 ${measurements.huge.panel}`);
  L.push('');
  L.push('### 全局清洁度');
  L.push('');
  L.push(`- console error/warning：**${consoleMsgs.length}** 条`);
  L.push(`- 非 file:// 网络请求：**${externalRequests.length}** 个`);
  L.push(`- 未捕获页面异常：**${pageErrors.length}** 条`);
  L.push('');
  L.push('## 失败用例');
  L.push('');
  if (failed.length) {
    for (const f of failed) L.push(`- **${f.id}** ${f.testCase}：${f.actual}`);
  } else {
    L.push('无。');
  }
  L.push('');
  L.push('## 残留风险 / 未覆盖场景');
  L.push('');
  L.push('- **已修（Issue #2）**：源图任一边小于 16px 时，`app.js` `computeGeometry()` 原先对');
  L.push('  `outW`/`outH` 各自 `clamp(·,16,12000)`，会改变宽高比（4×4 源 + 4:3 曾被压成 16×16）。');
  L.push('  现改为「短边不足 16 时按裁切区整数倍整体放大」（4×3 → ×6 → 24×18，比例精确 4:3），');
  L.push('  上限同理整体等比缩小；`scaleCanvas()` 的逐边 `Math.max(16,·)` 一并抽成 `scaleToMinEdge()`。');
  L.push('- **残留（整数裁切量化，非 16px 下限）**：极小的非整数裁切区会因像素取整偏离理想比例 ——');
  L.push('  如 4×4 源请求 16:9，整数裁切区为 4×2（=2:1），输出 32×16（比例误差 12.5%）。');
  L.push('  这是「整数像素裁切」的固有量化，任何实现都无法在 4×4 源上得到精确 16:9，非本 Bug 根因。');
  L.push('- 未覆盖：Safari / Firefox 渲染差异（本机仅测 Chrome）；超大图（>16384px 单边）会触发浏览器画布上限，未测。');
  L.push('- 未覆盖：真实剪贴板（系统级 ⌘V）与真实文件拖拽（本脚本用合成事件，`qa.mjs` 亦同）。');
  L.push('- 未覆盖：原图取景视图的**纵向**拖动（需竖图且 gapY>0）、以及真实触屏上的指针捕获行为（本机以鼠标事件 + `setPointerCapture` 模拟）。');
  L.push('- 未覆盖：`#stage-crop` 的 `box-shadow` 压暗在极端比例下的视觉表现（仅断言几何位置与导出像素，不断言压暗观感）。');
  L.push('- JPEG 属有损格式，颜色断言（透明背景填充）按 ±14 容差判定；字节级一致性断言为零容差。');
  L.push('');

  fs.mkdirSync(OUT, { recursive: true });
  const report = L.join('\n');
  fs.writeFileSync(path.join(OUT, 'VERIFY-REPORT.md'), report);
  fs.writeFileSync(path.join(ROOT, 'VERIFY-REPORT.md'), report);   // 独立根目录的持久副本

  console.log('\n' + '='.repeat(74));
  console.log(`独立验证：共 ${results.length} 项 · 通过 ${passed} · 失败 ${failed.length}`);
  if (failed.length) for (const f of failed) console.log(`  ❌ ${f.id} ${f.testCase}\n     ${f.actual}`);
  console.log('报告：' + path.join(OUT, 'VERIFY-REPORT.md'));
  console.log('='.repeat(74));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('验证运行异常：', e);
  process.exit(2);
});
