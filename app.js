/* ============================================================================
 * CoverForge · 封面工坊 — app.js
 *
 * 纯前端封面处理工具：上传 → 选比例 → 居中裁剪 → 按目标体积压缩 → 导出。
 * 零依赖、零网络请求；所有像素处理都在本机浏览器里完成。
 *
 * 结构：
 *   1. 工具函数
 *   2. 常量（比例 / 平台预设 / 体积预设）
 *   3. 应用状态
 *   4. 图片载入（点击 / 拖拽 / 粘贴）
 *   5. UI 构建（比例、预设、体积、输出尺寸、焦点九宫格）
 *   6. 几何计算（裁剪矩形 + 输出尺寸）
 *   7. 编码管线（画布绘制 / 二分质量 / 分级降分辨率）
 *   8. 状态写回（读数条 / 导出前信息 / 标志位）
 *   9. 事件绑定与启动
 *
 * 注意：本文件刻意使用经典 script + IIFE，而不是 ES module ——
 *      file:// 协议下 `<script type="module">` 会被 CORS 拦截，双击打开即失效。
 * ========================================================================= */
(function () {
  'use strict';

  var tr = (window.CF && window.CF.tr) || function (k) { return k; };

  /* ── 1. 工具函数 ────────────────────────────────────────────────────── */

  const D = Object.create(null);
  function $(id) {
    let n = D[id];
    if (!n) { n = document.getElementById(id); D[id] = n; }
    return n;
  }

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /** 等待浏览器真正绘制一帧，避免耗时计算把“处理中”遮罩饿死。 */
  function nextPaint() {
    return new Promise((resolve) => {
      let done = false;
      const fin = () => { if (!done) { done = true; resolve(); } };
      requestAnimationFrame(() => requestAnimationFrame(fin));
      setTimeout(fin, 140);
    });
  }

  /** 人类可读体积；整数时省略小数位，便于与预设值字面一致。 */
  function fmtBytes(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    if (n < 1024) return Math.round(n) + ' B';
    const kb = n / 1024;
    if (kb < 1024) return trimNum(kb, 1) + ' KB';
    return trimNum(n / 1048576, 2) + ' MB';
  }

  function trimNum(v, digits) {
    let s = v.toFixed(digits);
    if (s.indexOf('.') > -1) s = s.replace(/\.?0+$/, '');
    return s;
  }

  const gcd = (a, b) => (b ? gcd(b, a % b) : a);

  /** 把实际像素比例约分成 `16:9` 这种可读形式（仅用于展示原图信息）。 */
  function ratioText(w, h) {
    if (!w || !h) return '—';
    const g = gcd(Math.round(w), Math.round(h)) || 1;
    const rw = Math.round(w) / g, rh = Math.round(h) / g;
    const val = (w / h).toFixed(3);
    if (rw <= 60 && rh <= 60) return rw + ':' + rh + ' · ' + val;
    return val;
  }

  /** 文件名里的比例标记，例如 16x9 / 2.35x1。 */
  function ratioTag(w, h) {
    const f = (v) => trimNum(v, 2).replace('.', '.');
    return f(w) + 'x' + f(h);
  }

  function sanitizeBase(name) {
    const base = String(name || 'cover').replace(/\.[^.\/\\]+$/, '');
    return base.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'cover';
  }

  function readAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error('read'));
      fr.readAsDataURL(file);
    });
  }

  function decodeImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('decode'));
      img.src = url;
    });
  }

  function makeCanvas(w, h, opts) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    const ctx = c.getContext('2d', opts || undefined);
    return { canvas: c, ctx: ctx };
  }

  function toBlobAsync(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      const cb = (blob) => (blob ? resolve(blob) : reject(new Error('encode')));
      if (type === 'image/png') canvas.toBlob(cb, 'image/png');
      else canvas.toBlob(cb, 'image/jpeg', quality);
    });
  }

  /* ── 2. 常量 ────────────────────────────────────────────────────────── */

  const GENERIC_RATIOS = [[16, 9], [9, 16], [1, 1], [3, 4], [4, 3], [4, 5], [5, 4], [2, 3], [3, 2], [21, 9]];

  // 注意：这两组是「函数」而不是常量 —— 文案要在构建时求值，
  // 否则切换语言后预设名 / 「不限」标签仍停留在加载时的语言。
  function platformGroups() {
    return [
      {
        name: tr('group.landscape'),
        items: [
          { id: 'bilibili', name: tr('preset.bilibili'), w: 16, h: 9, pw: 1920, ph: 1080 },
          { id: 'youtube', name: tr('preset.youtube'), w: 16, h: 9, pw: 1280, ph: 720 }
        ]
      },
      {
        name: tr('group.vertical'),
        items: [
          { id: 'douyin', name: tr('preset.douyin'), w: 9, h: 16, pw: 1080, ph: 1920 }
        ]
      },
      {
        name: tr('group.social'),
        items: [
          { id: 'xiaohongshu', name: tr('preset.xiaohongshu'), w: 3, h: 4, pw: 1080, ph: 1440 },
          { id: 'instagram', name: tr('preset.instagram'), w: 4, h: 5, pw: 1080, ph: 1350 }
        ]
      },
      {
        name: tr('group.square'),
        items: [
          { id: 'square', name: tr('preset.square'), w: 1, h: 1, pw: 1080, ph: 1080 }
        ]
      },
      {
        name: tr('group.article'),
        items: [
          { id: 'wechat', name: tr('preset.wechat'), w: 2.35, h: 1, pw: 1175, ph: 500 }
        ]
      }
    ];
  }

  function sizeChips() {
    return [
      { label: tr('size.unlimited'), bytes: null },
      { label: '200 KB', bytes: 200 * 1024 },
      { label: '500 KB', bytes: 500 * 1024 },
      { label: '1 MB', bytes: 1024 * 1024 },
      { label: '2 MB', bytes: 2 * 1024 * 1024 }
    ];
  }

  const MAX_TARGET_BYTES = 50 * 1024 * 1024;
  const TINY_TARGET_BYTES = 50 * 1024;
  const LARGE_PIXELS = 8e6;

  // 输出尺寸边界。注意：这两条是「画布经验下限/上限」，**绝不能**对宽高各自钳制，
  // 否则会把所选比例抹平（4×4 源 + 4:3 曾变成 16×16，见 Issue #2）。触边时必须整体等比。
  const MIN_OUT = 16;
  const MAX_OUT = 12000;

  const Q_MIN = 0.4;    // 质量下限：再低不如降分辨率
  const Q_MAX = 0.95;   // 质量上限
  const Q_UNLIMITED = 0.92;
  const MAX_SCALE_ITER = 6;

  const PREVIEW_MAX_EDGE = 1400;

  /* ── 3. 应用状态 ───────────────────────────────────────────────────── */

  function initialState() {
    return {
      file: null,          // 原始 File
      img: null,           // 已解码的 HTMLImageElement
      srcW: 0,
      srcH: 0,
      hasAlpha: false,

      ratioW: 16,
      ratioH: 9,

      focusX: 0.5,
      focusY: 0.5,

      sizeMode: 'max',     // max | preset | edge
      presetPx: null,      // {w,h} 平台推荐像素
      edge: 1920,

      targetBytes: null,   // null = 不限

      format: 'image/jpeg',
      bgColor: '#ffffff',
      manualQuality: 0,    // 0 = 自动

      thirdsVisible: true,
      viewMode: 'crop',    // crop = 成片预览 | source = 原图取景（可见框外内容）

      // 派生结果
      geo: null,
      result: null,        // { blob, w, h, quality, requestedW/H, minBytes }
      dirty: true,
      presetId: null
    };
  }

  const S = initialState();

  /* ── 4. 几何计算 ────────────────────────────────────────────────────── */

  /**
   * 由「原图 + 目标比例 + 取景焦点」推出裁切矩形与输出尺寸。
   * 原则：永远填满目标比例（cover），绝不拉伸变形。
   */
  function computeGeometry() {
    const srcW = S.srcW, srcH = S.srcH;
    const r = S.ratioW / S.ratioH;

    let cropW, cropH;
    if (srcW / srcH > r) { cropH = srcH; cropW = srcH * r; }
    else { cropW = srcW; cropH = srcW / r; }

    cropW = clamp(Math.round(cropW), 1, srcW);
    cropH = clamp(Math.round(cropH), 1, srcH);

    const sx = clamp(Math.round((srcW - cropW) * S.focusX), 0, srcW - cropW);
    const sy = clamp(Math.round((srcH - cropH) * S.focusY), 0, srcH - cropH);

    // 输出尺寸
    let outW, outH;
    if (S.sizeMode === 'preset' && S.presetPx) {
      outW = S.presetPx.w; outH = S.presetPx.h;
    } else if (S.sizeMode === 'edge' && S.edge) {
      const s = S.edge / Math.max(cropW, cropH);
      outW = Math.round(cropW * s); outH = Math.round(cropH * s);
    } else {
      outW = cropW; outH = cropH;
    }
    // 下界：短边不足 MIN_OUT 时，用「裁切区的整数倍」放大 —— cropW/cropH 本身就代表
    // 目标比例，取整数倍得到的是精确比例，绝不为了凑 16px 把比例抹平。
    // 上界：超过 MAX_OUT 时整体等比缩小，同样不能各自截断。
    if (outW < MIN_OUT || outH < MIN_OUT) {
      const n = Math.ceil(MIN_OUT / Math.min(cropW, cropH));
      outW = cropW * n;
      outH = cropH * n;
    }
    if (outW > MAX_OUT || outH > MAX_OUT) {
      const k = MAX_OUT / Math.max(outW, outH);
      outW = Math.round(outW * k);
      outH = Math.round(outH * k);
    }
    outW = clamp(outW, 1, MAX_OUT);
    outH = clamp(outH, 1, MAX_OUT);

    const factor = Math.max(outW / cropW, outH / cropH);

    return {
      srcW: srcW, srcH: srcH,
      cropW: cropW, cropH: cropH, sx: sx, sy: sy,
      gapX: srcW - cropW, gapY: srcH - cropH,
      outW: outW, outH: outH,
      factor: factor
    };
  }

  /* ── 5. 画布与编码（核心） ──────────────────────────────────────────── */

  /** 把裁切区域 1:1 拷进一张画布，作为后续缩放的源。 */
  function buildCropCanvas(geo) {
    const { canvas, ctx } = makeCanvas(geo.cropW, geo.cropH);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(S.img, geo.sx, geo.sy, geo.cropW, geo.cropH, 0, 0, geo.cropW, geo.cropH);
    return canvas;
  }

  /** 渐进式重采样：每次最多放大 2×，避免一次性插值造成明显失真 / 锯齿。 */
  function resample(srcCanvas, dw, dh, bgFill) {
    const { canvas, ctx } = makeCanvas(dw, dh);
    if (bgFill) { ctx.fillStyle = bgFill; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const sw = srcCanvas.width, sh = srcCanvas.height;
    const need = Math.max(canvas.width / sw, canvas.height / sh);

    if (need <= 2) {
      ctx.drawImage(srcCanvas, 0, 0, sw, sh, 0, 0, canvas.width, canvas.height);
      return canvas;
    }

    let cur = srcCanvas;
    let cw = sw, ch = sh;
    while (Math.max(canvas.width / cw, canvas.height / ch) > 2) {
      cw = cw * 2; ch = ch * 2;
      const step = makeCanvas(cw, ch);
      step.ctx.imageSmoothingEnabled = true;
      step.ctx.imageSmoothingQuality = 'high';
      step.ctx.drawImage(cur, 0, 0, cur.width, cur.height, 0, 0, step.canvas.width, step.canvas.height);
      cur = step.canvas; cw = cur.width; ch = cur.height;
    }
    ctx.drawImage(cur, 0, 0, cur.width, cur.height, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  /**
   * 等比把 (w,h) 的短边抬到 ≥ min。两边都已达标则原样返回。
   * 与 computeGeometry() 一样：这里**绝不能**对宽高各自 Math.max(min, ·) ——
   * 那会把 7×5 抹成 16×16。抽成共用工具，避免同一错误模式写第三遍。
   */
  function scaleToMinEdge(w, h, min) {
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    if (w >= min && h >= min) return { w: w, h: h };
    const k = min / Math.min(w, h);
    return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
  }

  /** 按比例缩放一张画布（保持宽高比，短边不小于 MIN_OUT）。 */
  function scaleCanvas(srcCanvas, scale) {
    const dim = scaleToMinEdge(srcCanvas.width * scale, srcCanvas.height * scale, MIN_OUT);
    const w = dim.w, h = dim.h;
    const { canvas, ctx } = makeCanvas(w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(srcCanvas, 0, 0, srcCanvas.width, srcCanvas.height, 0, 0, w, h);
    return canvas;
  }

  /**
   * 定体积压缩：在「尽量保清晰」的前提下逼近目标字节数。
   *
   * 策略一（优先）：固定分辨率，二分搜索满足体积上限的最高 JPEG 质量。
   * 策略二（质量触底仍超标）：按面积估算所需分辨率并跳档降分辨率，再回到策略一。
   * 这样比“一路降质量”观感好得多：宁可少几个像素，也不要糊成一片。
   */
  async function fitToTarget(baseCanvas, target) {
    let scale = 1;
    let smallest = null;

    for (let iter = 0; iter < MAX_SCALE_ITER; iter++) {
      const canvas = scale === 1 ? baseCanvas : scaleCanvas(baseCanvas, scale);

      setBusyText(tr('busy.compress'));
      const floor = await toBlobAsync(canvas, 'image/jpeg', Q_MIN);
      smallest = { blob: floor, quality: Q_MIN, canvas: canvas, scale: scale };

      if (floor.size <= target) {
        // 下限已经达标 → 二分找“还能更高”的质量
        const top = await toBlobAsync(canvas, 'image/jpeg', Q_MAX);
        if (top.size <= target) {
          return { blob: top, quality: Q_MAX, canvas: canvas, scale: scale, minBytes: floor.size };
        }
        let lo = Q_MIN, hi = Q_MAX, best = floor;
        for (let i = 0; i < 9; i++) {
          const mid = (lo + hi) / 2;
          const probe = await toBlobAsync(canvas, 'image/jpeg', mid);
          if (probe.size <= target) { best = probe; lo = mid; }
          else { hi = mid; }
        }
        return { blob: best, quality: lo, canvas: canvas, scale: scale, minBytes: floor.size };
      }

      // 质量已触底仍超标 → 用面积比估算目标分辨率（字节数近似与像素数成正比）
      const need = Math.sqrt(Math.max(1, target) / floor.size);
      let nextScale = scale * clamp(need, 0.35, 0.9);
      if (nextScale >= scale - 0.004) nextScale = scale * 0.82;   // 保证单调前进
      nextScale = Math.max(nextScale, 0.06);
      if (nextScale <= 0.0605) break;
      scale = nextScale;
    }

    // 兜底：返回当前能达到的最小体积，并如实告知
    return {
      blob: smallest.blob,
      quality: smallest.quality,
      canvas: smallest.canvas,
      scale: smallest.scale,
      minBytes: smallest.blob.size,
      unreachable: true
    };
  }

  /** 完整编码：产出唯一一份 blob —— 它既是“预估大小”，也是下载内容。 */
  async function encodeOutput(baseCanvas, geo) {
    if (S.format === 'image/png') {
      setBusyText(tr('busy.png'));
      const blob = await toBlobAsync(baseCanvas, 'image/png');
      return { blob: blob, quality: null, canvas: baseCanvas, scale: 1, minBytes: blob.size };
    }
    if (S.manualQuality > 0) {
      setBusyText(tr('busy.manual'));
      const blob = await toBlobAsync(baseCanvas, 'image/jpeg', S.manualQuality);
      return { blob: blob, quality: S.manualQuality, canvas: baseCanvas, scale: 1, minBytes: blob.size };
    }
    if (S.targetBytes === null) {
      setBusyText(tr('busy.jpg'));
      const blob = await toBlobAsync(baseCanvas, 'image/jpeg', Q_UNLIMITED);
      return { blob: blob, quality: Q_UNLIMITED, canvas: baseCanvas, scale: 1, minBytes: blob.size };
    }
    return await fitToTarget(baseCanvas, S.targetBytes);
  }

  /* ── 6. 渲染管线 ────────────────────────────────────────────────────── */

  let jobSeq = 0;          // 递增令牌：只有最新任务能写回 UI，避免竞态
  let busyDepth = 0;
  let queued = null;       // 最近一次渲染的 Promise
  let debounceTimer = 0;

  function setBusyText(text) { $('busy-text').textContent = text; }

  function pushBusy(text) {
    busyDepth++;
    $('stage-busy').hidden = false;
    $('readout-progress').hidden = false;
    setBusyText(text);
    const pill = $('ro-status');
    pill.dataset.state = 'busy';
    pill.textContent = tr('status.busy');
  }

  function popBusy() {
    busyDepth = Math.max(0, busyDepth - 1);
    if (busyDepth > 0) return;
    $('stage-busy').hidden = true;
    $('readout-progress').hidden = true;
    paintStatus();
  }

  /** 执行一次完整处理；返回本次任务是否为“最新”。 */
  async function render() {
    if (!S.img) { clearOutputs(); return false; }
    const my = ++jobSeq;
    pushBusy(tr('busy.crop'));
    await nextPaint();
    try {
      const t0 = performance.now();
      const geo = computeGeometry();
      if (my !== jobSeq) return false;
      S.geo = geo;
      paintGeometry(geo);

      setBusyText(tr('busy.resample'));
      const crop = buildCropCanvas(geo);
      const bgFill = S.format === 'image/jpeg' ? S.bgColor : null;
      const master = resample(crop, geo.outW, geo.outH, bgFill);

      const enc = await encodeOutput(master, geo);
      if (my !== jobSeq) return false;

      // 以「真正被编码的那张画布」为准：目标体积过小触发降分辨率时，
      // enc.canvas 会比 master 小，若沿用 master 会导致面板尺寸 / 文件名 /
      // 预览与实际下载文件的像素尺寸不一致。
      const final = enc.canvas || master;

      const ms = performance.now() - t0;
      S.result = {
        blob: enc.blob,
        w: final.width,
        h: final.height,
        quality: enc.quality,
        scale: enc.scale,
        minBytes: enc.minBytes,
        unreachable: !!enc.unreachable,
        ms: ms,
        // 预览小图缓存下来：切换「成片 / 原图取景」视图时无需重新编码
        preview: downscaleForPreview(final)
      };
      S.dirty = false;
      paintStage(geo);
      paintResult(geo, ms);
      return true;
    } catch (err) {
      if (my === jobSeq) {
        toast('error', tr('toast.encodeFail.title'),
          tr('toast.encodeFail.msg', { err: (err && err.message ? err.message : String(err)) }));
      }
      return false;
    } finally {
      popBusy();
    }
  }

  /** 串行调度：任何状态变化都走这里，天然避免并发重入。 */
  let running = false;
  let pending = false;
  let debounceResolve = null;

  function cancelDebounce() {
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = 0; }
    if (debounceResolve) { const r = debounceResolve; debounceResolve = null; r(false); }
  }

  function runQueued() {
    if (running) { pending = true; return Promise.resolve(false); }
    running = true;
    const p = render().then((fresh) => {
      running = false;
      if (pending) { pending = false; return runQueued(); }
      return fresh;
    });
    queued = p;
    return p;
  }

  function scheduleRender(delay) {
    const wait = typeof delay === 'number' ? delay : 0;
    cancelDebounce();
    if (wait > 0) {
      // 连续输入时只跑最后一次（debounce），避免重复的重编码把页面拖死
      return new Promise((resolve) => {
        debounceResolve = resolve;
        debounceTimer = setTimeout(() => {
          debounceTimer = 0; debounceResolve = null;
          resolve(runQueued());
        }, wait);
      });
    }
    return runQueued();
  }

  /** 状态变更入口：标记脏 + 调度一次渲染。 */
  function invalidate(delay) {
    S.dirty = true;
    return scheduleRender(delay);
  }

  /** 下载 / 导出前调用：确保结果与当前状态完全一致。 */
  async function ensureFresh() {
    cancelDebounce();
    let guard = 0;
    while ((running || S.dirty || !S.result) && guard++ < 120) {
      if (running) { await new Promise((r) => setTimeout(r, 40)); continue; }
      S.dirty = true;
      await runQueued();
    }
    return S.result;
  }

  /* ── 7. 画布绘制 ────────────────────────────────────────────────────── */

  let ctxStage = null;
  function stageCtx() {
    const c = $('stage-canvas');
    if (!ctxStage) ctxStage = c.getContext('2d', { willReadFrequently: true });
    return ctxStage;
  }

  let checker = null;
  function drawChecker(ctx, w, h) {
    if (!checker) {
      // 棋盘格必须能读出「这是透明」：原先 #232931 / #1a1f26 只有 1.13:1，
      // 看上去是一块纯灰，用户无法分辨透明区域与灰色填充。现为 1.68:1。
      const t = makeCanvas(16, 16);
      t.ctx.fillStyle = '#363F4C'; t.ctx.fillRect(0, 0, 8, 8); t.ctx.fillRect(8, 8, 8, 8);
      t.ctx.fillStyle = '#0F1216'; t.ctx.fillRect(8, 0, 8, 8); t.ctx.fillRect(0, 8, 8, 8);
      checker = ctx.createPattern(t.canvas, 'repeat');
    }
    ctx.save();
    ctx.fillStyle = checker || '#1a1f26';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  /** 预览用的小图（长边 ≤ PREVIEW_MAX_EDGE）。缓存进 result，切换视图时零成本。 */
  function downscaleForPreview(src) {
    const k = Math.min(1, PREVIEW_MAX_EDGE / Math.max(src.width, src.height));
    const w = Math.max(1, Math.round(src.width * k));
    const h = Math.max(1, Math.round(src.height * k));
    const { canvas, ctx } = makeCanvas(w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, w, h);
    return canvas;
  }

  /** 画舞台：按当前视图模式选择「成片」或「原图取景」，再叠加裁剪框 */
  function paintStage(geo) {
    if (S.viewMode === 'source') paintSourceView();
    else paintCropView();
    paintCropOverlay(geo);
  }

  /** 成片视图：显示的就是最终要下载的那份像素（保留透明棋盘格语义）。 */
  function paintCropView() {
    const c = $('stage-canvas');
    const ctx = stageCtx();
    const src = S.result && S.result.preview;
    if (!src) return;
    if (c.width !== src.width || c.height !== src.height) { c.width = src.width; c.height = src.height; }
    ctx.clearRect(0, 0, src.width, src.height);
    if (S.format === 'image/png' && S.hasAlpha) drawChecker(ctx, src.width, src.height);
    ctx.drawImage(src, 0, 0);
  }

  /** 原图取景视图：显示完整原图，框外内容可见 —— 用于判断构图、避免裁掉关键信息。 */
  function paintSourceView() {
    if (!S.img) return;
    const c = $('stage-canvas');
    const ctx = stageCtx();
    const k = Math.min(1, PREVIEW_MAX_EDGE / Math.max(S.srcW, S.srcH));
    const w = Math.max(1, Math.round(S.srcW * k));
    const h = Math.max(1, Math.round(S.srcH * k));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    ctx.clearRect(0, 0, w, h);
    if (S.hasAlpha) drawChecker(ctx, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(S.img, 0, 0, S.srcW, S.srcH, 0, 0, w, h);
  }

  /**
   * 原图取景视图下的裁剪框：位置/尺寸按原图百分比定位，框外用超大 box-shadow 压暗。
   * 三分线也跟着裁剪框走 —— 只有落在裁剪框里的三分线才对构图有参考意义。
   */
  function paintCropOverlay(geo) {
    const box = $('stage-crop');
    const thirds = $('stage-thirds');
    if (S.viewMode !== 'source' || !S.img) {
      box.hidden = true;
      thirds.style.cssText = '';
      thirds.hidden = !S.thirdsVisible;
      return;
    }
    const pct = (v) => (clamp(v, 0, 1) * 100).toFixed(4) + '%';
    const l = geo.sx / S.srcW, t = geo.sy / S.srcH;
    const w = geo.cropW / S.srcW, h = geo.cropH / S.srcH;

    box.hidden = false;
    box.style.left = pct(l);
    box.style.top = pct(t);
    box.style.width = pct(w);
    box.style.height = pct(h);

    thirds.hidden = !S.thirdsVisible;
    if (S.thirdsVisible) {
      thirds.style.left = pct(l);
      thirds.style.top = pct(t);
      thirds.style.width = pct(w);
      thirds.style.height = pct(h);
      thirds.style.right = 'auto';
      thirds.style.bottom = 'auto';
    }
    const r = S.result;
    $('crop-tag').textContent = (r ? r.w : geo.outW) + ' × ' + (r ? r.h : geo.outH);
  }

  /** 拖动取景时的低延迟预览：直接从原图重画裁切区，不做编码。 */
  function paintPreviewLive(geo) {
    if (!S.img) return;
    const c = $('stage-canvas');
    const ctx = stageCtx();
    const k = Math.min(1, PREVIEW_MAX_EDGE / Math.max(geo.outW, geo.outH));
    const pw = Math.max(1, Math.round(geo.outW * k));
    const ph = Math.max(1, Math.round(geo.outH * k));
    if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
    if (S.format === 'image/jpeg') { ctx.fillStyle = S.bgColor; ctx.fillRect(0, 0, pw, ph); }
    else if (S.hasAlpha) drawChecker(ctx, pw, ph);
    else ctx.clearRect(0, 0, pw, ph);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(S.img, geo.sx, geo.sy, geo.cropW, geo.cropH, 0, 0, pw, ph);
  }

  /* ── 8. Toast ───────────────────────────────────────────────────────── */

  const TOAST_LIFE = { success: 5200, warn: 8000, error: 9000, info: 5200 };

  function toast(kind, title, msg) {
    const box = $('toasts');
    const node = document.createElement('div');
    node.className = 'toast';
    node.dataset.kind = kind;

    const body = document.createElement('div');
    body.className = 'toast__body';
    const t = document.createElement('p');
    t.className = 'toast__title';
    t.textContent = title;
    const m = document.createElement('p');
    m.className = 'toast__msg';
    m.textContent = msg;
    body.appendChild(t); body.appendChild(m);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast__close';
    close.setAttribute('aria-label', tr('toast.close'));
    close.textContent = '\u00d7';

    node.appendChild(body); node.appendChild(close);
    box.appendChild(node);

    let gone = false;
    const dismiss = () => {
      if (gone) return;
      gone = true;
      node.classList.add('is-leaving');
      setTimeout(() => { if (node.parentNode) node.parentNode.removeChild(node); }, 240);
    };
    close.addEventListener('click', dismiss);
    // 只保留最近 4 条，避免堆叠
    while (box.children.length > 4) box.removeChild(box.firstChild);
    setTimeout(dismiss, TOAST_LIFE[kind] || 6000);
    return node;
  }

  /* ── 9. UI 构建 ─────────────────────────────────────────────────────── */

  const ratioChipEls = [];
  const presetCardEls = [];
  const sizeChipEls = [];

  function buildUI() {
    // 切换语言时会重新调用本函数：先清空缓存，避免数组重复累加
    ratioChipEls.length = 0;
    presetCardEls.length = 0;
    sizeChipEls.length = 0;

    // 通用比例
    const box = $('generic-ratios');
    box.textContent = '';
    GENERIC_RATIOS.forEach(([w, h]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.rw = String(w);
      b.dataset.rh = String(h);
      b.textContent = trimNum(w, 2) + ':' + trimNum(h, 2);
      b.setAttribute('aria-label', tr('chip.aria', { w: trimNum(w, 2), h: trimNum(h, 2) }));
      b.addEventListener('click', () => applyRatio(w, h, null));
      box.appendChild(b);
      ratioChipEls.push(b);
    });

    // 平台预设
    const ps = $('platform-presets');
    ps.textContent = '';
    platformGroups().forEach((g) => {
      const wrap = document.createElement('div');
      wrap.className = 'preset-group';
      const nm = document.createElement('p');
      nm.className = 'preset-group__name';
      nm.textContent = g.name;
      const items = document.createElement('div');
      items.className = 'preset-group__items';

      g.items.forEach((it) => {
        const card = document.createElement('div');
        card.className = 'preset';
        card.dataset.id = it.id;
        card.dataset.rw = String(it.w);
        card.dataset.rh = String(it.h);
        card.setAttribute('role', 'button');
        card.tabIndex = 0;
        card.setAttribute('aria-pressed', 'false');
        card.setAttribute('aria-label', tr('preset.aria', { name: it.name, r: trimNum(it.w, 2) + ':' + trimNum(it.h, 2), w: it.pw, h: it.ph }));

        const bodyEl = document.createElement('span');
        bodyEl.className = 'preset__body';
        const n1 = document.createElement('span');
        n1.className = 'preset__name';
        n1.textContent = it.name;
        const n2 = document.createElement('span');
        n2.className = 'preset__ratio mono';
        n2.textContent = trimNum(it.w, 2) + ':' + trimNum(it.h, 2) + ' · ' + it.pw + ' × ' + it.ph;
        bodyEl.appendChild(n1); bodyEl.appendChild(n2);

        const applyBtn = document.createElement('button');
        applyBtn.type = 'button';
        applyBtn.className = 'preset__apply';
        applyBtn.textContent = tr('btn.apply');
        applyBtn.setAttribute('aria-label', tr('btn.apply.aria', { name: it.name }));

        card.appendChild(bodyEl); card.appendChild(applyBtn);
        items.appendChild(card);
        presetCardEls.push({ el: card, item: it });

        card.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); applyPreset(it, false); }
        });
      });

      wrap.appendChild(nm); wrap.appendChild(items);
      ps.appendChild(wrap);
    });

    // 目标体积预设
    const sp = $('size-presets');
    sp.textContent = '';
    sizeChips().forEach((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.bytes = c.bytes === null ? '' : String(c.bytes);
      b.textContent = c.label;
      b.addEventListener('click', () => pickSizeChip(c));
      sp.appendChild(b);
      sizeChipEls.push({ el: b, data: c });
    });

  }

  /* ── 10. 状态写回 UI ────────────────────────────────────────────────── */

  function paintStatus() {
    const pill = $('ro-status');
    if (!S.img) { pill.dataset.state = 'idle'; pill.textContent = tr('status.idle'); return; }
    if (busyDepth > 0) { pill.dataset.state = 'busy'; pill.textContent = tr('status.busy'); return; }
    if (!S.result) { pill.dataset.state = 'idle'; pill.textContent = tr('status.wait'); return; }
    const t = S.targetBytes;
    if (t === null) { pill.dataset.state = 'ok'; pill.textContent = tr('status.ready'); return; }
    if (S.result.blob.size <= t) { pill.dataset.state = 'ok'; pill.textContent = tr('status.hit'); }
    else { pill.dataset.state = 'warn'; pill.textContent = tr('status.miss'); }
  }

  function focusText() {
    if (Math.abs(S.focusX - 0.5) < 0.006 && Math.abs(S.focusY - 0.5) < 0.006) return tr('focus.center');
    return tr('focus.at', { x: Math.round(S.focusX * 100), y: Math.round(S.focusY * 100) });
  }

  function paintFocus() {
    $('focus-readout').textContent = focusText();
    const cells = $('focus-grid').querySelectorAll('.focus-grid__cell');
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const on = Math.abs(Number(c.dataset.fx) - S.focusX) < 0.006 && Math.abs(Number(c.dataset.fy) - S.focusY) < 0.006;
      c.classList.toggle('is-active', on);
    }
    $('btn-reset-crop').disabled = !S.img;
  }

  /** 与几何相关的 UI：取景、标志位、输出尺寸策略相关提示 */
  function paintGeometry(geo) {
    const frame = $('stage-frame');
    const isSource = S.viewMode === 'source';

    // 成片视图的帧比例 = 输出比例；原图取景视图的帧比例 = 原图比例
    frame.classList.toggle('is-source-view', isSource);
    frame.style.setProperty('--stage-ar', String(isSource ? geo.srcW / geo.srcH : geo.outW / geo.outH));

    const slack = geo.gapX > 0 || geo.gapY > 0;
    frame.classList.toggle('is-locked', !slack);
    $('stage-hint').hidden = !slack;
    $('stage-hint-text').textContent = isSource
      ? tr('hint.source')
      : tr('hint.crop');

    paintCropReadout(geo);

    paintFocus();

    // 放大 / 缩小
    const up = $('flag-upscale');
    if (geo.factor > 1.001) {
      up.hidden = false;
      up.textContent = tr('flag.upscale', { n: geo.factor.toFixed(2) });
    } else { up.hidden = true; }

    const down = $('flag-downscale');
    if (geo.factor < 0.999 && S.sizeMode !== 'max') {
      down.hidden = false;
      down.textContent = tr('flag.downscale', { p: (geo.factor * 100).toFixed(0) });
    } else { down.hidden = true; }

    // 输出尺寸策略
    const modeChips = $('size-modes').querySelectorAll('.chip[data-mode]');
    for (let i = 0; i < modeChips.length; i++) {
      const c = modeChips[i];
      const on = c.dataset.mode === S.sizeMode;
      c.classList.toggle('is-active', on);
      c.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    const mp = $('mode-preset');
    mp.disabled = !S.presetPx;
    $('mode-preset-px').textContent = S.presetPx ? (S.presetPx.w + ' × ' + S.presetPx.h) : '—';
    $('edge-field').hidden = S.sizeMode !== 'edge';

    // 体积相关标志位
    $('flag-tiny').hidden = !(S.targetBytes !== null && S.targetBytes < TINY_TARGET_BYTES);
    $('flag-png').hidden = !(S.format === 'image/png' && S.targetBytes !== null);

    // 导出设置显示条件
    $('bg-field').hidden = !(S.format === 'image/jpeg' && S.hasAlpha);
    $('quality-field').hidden = S.format === 'image/png';
    $('format-hint').textContent = S.format === 'image/png'
      ? tr('fmt.hint.png')
      : tr('fmt.hint.jpg');

    $('stage-thirds').hidden = !S.thirdsVisible;
    $('btn-toggle-grid').setAttribute('aria-pressed', S.thirdsVisible ? 'true' : 'false');

    paintCropOverlay(geo);
    paintSelection();
    paintSteps();
  }

  /** 裁切区域的数值读数（拖动时要实时刷新） */
  function paintCropReadout(geo) {
    $('crop-info').hidden = false;
    $('crop-rect').textContent = tr('crop.rect', { w: geo.cropW, h: geo.cropH, x: geo.sx, y: geo.sy });
    $('crop-gap-x').textContent = tr('crop.gap', { n: geo.gapX });
    $('crop-gap-y').textContent = tr('crop.gap', { n: geo.gapY });
  }

  function paintViewToggle() {
    const btns = $('view-mode').querySelectorAll('.segmented__btn');
    for (let i = 0; i < btns.length; i++) {
      const on = btns[i].dataset.view === S.viewMode;
      btns[i].classList.toggle('is-active', on);
      btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  /** 高亮所有“当前选中项”（不依赖几何信息，启动时也能安全调用） */
  function paintSelection() {
    ratioChipEls.forEach((el) => {
      const on = Number(el.dataset.rw) === S.ratioW && Number(el.dataset.rh) === S.ratioH;
      el.classList.toggle('is-active', on);
      el.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    presetCardEls.forEach(({ el }) => {
      const on = el.dataset.id === S.presetId;
      el.classList.toggle('is-active', on);
      el.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    sizeChipEls.forEach(({ el, data }) => {
      const on = data.bytes === S.targetBytes;
      el.classList.toggle('is-active', on);
      el.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const fmtBtns = $('format-group').querySelectorAll('.segmented__btn');
    for (let i = 0; i < fmtBtns.length; i++) {
      const b = fmtBtns[i];
      const on = b.dataset.format === S.format;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    const unitBtns = $('size-unit').querySelectorAll('.segmented__btn');
    for (let i = 0; i < unitBtns.length; i++) {
      const b = unitBtns[i];
      const on = b.dataset.unit === sizeUnit;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    const modeChips = $('size-modes').querySelectorAll('.chip[data-mode]');
    for (let i = 0; i < modeChips.length; i++) {
      const c = modeChips[i];
      const on = c.dataset.mode === S.sizeMode;
      c.classList.toggle('is-active', on);
      c.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    $('mode-preset').disabled = !S.presetPx;
    $('mode-preset-px').textContent = S.presetPx ? (S.presetPx.w + ' × ' + S.presetPx.h) : '—';
    $('edge-field').hidden = S.sizeMode !== 'edge';
    $('quality-readout').textContent = S.manualQuality > 0 ? Math.round(S.manualQuality * 100) + '%' : tr('q.auto');
    $('quality-input').value = String(Math.round(S.manualQuality * 100));
  }

  /** 导出前信息 + 读数条 */
  function paintResult(geo, ms) {
    const r = S.result;
    if (!r) return;
    const bytes = r.blob.size;
    const target = S.targetBytes;
    const dimsText = tr('dims.px', { w: r.w, h: r.h });

    $('sm-dims').textContent = dimsText;
    $('ro-dims').textContent = r.w + ' × ' + r.h;

    const ratioLabel = trimNum(S.ratioW, 2) + ':' + trimNum(S.ratioH, 2);
    $('sm-ratio').textContent = ratioLabel + ' · ' + (r.w / r.h).toFixed(3);
    $('ro-ratio').textContent = ratioLabel;

    const ext = S.format === 'image/png' ? 'PNG' : 'JPG';
    $('sm-format').textContent = ext;
    $('sm-target').textContent = target === null ? tr('sm.target.unlimited') : fmtBytes(target);
    $('ro-target').textContent = target === null ? tr('size.unlimited') : fmtBytes(target);
    $('sm-actual').textContent = fmtBytes(bytes);
    $('ro-size').textContent = fmtBytes(bytes);

    if (S.format === 'image/png') $('sm-quality').textContent = tr('sm.quality.lossless');
    else if (S.manualQuality > 0) $('sm-quality').textContent = tr('sm.quality.manual', { q: Math.round(S.manualQuality * 100) });
    else if (r.quality !== null) {
      $('sm-quality').textContent = target === null
        ? tr('sm.quality.fixed', { q: (r.quality * 100).toFixed(0) })
        : tr('sm.quality.auto', { q: (r.quality * 100).toFixed(0) });
    } else $('sm-quality').textContent = '—';

    let scaleText;
    if (geo.factor > 1.001) scaleText = tr('sm.scale.up', { n: geo.factor.toFixed(2) });
    else if (geo.factor < 0.999) scaleText = tr('sm.scale.down', { n: geo.factor.toFixed(2) });
    else scaleText = tr('sm.scale.same');
    if (r.w !== geo.outW || r.h !== geo.outH) scaleText += tr('sm.scale.shrunk', { s: '', w: r.w, h: r.h }).replace('{s}', scaleText).replace(/^.*?→/, ' →');
    $('sm-scale').textContent = scaleText;

    $('sm-time').textContent = (ms / 1000).toFixed(1) + ' s';

    // 目标达成判定
    let verdictHtml, reached;
    if (target === null) {
      reached = true;
      verdictHtml = '<span class="verdict verdict--idle">' + tr('sm.verdict.none') + '</span>';
    } else if (bytes <= target) {
      reached = true;
      const room = (bytes / target * 100).toFixed(1);
      verdictHtml = '<span class="verdict verdict--ok">' + tr('sm.verdict.ok', { p: room }) + '</span>';
    } else {
      reached = false;
      verdictHtml = '<span class="verdict verdict--warn">' + tr('sm.verdict.miss', { d: fmtBytes(bytes - target) }) + '</span>';
    }
    $('sm-verdict').innerHTML = verdictHtml;

    // 脚注（诚实说明）
    const notes = [];
    if (S.format === 'image/jpeg' && S.hasAlpha) {
      notes.push(tr('note.bgfill', { color: S.bgColor.toUpperCase() }));
    }
    if (S.format === 'image/png' && target !== null && !reached) {
      notes.push(tr('note.pngOver', { d: fmtBytes(bytes - target) }));
    }
    if (r.unreachable) {
      notes.push(tr('note.unreachable', { size: fmtBytes(r.minBytes) }));
    }
    if (geo.factor > 1.001 && S.sizeMode !== 'max') {
      notes.push(tr('note.upscaled', { cw: geo.cropW, ch: geo.cropH, n: geo.factor.toFixed(2) }));
    }
    if (r.w !== geo.outW || r.h !== geo.outH) {
      notes.push(tr('note.shrunk', { ow: geo.outW, oh: geo.outH, w: r.w, h: r.h }));
    }
    if (!notes.length) notes.push(tr('note.privacy'));
    $('sm-foot').textContent = notes.join(' ');

    // 下载按钮
    $('btn-download').disabled = false;
    $('download-label').textContent = tr('dl.label', { ext: ext, w: r.w, h: r.h });
    $('download-note').textContent = target === null
      ? tr('dl.note.unlimited', { ext: ext, size: fmtBytes(bytes) })
      : tr('dl.note.target', { ext: ext, size: fmtBytes(bytes), target: fmtBytes(target), state: reached ? tr('dl.state.hit') : tr('dl.state.miss') });

    paintStatus();
  }

  /** 左侧步骤条的完成态 */
  function paintSteps() {
    const st = {
      source: !!S.img,
      ratio: !!S.img,
      target: S.targetBytes !== null,
      output: !!S.img,
      crop: !!S.img,
      export: !!S.result
    };
    const order = ['source', 'ratio', 'target', 'output', 'crop', 'export'];
    let currentSet = false;
    $('steps-list').querySelectorAll('.steps__item').forEach((li) => {
      const k = li.dataset.step;
      const done = st[k];
      let isCurrent = false;
      if (!done && !currentSet) { isCurrent = true; currentSet = true; }
      li.classList.toggle('is-done', done);
      li.classList.toggle('is-current', isCurrent);
    });
    void order;
  }

  function clearOutputs() {
    $('stage-canvas').width = 16;
    $('stage-canvas').height = 9;
    $('stage-crop').hidden = true;
    $('stage-thirds').style.cssText = '';
    $('stage-thirds').hidden = !S.thirdsVisible;
    $('sm-dims').textContent = '—';
    $('sm-ratio').textContent = '—';
    $('sm-format').textContent = '—';
    $('sm-target').textContent = '—';
    $('sm-actual').textContent = '—';
    $('sm-quality').textContent = '—';
    $('sm-scale').textContent = '—';
    $('sm-time').textContent = '—';
    $('sm-verdict').textContent = '—';
    $('sm-foot').textContent = tr('sm.foot.empty');
    $('ro-dims').textContent = '—';
    $('ro-ratio').textContent = '—';
    $('ro-size').textContent = '—';
    $('ro-target').textContent = S.targetBytes === null ? tr('size.unlimited') : fmtBytes(S.targetBytes);
    $('download-label').textContent = tr('dl.label.idle');
    $('download-note').textContent = tr('dl.note.idle');
    paintStatus();
    paintSteps();
  }

  /* ── 11. 动作 ───────────────────────────────────────────────────────── */

  let sizeUnit = 'KB';
  let inputTimer = 0;

  function applyRatio(w, h) {
    S.ratioW = w; S.ratioH = h;
    S.presetId = null;
    // 换了比例，之前的平台推荐像素不再适配 → 退回“最大可用”
    if (S.sizeMode === 'preset') { S.sizeMode = 'max'; S.presetPx = null; }
    $('ratio-error').hidden = true;
    $('ratio-w').removeAttribute('aria-invalid');
    paintSelection();
    return invalidate();
  }

  function applyPreset(item, applySize) {
    S.ratioW = item.w; S.ratioH = item.h;
    S.presetId = item.id;
    S.presetPx = { w: item.pw, h: item.ph };
    if (applySize) S.sizeMode = 'preset';
    paintSelection();
    return invalidate();
  }

  function applyCustomRatio() {
    const w = Number($('ratio-w').value);
    const h = Number($('ratio-h').value);
    const err = $('ratio-error');
    const input = $('ratio-w');
    if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) {
      err.textContent = tr('ratio.err.positive');
      err.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      return Promise.resolve(false);
    }
    if (w > 100 || h > 100) {
      err.textContent = tr('ratio.err.range');
      err.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      return Promise.resolve(false);
    }
    err.hidden = true;
    input.removeAttribute('aria-invalid');
    return applyRatio(w, h);
  }

  function pickSizeChip(c) {
    if (inputTimer) { clearTimeout(inputTimer); inputTimer = 0; }
    S.targetBytes = c.bytes;
    $('size-error').hidden = true;
    $('size-value').removeAttribute('aria-invalid');
    if (c.bytes === null) {
      $('size-value').value = '';
    } else if (c.bytes % (1024 * 1024) === 0) {
      sizeUnit = 'MB'; $('size-value').value = String(c.bytes / (1024 * 1024));
    } else {
      sizeUnit = 'KB'; $('size-value').value = String(Math.round(c.bytes / 1024));
    }
    paintSelection();
    return invalidate();
  }

  function applyTargetInput() {
    if (inputTimer) { clearTimeout(inputTimer); inputTimer = 0; }
    const raw = String($('size-value').value || '').trim();
    const err = $('size-error');
    const input = $('size-value');
    if (raw === '') {
      err.hidden = true;
      input.removeAttribute('aria-invalid');
      S.targetBytes = null;
      paintSelection();
      return invalidate();
    }
    const num = Number(raw);
    if (!isFinite(num) || num <= 0) {
      err.textContent = tr('size.err.positive');
      err.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      return Promise.resolve(false);
    }
    const bytes = sizeUnit === 'MB' ? num * 1024 * 1024 : num * 1024;
    if (bytes > MAX_TARGET_BYTES) {
      const mb = trimNum(sizeUnit === 'MB' ? num : num / 1024, 2);
      err.textContent = tr('size.err.max', { mb: mb });
      err.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      return Promise.resolve(false);
    }
    err.hidden = true;
    input.removeAttribute('aria-invalid');
    S.targetBytes = Math.round(bytes);
    paintSelection();
    return invalidate();
  }

  function setEdge(v) {
    const err = $('edge-error');
    const input = $('edge-input');
    if (!isFinite(v) || v < 16 || v > 10000) {
      err.textContent = tr('edge.err');
      err.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      return;
    }
    err.hidden = true;
    input.removeAttribute('aria-invalid');
    S.edge = Math.round(v);
    S.sizeMode = 'edge';
    paintSelection();
    invalidate();
  }

  function setSizeMode(mode) {
    if (mode === 'preset' && !S.presetPx) return;
    S.sizeMode = mode;
    if (mode === 'edge') {
      const v = Number($('edge-input').value);
      if (isFinite(v) && v >= 16) S.edge = Math.round(v);
    }
    paintSelection();
    invalidate();
  }

  function setFormat(fmt) {
    if (fmt === S.format) return;
    S.format = fmt;
    paintSelection();
    invalidate();
  }

  /* ── 12. 图片载入 ───────────────────────────────────────────────────── */

  const IMG_EXT = /\.(jpe?g|png|webp|gif|bmp|avif)$/i;

  function isImageFile(file) {
    if (file.type && file.type.indexOf('image/') === 0) return true;
    return !file.type && IMG_EXT.test(file.name || '');
  }

  function detectAlpha(img) {
    try {
      const { ctx } = makeCanvas(48, 48, { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 0, 0, 48, 48);
      const data = ctx.getImageData(0, 0, 48, 48).data;
      for (let i = 3; i < data.length; i += 4) { if (data[i] < 250) return true; }
      return false;
    } catch (err) {
      return false;
    }
  }

  async function loadFile(file) {
    if (!file) return;
    if (!isImageFile(file)) {
      toast('error', tr('toast.notImage.title'),
        tr('toast.notImage.msg', { name: file.name }));
      return;
    }
    pushBusy(tr('busy.read'));
    try {
      const url = await readAsDataURL(file);
      setBusyText(tr('busy.decode'));
      const img = await decodeImage(url);

      S.file = file;
      S.img = img;
      S.srcW = img.naturalWidth || img.width;
      S.srcH = img.naturalHeight || img.height;
      S.hasAlpha = detectAlpha(img);
      S.focusX = 0.5; S.focusY = 0.5;
      S.result = null;
      S.dirty = true;

      $('info-name').textContent = file.name;
      $('info-name').title = file.name;
      $('info-dims').textContent = tr('dims.px', { w: S.srcW, h: S.srcH });
      $('info-mp').textContent = trimNum(S.srcW * S.srcH / 1e6, 2) + ' MP';
      $('info-ratio').textContent = ratioText(S.srcW, S.srcH);
      $('info-size').textContent = fmtBytes(file.size);
      $('info-format').textContent = (file.type || '').replace('image/', '').toUpperCase() || tr('value.unknown');
      $('info-alpha').textContent = S.hasAlpha ? tr('value.yes') : tr('value.no');

      $('source-info').hidden = false;
      $('flag-large').hidden = !(S.srcW * S.srcH >= LARGE_PIXELS);
      $('btn-change-file').hidden = false;
      /* 素材载入后收起投放区：此时左栏的主角是「这张图的规格」，
         而大号虚线投放区（图标 + 三行引导文案）在 264px 宽的栏里太重，
         且与紧邻的「换一张图片」是同一个动作（都打开文件对话框）。
         换图能力不丢：拖拽到页面任意位置、⌘V 粘贴、以及残留的按钮都还在。 */
      $('dropzone').hidden = true;
      $('btn-reset-all').disabled = false;
      $('panel-crop-controls').hidden = false;
      $('btn-reset-crop').disabled = false;
      $('stage').hidden = false;
      $('stage-empty').hidden = true;

      await invalidate();

      toast('info', tr('toast.load.title'),
        tr('toast.load.msg', { w: S.srcW, h: S.srcH, size: fmtBytes(file.size), alpha: S.hasAlpha ? tr('alpha.yes') : tr('alpha.no') }));
    } catch (err) {
      toast('error', tr('toast.decode.title'),
        tr('toast.decode.msg', { name: file.name }));
    } finally {
      popBusy();
    }
  }

  /* ── 13. 导出 ───────────────────────────────────────────────────────── */

  async function download() {
    if (!S.img) return;
    if (inputTimer) { clearTimeout(inputTimer); inputTimer = 0; }
    $('btn-download').disabled = true;
    try {
      await ensureFresh();
      const r = S.result;
      if (!r) return;
      const ext = S.format === 'image/png' ? 'png' : 'jpg';
      const name = sanitizeBase(S.file ? S.file.name : 'cover') +
        '-' + ratioTag(S.ratioW, S.ratioH) + '-' + r.w + 'x' + r.h + '.' + ext;

      const url = URL.createObjectURL(r.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        if (a.parentNode) a.parentNode.removeChild(a);
      }, 4000);

      const target = S.targetBytes;
      const tail = target === null ? tr('tail.unlimited') : (r.blob.size <= target ? tr('tail.hit', { target: fmtBytes(target) }) : tr('tail.miss', { target: fmtBytes(target) }));
      toast('success', tr('toast.exported.title'),
        tr('toast.exported.msg', { name: name, size: fmtBytes(r.blob.size), tail: tail, sec: (r.ms / 1000).toFixed(1) }));

      if (target !== null && r.blob.size > target) {
        toast('warn', tr('toast.miss.title'),
        tr('toast.miss.msg', {
          size: fmtBytes(r.blob.size), target: fmtBytes(target),
          advice: S.format === 'image/png' ? tr('advice.png') : tr('advice.jpg')
        }));
      }
    } catch (err) {
      toast('error', tr('toast.exportFail.title'),
        tr('toast.exportFail.msg', { err: (err && err.message ? err.message : String(err)) }));
    } finally {
      $('btn-download').disabled = false;
    }
  }

  function resetAll() {
    if (inputTimer) { clearTimeout(inputTimer); inputTimer = 0; }
    cancelDebounce();
    jobSeq++;
    busyDepth = 0;

    S.file = null; S.img = null; S.srcW = 0; S.srcH = 0; S.hasAlpha = false;
    S.ratioW = 16; S.ratioH = 9; S.focusX = 0.5; S.focusY = 0.5;
    S.sizeMode = 'max'; S.presetPx = null; S.edge = 1920; S.targetBytes = null;
    S.format = 'image/jpeg'; S.bgColor = '#ffffff'; S.manualQuality = 0;
    S.presetId = null; S.geo = null; S.result = null; S.dirty = true;
    sizeUnit = 'KB';

    $('file-input').value = '';
    $('size-value').value = '';
    $('edge-input').value = '1920';
    $('ratio-w').value = '2.35';
    $('ratio-h').value = '1';
    $('bg-color').value = '#ffffff';
    $('size-error').hidden = true;
    $('ratio-error').hidden = true;
    $('edge-error').hidden = true;
    $('size-value').removeAttribute('aria-invalid');
    $('ratio-w').removeAttribute('aria-invalid');
    $('edge-input').removeAttribute('aria-invalid');

    $('source-info').hidden = true;
    $('flag-large').hidden = true;
    $('flag-upscale').hidden = true;
    $('flag-downscale').hidden = true;
    $('flag-tiny').hidden = true;
    $('flag-png').hidden = true;
    $('btn-change-file').hidden = true;
    $('btn-reset-all').disabled = true;
    $('btn-reset-crop').disabled = true;
    $('panel-crop-controls').hidden = true;
    $('crop-info').hidden = true;
    $('stage').hidden = true;
    $('stage-empty').hidden = false;
    $('stage-busy').hidden = true;
    $('readout-progress').hidden = true;
    $('btn-download').disabled = true;
    $('stage-thirds').hidden = !S.thirdsVisible;

    clearOutputs();
    paintSelection();
    paintFocus();
    $('focus-readout').textContent = tr('focus.center');
  }

  /* ── 14. 事件绑定 ───────────────────────────────────────────────────── */

  function bindEvents() {
    const frame = $('stage-frame');

    // 上传：点击 / 键盘
    $('dropzone').addEventListener('click', () => $('file-input').click());
    $('dropzone').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('file-input').click(); }
    });
    $('btn-change-file').addEventListener('click', () => $('file-input').click());
    $('file-input').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f) loadFile(f);
    });

    // 上传：拖拽（监听 window，页面任意位置都能投放）
    const veil = $('drop-veil');
    const hasFiles = (e) => {
      const dt = e.dataTransfer;
      if (!dt) return false;
      if (dt.files && dt.files.length) return true;
      const t = dt.types;
      if (!t) return false;
      for (let i = 0; i < t.length; i++) { if (t[i] === 'Files') return true; }
      return false;
    };
    window.addEventListener('dragenter', (e) => {
      e.preventDefault();
      if (hasFiles(e)) veil.classList.add('is-on');
    });
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      if (hasFiles(e)) veil.classList.add('is-on');
    });
    window.addEventListener('dragleave', (e) => {
      // relatedTarget 为空 = 指针真的离开了窗口
      if (!e.relatedTarget) veil.classList.remove('is-on');
    });
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      veil.classList.remove('is-on');
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) loadFile(f);
    });

    // 上传：粘贴（先看 files，再兜底看 items —— 部分应用粘贴图片时只填 items）
    window.addEventListener('paste', (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      const dt = e.clipboardData;
      if (!dt) return;
      let picked = null;
      const isImg = (type) => !!type && type.indexOf('image/') === 0;
      const files = dt.files;
      if (files && files.length) {
        for (let i = 0; i < files.length; i++) {
          if (isImg(files[i].type)) { picked = files[i]; break; }
        }
      }
      if (!picked && dt.items && dt.items.length) {
        for (let i = 0; i < dt.items.length; i++) {
          const it = dt.items[i];
          if (it.kind === 'file' && isImg(it.type)) {
            const f = it.getAsFile();
            if (f) { picked = f; break; }
          }
        }
      }
      if (!picked) return;
      e.preventDefault();
      loadFile(picked);
    });

    // 比例
    $('btn-apply-ratio').addEventListener('click', applyCustomRatio);
    ['ratio-w', 'ratio-h'].forEach((id) => {
      $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyCustomRatio(); } });
    });

    // 平台预设：点卡片本体 = 只套用比例；点“套用” = 比例 + 推荐像素
    $('platform-presets').addEventListener('click', (e) => {
      const card = e.target.closest('.preset');
      if (!card) return;
      const applyBtn = e.target.closest('.preset__apply');
      const hit = presetCardEls.filter((p) => p.el === card)[0];
      if (!hit) return;
      applyPreset(hit.item, !!(applyBtn && applyBtn.closest('.preset') === card));
    });

    // 目标体积
    $('btn-apply-size').addEventListener('click', applyTargetInput);
    $('size-value').addEventListener('input', () => {
      if (inputTimer) clearTimeout(inputTimer);
      inputTimer = setTimeout(() => { inputTimer = 0; applyTargetInput(); }, 420);
    });
    $('size-value').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyTargetInput(); } });
    $('size-unit').addEventListener('click', (e) => {
      const b = e.target.closest('.segmented__btn[data-unit]');
      if (!b) return;
      if (sizeUnit === b.dataset.unit) return;
      sizeUnit = b.dataset.unit;
      paintSelection();
      // 单位变了，已经生效的目标体积必须按新单位重算：
      // 否则会出现「输入框显示 2 + MB 高亮，实际仍按 2 KB 压缩」的静默不一致。
      applyTargetInput();
    });
    $('btn-switch-jpg').addEventListener('click', () => setFormat('image/jpeg'));

    // 输出尺寸
    $('size-modes').addEventListener('click', (e) => {
      const b = e.target.closest('.chip[data-mode]');
      if (!b || b.disabled) return;
      setSizeMode(b.dataset.mode);
    });
    $('edge-input').addEventListener('change', () => setEdge(Number($('edge-input').value)));
    $('edge-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); setEdge(Number($('edge-input').value)); } });

    // 取景
    $('focus-grid').addEventListener('click', (e) => {
      const c = e.target.closest('.focus-grid__cell');
      if (!c || !S.img) return;
      S.focusX = Number(c.dataset.fx);
      S.focusY = Number(c.dataset.fy);
      paintFocus();
      invalidate();
    });
    $('btn-reset-crop').addEventListener('click', () => {
      S.focusX = 0.5; S.focusY = 0.5;
      paintFocus();
      invalidate();
    });
    $('btn-toggle-grid').addEventListener('click', () => {
      S.thirdsVisible = !S.thirdsVisible;
      $('stage-thirds').hidden = !S.thirdsVisible;
      $('btn-toggle-grid').setAttribute('aria-pressed', S.thirdsVisible ? 'true' : 'false');
    });

    // 舞台视图切换：成片（看结果）↔ 原图取景（看框外，判断构图）
    $('view-mode').addEventListener('click', (e) => {
      const b = e.target.closest('.segmented__btn[data-view]');
      if (!b || b.dataset.view === S.viewMode) return;
      S.viewMode = b.dataset.view;
      paintViewToggle();
      if (!S.img) return;
      const geo = S.geo || computeGeometry();
      paintStage(geo);
      paintCropReadout(geo);
      paintGeometry(geo);
    });

    // 拖拽微调取景
    let drag = null;
    frame.addEventListener('pointerdown', (e) => {
      if (!S.img || e.button !== 0 || frame.classList.contains('is-locked')) return;
      const geo = S.geo || computeGeometry();
      if (geo.gapX <= 0 && geo.gapY <= 0) return;
      const rect = frame.getBoundingClientRect();
      drag = {
        id: e.pointerId, x: e.clientX, y: e.clientY,
        fx: S.focusX, fy: S.focusY, geo: geo, w: rect.width, h: rect.height
      };
      frame.classList.add('is-dragging');
      try { frame.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
      e.preventDefault();
    });
    frame.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      // 成片视图拖的是「画面」→ 裁剪窗反向移动；原图取景视图拖的是「裁剪框」→ 同向移动。
      // 换算基准也不同：前者按裁切区尺寸，后者按原图尺寸（帧里显示的是整张原图）。
      const isSource = S.viewMode === 'source';
      const baseW = isSource ? drag.geo.srcW : drag.geo.cropW;
      const baseH = isSource ? drag.geo.srcH : drag.geo.cropH;
      const sign = isSource ? 1 : -1;
      const perPxX = drag.w > 0 ? baseW / drag.w : 0;
      const perPxY = drag.h > 0 ? baseH / drag.h : 0;
      S.focusX = clamp(drag.geo.gapX > 0 ? drag.fx + sign * (dx * perPxX) / drag.geo.gapX : drag.fx, 0, 1);
      S.focusY = clamp(drag.geo.gapY > 0 ? drag.fy + sign * (dy * perPxY) / drag.geo.gapY : drag.fy, 0, 1);
      const live = computeGeometry();
      if (isSource) { paintCropOverlay(live); paintCropReadout(live); }
      else paintPreviewLive(live);
      paintFocus();
    });
    const endDrag = (e) => {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      drag = null;
      frame.classList.remove('is-dragging');
      invalidate();
    };
    frame.addEventListener('pointerup', endDrag);
    frame.addEventListener('pointercancel', endDrag);
    frame.addEventListener('lostpointercapture', endDrag);

    // 导出设置
    $('format-group').addEventListener('click', (e) => {
      const b = e.target.closest('.segmented__btn[data-format]');
      if (b) setFormat(b.dataset.format);
    });
    $('bg-color').addEventListener('input', () => {
      S.bgColor = $('bg-color').value || '#ffffff';
      markSwatches();
      invalidate(160);
    });
    $('bg-swatches').addEventListener('click', (e) => {
      const s = e.target.closest('.swatch[data-color]');
      if (!s) return;
      S.bgColor = s.dataset.color;
      $('bg-color').value = S.bgColor;
      markSwatches();
      invalidate();
    });
    $('quality-input').addEventListener('input', () => {
      const v = Number($('quality-input').value);
      S.manualQuality = v > 0 ? v / 100 : 0;
      $('quality-readout').textContent = S.manualQuality > 0 ? Math.round(S.manualQuality * 100) + '%' : tr('q.auto');
      invalidate(200);
    });

    // 长边快捷值
    $('edge-presets').addEventListener('click', (e) => {
      const b = e.target.closest('.chip[data-edge]');
      if (!b) return;
      $('edge-input').value = b.dataset.edge;
      setEdge(Number(b.dataset.edge));
    });

    // 语言切换（i18n.js 提供 CF；未加载时按钮不出现副作用）
    $('btn-lang').addEventListener('click', () => {
      if (window.CF) window.CF.toggleLang();
    });

    // 下载 / 重置
    $('btn-download').addEventListener('click', download);
    $('btn-reset-all').addEventListener('click', resetAll);

    // 步骤条 → 滚动到对应面板
    const stepTarget = {
      source: 'panel-source', ratio: 'panel-ratio', target: 'panel-target',
      output: 'panel-output', crop: 'panel-stage', export: 'panel-export'
    };
    $('steps-list').addEventListener('click', (e) => {
      const li = e.target.closest('.steps__item');
      if (!li) return;
      const step = li.dataset.step;
      // 「05 取景」直接切到原图取景视图 —— 这一步的实质操作在舞台上，而不是说明面板
      if (step === 'crop' && S.img && S.viewMode !== 'source') {
        S.viewMode = 'source';
        paintViewToggle();
        const geo = S.geo || computeGeometry();
        paintStage(geo);
        paintGeometry(geo);
      }
      const p = $(stepTarget[step]);
      if (p) p.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
    });

    // 快捷键
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        veil.classList.remove('is-on');
        if (drag) { drag = null; frame.classList.remove('is-dragging'); }
      }
    });
  }

  function markSwatches() {
    const list = $('bg-swatches').querySelectorAll('.swatch');
    for (let i = 0; i < list.length; i++) {
      list[i].classList.toggle('is-active', list[i].dataset.color.toLowerCase() === S.bgColor.toLowerCase());
    }
  }

  function reducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* ── 15. 启动 ───────────────────────────────────────────────────────── */

  /**
   * 语言切换回调（由 i18n.js 的 setLang 调用）。
   * 静态文案由 i18n.js 按选择器表覆盖；这里负责所有「构建时生成」的动态文案：
   * 比例 chips、平台预设卡片、体积预设，以及当前这张图的全部读数。
   */
  window.CoverForge = window.CoverForge || {};
  window.CoverForge.onLangChange = function () {
    buildUI();          // chip / 预设的文字与 aria-label 都在构建时写入
    paintSelection();
    paintViewToggle();
    markSwatches();
    if (S.img) {
      const geo = S.geo || computeGeometry();
      paintGeometry(geo);
      paintCropReadout(geo);
      if (S.result) paintResult(geo, S.result.ms);
      paintStage(geo);
    } else {
      clearOutputs();
    }
  };

  function boot() {
    // 先按已保存的语言刷新静态文案（含 <title> 与 html[lang]），再构建动态部分
    if (window.CF) window.CF.applyDOM();
    buildUI();
    bindEvents();
    markSwatches();
    paintViewToggle();
    $('stage-thirds').hidden = false;
    $('stage').hidden = true;
    $('stage-empty').hidden = false;
    $('stage-busy').hidden = true;
    $('readout-progress').hidden = true;
    clearOutputs();
    paintSelection();
    paintFocus();
    $('focus-readout').textContent = tr('focus.center');
    $('btn-reset-crop').disabled = true;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})();
