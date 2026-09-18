# CoverForge · 封面工坊 — Design System

> **DARKROOM FORGE** — 一间暗房里的锻造台
> 设计系统 v1.1 · 2026-09-18
>
> **这份文档是设计的唯一源文件，但它不是需求书——它是从 `styles.css` / `index.html` / `app.js`
> 的当前实现逐项**还原**出来的。文档里的每个数值、每条类名、每个状态都可在代码里找到出处；
> 凡实现与本文不符，以实现为准并回头改文档（§12 列出当前已知偏差）。**
>
> 反向索引：改动 UI 前请先读 §9（组件）、§10（布局）、§11（交互状态）。
> `styles.css` 顶部 23 个分区编号与 §9 的组件分组一一对应。

**本文档对应的构建**（2026-09-18 14:21 量测，之后文件如有改动请重跑量测再改本文数字）：

| 文件 | 行数 | sha256（前 16 位） |
|---|---|---|
| `styles.css` | 835 | `62e14e5061545c62` |
| `index.html` | 425 | `1a88363f7cb468e5` |
| `app.js` | 1658 | `6ba0851a7099a1ca` |

§4.4 / §10.1 里的尺寸与滚动数字都是**该构建上的无头 Chrome 实测值**（1512×950、DPR 1）。

---

## 0. 事实来源与阅读顺序

| 关注 | 看哪一节 | 对应代码位置 |
|---|---|---|
| 品牌调性 / 为什么是深色 | §1 | — |
| 颜色令牌、对比度实测 | §2 | `styles.css` §1 Tokens |
| 字体、字号阶梯、等宽数字 | §3 | `styles.css` §1 Tokens / §2 base |
| 间距、圆角、阴影、尺寸常量 | §4 | `styles.css` §1 Tokens |
| 动效时长、缓动、7 个 keyframes | §5 | `styles.css` 各组件 + §23 |
| 每个组件的结构 / 状态 | §9 | `styles.css` §3–§21 |
| 三栏布局与断点行为 | §10 | `styles.css` §5 + §22 |
| 无障碍要求与已知缺口 | §11 | `styles.css` §2 + 全站 |
| 空/忙/错/完成 四态 | §12 | `app.js` paint* 系列 |

---

## 1. Aesthetic — 美学定位

**一句话**：整块界面是一张哑光炭黑的工作台面，图片是台面上唯一亮着的东西。

三个关键词：**Instrument（仪器感）· Matte（哑光）· Ember（余温）**

**为什么是深色工作台（dark studio）**：这是图像处理工具，用户判读的对象是画面本身的明度与色彩。
浅色界面会在图片周围形成高亮包围，压低对画面暗部的感知，并让图片看起来比实际更暗。
Photoshop / Lightroom / Figma / DaVinci 都因此采用深色工作区。省下的主题复杂度被投入到
**对比度与层次**：正文 ≥ 4.5:1、主要文字 ≥ 7:1（§2 有实测值），界面里没有任何一处装饰性渐变。

**三条可执行的风格规则**（不是口号，写代码时照这个判）：

1. **控件做成仪表，不做按钮墙**：分段选择器、刻度式 chips、等宽数字读数条。参数的"当前值"永远出现在同一个位置。
2. **Ember 只表达"当前/焦点"**：`--ember` 出现在当前选中项、主操作、焦点环、裁剪框角标、正在处理的扫描光带上。
   它一出现，眼睛就知道该看哪儿。Ember 不用于装饰（不用来做渐变标题、描边花纹、图标底色）。
3. **数据一律等宽 + `tabular-nums`**：尺寸 / 比例 / 体积 / 质量 / 耗时 / 裁剪坐标。数值列能对齐是仪器感的来源。

### 反模板自检（设计时否决过的默认脸）

| 默认脸 | 否决理由 |
|---|---|
| 近黑底 + 荧光绿/朱红单色点缀 | 与本主题"暗房暖光"叙事无关，是通用科技感模板 |
| 奶油底 + 高对比衬线 + 陶土色 | 与图像工具的工作环境冲突（破坏图片判读） |
| 卡片堆叠式后台布局 | 图像工具的主角是画面，不是卡片；这里用**仪表台三栏**取代卡片网格 |

**界面里只有 3 处渐变，全部在表达空间或运动**，没有一处为了好看：
`.topbar` 的 180° 纵向渐变（顶栏顶光）、`.dropzone` 与 `.stage-empty` 的 radial 暖光暗角（把视线聚到中间）。

---

## 2. Color — 色彩系统

### 2.1 令牌全表（`styles.css` §1，共 23 个）

| 令牌 | HEX | 用途 |
|---|---|---|
| `--obsidian` | `#0A0C0F` | 页面底色（`body`）、遮罩/压暗底、跳过链接的文字色 |
| `--graphite` | `#12151A` | 面板底、步骤条底、`.preset__apply` 底 |
| `--slate` | `#1A1F26` | 抬升面：输入框、chip、预设卡、读数条、Toast、焦点区底 |
| `--slate-hi` | `#222831` | hover 抬升、`range` 轨道、Toast 关闭按钮 hover |
| `--hairline` | `#262C35` | 1px 分隔线（面板内的行分隔、`panel__head` 下边线） |
| `--hairline-hi` | `#333B47` | 强分隔与控件描边：输入框、chip 的 hover 描边、面板外框的强调版 |
| `--text-hi` | `#E9EDF2` | 主要文字：数值、标题、选中项文字 |
| `--text` | `#9BA6B4` | 正文与默认控件文字（`body` 默认色） |
| `--text-lo` | `#7C8794` | 三级文字：标签、说明、单位、未选中项 |
| `--ember` | `#FF7A33` | 唯一强调色：当前项、主操作、焦点环、裁剪框、扫描光带 |
| `--ember-hi` | `#FF9459` | 主按钮 hover |
| `--ember-dp` | `#D9581A` | 主按钮 active |
| `--ember-a12` | `rgba(255,122,51,.12)` | 选中项底色（chip / preset 的 `is-active`） |
| `--ember-a24` | `rgba(255,122,51,.24)` | 输入框聚焦外环、色板选中外环 |
| `--ember-a40` | `rgba(255,122,51,.40)` | 选中项描边、投放区 hover 描边、`::selection` |
| `--jade` | `#35C48D` | 达标 / 已完成（步骤条已完成编号、状态徽标 ok、成功 Toast） |
| `--amber` | `#E8B24A` | 未达标 / 风险提示（`flag--amber`、状态徽标 warn、警告 Toast） |
| `--coral` | `#FF6A5E` | 错误（输入框错误描边与错误文字、`flag` 错误边框、错误 Toast） |
| `--azure` | `#6BA6F5` | 中性信息（`flag--azure`、信息 Toast 的默认左竖条） |

**合成色**（半透明令牌叠在表面上的实际颜色，供取色/对比度核对）：
`--ember-a12` on `--slate` = `#352A28`；on `--graphite` = `#2E211D`；`amber 9%` on `--graphite` = `#25231E`；`azure 9%` on `--graphite` = `#1A222E`。

### 2.2 对比度实测（WCAG 2.1，sRGB 相对亮度计算）

文字色 × 表面：

| 前景 \ 背景 | obsidian | graphite | slate | slate-hi | 结论 |
|---|---|---|---|---|---|
| `--text-hi` | 16.65 | 15.56 | 14.09 | 12.61 | AAA |
| `--text` | 7.93 | 7.41 | 6.71 | 6.01 | AAA |
| `--text-lo` | 5.36 | 5.01 | 4.54 | 4.06 | AA（slate-hi 除外，见下） |
| `--ember` | 7.54 | 7.04 | 6.38 | 5.71 | AA 全通过 |
| `--jade` | 8.80 | 8.22 | 7.44 | 6.66 | AA 全通过 |
| `--amber` | 10.16 | 9.49 | 8.60 | 7.70 | AA 全通过 |
| `--coral` | 6.97 | 6.51 | 5.90 | 5.28 | AA 全通过 |
| `--azure` | 7.83 | 7.32 | 6.62 | 5.93 | AA 全通过 |

关键组合（含半透明叠底）：

| 组合 | 实测 | 判定 |
|---|---|---|
| 主按钮文字 `#140803` on `--ember` | 7.58 | AA |
| 分段选择器选中文字 on `--ember` | 7.58 | AA |
| 跳过链接文字 `--obsidian` on `--ember` | 7.54 | AA |
| `--text-hi` on chip 选中底（ember-a12 on slate） | 11.80 | AAA |
| `--text` on chip 选中底 | 5.62 | AA |
| `--text` on hover 底 `--slate-hi`（chip/preset 次级文字修正后） | 6.01 | AA |
| `--text-lo` on hover 底 `--slate-hi`（**修正前**） | **4.06** | **未达 AA → 已修（§13）** |
| `--amber` on `flag--amber` 底 | 8.15 | AA |
| `--azure` on `flag--azure` 底 | 6.40 | AA |
| `--coral` on `--slate`（错误文字/Toast） | 5.90 | AA |
| 焦点环 `--ember` on obsidian / slate | 7.54 / 6.38 | 远超 3:1 |

**非文字边界（1.4.11 要求 ≥3:1）—— 当前不达标的项，见 §12 偏差清单**：
`--hairline` on obsidian 1.39 / on graphite 1.30；`--hairline-hi` on graphite 1.62 / on slate 1.46。
即：输入框、焦点九宫格单元格、预设卡、折叠面板外框的**唯一边界线索低于 3:1**，只能靠填充色差（输入框 vs 面板仅 1.13:1）区分。

### 2.3 用色规则

- 语义色（jade/amber/coral/azure）**只**出现在徽标、`flag`、Toast 左竖条与径向小点上，**绝不做按钮填充**，避免与 Ember 争夺"可点击"信号。
- 破坏性/失败态用 `--coral` **文字 + 描边**表达，不做红色实心按钮。
- 禁止：装饰性渐变、玻璃拟态、彩色阴影、彩色 glow（Ember 焦点环是唯一例外）。

---

## 3. Typography — 字体排版

### 3.1 字体族（零外链约束下的选择）

```css
--font-sans: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue",
             "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
--font-mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas,
             "Liberation Mono", "Courier New", monospace;
```

**为什么全系统字体栈**：产品硬约束是"零依赖、零网络、`file://` 直接打开"。引入 Web Font 会同时破坏这三条
（首屏闪动、离线不可用、体积）。因此性格不靠一款奇特显示字，而靠**字重对比 + 字距 + 大小写 + 等宽**制造。

两个角色分工明确：`sans` 承担叙述与操作文案，`mono` 承担全部**数据**。
`.mono { font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1; letter-spacing: .01em }`
——数值列纵向对齐是"仪器感"的技术底座。

### 3.2 字号阶梯

| 令牌 | 值 | 主要用途（实际出现的类） |
|---|---|---|
| `--fs-display` | 30px（≤768 降为 24px） | `.stage-empty__title`（30/680/-.024em）、`.veil__title`（30/660/-.02em） |
| `--fs-readout` | 22px（≤768 降为 18px） | `.readout__value`（560 / line-height 1.15） |
| `--fs-title` | 17px | `.brand__en`（700 / uppercase / -.012em）——**仅品牌字标** |
| `--fs-lead` | 14.5px | `.btn--primary` 文字（660）、`.dropzone__title`（620）、`.readout__value--sm`（mono） |
| `--fs-body` | 14px | `body` 基准、`.btn` 默认字号 |
| `--fs-small` | 12.5px | 面板内说明、chip/预设卡文字、Toast 文字、状态徽标、`.kv` 行 |
| `--fs-mono` | 12.5px | `.mono` 行内数据、`input--num` |
| `--fs-micro` | 11px | 单位、`.chip__meta`、`.preset__ratio`、`.stage__hint`、`.kv__file`、`.field__hint` |
| `--fs-eyebrow` | 10.5px | `.panel__eyebrow`（uppercase / .16em / 680）、`.mini-label`（uppercase / .14em / 640） |

**阶梯之外的 3 个字号（当前实现里的既有偏差，改版时优先收编）**：
`.readout__label` 9.5px（uppercase / .18em / 640）、`.dropzone kbd` 10px、`.toast__close` 15px。

### 3.3 字重、行高、字距

- **字重只用 9 档**：520（chip/未选中项）、540（按钮默认）、560（次级标题/数值）、580（`chip__main`）、620（`dropzone__title`、Toast 标题、跳过链接）、640（`mini-label`、品牌）、660（主按钮、`veil__title`）、680（`panel__eyebrow`、`stage-empty__title`）、700（`brand__en`）。中文不额外加粗（系统字体合成加粗会糊）。
- **行高**：`body` 1.6；紧凑标题 1.2；读数数值 1.15；多行说明 1.5–1.7。
- **字距**：大写小字加宽（`.16em` / `.14em` / `.18em` / `.08em`），大号标题收紧（`-.024em` / `-.02em` / `-.012em`），等宽数据 `+.01em`，拖动提示的 `⋮⋮` 用 `-2px` 压缩成握把形状。
- 全大写只用于 `.panel__eyebrow` / `.mini-label` / `.readout__label` / `.brand__en`：它们标出"这一段在问什么"，是结构性装置，不是装饰。

---

## 4. Space / Radius / Shadow — 空间系统

### 4.1 间距（4px 基数，`--s-1…--s-12`）

```
--s-1 2px   --s-2 4px   --s-3 6px   --s-4 8px
--s-5 12px  --s-6 16px  --s-7 20px  --s-8 24px
--s-9 32px  --s-10 40px --s-11 56px --s-12 72px
```

真实映射（照抄这套节奏，不要引入 13/18/22px 这类值）：

| 场景 | 值 |
|---|---|
| 栏与栏之间 | `--s-6` 16px（`.workspace` gap） |
| 同一栏内面板之间 | `--s-6` 16px（`.rail` / `.inspector` gap） |
| 面板内边距 | `--s-7` 20px（`.panel__body`），面板头 `--s-4`/`--s-7` |
| 面板内元素间距 | `--s-5` 12px；舞台面板 `--s-6` 16px |
| 表单行间距 | `--s-5` 12px；标签到控件 `--s-3` 6px |
| chip 之间 | `--s-3` 6px；预设卡之间 `--s-2` 4px |
| 页面内边距 | 上 `--s-6` / 左右 `--s-8` / 下 `--s-9`（≤1279 起四周 16px，≤768 起 12px） |
| 空态大留白 | `.stage-empty` padding `--s-11`/`--s-7`，`.veil__inner` `--s-11`/`--s-12` |

### 4.2 圆角（刻意收紧——仪器感来自小圆角）

| 令牌 | 值 | 用在 | 内嵌圆角 = 外圆角 − 1 |
|---|---|---|---|
| `--r-xs` | 4px | 输入框、chip、小按钮、`preset__apply`、`segmented` 容器、Toast 关闭钮、跳过链接、焦点环 | `segmented__btn`、`focus-grid__cell`、`br--*`、`kbd` 用 3px；`input--color` 色块用 2px |
| `--r-sm` | 8px | 面板、步骤条、读数条、舞台框、焦点区 | — |
| `--r-md` | 14px | 空态投放区、`.dropzone`、`.veil__inner`、Toast | — |
| `--r-full` | 999px | 隐私徽标、状态徽标、扫描条、滑块轨道与滑块 | — |

规则：**外层 4px → 内嵌 3px** 是本设计固定的"同心圆角"关系，不要再引入第二个数值。

### 4.3 阴影（只表达空间关系）

```
--sh-1      0 1px 2px rgba(0,0,0,.5)             贴在底上的面板
--sh-2      0 10px 28px -10px rgba(0,0,0,.72)    浮起层：Toast
--sh-inset  inset 0 1px 0 rgba(255,255,255,.04)  面板顶缘 1px 高光（与 sh-1 叠加使用）
```
主按钮另有专用投影 `0 6px 18px -8px var(--ember-a40)`；焦点环用 `0 0 0 3px var(--ember-a24)`；
裁剪框框外压暗用 `box-shadow: 0 0 0 9999px rgba(10,12,15,.62)`（超大扩散做遮罩，不改 DOM 层级）。

### 4.4 关键尺寸常量（组件几何，非间距）

| 元素 | 尺寸 |
|---|---|
| 主按钮 / 次按钮 / 幽灵按钮 / `btn--sm` | 46 / 34 / 30 / 32 px 高 |
| 输入框 | 36px 高；`input--num` 78px 宽；`ratio-custom input` 68px；`input--color` 46×36 |
| 色板 `.swatch` | 24×24 |
| 滑块 `.range` | 轨道 4px；拇指 16px（Firefox 14px） |
| 焦点九宫格 | 3×26px 格 + 3px 缝隙 |
| 裁剪角标 `.br` | 22px → hover 34px → 拖动 40px |
| 裁剪框角标 `.crop-tick` | 15px，线宽 3px |
| 扫描条 `.scanner` | 168×3px，光带占 42% |
| Toast | 宽 `min(380px, 100vw − 32px)` |
| 面板头 | 高 49px（`--s-4` 上下 padding + 内容） |
| 舞台框 | `max-width: calc(56vh × --stage-ar)`，`aspect-ratio: var(--stage-ar, 1.7778)` |

---

## 5. Motion — 动效系统

```css
--t-fast: 120ms;  /* 颜色 / 描边 / 图标 / 角标尺寸 */
--t-base: 200ms;  /* 位移 / 缩放 / 展开 / 遮罩淡入 */
--t-slow: 340ms;  /* 成片入场 */
--ease:      cubic-bezier(.22, .61, .36, 1);  /* 标准：进出都平滑，用于绝大多数过渡 */
--ease-emph: cubic-bezier(.16, .84, .30, 1);  /* 强调：起步快、收尾长，只用于"新的东西诞生"（成片入场、Toast 入场、遮罩内部缩放） */
```

**缓动选择原则**：状态色变化一律 `--ease`；"新对象出现"一律 `--ease-emph`；`--ease-emph` 不要用在
hover 之类高频交互上（起手过快会显得毛躁）。

### 5.1 七个 keyframes（全部有语义，没有一个是为了"活泼"）

| 名称 | 定义 | 时长/缓动 | 语义 / 用在哪 |
|---|---|---|---|
| `breathe` | opacity .38 → .68 → .38 | 4.2s `--ease` infinite | 空态四角图标"待机呼吸"：这里还没有素材，但工具在待命 |
| `stageIn` | opacity 0→1，scale .985→1 | 340ms `--ease-emph` both | 成片入场：新图或新比例生效后，"新的成片诞生了"被感知到 |
| `fadeIn` | opacity 0→1 | 200ms `--ease` both | 处理遮罩出现 |
| `scan` | translateX −110% → 340% | 1.6s `--ease` infinite | 正在计算的唯一循环动画（舞台扫描条 + 读数条底部 2px 进度条共用） |
| `toastIn` | opacity 0→1，translateY(10px)→0，scale .98→1 | 200ms `--ease-emph` both | Toast 入场 |
| `toastOut` | opacity→0，translateY(6px)，scale .98 | 200ms `--ease` both（`.is-leaving` 触发） | Toast 退场（JS 在 240ms 后移除节点） |
| `veilPulse` | box-shadow 0 → 12px `rgba(255,122,51,.07)` | 1.8s `--ease` infinite | 全屏拖拽遮罩的"可以松手了"呼吸提示 |

### 5.2 过渡白名单

只过渡 `background-color` / `border-color` / `color` / `box-shadow` / `opacity` / `transform` / `visibility` / `top`。
**不动** `width / height / left / top` 做布局动画（唯二例外：裁剪角标 `.br` 的宽高呼吸、
`.readout__progress i` 的宽度，二者都不参与文档流）；也不做 `layout` 触发的过渡。

### 5.3 `prefers-reduced-motion` 降级（实测行为）

```css
*, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important;
                         transition-duration: .01ms !important; scroll-behavior: auto !important; }
.stage__frame { animation: none; }              /* 取消入场缩放，避免"闪一下" */
.stage-empty__ring { animation: none; opacity: .55; }   /* 呼吸改为静态 */
.scanner i, .readout__progress i { animation: none; width: 100%; opacity: .5; }  /* 循环光带改为静态条 */
.veil.is-on .veil__inner { animation: none; }    /* 遮罩不脉冲 */
```
实测（`reducedMotion: 'reduce'`）：`animation-name: none`、剩余动画时长 `1e-05s`、空态图标 opacity `0.55`。
另外 `app.js` 的 `reducedMotion()` 还会把"点击步骤条跳转"的 `behavior: smooth` 降为 `auto`。
**信息从不只靠动效传达**：处理中同时有文字（"处理中"徽标 + `busy-text`）、静态条与数字变化。

---

## 6. 全局基础层（`styles.css` §2）

| 规则 | 作用 / 注意 |
|---|---|
| `*, *::before, *::after { box-sizing: border-box }` | 所有尺寸按 border-box 计算（改尺寸时不必再减 padding） |
| `[hidden] { display: none !important }` | **必须排在任何组件规则之前**。本文件组件大量使用 `display:flex/grid`，特异性高于 UA 的 `[hidden]{display:none}`，会把 hidden 元素重新显示出来。整站靠这一条兜住 |
| `body` | `margin:0` / `min-height:100vh` / `--obsidian` 底 / `--text` 文字 / 14px / 1.6 / 抗锯齿 |
| `.mono` | 等宽 + `tabular-nums` + `.01em`，所有数值都要套 |
| `.visually-hidden` | 1px 剪切盒，用于 `<input type="file">` 与屏幕阅读器专用文字 |
| `.skip-link` | 默认 `top:-60px`，`:focus` 时落到 `top:8px`；Ember 底 + obsidian 文字（7.54:1） |
| `:focus-visible` | 统一焦点环：`2px solid var(--ember)` + `outline-offset: 2px` + `border-radius: 4px`；同时 `:focus:not(:focus-visible){outline:none}` 保证鼠标点击不出环 |
| `::selection` | `--ember-a40` 底 + 白字 |

---

## 7. 字号/字重速查（给实现者）

```
标题显字    30/680/-.024em      (.stage-empty__title)
遮罩标题    30/660/-.02em       (.veil__title)
读数数值    22/560/1.15 mono    (.readout__value)
品牌        17/700/uppercase    (.brand__en)
主按钮      14.5/660            (.btn--primary)
区块标签    10.5/680/.16em 大写 (.panel__eyebrow)
次级标签    10.5/640/.14em 大写 (.mini-label)
正文/控件   14/540              (.btn, body)
小字        12.5/520–560        (.chip, .kv, .toast)
微字        11/520              (.chip__meta, .preset__ratio, .field__hint)
读数标签    9.5/640/.18em 大写  (.readout__label)
```

---

## 8. 组件总览（类名 → 所属分区）

| 分区 | 组件 | 分组见 §9 |
|---|---|---|
| §3 | `.topbar` `.brandmark` `.brand` `.brand__en/__zh/__tag` `.privacy-badge` | 外壳与导航 |
| §4 | `.btn` + `--primary/--secondary/--ghost/--sm/--block` | 操作 |
| §5 | `.workspace` `.rail` `.inspector` `.stage-col` | 布局 |
| §6 | `.steps` `.steps__list/__item/__no/__label` | 外壳与导航 |
| §7 | `.panel` + `--stage/--link/--summary` `.panel__head/__head--row/__head-tools/__eyebrow/__body/__lead` `.mini-label` | 容器 |
| §8 | `.dropzone` `.dropzone__icon/__title/__sub` `kbd` | 输入 |
| §9 | `.kv` `.kv__row` `--stack` `--compact` `.kv__file` | 数据 |
| §10 | `.flag` + `--amber/--azure/--neutral` `.flag__action` | 反馈 |
| §11 | `.stage-empty` `.stage` `.stage__frame/__thirds/__brackets/__busy/__hint/__hint-grip` `.br--*` `.stage__crop` `.crop-tick--*` `.stage__crop-tag` `.scanner` | 舞台 |
| §12 | `.readout` `.readout__item(--wide)/__label/__value(--sm)/__separator/__progress` `.status-pill` | 数据 |
| §13 | `.focus-block` `.focus-grid` `.focus-grid__cell` | 输入 |
| §14 | `.stage-actions` `.stage-actions__note` | 操作 |
| §15 | `.chips` `--stack/--tight` `.chip` `--xs/--wide` `.chip__main/__meta` | 选择 |
| §16 | `.presets` `.preset-group` `.preset` `.preset__body/__name/__ratio/__apply` | 选择 |
| §17 | `.field` `--spaced/--inline` `.field__head/__row/__value/__hint/__msg` `.input` `--num/--color` `.ratio-custom` `.range` `.swatches` `.swatch` | 输入 |
| §18 | `.segmented` `.segmented__btn` `--sm` | 选择 |
| §19 | `.summary` `.summary__row` `--verdict` `.summary__foot` `.verdict` `--ok/--warn/--idle` | 数据 |
| §20 | `.toasts` `.toast` `[data-kind]` `.toast__body/__title/__msg/__close` | 反馈 |
| §21 | `.veil` `.veil__inner/__title/__sub` | 反馈 |

---

## 9. 组件规范（用途 / 结构 / 状态）

### 9.1 外壳与导航

**`.topbar`** — 顶栏，`sticky; top:0; z-index:30`，高 55px（`--s-5` 上下 padding + 30px 控件高 + 1px 下边线）。
底为 `linear-gradient(180deg, var(--graphite), var(--obsidian))`：给顶栏一点"顶光"，其余一切都不给渐变。
结构：`.topbar__brand`（`.brandmark` 26px Ember 图标 + `h1.brand`（`.brand__en` + `.brand__zh`）+ `.brand__tag` 标语）
与 `.topbar__actions`（`.privacy-badge` + `#btn-reset-all` 幽灵按钮）。
状态：`aria-hidden="true"` 只加在图标上；标语在 ≤900px 隐藏（`.brand__tag{display:none}`）。

**`.privacy-badge`** — "本地处理 · 不联网"胶囊。`--slate` 底 + `--hairline` 边 + `--r-full` + 11px `--text-lo`；
盾牌图标 `--jade`（8.22:1）。用途：把"零上传"这件事实时可见，而不是藏在文档里。

**`.steps`** — 步骤条（01–06）。`li` 结构：`.steps__no`（mono 11px，opacity .8）+ `.steps__label`（12.5/520）。
状态：`is-done`（编号转 `--jade`）、`is-current`（左侧 2px Ember 边 + `--slate` 底 + `--text-hi` 文字 + 编号 Ember）。
交互：`cursor:pointer`，点击滚动到对应面板（`app.js` 的 `stepTarget` 映射）；点击"05 取景"会顺带把预览切到原图取景视图。
**已知缺口：`li` 不可 Tab 聚焦**（无 `tabindex`/`role`），键盘用户只能靠滚动到达同目标，见 §12。

### 9.2 容器

**`.panel`** — 所有区域的统一容器：`--graphite` 底 + 1px `--hairline` + `--r-sm` + `--sh-1, --sh-inset` + `overflow:hidden`。
变体：`--stage` / `--link`（同 graphite，语义标记）、`--summary`（`--hairline-hi` 边 + `--slate` 底，**视觉上抬升一层**，
因为它是"导出前信息"的汇总卡）。
**`.panel__head`** — 高 49px，`--s-4`/`--s-7` padding，`border-bottom`，底 `rgba(255,255,255,.015)`（极轻的提亮）；
`--row` 允许换行（舞台面板头用它放 4 个控件）；`.panel__head-tools` 是右侧工具组（`gap: var(--s-2)`）。
**`.panel__eyebrow`** — 10.5/680/.16em 大写 `--text-lo`，是每个面板的"编号 + 名字"。
**`.panel__body`** — `--s-7` padding，列向 `gap: var(--s-5)`；`--stage` 变体 gap 16px。
**`.mini-label`** — 组内小标题（10.5/640/.14em 大写）；`--spaced` 额外 `margin-top: 6px`，用于"上一组控件"与下一组的呼吸。

### 9.3 输入类

**`.dropzone`** — 投放区。列向居中，padding `--s-8`/`--s-5`，1px 虚线 `--hairline-hi`，`--r-md`，
底为 `radial-gradient(120% 100% at 50% 0%, rgba(255,122,51,.05), transparent 70%), var(--slate)`（顶部暖光）。
状态：hover → 描边转 `--ember-a40` + `translateY(-1px)`；`:focus-visible` → 全站焦点环；
`role="button" tabindex="0"`，Enter/Space 打开文件选择器。内含 `.dropzone__icon`（Ember .85）、
`.dropzone__title`（14.5/620 `--text-hi`）、`.dropzone__sub`（11px `--text-lo`，含两枚 `kbd`）。
`kbd`：mono 10px、`--graphite` 底、1px `--hairline-hi`、3px 圆角——只用于"⌘ V"。

**`.field`** — 表单行容器（列向 gap 6px）。`--spaced` 加 `border-top: 1px --hairline` + `padding-top: 12px`
（同一面板内区分"预设区 / 自定义区"）；`--inline`（`.ratio-custom` 内）改为横向。
子件：`__head`（标签 + 右侧当前值，`justify-content: space-between`）、`__row`（横向控件行，可换行）、
`__value`（`--text-hi` 的当前值，如"自动"）、`__hint`（11px `--text-lo`）、`__msg`（12.5px `--coral` 行内错误，`role="alert"`）。

**`.input`** — 36px 高、`--slate` 底、1px `--hairline-hi`、`--r-xs`、`--text-hi` 文字。
状态：hover → 描边 `--text-lo`；focus → **去掉 outline**，描边转 `--ember` + 外环 `0 0 0 3px var(--ember-a24)`；
`[aria-invalid="true"]` → 描边 `--coral`，focus 时外环转 `rgba(255,106,94,.22)`。
变体：`--num`（78px 宽、mono、居中）、`--color`（46×36、3px 内边距、色块 2px 圆角）。

**`.range`** — 原生 range 重绘：轨道 4px `--slate-hi`；拇指 16px `--ember` + 2px `--obsidian` 边 + `0 0 0 1px --ember-a40` 外环；
hover 放大到 1.12。用途：手动覆盖 JPG 质量（0 = 自动）。

**`.swatches` / `.swatch`** — 背景色快捷色板。24×24、`--r-xs`、底色由内联 `--sw` 提供（`style="--sw:#ffffff"`）。
状态：hover → 上浮 1px + 描边 Ember；`is-active` → 描边 Ember + `0 0 0 2px --ember-a24`。

**`.ratio-custom`** — 自定义比例行：两个 `input--num`（68px）+ `:` 分隔（mono `--text-lo`）+ "套用"次按钮；
下方是 `#ratio-error`（`role="alert"`）与 hint。Enter 直接套用。

**`.focus-block` / `.focus-grid`** — **取景焦点的键盘等价物**：拖动是鼠标路径，九宫格是键盘路径。
`focus-block` 为横向 `space-between` 卡片（`--slate` 底），左侧 `mini-label` + `focus-block__readout`（mono "居中 · 50% / 50%"），
右侧 3×26px 网格。单元格：`--slate` 底 + 1px `--hairline`；hover → `--slate-hi`；`is-active` → Ember 实底。
**已知缺口**：单元格边界仅 1.30:1，静态下几乎只能看见"选中的那一格"（§12）。

### 9.4 选择类

**`.chip`** — 最小选择单元（等宽标签 / 数值）。`--slate` 底 + 1px `--hairline` + `--r-xs` + 12.5/520。
hover → `--slate-hi` 底 + `--hairline-hi` 边 + `--text-hi` 字；`:active` → 下沉 1px；
`is-active` → `--ember-a12` 底 + `--ember-a40` 边 + `--text-hi` 字 + `inset 2px 0 0 var(--ember)` 左竖条（2px）。
变体：`--xs`（mono 11px，用于长边预设 1920/1280/1080/800）、`--wide`（整宽、列向、`__main` 12.5/580 + `__meta` 11px mono）。
搭配容器：`.chips`（wrap，gap 6px）、`--stack`（列向，用于"输出尺寸策略"三选一）、`--tight`（gap 4px，塞进一行）。
**无障碍**：一律 `<button aria-pressed>`，Tab 可达、Enter/Space 可切换。

**`.preset`** — 平台预设卡。`--slate` 底 + `--r-xs`，左侧预留 2px 竖条（`inset 2px 0 0 transparent`）。
结构：`.preset__body`（`.preset__name` 12.5/560 `--text-hi` + `.preset__ratio` 11px mono `--text-lo`）
+ `.preset__apply`（"套用"小按钮，mono 11px）。
**两种意图分开**：点卡片=只设比例；点"套用"=比例 + 平台推荐像素，避免"点一下不知道会发生什么"。
分组：`.preset-group` + `.preset-group__name`（11px `--text-lo`，如"视频横版"）。

**`.segmented`** — 分段选择器（2–3 个互斥项）。容器 `--slate` 底 + 1px `--hairline-hi` + 2px padding + 2px gap；
按钮 3px 圆角、透明底、`--text-lo`；hover → `--text-hi`；`is-active` → **Ember 实底 + `#140803` 文字**（7.58:1）。
`--sm` 变体用于空间紧张处（目标大小单位 KB/MB、预览视图切换"成片 / 原图取景"）。
**一个容器只放同类选项**；"格式 JPG/PNG"与"目标单位 KB/MB"是两个独立容器。

### 9.5 数据展示

**`.readout`** — 舞台下方的读数条（本产品的签名装置之一）。`--slate` 底 + `--r-sm` + `--s-5`/`--s-6` padding，
横向 wrap，项之间用 `.readout__separator`（1px `--hairline`，竖向拉伸）分隔。
每一项：`.readout__label`（9.5/640/.18em 大写 `--text-lo`）+ `.readout__value`（22px mono `--text-hi`，tabular-nums）。
固定顺序与含义：**输出尺寸 → 比例 → 预估体积 → 目标 → 状态徽标**；`--wide` 给第一项（吃满剩余宽度），
`--status` 用 `margin-left:auto` 推到最右。`.readout__progress` 是 2px 底部进度条（处理中显示，`scan` 动画）。
**含一个隐藏规则**：无素材时显示"—"，但结构与位置不变（用户的位置记忆不被破坏）。

**`.status-pill`** — 状态徽标。`--r-full` + 1px `currentColor` 边 + 前置 6px 圆点（`::before`，同为 `currentColor`）。
五态由 `data-state` 决定：**`idle` `--text-lo` / `busy` `--ember` / `ok` `--jade` / `warn` `--amber` / `error` `--coral`**。
文案与状态的对应见 §12。`error` 目前仅保留样式（`app.js` 的 `paintStatus()` 尚未使用），供后续错误态复用。

**`.kv`** — 原图信息表（`dl`）。行：`flex; justify-content: space-between`，`dt` 12.5 `--text-lo`、`dd` 12.5 mono `--text-hi` 右对齐，
行间 1px `--hairline`，末行去线。变体：`--stack`（标签在上、值在下，用于长文件名）、`--compact`（行 padding 6→4px，用于更窄的取景信息）、
`.kv__file`（mono 11px + `word-break: break-all`，长文件名不撑破 264px 左栏）。

**`.summary`** — 导出前信息表（结构与 `.kv` 同源，但语义独立）。`__row--verdict` 用 `border-top: 1px --hairline-hi` 与
`padding-top` 把它从"参数"里分出来；`__foot` 是诚实脚注（11px `--text-lo`，`border-top`，如"预测文件大小是即将下载文件本身的字节数，不是估算"）。
**`.verdict`** — 结论徽标：`--ok`（jade）/ `--warn`（amber）/ `--idle`（text-lo），12.5/560，前置 ✅/⚠ 字符。

**`.flag`** — 行内提示条。`border-left: 2px solid currentColor` + 8%/9% 同色底 + 12.5px 正文。
三种语义：`--amber`（画质/放大风险）、`--azure`（中性说明，如"PNG 无损、无法用质量参数控制体积"）、
`--neutral`（`--slate` 底的普通说明）。`__action` 让提示里能放一个次按钮（如"改为 JPG 以达到目标大小"）。
**规则**：`flag` 只解释"为什么"和"代价"，不重复读数条里的数字。

### 9.6 舞台（签名元素）

**`.stage-empty`** — 空态：`min-height: 380px`（≤768 为 260px），1px 虚线 `--hairline`，`--r-md`，
radial 暖光暗角；`.stage-empty__ring`（64px Ember 图标 + `breathe`）、`__title`（30/680）、`__sub`（12.5 `--text-lo`，`max-width: 42ch`
—— **42ch 是刻意的行宽上限**，让说明句保持一行可读）。

**`.stage` / `.stage__frame`** — 成片舞台。`__frame` 的 `aspect-ratio: var(--stage-ar)` 由 JS 内联写入：
- **成片视图**：`--stage-ar = 输出宽/高`（所见即成片，不存在"框和结果不一致"）
- **原图取景视图**：`--stage-ar = 原图宽/高`（看得见被裁掉的部分）

`max-width: calc(56vh × --stage-ar)` 把画面钉在视口高度内，避免大屏上图片无限膨胀。
底 `#000`、1px `--hairline-hi` 边、`--r-sm`、`cursor: grab`（拖动时 `:active` → `grabbing`）、`touch-action: none`、
入场 `stageIn`。无余量可拖时 JS 加 `is-locked`（光标回到 default）。

**`.stage__thirds`** — 三分线（4 个 1px span，`rgba(255,255,255,.16)`），可开关（`#btn-toggle-grid`，`aria-pressed`）。
在原图取景视图下，三分线被 JS 用内联 `inset/width/height` **约束到裁剪框内部**
（只有落在裁剪框里的三分线才对构图有意义）。
**已知缺口**：`.16` 的白色实线在浅色照片上几乎不可见（§12）。

**`.stage__brackets` / `.br--*`** — 成片视图的裁剪角标：四角 22px Ember L 形（2px 线宽、3px 内圆角，距边 8px）。
hover 长到 34px、拖动时长到 40px —— **用尺寸变化表达"这是可拖的"**，比加提示文字更省空间。
原图取景视图下整体隐藏（`.is-source-view .stage__brackets{display:none}`），改由裁剪框自身表达。

**`.stage__crop` / `.crop-tick` / `.stage__crop-tag`** — 原图取景视图的裁剪框：
1px Ember 边框 + 四角 15px/3px 实心角标 + `box-shadow: 0 0 0 9999px rgba(10,12,15,.62)` 把框外压暗 62%
（"框外压暗"而不是"框内高亮"：被裁掉的内容仍然看得见，只是退到后面）。
`.stage__crop-tag` 是框内左上角的 mono 徽标（如 `1080 × 1080`，`rgba(10,12,15,.8)` 底 + `--ember-a40` 边 + Ember 文字）。
**永远不要给裁剪框加 pointer 事件**（`pointer-events: none`），拖动由 `.stage__frame` 统一接管。

**`.stage__busy` / `.scanner`** — 处理中遮罩：`inset:0` + `rgba(10,12,15,.74)` + `backdrop-filter: blur(2px)` + `fadeIn`。
内部：168×3px 轨道 + 42% 宽的 Ember 光带做 `scan` 往复 + 一行阶段文案（`busy-text`，如"正在搜索质量…"）。
**遮罩盖住的是画面，不是整个界面**：用户仍能修改参数。

**`.stage__hint`** — 框下提示（11px `--text-lo`，`.stage__hint-grip` 的 `⋮⋮` 用 Ember + `letter-spacing:-2px` 捏成握把）。
文案随视图切换：成片视图"在框内拖动可调整取景焦点" / 原图取景"拖动裁剪框，决定保留原图的哪一块"。
**没有可拖余量时整体 `hidden`**（JS 控制），避免提示一个做不到的操作。

**`.stage-actions`** — 主操作区：全宽 Ember 主按钮（`#btn-download`，46px，文案带格式与像素："下载 JPG · 1920 × 1080"）
+ 12.5px 居中脚注（`#download-note`，如"JPG · 186.6 KB · 未限制体积"）。**一屏只有这一个实心彩色按钮。**

### 9.7 反馈类

**`.toasts` / `.toast`** — 右下角堆叠容器（`position: fixed; right/bottom: var(--s-7)`，`z-index: 60`，`pointer-events: none`；
每个 toast 自己 `pointer-events: auto`）。容器 `role="status" aria-live="polite" aria-atomic="false"`。
Toast：`--slate` 底 + 1px `--hairline-hi` + **左侧 3px 语义色竖条** + `--r-md` + `--sh-2` + `toastIn`。
`data-kind` 决定竖条色：`success` → jade、`error` → coral、`warn` → amber、**无 kind（info）→ azure（默认）**。
结构：`__title`（12.5/620 `--text-hi`）+ `__msg`（12.5 `--text`，内嵌 `.mono` 数值会转 `--text-hi`）+ `__close`（22×22）。
生命周期（`app.js` `TOAST_LIFE`）：success/info 5200ms、warn 8000ms、error 9000ms；退场加 `.is-leaving`，240ms 后移除节点。
**已知问题**：容器宽 380px、正好压住 376px 的右栏，最多 4 条时高约 300px（§12）。

**`.veil`** — 全屏拖拽遮罩（`z-index: 80`，盖过 Toast）。`rgba(10,12,15,.82)` + `blur(6px)` + 200ms 淡入；
内部 `.veil__inner`：2px Ember 虚线框 + `rgba(255,122,51,.05)` 底 + `--r-md`，
从 `scale(.96)` 弹到 `1`（`--ease-emph`）并进入 `veilPulse` 呼吸。
文案：`__title`（30/660 "松开即可载入"）+ `__sub`（12.5 mono 列出支持的格式）。
**只在真的拖来文件时出现**（`dataTransfer` 里有 Files），且 `Esc` 或拖离即收起。

### 9.8 按钮（`.btn`）

| 变体 | 形态 | 用途 | 高度 |
|---|---|---|---|
| `--primary` | Ember 实底 + `#140803` 文字 + Ember 描边 + 暖色投影 | 全屏唯一主操作：下载封面 | 46px / 14.5 / 660 |
| `--secondary` | `--slate` 底 + `--hairline-hi` 边 + `--text-hi` 字 | 次级操作：换一张图片、套用、改为 JPG | 34px / 12.5 |
| `--ghost` | 无底无边，hover 才出 `--slate` 底 | 面板头小工具：三分线、重置居中、重置 | 30px / 12.5 |
| `--ghost[aria-pressed="true"]` | `--slate` 底 + `--text-hi` 字 | 开关型幽灵按钮的"开"态 | 同上 |
| `--sm` | 32px / `0 8px` padding / 12.5 | 与输入框同排时的紧凑按钮 | 32px |
| `--block` | `width: 100%` | 主操作、换图按钮 | — |

统一行为：`transition` 只覆盖 background/border/color/transform（`--t-fast`）；hover 上浮 `translateY(-1px)`、
active 回落 `translateY(0)`；`:disabled` → `opacity: .42` + `cursor: not-allowed`（**不变颜色**，避免"禁用态像另一种语义"）；
`:focus-visible` → 全站 Ember 焦点环。

---

## 10. 布局规范

### 10.1 三栏工作台（≥1280px）

```
grid-template-columns: var(--rail-w) minmax(0, 1fr) var(--insp-w);
gap: var(--s-6); padding: var(--s-6) var(--s-8) var(--s-9);
align-items: start; max-width: 2200px; margin: 0 auto;
```

1512×950 实测几何：

| 区域 | 尺寸 | 说明 |
|---|---|---|
| 顶栏 | 1512 × 55 | sticky，`z-index:30` |
| 左栏 `.rail` | 264 宽，`position: sticky; top: calc(55px + var(--s-6))` = 71px | 步骤条 199px + `01 素材` 面板 |
| 中栏 `.stage-col` | 792 宽 | 舞台框 750 × 422（16:9，`56vh` 封顶）→ 读数条 750 × 68.5 → 取景区 750 × 118 → 主按钮 750 × 46 |
| 右栏 `.inspector` | 376 宽，`max-height: calc(100vh − 100px)`（950 视口 = 850），内部滚动 | 02–06 + 导出前信息 |

**sticky 策略**：
- 左栏 sticky（步骤 + 素材信息始终可见，因为它是"我在哪 / 这张图是什么"的答案）。
- 中栏不 sticky（内容比视口短时就该跟着滚）。
- 右栏**不 sticky 到视口，而是自身内部滚动**（`overflow-y: auto`，细滚动条 8px、滑块 `--hairline-hi`）：
  参数多，让"滚动参数"与"滚动页面"分开，避免页面被拉得极长。≤1279 解除（`max-height:none; overflow:visible`）。
- **右栏的可行长度实测（1512×950）**：可视 850px，内容 2440px —— 6 个面板（919 / 213 / 258 / 256 / 243 / 471 px）
  中有约 1600px 在首屏之外，`导出前信息` 面板的 y 在 2040px。**因此"内部滚动"必须始终可达**：
  不要给 `.inspector` 加 `overflow: hidden`，也不要把面板固定成 grid 行高。
- **必须保留 `.rail > *, .inspector > * { flex: 0 0 auto }`**：`.panel` 为了圆角裁切带 `overflow: hidden`，
  而 flex item 的"自动最小尺寸"只在 `overflow: visible` 时生效 —— 少了这条，面板会在 `max-height` 约束下
  被压扁成一条、文字直接溢出面板边框。这是右栏能正确内部滚动的**前提条件**，不要删。
- **陷阱**：sticky 偏移必须 ≤ 元素自然位置，否则未滚动时就被下推。顶栏 55 + 工作区上内边距 16 = **71px** 是唯一正确值（§13 记录了一次修正）。

### 10.2 断点行为（实测）

| 断点 | 触发 | 变化 |
|---|---|---|
| `≤1440px` | 笔记本 | `--rail-w: 240px`、`--insp-w: 344px`（栏宽先收，不动字号） |
| `≥1280px` | 主目标 | 三栏；左栏 sticky；右栏内部滚动；步骤条纵向 |
| `≤1279px` | 小笔记本 / 横屏平板 | 两栏 `minmax(0,1fr) + --insp-w`（344）；**左栏整行移到最上方**（`grid-column: 1/-1`），变成"横向步骤条 + 素材面板"一行；步骤条改为横向（`is-current` 的指示从左边线改为下边线 Ember）；右栏解除内部滚动；`.steps` 用 `align-self: flex-start` 不跟着面板拉伸 |
| `≤900px` | 竖屏平板 | 单栏；`order`：`.rail`(0) → `.stage-col`(2) → `.inspector`(3)；顶栏允许换行并隐藏标语；页面左右 padding 16px |
| `≤768px` | 手机 | `--fs-display: 24px`、`--fs-readout: 18px`；padding/gap 收到 12px；`.rail` 转纵向；步骤条 `flex: 1 1 33%` 三格一行；舞台框 `max-width: 100%`（不再被 56vh 限制）；读数条：分隔线隐藏、状态徽标独占一行；取景区转纵向；Toast 四边 12px 全宽；空态降到 260px 高 |

**响应式不是"缩水"，是按优先级重排**：图像处理的主线是"看图 → 调参 → 下载"。
窄屏保留全部功能与全部读数，只允许换行与堆叠，**不隐藏任何信息**（唯一被隐藏的是顶栏标语与读数条分隔线，
二者都是纯装饰）。已验证 390/700/768/900/1024/1279/1280/1440/1512 全部无横向溢出（`scrollWidth == clientWidth`）。

### 10.3 需求区块 → 布局的映射

需求里的 9 个区块全部存在，但按"看什么 / 调什么"重新归位：

| 需求区块 | 落位 |
|---|---|
| 上传区 + 原图信息区 | 左栏 `01 素材`（`.dropzone` + `.kv` + `.flag` + 换图按钮） |
| 裁剪 / 预览区 | 中央舞台（视觉主角，始终可见） |
| 下载按钮 | 舞台下方 `.stage-actions`（紧跟成片，不在右栏） |
| 比例 / 目标大小 / 输出尺寸 / 取景 / 导出设置 | 右栏 `02`–`06` |
| 导出前信息 | 右栏底部 `.panel--summary` |
| 结果提示区 | 右下 Toast（`aria-live`） |
| 流程指示 | 左栏 01–06 步骤条（编号承载真实顺序，因此是信息不是装饰） |

---

## 11. Accessibility — 无障碍规范

### 11.1 已实现（可验证）

- **语义结构**：`header` / `main` / `aside[aria-label]` / `section[aria-labelledby]` / `nav[aria-label]`；
  面板标题是真实 `h2`，组内小标题是真实 `h3`；`ol/ul` 承载列表。
- **焦点可见**：`:focus-visible` 统一 2px Ember 环 + `2px` offset（对 obsidian 7.54:1、对 slate 6.38:1）；
  `:focus:not(:focus-visible)` 清除鼠标环；输入框自绘 3px `--ember-a24` 外环（因为 `outline` 与描边叠加会很脏）。
- **跳过链接**：`.skip-link` → `#panel-ratio`，默认移出视口，聚焦时落到左上角（Ember 底 7.54:1）。
- **键盘完整可达**：Tab 顺序 = 视觉顺序；`Enter`/`Space` 激活 chip、预设卡、投放区、分段按钮；
  `Enter` 在自定义比例/目标大小/长边输入框里直接套用；`Esc` 收起拖拽遮罩并取消拖动；
  **拖动取景完全有键盘等价物**（九宫格 9 个按钮，标注"左上/上中/…/右下"）。
- **状态播报**：Toast 容器 `role="status" aria-live="polite" aria-atomic="false"`；
  输入错误用 `role="alert"`（`#ratio-error` / `#size-error` / `#edge-error`）+ `aria-invalid="true"`；
  开关型控件用 `aria-pressed`；单位组/比例组/视图组用 `role="group"` + `aria-label`。
- **不靠颜色单独传意**：状态徽标有点 + 文案（"目标达成"/"未达标"），`flag` 有文案，步骤条有编号 + 文案。
- **对比度**：见 §2.2 —— 正文全部 ≥ 4.5:1，主要文字 ≥ 7:1（修正后）。
- **动效可关闭**：见 §5.3。
- **单位与数值**：数值带单位（`1920 × 1080 px`、`170.3 KB`、`2.35 : 1`），不出现裸数字。
- **触控**：拖动用 pointer events + `touch-action: none`；`input`/`button` 命中区 ≥ 30px 高（移动端按钮 32–46px）。

### 11.2 已知缺口（改版时应处理，见 §12 编号）

1. **非文字边界对比度（已修）**：输入框 / 焦点九宫格 / 分段控件的边框原先只有 1.18–1.46:1，
   而它们的填充与面板底几乎无差（约 1.10:1），边框就是唯一的可辨识边界 —— 低于 WCAG 1.4.11 的 3:1。
   已统一改用 `--text-lo`（对 `--slate` = 4.54:1）。仍低于 3:1 的只剩纯装饰性描边
   （预设卡、面板外框、步骤分隔线），它们不是任何控件的唯一边界。
2. **步骤条不可键盘聚焦**：`.steps__item` 是 `li` + click 处理器，鼠标可用来跳转，键盘不可。
3. **Toast 遮挡**：右下 380px 覆盖右栏 376px 宽度，堆叠 4 条时高约 300px。
4. **右栏内部滚动没有视觉提示**：1512×950 下 65% 的设置（约 1600px）在首屏之外，底边把文案切在半句上
   （"…需要保留的"），而滚动条仅 8px 且低对比。建议给 `.inspector` 加底部渐隐遮罩或滚动阴影。
5. **三分线在浅色画面上不可见**（白色 16% 单色线）。
6. **PNG 透明棋盘格对比过低（已修）**：原先 `#232931` / `#1a1f26` 仅 1.13:1，看起来像一块纯灰，
   无法分辨"透明"与"灰色填充"。已改为 `#363F4C` / `#0F1216`（1.68:1）。
7. **移动端信息顺序**：≤900px 时"步骤 → 素材 → 舞台 → 设置"，已载入图片后预览落在首屏之外。
8. **载入后投放区仍占 152px**：与"换一张图片"按钮重复表达同一件事。
9. **右栏面板被压扁（已修）**：`.panel` 的 `overflow: hidden` 会让 flex 子项的自动最小尺寸按 0 计算，
   在 `.inspector` 的 `max-height: calc(100vh - 100px)` 约束下，面板被压缩成只剩标题的细条、
   文字直接溢出边框（最长的真实状态即可复现，1366×768 矮屏尤甚）。已加
   `.rail > *, .inspector > * { flex: 0 0 auto }` 锁住自然高度，溢出改由 `.inspector` 自身滚动承担。
10. **小图输出比例被 16px 下限抹平（已修，Issue #2）**：`computeGeometry()` 曾对 `outW`/`outH`
    分别 `clamp(·, 16, 12000)`。当源图任一边 < 16px 时（如 4×4 源 + 4:3），输出被压成 16×16、
    比例变成 1:1，与面板显示的用户所选比例不符（真实用户报告）。已改为：短边不足 16 时按
    「裁切区整数倍」整体放大（4×3 → ×6 → 24×18，比例精确 4:3），超过上限时整体等比缩小；
    `scaleCanvas()` 中同类逐边 `Math.max(16, ·)` 一并抽成共用的 `scaleToMinEdge()`。
    **原则：比例正确性优先于 16px 下限。"取整到精确比例" 优于 "凑够 16px"。**
    （残留：极小源的**整数像素裁切**仍会带来量化偏差，如 4×4 源请求 16:9 时裁切区为 4×2、
    输出 32×16（=2:1）；这与 16px 下限无关，任何实现都无法在 4×4 源上得到精确 16:9。）

---

## 12. 交互状态规范

### 12.1 四态在各区域的表达

| 区域 | empty（无素材） | busy（编码中） | error | done（有结果） |
|---|---|---|---|---|
| 左栏 `01 素材` | `.dropzone` 可见，`.kv`/换图按钮 `hidden` | 不变（仍可换图） | 载入失败 → Toast（coral）+ 保留上一张 | `.dropzone` + `.kv`（7 行）+ 换图按钮 |
| 舞台 | `.stage-empty`（呼吸图标 + "还没有素材" + 说明） | `.stage__busy` 遮罩（扫描条 + 阶段文案） | 上一张的成片保留，不被清空 | 成片 / 原图取景视图 + 角标或裁剪框 |
| 读数条 | 4 项 "—" + 徽标 `待载入` | 底部 2px 进度条 + 徽标 `处理中` | — | 真实数值 + `已就绪`/`目标达成`/`未达标` |
| 主按钮 | 禁用（`opacity:.42`），脚注"先载入一张图片" | 仍可点（点击时串行等待，按钮文案不变） | — | 可用，文案含格式与像素 |
| 取景区 | `hidden`（没有可拖的东西） | 不响应拖动 | — | 有可拖余量时显示；无余量时整体 `hidden` 且帧 `is-locked` |
| 右栏设置 | 全部可用（可先设比例再传图） | 可用（改动会取消进行中的任务并重排） | 输入非法 → `role="alert"` 行内错误 + `aria-invalid` | 全部可用 |
| Toast | — | — | error 9s | info 5.2s / success 5.2s / warn 8s |

### 12.2 `.status-pill` 的五态与文案（`app.js` `paintStatus()`）

| `data-state` | 颜色 | 文案 | 触发条件 |
|---|---|---|---|
| `idle` | `--text-lo` | 待载入 | 还没有素材 |
| `idle` | `--text-lo` | 待处理 | 有素材、结果还没算出来（含被取消后的一瞬） |
| `busy` | `--ember` | 处理中 | `busyDepth > 0`（渲染队列非空） |
| `ok` | `--jade` | 已就绪 | 有结果且未设目标体积（最高画质） |
| `ok` | `--jade` | 目标达成 | 结果字节 ≤ 目标 |
| `warn` | `--amber` | 未达标 | 结果字节 > 目标（脚本会同时给出"超出 x"与诚实脚注） |
| `error` | `--coral` | （保留） | 样式已定义，当前逻辑未使用，留给后续错误态 |

### 12.3 结论区（`.verdict`）

| 类 | 文案 | 条件 |
|---|---|---|
| `verdict--idle` | 未设置目标 · 使用最高画质 | 无目标体积 |
| `verdict--ok` | ✅ 达标 · 用掉目标的 xx% | 结果 ≤ 目标 |
| `verdict--warn` | ⚠ 未达标 · 超出 xx | 结果 > 目标 |

### 12.4 状态类清单（`is-*` / `has-*` 约定）

| 类 | 宿主 | 含义 |
|---|---|---|
| `is-active` | chip / preset / segmented__btn / swatch / focus-grid__cell | 选中 |
| `is-current` / `is-done` | steps__item | 流程当前步 / 已完成 |
| `is-locked` | stage__frame | 无裁剪余量（不可拖，光标回 default） |
| `is-dragging` | stage__frame | 正在拖动取景（角标放大到 40px） |
| `is-source-view` | stage__frame | 原图取景视图（隐藏角标，显示裁剪框） |
| `is-on` | veil | 拖拽遮罩可见 |
| `is-leaving` | toast | 正在退场（`toastOut`） |
| `aria-pressed` / `aria-invalid` | 按钮 / 输入框 | 开关态 / 校验失败（**状态优先用 ARIA 表达，`is-*` 只管视觉**） |

---

## 13. 二次开发约定

1. **令牌优先**：颜色 / 间距 / 圆角 / 阴影 / 时长必须引用 `:root` 令牌。当前 CSV/`px` 硬编码仅限
   组件几何（按钮高度、字符尺寸、角标长度等），改动时请顺手判断能否收编为令牌。
2. **不要新增圆角层级**：3px（内嵌）/ 4px / 8px / 14px / 999px 已够用。
3. **不要新增强调色**：需要"注意"用 `--amber`，"成功"用 `--jade`，"信息"用 `--azure`，"错误"用 `--coral`；
   它们是状态色，不做品牌表达。
4. **等宽只给数据**：不要用 mono 排中文句子或按钮文案。
5. **状态优先 ARIA**：`aria-pressed` / `aria-invalid` / `aria-live` / `aria-label` 是给辅助技术的真话；
   `is-*` 只负责外观。新增交互控件时两套都要给。
6. **JS 驱动样式走内联自定义属性**（现有三例：`--stage-ar`、`.swatch` 的 `--sw`、原图取景下 `.stage__thirds` 的 `inset/width/height`），
   不要用 JS 拼 class 名再在 CSS 里写一堆组合选择器。
7. **改 `display` 前先想 `[hidden]`**：任何给元素设 `display:flex/grid` 的规则都会盖掉 `[hidden]`。
   本文件已在重置段放了兜底规则 `[hidden]{display:none !important}`（§2，稳在最高优先级），
   所以**新组件不需要再单独写** `.[你的类][hidden]`。仅当你想让某个元素在被隐藏时走
   `display:contents` 之类的特殊分支，才需要覆盖它。
8. **给 flex 列容器的子项加 `overflow:hidden` 要小心**：CSS 的「自动最小尺寸」只在
   `overflow:visible` 时生效。面板是 `overflow:hidden`（§7，为了圆角裁切），一旦它成为
   `max-height` + `overflow-y:auto` 的 flex 列（如 `.inspector`）的子项，就会被**压扁成条**、
   内容溢出面板边框。已在 §5 用 `.rail > *, .inspector > * { flex: 0 0 auto }` 显式禁止收缩；
   今后若再出现受高度约束的 flex 列，请照做。
9. **文件职责**：`index.html` 只写结构与文案（无内联 style/script）；`styles.css` 只写样式与令牌；
   `app.js` 写逻辑（经典 `<script>` + IIFE —— `file://` 下 ES module 会被 CORS 拦掉）。

---

## 14. 本文档相对 v1.0 的修正（v1.1 变更记录）

v1.0 是设计提案阶段的文档，与最终实现有多处不一致。v1.1 逐项核对代码后修正：

| 项 | v1.0 的说法 | 实现的事实（v1.1） |
|---|---|---|
| 断点 | 1280 / 1024 / 768 / 560 | **1440 / 1279 / 900 / 768** |
| 字重/行高 | 表格里的 440/460/520 等一套统一值 | 实际只有 520/540/560/580/620/640/660/680/700 九档，逐组件不同 |
| Ember 用量 | "一屏出现 ≤ 3 处" | 实为"只用于 当前/焦点/可点击"三类语义，一屏可出现多处但都属这两类 |
| 渐变 | "仅有两处" | 实为三处（顶栏顶光 + 投放区暗角 + 空态暗角） |
| 按钮变体 | 列了 `Danger-quiet` | 不存在；实际是 primary / secondary / ghost / ghost[pressed] / sm / block |
| 选择器 | 提到 `.panel__head--sticky` | 不存在；实际是 `.panel__head--row` |
| Toast | "错误型用 `role="alert" aria-live="assertive"`，6.5s/10s，最多 3 条" | 容器是 `role="status" aria-live="polite"`（无 alert）；生命周期 5.2s/8s/9s（info/success 5.2s）；无条数上限 |
| 浅色主题 | "不做浅色主题" | 一致（`meta[name=color-scheme]=dark`） |
| 组件覆盖 | 8 个组件 | 30+ 个，含 `flag`/`segmented`/`status-pill` 五态/`veil`/`steps`/`focus-grid`/`dropzone`/`kv`/`summary`/`verdict` 等 |
| 新增 | — | 「成片 / 原图取景」双视图 + 裁剪框覆盖层（§9.6） |

### 代码修正台账（共 7 处、均为局部零风险；#1–#4 由设计侧提交，#5–#7 由团队其他协作者同期提交）

| # | 文件 / 位置 | 改什么 | 为什么 | 影响范围 |
|---|---|---|---|---|
| 1 | `styles.css` §15 `.chip__meta` 后 | 新增 `.chip:hover .chip__meta { color: var(--text) }` | hover 底色抬到 `--slate-hi` 后，11px 次级文字只有 4.06:1，低于 AA 4.5:1 | 仅 hover 态的 chip 副标题颜色 |
| 2 | `styles.css` §16 `.preset__ratio` 后 | 新增 `.preset:hover .preset__ratio { color: var(--text) }` | 同上（4.06 → 6.01） | 仅 hover 态的预设卡比例文字 |
| 3 | `styles.css` §5 `.rail` | `top: 76px` → `calc(55px + var(--s-6))`（= 71px） | 76 > 自然位置 71，sticky 在未滚动时就把左栏下推 5px，与舞台/右栏顶边错开 | ≥1280px 左栏 y 位置（71 → 与中/右栏对齐） |
| 4 | `styles.css` §22 `≤1279` 内 `.rail .steps` | 新增 `align-self: flex-start` | `align-items: stretch` 把步骤条拉成与素材面板等高的大空盒（1024–1279 实测约 250px 空白） | 1024–1279px 左栏步骤条高度（446 → 自身高度） |
| 5 | `styles.css` §5 `.inspector` 后 | 新增 `.rail > *, .inspector > * { flex: 0 0 auto }` | **Critical**：`.panel` 是 `overflow:hidden`，自动最小尺寸失效；在 `.inspector`（`max-height` + `overflow-y:auto`）里 6 个面板被压成 200–260px 的条，`03 / 04 / 05` 的文字直接溢出面板边框（实测 `panel-ratio` 917→被压到 211）。禁止收缩后面板按内容撑开，超出交给 `.inspector` 滚动 | 右栏全部面板高度；左栏同步加固 |
| 6 | `index.html` L302「最大可用」副标题 | `不降分辨率` → `不主动降分辨率` | 与行为/文档冲突：设了目标体积且全分辨率达标不了时压缩环节仍会降分辨率（脚注已解释）。`USAGE.zh-CN.md` 用的就是「不主动降分辨率」，UI 对齐文档 | 一处 chip 副标题 |
| 7 | `index.html` L340–343「05 · 取景」正文 | 改为视图中性表述：`「成片」视图拖动图片、「原图取景」视图拖动裁剪框，两者等价` | 双视图上线后旧文案只说「拖动图片」，与原图取景视图里「拖的是裁剪框」的舞台提示自相矛盾 | 一段面板说明文字 |
