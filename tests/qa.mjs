/* ============================================================================
 * CoverForge · 封面工坊 — 端到端 QA（真实浏览器）
 *
 * 运行：
 *   cd tests && npm install playwright-core && node qa.mjs
 *
 * 说明：
 *   - 使用系统 Chrome（channel: 'chrome'），不需要下载 Playwright 自带的浏览器。
 *   - 测试样图由浏览器自己用 canvas 生成（真实 JPEG/PNG 编码），写入 tests/output/，
 *     不会混进交付目录；tests/output/ 已在 .gitignore 中。
 *   - 每次下载都会被真机捕获，校验字节数与 magic bytes，而不是「假设成功」。
 * ========================================================================= */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = 'file://' + path.resolve(here, '..', 'index.html');
/* 输出目录：tests/output/ —— 与 README / USAGE / CONTRIBUTING 中写明的路径一致。
   历史说明：这里曾用 `output-designer-<pid>` 按 PID 隔离，起因是当时两个脚本都会
   `rmSync` 同一个 output/、互相删产物。现在 qa.mjs 只 `mkdirSync` 从不删除，
   verify.mjs 也只清自己的 output-verify/，冲突已不存在；而带 PID 的目录名会让
   「文档指明的报告路径」永远停留在旧文件上（排查 Issue #2 时真的被它误导过）。
   两套脚本的报告文件名不同（QA-REPORT.md / VERIFY-REPORT.md），可安全共存。 */
const OUT = path.join(here, 'output');
const FIX = path.join(OUT, 'fixtures');
const DL = path.join(OUT, 'downloads');

/* 看门狗：多 agent 并行跑浏览器时可能被拖慢，但绝不允许无限挂起 */
const WATCHDOG_MS = 20 * 60 * 1000;
setTimeout(() => {
  console.error(`\n[WATCHDOG] 超过 ${WATCHDOG_MS / 60000} 分钟仍未结束，强制退出。`);
  process.exit(3);
}, WATCHDOG_MS).unref();

for (const d of [OUT, FIX, DL]) fs.mkdirSync(d, { recursive: true });
console.log(`运行目录：${OUT}`);

/* ── 结果记录 ────────────────────────────────────────────────────────── */
const results = [];
let currentGroup = '';

function group(name) {
  currentGroup = name;
  console.log(`\n── ${name} ──`);
}

function record(id, testCase, expected, actual, pass) {
  results.push({ group: currentGroup, id, testCase, expected, actual, pass: !!pass });
  const mark = pass ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${id} ${testCase}\n        预期: ${expected}\n        实测: ${actual}`);
}

function assert(id, testCase, expected, actual, pass) {
  record(id, testCase, expected, actual, pass);
  return !!pass;
}

/* ── 浏览器内小工具（注入页面用）────────────────────────────────────── */
const pageHelpers = `
window.__forge = {
  state: () => window.__forgeState ? window.__forgeState() : null,
  dims: () => {
    const t = document.getElementById('sm-dims').textContent.trim();
    const m = t.match(/(\\d+)\\s*×\\s*(\\d+)/);
    return m ? { w: +m[1], h: +m[2], text: t } : null;
  },
  actualBytes: () => {
    const t = document.getElementById('sm-actual').textContent.trim();
    return forgeParseBytes(t);
  },
  targetBytes: () => {
    const t = document.getElementById('sm-target').textContent.trim();
    return /不限/.test(t) ? null : forgeParseBytes(t);
  },
  verdict: () => document.getElementById('sm-verdict').textContent.trim(),
  foot: () => document.getElementById('sm-foot').textContent.trim(),
  scale: () => document.getElementById('sm-scale').textContent.trim(),
  quality: () => document.getElementById('sm-quality').textContent.trim(),
  time: () => document.getElementById('sm-time').textContent.trim(),
  frameAspect: () => {
    const r = document.getElementById('stage-frame').getBoundingClientRect();
    return r.height ? r.width / r.height : 0;
  },
  busy: () => !document.getElementById('stage-busy').hidden,
  canvasMatchesFrame: () => {
    const c = document.getElementById('stage-canvas');
    const box = document.getElementById('stage-frame').getBoundingClientRect();
    return { cw: c.width, ch: c.height, fw: Math.round(box.width), fh: Math.round(box.height) };
  },
  canvasIsBlank: () => {
    const c = document.getElementById('stage-canvas');
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(Math.floor(c.width/2), Math.floor(c.height/2), 8, 8).data;
    let sum = 0; for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i+1] + d[i+2] + d[i+3];
    return sum === 0;
  },
  makeFile: async (b64, name, mime) => {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new File([arr], name, { type: mime });
  },
  pasteBase64: async (b64, name, mime) => {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const file = new File([arr], name, { type: mime });
    const dt = new DataTransfer();
    dt.items.add(file);
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    return true;
  },
  dragBase64: async (b64, name, mime, drop) => {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const file = new File([arr], name, { type: mime });
    const dt = new DataTransfer();
    dt.items.add(file);
    const mk = (type) => new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true });
    window.dispatchEvent(mk('dragenter'));
    window.dispatchEvent(mk('dragover'));
    const veilOn = document.getElementById('drop-veil').classList.contains('is-on');
    if (drop) {
      window.dispatchEvent(mk('drop'));
    } else {
      window.dispatchEvent(mk('dragleave'));
    }
    return veilOn;
  }
};
function forgeParseBytes(t) {
  const m = t.match(/([\\d.]+)\\s*(B|KB|MB)/i);
  if (!m) return null;
  const v = parseFloat(m[1]);
  const u = m[2].toUpperCase();
  return u === 'B' ? v : (u === 'KB' ? v * 1024 : v * 1024 * 1024);
}
`;

/* ── 等待应用空闲（编码完成）─────────────────────────────────────────── */
async function waitIdle(page, timeout = 180000) {
  await page.waitForFunction(() => {
    const busy = document.getElementById('stage-busy');
    const actual = document.getElementById('sm-actual').textContent;
    const dims = document.getElementById('sm-dims').textContent;
    return busy && busy.hidden === true &&
           actual.indexOf('计算中') === -1 &&
           dims.indexOf('—') === -1;
  }, null, { timeout, polling: 120 });
}

/* ── 下载并读回真实字节 ──────────────────────────────────────────────── */
async function grabDownload(page, label) {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 90000 }),
    page.click('#btn-download')
  ]);
  const name = download.suggestedFilename();
  const dest = path.join(DL, `${label}__${name}`);
  await download.saveAs(dest);
  const buf = fs.readFileSync(dest);
  return { name, bytes: buf.length, buf, path: dest };
}

function magicOf(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'JPEG';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'PNG';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' &&
      buf.toString('ascii', 8, 12) === 'WEBP') return 'WEBP';
  if (buf.length >= 2 && buf.toString('ascii', 0, 2) === 'BM') return 'BMP';
  if (buf.length >= 3 && buf.toString('ascii', 0, 3) === 'GIF') return 'GIF';
  return 'UNKNOWN';
}

/* ── 生成测试样图（在浏览器里用 canvas 真实编码）────────────────────── */
async function makeFixtures(browser) {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto('about:blank');

  const spec = {
    'wide-4x3.jpg':   { w: 4000, h: 3000, type: 'image/jpeg', q: 0.92, alpha: false },
    'photo-16x9.jpg': { w: 1920, h: 1080, type: 'image/jpeg', q: 0.9,  alpha: false },
    'small-4x3.png':  { w: 400,  h: 300,  type: 'image/png',  q: 1,    alpha: false },
    'alpha-square.png': { w: 1200, h: 1200, type: 'image/png', q: 1,   alpha: true },
    'tall-9x16.png':  { w: 900,  h: 1600, type: 'image/png',  q: 1,    alpha: false },
    /* Issue #2 回归用极小样图：短边 < 16px 时曾被 16px 下限抹平比例 */
    'tiny-4x4.png':   { w: 4,    h: 4,    type: 'image/png',  q: 1,    alpha: false },
    'tiny-1x1.png':   { w: 1,    h: 1,    type: 'image/png',  q: 1,    alpha: false },
    'tiny-10x10.png': { w: 10,   h: 10,   type: 'image/png',  q: 1,    alpha: false }
  };

  const b64s = {};
  for (const [name, s] of Object.entries(spec)) {
    b64s[name] = await p.evaluate(async (s) => {
      const c = document.createElement('canvas');
      c.width = s.w; c.height = s.h;
      const g = c.getContext('2d');
      if (s.alpha) {
        g.clearRect(0, 0, s.w, s.h);
      } else {
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, s.w, s.h);
      }
      // 内容：渐变 + 色块 + 细颗粒 —— 让 JPEG 体积与质量有真实的相关性
      const grad = g.createLinearGradient(0, 0, s.w, s.h);
      grad.addColorStop(0, '#2b4a6f');
      grad.addColorStop(0.45, '#c9762f');
      grad.addColorStop(1, '#f2e3c8');
      g.fillStyle = grad;
      if (s.alpha) {
        g.fillRect(s.w * 0.15, s.h * 0.15, s.w * 0.7, s.h * 0.7);
      } else {
        g.fillRect(0, 0, s.w, s.h);
      }
      for (let i = 0; i < 26; i++) {
        g.fillStyle = `hsla(${(i * 37) % 360}, 62%, ${28 + (i % 5) * 9}%, ${s.alpha ? 0.85 : 0.75})`;
        const bw = s.w * (0.04 + (i % 4) * 0.03);
        const bh = s.h * (0.03 + (i % 3) * 0.04);
        g.fillRect((i * 97) % Math.max(1, s.w - bw), (i * 61) % Math.max(1, s.h - bh), bw, bh);
      }
      // 文字边缘（对 JPEG 质量敏感，保证压缩曲线真实）
      g.fillStyle = '#0b0d10';
      g.font = `${Math.round(s.h * 0.09)}px sans-serif`;
      g.textBaseline = 'middle';
      g.fillText('CoverForge QA', s.w * 0.06, s.h * 0.5);
      g.font = `${Math.round(s.h * 0.045)}px monospace`;
      g.fillText(`${s.w}x${s.h} test pattern 0123456789`, s.w * 0.06, s.h * 0.62);
      // 颗粒
      const id = g.getImageData(0, 0, Math.min(s.w, 512), Math.min(s.h, 512));
      const d = id.data;
      for (let i = 0; i < d.length; i += 4) {
        const n = (Math.random() - 0.5) * 26;
        d[i] += n; d[i + 1] += n; d[i + 2] += n;
      }
      g.putImageData(id, 0, 0);
      const blob = await new Promise((r) => c.toBlob(r, s.type, s.q));
      const ab = await blob.arrayBuffer();
      let bin = '';
      const u8 = new Uint8Array(ab);
      for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
      return btoa(bin);
    }, s);
  }
  await ctx.close();

  const files = {};
  for (const [name, b64] of Object.entries(b64s)) {
    const p2 = path.join(FIX, name);
    fs.writeFileSync(p2, Buffer.from(b64, 'base64'));
    files[name] = { path: p2, b64, bytes: fs.statSync(p2).size };
  }

  // 非图片 / 损坏文件
  fs.writeFileSync(path.join(FIX, 'notes.txt'), 'This is not an image at all.\n');
  fs.writeFileSync(path.join(FIX, 'report.pdf'), '%PDF-1.4 fake pdf payload\n%%EOF\n');
  const junk = Buffer.alloc(4096);
  for (let i = 0; i < junk.length; i++) junk[i] = (i * 37 + 11) & 0xff;
  fs.writeFileSync(path.join(FIX, 'corrupt.jpg'), junk);
  files['notes.txt'] = { path: path.join(FIX, 'notes.txt') };
  files['report.pdf'] = { path: path.join(FIX, 'report.pdf') };
  files['corrupt.jpg'] = { path: path.join(FIX, 'corrupt.jpg') };

  return files;
}

/* ── 主流程 ──────────────────────────────────────────────────────────── */
(async () => {
  const consoleErrors = [];
  const pageErrors = [];
  const externalRequests = [];

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const files = await makeFixtures(browser);

  const context = await browser.newContext({
    viewport: { width: 1512, height: 950 },
    acceptDownloads: true,
    deviceScaleFactor: 2
  });
  const page = await context.newPage();

  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') {
      consoleErrors.push(`[${m.type()}] ${m.text()}`);
    }
  });
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e)));
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith('file://') && !u.startsWith('data:') && !u.startsWith('blob:')) {
      externalRequests.push(u);
    }
  });

  await page.goto(APP);
  await page.addScriptTag({ content: pageHelpers });

  const set = async (sel, val) => {
    await page.fill(sel, String(val));
  };

  const pickBytes = async (label) => {
    await page.click(`#size-presets .chip:text-is("${label}")`);
    await waitIdle(page);
  };

  const pickRatio = async (w, h) => {
    await page.click(`#generic-ratios .chip[data-rw="${w}"][data-rh="${h}"]`);
    await waitIdle(page);
  };

  /* ═══ 用例 1 · 上传（file input / 拖拽 / 粘贴）══════════════════════ */
  group('1 · 上传路径');
  await page.setInputFiles('#file-input', files['photo-16x9.jpg'].path);
  await waitIdle(page);
  const srcName = await page.textContent('#info-name');
  const srcDims = await page.textContent('#info-dims');
  assert('1.1', 'file input 上传', 'info-name/尺寸被填充',
    `${srcName} / ${srcDims}`,
    srcName === 'photo-16x9.jpg' && srcDims.includes('1920'));

  const dragVeil = await page.evaluate(async ({ b64 }) => {
    return await window.__forge.dragBase64(b64, 'tall-9x16.png', 'image/png', false);
  }, { b64: files['tall-9x16.png'].b64 });
  assert('1.2', '拖拽时出现拖拽态覆盖层', 'drop-veil 显示 is-on', `is-on=${dragVeil}`, dragVeil === true);
  const veilAfterLeave = await page.evaluate(() => document.getElementById('drop-veil').classList.contains('is-on'));
  assert('1.3', '拖离后覆盖层收起', 'false', String(veilAfterLeave), veilAfterLeave === false);

  await page.evaluate(async ({ b64 }) => {
    await window.__forge.dragBase64(b64, 'tall-9x16.png', 'image/png', true);
  }, { b64: files['tall-9x16.png'].b64 });
  await waitIdle(page);
  const dropped = await page.textContent('#info-name');
  assert('1.4', '拖拽投放载入图片', 'tall-9x16.png', dropped, dropped === 'tall-9x16.png');

  await page.evaluate(async ({ b64 }) => {
    await window.__forge.pasteBase64(b64, 'pasted.png', 'image/png');
  }, { b64: files['small-4x3.png'].b64 });
  await waitIdle(page);
  const pasted = await page.textContent('#info-name');
  const pasteDims = await page.textContent('#info-dims');
  assert('1.5', '⌘V 粘贴剪贴板图片', 'pasted.png / 400 × 300 px',
    `${pasted} / ${pasteDims}`, pasted === 'pasted.png' && pasteDims.includes('400'));

  /* ═══ 用例 2 · 比例裁剪精度 ═════════════════════════════════════════ */
  group('2 · 比例裁剪');
  await page.setInputFiles('#file-input', files['photo-16x9.jpg'].path);
  await waitIdle(page);

  const ratioCases = [];
  for (const [w, h] of [[16, 9], [9, 16], [1, 1], [3, 4], [4, 3], [4, 5], [5, 4], [2, 3], [3, 2], [21, 9]]) {
    await pickRatio(w, h);
    const d = await page.evaluate(() => window.__forge.dims());
    const want = w / h;
    const got = d.w / d.h;
    ratioCases.push({ label: `${w}:${h}`, want, got, err: Math.abs(got / want - 1) });
  }
  const worstGeneric = ratioCases.reduce((a, b) => (a.err > b.err ? a : b));
  assert('2.1', '10 个通用比例输出宽高比误差 < 1%',
    '所有误差 < 1%', '最大误差 ' + (worstGeneric.err * 100).toFixed(3) + '% @' + worstGeneric.label,
    ratioCases.every((c) => c.err < 0.01));

  // 平台预设
  const presetIds = await page.$$eval('#platform-presets .preset', (els) => els.map((e) => e.dataset.id));
  const presetFail = [];
  for (const id of presetIds) {
    await page.click(`#platform-presets .preset[data-id="${id}"]`);
    await waitIdle(page);
    const d = await page.evaluate(() => window.__forge.dims());
    const ratioText = await page.textContent('#sm-ratio');
    const want = await page.getAttribute(`#platform-presets .preset[data-id="${id}"]`, 'aria-label');
    const labelM = want.match(/比例\s*([\d.]+):([\d.]+)/);
    const pw = parseFloat(labelM[1]), ph = parseFloat(labelM[2]);
    const err = Math.abs((d.w / d.h) / (pw / ph) - 1);
    if (err >= 0.01) presetFail.push(`${id}:${(err * 100).toFixed(2)}%`);
  }
  assert('2.2', `${presetIds.length} 个平台预设输出宽高比误差 < 1%`,
    '全部 < 1%', presetFail.length ? presetFail.join(', ') : '全部通过', presetFail.length === 0);

  // 自定义比例 2.35:1
  await pickRatio(16, 9);
  await set('#ratio-w', 2.35);
  await set('#ratio-h', 1);
  await page.click('#btn-apply-ratio');
  await waitIdle(page);
  const customDims = await page.evaluate(() => window.__forge.dims());
  const customErr = Math.abs((customDims.w / customDims.h) / 2.35 - 1);
  assert('2.3', '自定义比例 2.35:1', '误差 < 1%',
    `${customDims.text} → ${(customErr * 100).toFixed(3)}%`, customErr < 0.01);

  // 非法自定义比例要有错误提示
  await set('#ratio-w', 0);
  await page.click('#btn-apply-ratio');
  const ratioErrVisible = await page.isVisible('#ratio-error');
  const ratioErrText = await page.textContent('#ratio-error');
  await set('#ratio-w', 2.35);
  await page.click('#btn-apply-ratio');
  await waitIdle(page);
  assert('2.4', '非法比例（0）被拦截并提示', '显示错误文案',
    `${ratioErrVisible} / ${ratioErrText}`, ratioErrVisible && ratioErrText.length > 4);

  // 预览不是空白
  const blank = await page.evaluate(() => window.__forge.canvasIsBlank());
  assert('2.5', '舞台画布真的画出了成片（非空白）', 'false', String(blank), blank === false);

  /* ── Issue #2 回归 · 极小源图不得因 16px 下限而改变输出比例 ──────────────
     根因：computeGeometry() 曾对 outW/outH 各自 clamp(·,16,12000)，把 4×4+4:3 压成 16×16。
     修法：短边不足 16 时按「裁切区整数倍」整体放大（4×3 → ×6 → 24×18），得到的是精确比例。
     说明：4×4 源请求 16:9 时，整数裁切区为 4×2（=2:1）—— 这是「整数像素裁切」的量化限制，
     与 16px 下限无关，故该例只断言「尺寸 + 输出比例 == 裁切区比例」，不苛求 == 理想比例。 */
  const tinyCases = [
    { file: 'tiny-4x4.png',   rw: 4,  rh: 3, cw: 4,  ch: 3,  ew: 24, eh: 18, exact: true },
    { file: 'tiny-1x1.png',   rw: 1,  rh: 1, cw: 1,  ch: 1,  ew: 16, eh: 16, exact: true },
    { file: 'tiny-10x10.png', rw: 1,  rh: 1, cw: 10, ch: 10, ew: 20, eh: 20, exact: true },
    { file: 'tiny-4x4.png',   rw: 16, rh: 9, cw: 4,  ch: 2,  ew: 32, eh: 16, exact: false }
  ];
  const tinyBad = [];
  for (let i = 0; i < tinyCases.length; i++) {
    const c = tinyCases[i];
    await page.setInputFiles('#file-input', files[c.file].path);
    await waitIdle(page);
    await set('#ratio-w', c.rw);
    await set('#ratio-h', c.rh);
    await page.click('#btn-apply-ratio');
    await waitIdle(page);
    const d = await page.evaluate(() => window.__forge.dims());
    const sizeOk = d.w === c.ew && d.h === c.eh;                  // 输出尺寸精确
    const minOk = Math.min(d.w, d.h) >= 16;                       // 短边仍守住 16px 下限
    const cropErr = Math.abs((d.w / d.h) / (c.cw / c.ch) - 1);    // 输出比例 == 裁切区比例（不变形、不被抹平）
    const idealErr = Math.abs((d.w / d.h) / (c.rw / c.rh) - 1);   // 输出比例 == 所选比例
    const pass = sizeOk && minOk && cropErr < 0.01 && (!c.exact || idealErr < 0.01);
    if (!pass) tinyBad.push(`${c.file} ${c.rw}:${c.rh} → ${d.w}×${d.h}`);
    const detail = c.exact
      ? `${d.text} · 比例误差 ${(idealErr * 100).toFixed(3)}%`
      : `${d.text} · 裁切区 ${c.cw}×${c.ch}（整数量化偏差 ${(idealErr * 100).toFixed(1)}%，非下限所致）`;
    assert(`2.${6 + i}`, `Issue #2 回归：${c.file} + ${c.rw}:${c.rh} → ${c.ew}×${c.eh}（短边 ≥ 16、比例保持）`,
      `${c.ew}×${c.eh}，输出比例误差 ${c.exact ? '< 1%' : '（对裁切区）< 1%'}`,
      detail, pass);
  }
  assert(`2.${6 + tinyCases.length}`, 'Issue #2 回归汇总：极小源图输出短边均 ≥ 16 且比例未被 16px 下限抹平',
    '全部通过', tinyBad.length ? tinyBad.join('; ') : '全部通过', tinyBad.length === 0);

  /* ═══ 用例 3 · 大图 + 500KB 目标 ═════════════════════════════════════ */
  group('3 · 目标体积压缩');
  await page.setInputFiles('#file-input', files['wide-4x3.jpg'].path);
  await waitIdle(page);
  const largeFlag = await page.isVisible('#flag-large');
  assert('3.1', '4000×3000 触发「大尺寸图片」提示', 'true', String(largeFlag), largeFlag === true);

  await pickRatio(16, 9);
  await page.selectOption('#size-modes .chip', '').catch(() => {});
  await page.click('#size-modes .chip[data-mode="max"]');
  await waitIdle(page);
  await pickBytes('500 KB');
  const bigDims = await page.evaluate(() => window.__forge.dims());
  const bigActual = await page.evaluate(() => window.__forge.actualBytes());
  const bigVerdict = await page.evaluate(() => window.__forge.verdict());
  const bigQuality = await page.evaluate(() => window.__forge.quality());
  const bigDl = await grabDownload(page, 'big-500k');
  assert('3.2', '大图 + 500KB 目标 → 输出 ≤ 500KB', '≤ 512000 B',
    `${bigDl.bytes} B（面板 ${bigActual}）`, bigDl.bytes <= 500 * 1024);
  assert('3.3', '大图 + 500KB 目标 → 输出 ≥ 目标的 80%', '≥ 409600 B',
    `${bigDl.bytes} B（${(bigDl.bytes / (500 * 1024) * 100).toFixed(1)}% of target）`,
    bigDl.bytes >= 0.8 * 500 * 1024);
  assert('3.4', '面板标记达标', '包含"达标"', bigVerdict, bigVerdict.includes('达标'));
  assert('3.5', '输出比例仍为 16:9（压缩后不变形）', '误差 < 1%',
    bigDims.text, Math.abs((bigDims.w / bigDims.h) / (16 / 9) - 1) < 0.01);
  assert('3.6', 'JPG magic bytes 正确', 'FF D8 FF',
    bigDl.buf.subarray(0, 3).toString('hex').toUpperCase(), magicOf(bigDl.buf) === 'JPEG');
  console.log(`         ↳ 质量 ${bigQuality} · 分辨率变化 ${await page.evaluate(() => window.__forge.scale())} · ${await page.evaluate(() => window.__forge.time())}`);

  /* ═══ 用例 4 · 极小目标 ═════════════════════════════════════════════ */
  group('4 · 极小目标');
  await page.fill('#size-value', '80');
  await page.click('#btn-apply-size');
  await waitIdle(page);
  const tinyVerdict = await page.evaluate(() => window.__forge.verdict());
  const tinyFoot = await page.evaluate(() => window.__forge.foot());
  const tinyActual = await page.evaluate(() => window.__forge.actualBytes());
  const tinyDl = await grabDownload(page, 'big-80k');
  const tinyOk = (tinyDl.bytes <= 80 * 1024) || (tinyVerdict.includes('未达标') && tinyFoot.length > 10);
  assert('4.1', '80KB 目标：达成，或明确告知实际最小值', '≤ 81920 B 或含诚实提示',
    `${tinyDl.bytes} B · 判定「${tinyVerdict}」 · 脚注「${tinyFoot.slice(0, 60)}…」`, tinyOk);
  const tinyWarnVisible = await page.isVisible('#flag-tiny');
  assert('4.2', '80KB 目标不触发画质风险提示（阈值 50KB）', 'flag-tiny 不可见',
    `可见=${tinyWarnVisible}`, tinyWarnVisible === false);

  await page.fill('#size-value', '30');
  await page.click('#btn-apply-size');
  await waitIdle(page);
  const flagTiny = await page.isVisible('#flag-tiny');
  assert('4.3', '30KB 目标触发画质损失提示', 'flag-tiny 可见', String(flagTiny), flagTiny === true);

  // 超过 50MB 的目标必须被拦截（需切到 MB 单位）
  await page.click('#size-unit .segmented__btn[data-unit="MB"]');
  await page.fill('#size-value', '60');
  await page.click('#btn-apply-size');
  await page.waitForTimeout(150);
  const tooBig = await page.isVisible('#size-error');
  const tooBigText = await page.textContent('#size-error');
  assert('4.4', '60 MB 目标被拦截（上限 50 MB）', '显示错误文案',
    `${tooBig ? '可见' : '不可见'} · ${tooBigText}`, tooBig && /50 MB/.test(tooBigText));
  await page.click('#size-unit .segmented__btn[data-unit="KB"]');
  await page.fill('#size-value', '');

  /* ═══ 用例 5 · 小图放大 ═════════════════════════════════════════════ */
  group('5 · 放大路径');
  await page.click('#size-presets .chip:text-is("不限")');
  await waitIdle(page);
  await page.setInputFiles('#file-input', files['small-4x3.png'].path);
  await waitIdle(page);
  await page.click('#platform-presets .preset[data-id="bilibili"] .preset__apply');
  await waitIdle(page);
  const upDims = await page.evaluate(() => window.__forge.dims());
  const upFlag = await page.isVisible('#flag-upscale');
  const upFlagText = upFlag ? await page.textContent('#flag-upscale') : '';
  assert('5.1', '400×300 → 1920×1080 放大输出尺寸正确', '1920 × 1080 px',
    upDims.text, upDims.w === 1920 && upDims.h === 1080);
  assert('5.2', '放大路径给出诚实提示', '显示放大倍数提示', upFlagText.slice(0, 56), upFlag && /放大\s*4\.80×/.test(upFlagText));
  const upScaleField = await page.evaluate(() => window.__forge.scale());
  assert('5.3', '分辨率变化字段标注放大', '包含"放大"', upScaleField, upScaleField.includes('放大'));

  /* ═══ 用例 6 · JPG / PNG 下载 ═══════════════════════════════════════ */
  group('6 · 导出格式');
  await page.click('#format-group .segmented__btn[data-format="image/jpeg"]');
  await waitIdle(page);
  const jpgDl = await grabDownload(page, 'fmt-jpg');
  assert('6.1', 'JPG 导出非空且 magic bytes 正确', 'FF D8 FF 且 > 1KB',
    `${jpgDl.bytes} B · ${magicOf(jpgDl.buf)}`, jpgDl.bytes > 1024 && magicOf(jpgDl.buf) === 'JPEG');
  assert('6.2', 'JPG 文件名格式 <原名>-<比例>-<宽x高>.jpg',
    'small-4x3-16x9-1920x1080.jpg', jpgDl.name, jpgDl.name === 'small-4x3-16x9-1920x1080.jpg');

  await page.click('#format-group .segmented__btn[data-format="image/png"]');
  await waitIdle(page);
  const pngDl = await grabDownload(page, 'fmt-png');
  assert('6.3', 'PNG 导出非空且 magic bytes 正确', '89 50 4E 47 且 > 1KB',
    `${pngDl.bytes} B · ${magicOf(pngDl.buf)}`, pngDl.bytes > 1024 && magicOf(pngDl.buf) === 'PNG');

  // 透明 PNG → JPG 填背景色
  await page.setInputFiles('#file-input', files['alpha-square.png'].path);
  await waitIdle(page);
  await page.click('#format-group .segmented__btn[data-format="image/jpeg"]');
  await waitIdle(page);
  const bgVisible = await page.isVisible('#bg-field');
  const alphaInfo = await page.textContent('#info-alpha');
  await page.click('#bg-swatches .swatch[data-color="#0A0C0F"]');
  await waitIdle(page);
  const bgNote = await page.evaluate(() => window.__forge.foot());
  assert('6.4', '透明原图转 JPG 时提供背景色选择', 'bg-field 可见 + 脚注说明',
    `alpha=${alphaInfo} · 可见=${bgVisible} · 「${bgNote.slice(0, 40)}…」`,
    alphaInfo === '有' && bgVisible === true && bgNote.includes('透明'));
  const darkJpg = await grabDownload(page, 'alpha-to-jpg-dark');
  assert('6.5', '填深色底后仍产出有效 JPG', 'FF D8 FF',
    `${darkJpg.bytes} B · ${magicOf(darkJpg.buf)}`,
    magicOf(darkJpg.buf) === 'JPEG' && darkJpg.bytes > 1024);

  /* ═══ 用例 7 · PNG 无损的诚实提示 ═══════════════════════════════════ */
  group('7 · PNG 无损语义');
  await page.click('#format-group .segmented__btn[data-format="image/png"]');
  await page.click('#size-presets .chip:text-is("200 KB")');
  await waitIdle(page);
  const pngFlag = await page.isVisible('#flag-png');
  const pngFlagText = await page.textContent('#flag-png');
  const pngVerdict = await page.evaluate(() => window.__forge.verdict());
  assert('7.1', 'PNG + 目标体积时明确说明无法用质量压缩', 'flag-png 可见且文案说明无损',
    pngFlagText.slice(0, 70), pngFlag === true && /无损|无法/.test(pngFlagText));
  // 原断言写作 `!pngVerdict.startsWith('✅') || true` —— 恒为真，等于没测。
  // 真正要锁的是：PNG 未达标时必须「明确说出未达标」，而不是含糊其辞。
  assert('7.2', 'PNG 未达标时不谎报达标', '判定文案包含"未达标"且不以 ✅ 开头',
    pngVerdict, pngVerdict.indexOf('未达标') > -1 && pngVerdict.indexOf('✅') === -1);

  await page.click('#btn-switch-jpg');
  await waitIdle(page);
  const switchedVerdict = await page.evaluate(() => window.__forge.verdict());
  const switchedBytes = await page.evaluate(() => window.__forge.actualBytes());
  assert('7.3', '一键「改为 JPG」后达成目标', '≤ 204800 B',
    `${switchedBytes} B · ${switchedVerdict}`,
    switchedBytes !== null && switchedBytes <= 200 * 1024 && switchedVerdict.includes('达标'));

  /* ═══ 用例 8 · 预估大小 vs 实际文件大小 ══════════════════════════════ */
  group('8 · 预估准确性');
  await page.setInputFiles('#file-input', files['photo-16x9.jpg'].path);
  await waitIdle(page);
  await pickRatio(16, 9);
  await pickBytes('500 KB');
  const predicted = await page.evaluate(() => window.__forge.actualBytes());
  const dl8 = await grabDownload(page, 'estimate');
  const drift = Math.abs(dl8.bytes - predicted) / dl8.bytes;
  // 面板显示的「预估体积」就是即将下载的同一份 blob，偏差只来自显示取整（≤ 0.1 KB），
  // 因此这里用 2% 的严门槛 —— 15% 那种宽容差会让「预估可信」这个卖点变成一句空话。
  assert('8.1', '预估大小与实际文件大小偏差 < 2%', '< 2%',
    `预估 ${predicted} B vs 实际 ${dl8.bytes} B → ${(drift * 100).toFixed(2)}%`, drift < 0.02);

  /* ═══ 用例 9 · 错误处理 ═════════════════════════════════════════════ */
  group('9 · 错误处理');
  await page.evaluate(() => { document.getElementById('toasts').innerHTML = ''; });
  await page.evaluate(async ({ b64 }) => {
    await window.__forge.dragBase64(b64, 'report.pdf', 'application/pdf', true);
  }, { b64: Buffer.from('%PDF-1.4 fake').toString('base64') });
  await page.waitForSelector('.toast[data-kind="error"]', { timeout: 8000 });
  const errTitle = await page.textContent('.toast[data-kind="error"] .toast__title');
  const errMsg = await page.textContent('.toast[data-kind="error"] .toast__msg');
  const stillAlive = await page.textContent('#info-name');
  assert('9.1', '拖入非图片 → 明确报错', '出现 error Toast 且说明不是图片格式',
    `${errTitle}：${errMsg.slice(0, 60)}`,
    /不是支持的图片格式/.test(errMsg) && errTitle.length > 0);
  assert('9.2', '报错后应用未崩溃，原素材保留', 'photo-16x9.jpg', stillAlive,
    stillAlive === 'photo-16x9.jpg');

  await page.evaluate(() => { document.getElementById('toasts').innerHTML = ''; });
  await page.setInputFiles('#file-input', files['corrupt.jpg'].path);
  await page.waitForSelector('.toast[data-kind="error"]', { timeout: 20000 });
  const corruptMsg = await page.textContent('.toast[data-kind="error"] .toast__msg');
  assert('9.3', '损坏的 .jpg（随机字节）→ 解码失败提示', '出现解码失败提示',
    corruptMsg.slice(0, 70), /解码|损坏|不支持的图片编码/.test(corruptMsg));

  await page.evaluate(() => { document.getElementById('toasts').innerHTML = ''; });
  await page.setInputFiles('#file-input', files['notes.txt'].path);
  await page.waitForSelector('.toast[data-kind="error"]', { timeout: 8000 });
  const txtMsg = await page.textContent('.toast[data-kind="error"] .toast__msg');
  assert('9.4', '拖入 txt → 明确报错', '说明不是图片',
    txtMsg.slice(0, 60), /不是支持的图片格式/.test(txtMsg));

  /* ═══ 用例 10 · 取景微调 ════════════════════════════════════════════ */
  group('10 · 取景微调');
  await page.setInputFiles('#file-input', files['photo-16x9.jpg'].path);
  await waitIdle(page);
  await pickRatio(1, 1);
  const beforeCrop = await page.textContent('#crop-rect');
  await page.click('#focus-grid .focus-grid__cell[data-fx="0"][data-fy="0"]');
  await waitIdle(page);
  const afterCrop = await page.textContent('#crop-rect');
  const afterFocus = await page.textContent('#focus-readout');
  assert('10.1', '九宫格焦点改变裁切区域', '裁切区域相同但焦点不同',
    `${beforeCrop} → ${afterCrop} · ${afterFocus}`,
    afterFocus.includes('0% / 0%'));
  await page.click('#btn-reset-crop');
  await waitIdle(page);
  const resetFocus = await page.textContent('#focus-readout');
  assert('10.2', '「重置居中」回到 50%/50%', '居中 · 50% / 50%', resetFocus,
    resetFocus.includes('居中'));

  // 拖动（指针）微调
  const frameBox = await page.locator('#stage-frame').boundingBox();
  await page.mouse.move(frameBox.x + frameBox.width / 2, frameBox.y + frameBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(frameBox.x + frameBox.width / 2 + 120, frameBox.y + frameBox.height / 2, { steps: 12 });
  await page.mouse.up();
  await waitIdle(page);
  const dragFocus = await page.textContent('#focus-readout');
  assert('10.3', '在舞台内拖动图片改变取景焦点', '焦点 x ≠ 50%',
    dragFocus, /焦点\s*(\d+)%/.test(dragFocus) && !dragFocus.includes('50% / 50%'));

  /* ═══ 用例 11 · 隐私 / 离线 / 控制台 ═══════════════════════════════ */
  group('11 · 离线性与稳定性');
  assert('11.1', '无任何外部网络请求', '0 个非 file:// 请求',
    externalRequests.length ? externalRequests.slice(0, 5).join(', ') : '0',
    externalRequests.length === 0);
  assert('11.2', 'console 无 error / warning', '0 条',
    consoleErrors.length ? consoleErrors.slice(0, 5).join(' | ') : '0',
    consoleErrors.length === 0);
  assert('11.3', '无未捕获的页面异常', '0 条',
    pageErrors.length ? pageErrors.join(' | ') : '0', pageErrors.length === 0);

  // 响应式：窄屏单列
  await page.setViewportSize({ width: 720, height: 900 });
  await page.waitForTimeout(300);
  const narrowOk = await page.evaluate(() => {
    const ws = document.querySelector('.workspace');
    const cols = getComputedStyle(ws).gridTemplateColumns.split(' ').length;
    const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    return { cols, overflow };
  });
  assert('11.4', '720px 窄屏为单列且无横向溢出', '1 列 · overflow ≤ 1px',
    `${narrowOk.cols} 列 · overflow ${narrowOk.overflow}px`,
    narrowOk.cols === 1 && narrowOk.overflow <= 1);
  await page.setViewportSize({ width: 1512, height: 950 });

  // 截图
  await page.setInputFiles('#file-input', files['photo-16x9.jpg'].path);
  await waitIdle(page);
  await pickRatio(16, 9);
  await pickBytes('500 KB');
  await page.waitForTimeout(400);
  const shot = path.join(OUT, 'coverforge-desktop.png');
  await page.screenshot({ path: shot, fullPage: false });
  await page.setViewportSize({ width: 700, height: 1100 });
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(OUT, 'coverforge-mobile.png'), fullPage: false });

  await context.close();
  await browser.close();

  /* ── 汇总 ──────────────────────────────────────────────────────────── */
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  const lines = [];
  lines.push('# CoverForge QA 报告');
  lines.push('');
  lines.push(`运行时间：${new Date().toISOString()}`);
  lines.push(`用例总数：${results.length} · 通过 ${passed} · 失败 ${failed.length}`);
  lines.push('');
  lines.push('| # | 用例 | 预期 | 实测 | 结论 |');
  lines.push('|---|---|---|---|---|');
  for (const r of results) {
    lines.push(`| ${r.id} | ${r.testCase} | ${String(r.expected).replace(/\|/g, '\\|')} | ${String(r.actual).replace(/\|/g, '\\|')} | ${r.pass ? '✅' : '❌'} |`);
  }
  lines.push('');
  lines.push('## 关键实测数据');
  lines.push('');
  lines.push('### 通用比例宽高比误差');
  lines.push('');
  lines.push('| 比例 | 目标 | 实际 | 误差 |');
  lines.push('|---|---|---|---|');
  for (const c of ratioCases) {
    lines.push(`| ${c.label} | ${c.want.toFixed(4)} | ${c.got.toFixed(4)} | ${(c.err * 100).toFixed(3)}% |`);
  }
  lines.push('');
  lines.push('### 压缩实测');
  lines.push('');
  lines.push(`- 4000×3000 源图 · 16:9 · 目标 500 KB → **${bigDl.bytes} B**（${(bigDl.bytes / (500 * 1024) * 100).toFixed(1)}% of target），质量 ${bigQuality}`);
  lines.push(`- 同图 · 目标 80 KB → ${tinyDl.bytes} B，判定「${tinyVerdict}」`);
  lines.push(`- 预估 vs 实际偏差：${(drift * 100).toFixed(2)}%`);
  lines.push('');
  lines.push('报告由 `tests/qa.mjs` 自动生成。');

  const reportPath = path.join(OUT, 'QA-REPORT.md');
  fs.writeFileSync(reportPath, lines.join('\n'));

  console.log('\n' + '='.repeat(74));
  console.log(`总计 ${results.length} 项 · 通过 ${passed} · 失败 ${failed.length}`);
  if (failed.length) {
    console.log('\n失败用例：');
    for (const f of failed) console.log(`  ❌ ${f.id} ${f.testCase}\n     预期 ${f.expected}\n     实测 ${f.actual}`);
  }
  console.log(`\n报告：${reportPath}`);
  console.log(`截图：${path.join(OUT, 'coverforge-desktop.png')}`);
  console.log('='.repeat(74));

  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('QA 运行异常：', e);
  process.exit(2);
});
