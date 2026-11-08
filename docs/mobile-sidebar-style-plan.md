# 手机端侧边栏样式优化计划（安全区 / 信息头 / 上游风格对齐）

> 目标：在**不改变桌面端布局**的前提下，把手机竖屏下的全屏侧板改成更符合触屏习惯的形态：
>
> 1. 顶部不再从 `y=0` 直接摆可点控件，避免被状态栏 / 刘海 / 全面屏手势区遮挡；
> 2. 在标题栏上方增加**一行信息头**，标题栏整体下移一行；
> 3. 视觉尺寸、分隔线、字体层级尽量沿用上游（DSH 官方右栏 / Files 面板）的 token 与几何；所有样式参数收敛到 token，规则中不写裸值；
> 4. 顺带修掉手机端明显不符合触屏习惯的点：触控目标过小、SCM 操作只在 hover 出现、输入框字号、底部安全区等。
>
> 状态：**已实施（P0 + P1 核心，P2 未做；待最终回归）** ｜ 分支：`feat/mobile-sidebar-token-header` ｜ 影响文件：`styles.ts`、`PanelRoot.ts`、`layout/grid.ts`、`locales.ts`、`panel.ts`、`shared/ui.ts`、`explorer/ContextMenu.ts`、`shared/labels.ts`、`layout/MobileHeader.ts` ｜ 不改：手势仲裁、原生右栏桥、宿主 DOM、桌面端布局。
>
> 依据：本仓库源码逐行核对 + 宿主 DSH 0.2.x 打包产物（`@deepseek-ai/dsh-client-ui-layout`、`dsh-client-ui-sidebar-files`、`dsh-client-ui-sidebar-right`、`dsh-client-ui-theme`）+ 同机 `dsh-mobile-layout` 0.4.8 的公开 CSS 契约。文中提到的“上游”均指这些官方实现。

---

## 0. 结论速览

| 问题 | 结论 |
| --- | --- |
| 为什么会“被全面屏遮挡” | 手机全屏侧板在 `grid.ts` 里被写成 `position:fixed; inset:0; z-index:80`，内部第一行 `.sol-exp-activity` 从 `y=0` 开始，没有任何 `safe-area-inset-top` 或宿主安全区变量。状态栏 / 挖孔 / 刘海会直接压在 30px 的图标按钮上。 |
| “标题栏往下放一行”怎么做 | 新增一个**只在手机 sheet 显示**的信息头（`MobileHeader`），放在 `.sol-exp-activity` 之前。信息头 = 顶部安全区 + `var(--sol-exp-info-row-height)`；现有标题栏（`.sol-exp-activity`）因此整体下移一行。桌面端不渲染高度、不改变现有布局。 |
| 第一行放什么信息 | 工作区名（basename，长按/悬停看完整路径）、Git 分支、ahead/behind、变更数、加载状态，以及右侧的关闭按钮。全部来自现有 `state.root` / `state.scm`，不新增后端接口。 |
| 样式如何继承上游 | 采用官方 Files 面板的头部节奏：行高/控件尺寸/分隔线/圆角/字体全部收敛到 `--sol-exp-*` token；颜色、字体、圆角、焦点环只 alias 上游 `--dsw-*`。手机 coarse pointer 只重绑 token（`--sol-exp-row-height` → touch target），规则本身不出现 44px。 |
| 参数如何避免写死 | 新增 §4.7 Token 层：几何值只在 `body` 定义一次；颜色/字体/圆角/焦点环全部 `var(--dsw-*)`；规则只用 `var(--sol-exp-*)` / `var(--dsw-*)`。上游主题 token 挂在 `body`，token 层也必须在 `body`（写在 `:root` 会解析不到主题色，导致背景透明）。 |
| 手机操作习惯还差什么 | 触控目标不一致（活动栏 30px、工具栏 26/36px、SCM 行内按钮 20px、SCM 行约 30px、终端页签 26px）；SCM 的 stage/discard 只在 hover 显示，触屏上根本点不到；搜索框 24px 高、13px 字号；底部没有安全区；键盘弹起时 fixed sheet 不会缩。 |
| 会不会碰坏现有手势 / 工作台 | 不会。本次不新增任何全局触摸监听，不改 `gestures.ts` / `gesture-guard.ts` / `native-rightbar.ts`。信息头只增加一个普通按钮（关闭），复用 `commands.togglePanel`。 |
| 最大风险 | `env(safe-area-inset-*)` 在宿主 WebView 里可能为 0（官方 `index.html` 的 viewport 没有 `viewport-fit=cover`）。因此信息头自身必须有 `--sol-exp-top-clearance-min` + `--sol-exp-info-row-height` 的 token 兜底，不能把“不被遮挡”完全押在 `env()` 上。 |
| 推荐版本 | `1.1.0`（新增手机信息头与多组触屏可访问性调整，属于用户可见的 minor 变更）。 |
| 当前实现 | P0 + P1 核心已落地：token 层、信息头、安全区、标题栏下移、44px 触控、SCM 常显、搜索输入、底部安全区、toast/菜单。P2（键盘 `visualViewport`、底部操作条、token 审计脚本）未做。详见 §10。 |

---

## 1. 背景与边界

### 1.1 用户诉求拆解

| 诉求 | 本文对应设计 |
| --- | --- |
| 考虑手机上操作的习惯 | `--sol-exp-touch-target` 触控目标、拇指可达的关闭/操作、去掉 hover 依赖、底部安全区、输入框防缩放、键盘避让、overscroll 收敛 |
| 调整侧边栏样式 | 只改本插件自己的 `[data-solution-explorer]` 列，不碰宿主侧栏 |
| 样式尽量继承自上游 | 复用 `--dsw-alias-*` / `--dsw-font-*` / `--dsw-radius-*` token；几何向官方 Files 头部靠拢；手机端只做触控密度增量 |
| 标题栏往下放一行 | 新增信息头，现有 `.sol-exp-activity` 从第一行变为第二行 |
| 第一行加信息展示 | 工作区 / 分支 / 同步计数 / 变更数 / 加载状态 / 关闭 |
| 避免全面屏下被遮挡 | `--sol-exp-safe-top`（含 `--sol-exp-top-clearance-min` 兜底）+ `--sol-exp-info-row-height`；底部 `--sol-exp-safe-bottom` |

### 1.2 术语约定

本文把手机全屏侧板里的三行分开命名，避免“标题栏”指代不清：

| 名称 | 选择器 | 现状 | 本次动作 |
| --- | --- | --- | --- |
| **信息头**（新增） | `.sol-exp-mobilehead` | 不存在 | 手机 sheet 第一行；安全区 + 工作区/分支/变更/关闭 |
| **标题栏** | `.sol-exp-activity` | 第一行，36px，图标切换 + 收起按钮 | 下移一行；手机上 `--sol-exp-control-size` 触控；收起按钮移到信息头 |
| **视图头** | `.sol-exp-header` | 第二行，34px，根目录名 + 5 个工具 | 样式对齐上游；手机上隐藏重复的工作区标题，只保留操作 |

> 这样“标题栏往下放一行”就是字面含义：信息头插在 `.sol-exp-activity` 前面，桌面端信息头 `display:none`，所以桌面不受影响。

### 1.3 不做的事（Non-goals）

- 不改宿主的 `viewport` meta、不改官方 `index.html`、不改 DSH Mobile 原生视图。
- 不替代 `dsh-mobile-layout` 的底部导航 / 抽屉 / 工作台；不改它们的 DOM 或变量。
- 不新增全局手势（如下拉关闭、左右滑切换页签）；现有右滑关闭 + 关闭按钮足够。
- 不重做编辑器、终端、文件树交互；只在手机密度下修可点性。
- 不改桌面端的面板宽度、拖拽、折叠 rail、网格轨道。

---

## 2. 现状评估

### 2.1 当前 DOM / 层级

手机打开时，`layout/grid.ts` 把本插件列变成全屏 sheet：

```text
[data-solution-explorer]                 position:fixed; inset:0; width/height:100%; z-index:80
└── .sol-exp-panel                      height:100%; display:flex; flex-direction:column
    ├── .sol-exp-activity               ← 当前第一行（标题栏）36px
    └── .sol-exp-body
        └── .sol-exp-main
            ├── .sol-exp-header         ← 视图头 34px（Tree/Search）
            └── .sol-exp-content        ← 滚动区
```

代码位置：

- 全屏 sheet 的内联样式：[`grid.ts:99-131`](../src/client/layout/grid.ts#L99-L131)，其中 `inset = "0"`、`height = "100%"`、`zIndex = "80"`。
- 面板结构：[`PanelRoot.ts:104-133`](../src/client/PanelRoot.ts#L104-L133)；活动栏：[`PanelRoot.ts:52-77`](../src/client/PanelRoot.ts#L52-L77)。
- 顶部行样式：[`styles.ts:163-171`](../src/client/styles.ts#L163-L171)；视图头：[`styles.ts:6-14`](../src/client/styles.ts#L6-L14)。
- 手机判定：[`form-factor.ts:21-27`](../src/client/touch/form-factor.ts#L21-L27)；手机默认折叠：[`panel.ts:72`](../src/client/panel.ts#L72)。

### 2.2 当前手机端实际尺寸

| 元素 | 当前值 | 手机端影响 |
| --- | --- | --- |
| 全屏 sheet | `inset:0`，无 `padding`，无 `safe-area` | 顶部/底部直接贴物理屏幕边缘 |
| `.sol-exp-activity` | 高 36px；按钮 30×30；水平 padding 4px | 第一行可点图标只有 30px，低于 44/48px 触控建议 |
| `.sol-exp-header` | 高 34px；工具 26×26；`padding:0 8px 0 6px`；`border-radius:12px` | 手机上 5 个 26px 按钮；`@media (pointer:coarse)` 把它们放大到 36px 后，**高于 34px 的行高**，会溢出/挤压 |
| `.sol-exp-search-input` | `line-height:20px; padding:2px 8px`（约 24px 高），13px 字号 | 触控目标太小；部分移动浏览器聚焦时因 <16px 自动放大页面 |
| `.sol-exp-scm-item` | `padding:5px 10px`（约 30px 高） | 变更行太密，容易点错 |
| `.sol-exp-scm-action-btn` | 20×20；父级 `.sol-exp-scm-actions` 默认 `display:none`，仅 `:hover` 显示 | **触屏没有 hover**，单文件的暂存/放弃入口不可达 |
| `.sol-exp-scm-section-header` | `padding:8px 12px`（约 36px），右侧 20px 图标按钮 | 分区折叠/刷新/全部暂存也偏小 |
| `.sol-exp-commit-btn` / `.sol-exp-ai-btn` | 高约 30px | 提交/AI 按钮偏小 |
| `.sol-exp-term-tab` | 高 26px；关闭 16×16 | 终端页签难戳 |
| `.sol-exp-term-resize` | 6px 拖拽带 | 手指很难稳定抓住 |
| `.sol-exp-context-menu-item` | coarse 下已是 44px | 这一条目前是合格的 |
| `.sol-exp-tree-node` | coarse 下 44px | 这一条目前是合格的 |
| `.sol-exp-modal-mask` / toast | 无安全区处理 | 底部弹窗/提示可能与手势条重叠 |

### 2.3 上游基线（官方实现的可复用事实）

从宿主 0.2.x 的打包产物核对到以下稳定值（哈希类名不可依赖，只抄几何与 token 用法）：

| 上游元素 | 关键值 | 对我们的意义 |
| --- | --- | --- |
| Files 视图头（`FilesBody.module.css`） | `height:38px`；`padding:0 6px 0 16px`；`border-bottom:.5px solid var(--dsw-alias-border-l3)`；`gap:4px` | 视图头/信息头的默认节奏 |
| Files 工具按钮（`_4EiRdG_tool`） | `28×28`；`border-radius:var(--dsw-radius-sm)`；图标 `15×15`；`color:var(--dsw-alias-label-secondary)` | 工具按钮尺寸与颜色 |
| 左栏根容器 | `padding:6px 8px`；`background:var(--dsw-specific-sidebar-fill)`；`font-size:14px` | 面板表面与字体 |
| 右栏图标按钮（`acoR2W_iconButton`） | `28×28`；`border-radius:var(--dsw-radius-sm)`；`padding:6px`；`svg 15px` | 右栏工具按钮基准 |
| 官方主题 token | `--dsw-radius-sm:8px`；`--dsw-font-xs-13:13px/20px`；`--dsw-font-xxs-12:12px/18px`；`--dsw-alias-border-l3`；`--dsw-specific-sidebar-fill` | 直接使用，不新增颜色 |
| `dsh-mobile-layout` 手机契约 | `--dshm-safe-top/left/right/bottom`（来自 `env(safe-area-inset-*)`）；`--dshm-header-height:56px`；v2 预设下的 `--dshm-engine-bar:56px`；手机 chrome 按钮 `min-width/min-height:44px` | 手机端增量与宿主保持一致；顶部安全区优先读宿主变量 |

> 结论：上游桌面密度是“38px 行 + 28px 控件 + 0.5px 分隔线”；宿主移动端约定是“44px 可点区域”。我们的方案应同时满足：**桌面抄上游，手机加触控增量**，而不是把桌面也改成 44px。

### 2.4 上游风格差距清单

| 维度 | 当前 | 上游 | 建议 |
| --- | --- | --- | --- |
| 顶栏行高 | 36 / 34px | 38px | 桌面 `var(--sol-exp-row-height)`；手机 touch target |
| 工具按钮 | 30 / 26 / 20px | 28px | 桌面 `var(--sol-exp-control-size)`；手机 touch target |
| 分隔线 | `1px solid border-l1/l2` | `.5px solid border-l3` | 统一用 `var(--sol-exp-border)` |
| 圆角 | 6px / 12px（header 的 12px 还无背景） | `var(--dsw-radius-sm)` = 8px | 用 `var(--sol-exp-radius)`，移除无意义的 12px |
| 字体 | 13px/20px 混用 | `--dsw-font-xs-13` / `--dsw-font-xxs-12` | 用 token；标题 primary、次要信息 tertiary |
| 表面色 | `--dsw-specific-sidebar-fill` | 左栏同 token；右栏 Files 用 `--dsw-alias-bg-base` | **先保留现状**，避免整块换色；只做几何/线条对齐（见 §8 风险） |
| 触控目标 | 30 / 26 / 20 / 36 | 官方桌面 28；宿主手机 44 | coarse 下统一 ≥44（行内小按钮可 40+行高兜底） |

### 2.5 缺口清单（按严重度）

#### P0-1　顶部无安全区，第一行直接压在状态栏/刘海下

`grid.ts` 只设置 `inset:0`，`styles.ts` 没有任何 `env(safe-area-inset-top)` / `--dshm-safe-top`。在全面屏、刘海屏、Android 边到边或 DSH Mobile 全屏时，`.sol-exp-activity` 的 30px 按钮会和系统状态栏/挖孔重叠，既点不准也看不清。

#### P0-2　没有“应用级信息”，标题栏承担了不该承担的职责

当前第一行只有图标，用户不知道当前工作区、分支、有多少变更；这些信息只在进入 SCM 页后才出现。新增信息头后，标题栏可以专心做页签切换，信息头做上下文展示。

#### P0-3　顶部几何与上游漂移

`34px` 行 + `26px` 按钮 + `1px border-l1` + `border-radius:12px` 与上游 Files 头部的 `38px` + `28px` + `.5px border-l3` 不一致。用户明确要求“样式尽量继承自上游”，这一组值应统一。

#### P1-1　触控目标不一致

- `.sol-exp-activity-btn` 30px，没有 coarse 放大；
- `.sol-exp-toolbar-btn` coarse 放大到 36px，但父行只有 34px，视觉上溢出；
- `.sol-exp-hdr-btn` 20px、`.sol-exp-scm-action-btn` 20px、`.sol-exp-term-tab-close` 16px；
- `.sol-exp-scm-item` / `.sol-exp-repo-item` 没有 coarse 行高。

#### P1-2　SCM 操作依赖 hover，触屏不可达

`styles.ts:77-79`：

```css
.sol-exp-scm-actions { display:none; gap:2px; flex-shrink:0; }
.sol-exp-scm-item:hover .sol-exp-scm-actions { display:flex; }
```

触屏点击一行会直接打开 diff，没有机会点“暂存 / 放弃”。这是手机端的功能性缺陷，不只是样式问题。

#### P1-3　搜索框偏小，且可能触发移动浏览器自动缩放

`styles.ts:20` 的输入框约 24px 高、13px 字号。iOS/部分 Android WebView 在聚焦 `<input>` 且字号 <16px 时会放大页面；触控目标也不足。

#### P1-4　底部没有安全区

sheet 的 `padding-bottom` 为 0，终端、SCM 提交按钮、toast、模态框都可能压在 Android 手势条 / iPhone home indicator 上。`shared/ui.ts:22` 的 toast 固定 `bottom:16px`；`.sol-exp-modal-mask` 也没有安全区。

#### P1-5　内容滚动会带动页面 / 下拉刷新

`.sol-exp-content` 等滚动容器没有 `overscroll-behavior: contain`。在列表顶端继续下拉时，移动浏览器可能触发整页下拉刷新；在 sheet 里体感像“面板被弹走”。

#### P2-1　主要操作都在屏幕上半部

新建文件、新建文件夹、刷新、关闭都在顶部；6.7 英寸手机上单手很难够到。P2 可把视图操作移到拇指区的底部操作条，或至少提供长按菜单。

#### P2-2　终端触控不友好

26px 页签、16px 关闭、6px 拖拽带；打开终端后占掉大量高度，且没有底部安全区。属于“侧板内部的手机化”第二优先级。

#### P2-3　键盘弹起时 fixed sheet 不缩

`position:fixed; inset:0` + `height:100%` 不跟随 `visualViewport` 收缩；提交框/输入框聚焦后，键盘可能盖住 sheet 下半部。需要 `visualViewport` 变量或 `100dvh` + 键盘监听。

---

## 3. 设计原则

1. **上游优先（inherit upstream first）**：颜色、字体、圆角、分隔线全部用官方 token；几何优先抄官方 Files/右栏数值。手机端只做“触控密度”增量，不发明新的配色或卡片语言。
2. **手机增量、桌面零变化**：信息头只在 `[data-sol-exp-sheet]` 下显示；桌面端 DOM 可以存在，但 `display:none`，不占高度、不改变宽度/拖拽/rail。
3. **安全区是布局原语**：顶部、底部、左右都从 `env()` 和宿主 `--dshm-*` 变量取值，并给最小兜底；不把“不被遮挡”押在某个变量一定存在上。
4. **一行一个职责**：信息头 = 上下文；标题栏 = 页签；视图头 = 当前视图操作；内容区 = 滚动。避免把工作区名同时塞进三行。
5. **触控目标 token**：所有主要可点目标在 coarse pointer 下 ≥ `--sol-exp-touch-target`；行内小按钮用 `--sol-exp-scm-action-size` + 行高兜底。
6. **不跟手势抢**：不新增 document/window 级触摸监听；关闭复用现有右滑 + 信息头按钮；滚动区加 `overscroll-behavior` 只是容器内收敛，不 `preventDefault`。
7. **状态从现有 store 派生**：信息头只读 `state.root` / `state.scm` / `state.tree.loading` / `state.search.searching`，不新建第二份状态；新增字段只放 `state.layout`（如果确有必要）。
8. **可测试**：纯展示逻辑（工作区名、分支、变更数）抽成纯函数，进 `node --test`；DOM/尺寸用 CDP 断言，不靠肉眼。

---

## 4. 目标形态

### 4.1 线框

**桌面端（不变）**

```text
┌──────────────────────────────────────────────┐
│ [▣] [⌕] [⑂] [>_]                      [◧]  │ var(--sol-exp-row-height)  标题栏
├──────────────────────────────────────────────┤
│ 项目名                         ⌄ ⌃ + 📁 ⟳  │ var(--sol-exp-row-height)  视图头
├──────────────────────────────────────────────┤
│ 文件树 / 搜索 / SCM ...                      │
│                                              │
└──────────────────────────────────────────────┘
```

**手机竖屏 sheet（新）**

```text
┌──────────────────────────────────────────────┐
│  ← 安全区（状态栏 / 刘海 / 挖孔）            │  var(--sol-exp-safe-top)
│  📁 dsh-solution-explorer  ⑂ main ↑2 3  ✕   │  var(--sol-exp-info-row-height)  信息头
├──────────────────────────────────────────────┤
│ [▣] [⌕] [⑂] [>_]                            │  var(--sol-exp-row-height)  标题栏（原第一行下移）
├──────────────────────────────────────────────┤
│                               ⌄ ⌃ + 📁 ⟳   │  var(--sol-exp-row-height)  视图头（隐藏重复标题）
├──────────────────────────────────────────────┤
│ 文件树 / 搜索 / SCM ...                      │
│                                              │
│                                              │
├──────────────────────────────────────────────┤
│  ← 底部安全区（手势条）                      │  var(--sol-exp-safe-bottom)
└──────────────────────────────────────────────┘
```

### 4.2 行规格

| 行 | 选择器 | 桌面高度 | 手机高度 | 内容 | 显示条件 |
| --- | --- | --- | --- | --- | --- |
| 信息头 | `.sol-exp-mobilehead` | — | `var(--sol-exp-safe-top) + var(--sol-exp-info-row-height)` | 工作区 / 分支 / ahead-behind / 变更数 / 关闭 | `[data-sol-exp-sheet]` |
| 标题栏 | `.sol-exp-activity` | `var(--sol-exp-row-height)` | touch target | 文件 / 搜索 / SCM / 终端 / （桌面）收起 | 始终 |
| 视图头 | `.sol-exp-header` | `var(--sol-exp-row-height)` | touch target | 当前视图操作（手机上不显示重复工作区标题） | Tree / Search |
| 内容 | `.sol-exp-content` | flex:1 | flex:1 | 滚动 | 始终 |
| 底部安全区 | `.sol-exp-panel` padding-bottom | 0 | `var(--sol-exp-safe-bottom)` | 空白 | sheet |

> 信息头内容行 = `--sol-exp-info-row-height`，顶部兜底 = `--sol-exp-top-clearance-min`；两者之和用于覆盖常见 Android 状态栏/刘海，也覆盖 DSH Mobile 顶部原生条的最小占位。若 `env()` 有值，总高继续增加，不会重复压住内容。

### 4.3 信息头内容

从左到右：

1. **工作区**：`IconFolderClose` + basename；`title` 放完整路径；空工作区显示 `t('panel.empty')`。
2. **分支**：`IconBranchOutline` + `status.branch`；非 Git 仓库不显示，或显示轻量 `t('header.noGit')`。
3. **同步计数**：`↑ahead ↓behind`，仅当大于 0 时显示；不新增颜色，用 `--dsw-alias-label-tertiary`。
4. **变更数**：`gitChangesCount`，显示为数字 + `t('header.changes')` 的小字；0 时隐藏。
5. **加载/同步状态**：`state.tree.loading`、`state.search.searching`、`state.scm.committing` 时显示一个 `var(--sol-exp-icon-size-sm)` 的轻量指示（可用现有 `sol-exp-ai-spin` 动画或文字省略号），避免信息头看起来“死”。
6. **关闭**：`IconCloseOutline`，`var(--sol-exp-touch-target)` 按钮，`aria-label=t('header.close')`，点击 `actions.togglePanel()`。

信息头本身不滚动；所有文本 `min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap`。工作区名和分支竞争宽度时，工作区优先保留，分支可截断。

### 4.4 安全区公式

完整定义见 §4.7，这里只列语义（所有值都来自 token，不在这里写裸值）：

```css
body {
  /* 顶部：宿主变量 > env > 插件兜底 token */
  --sol-exp-safe-top: max(env(safe-area-inset-top, 0px), var(--dshm-safe-top, 0px), var(--sol-exp-top-clearance-min));
  --sol-exp-safe-right: max(env(safe-area-inset-right, 0px), var(--dshm-safe-right, 0px), 0px);
  --sol-exp-safe-bottom: max(env(safe-area-inset-bottom, 0px), var(--dshm-safe-bottom, 0px), 0px);
  --sol-exp-safe-left: max(env(safe-area-inset-left, 0px), var(--dshm-safe-left, 0px), 0px);
}
```

说明：

- 顶部使用 `--sol-exp-top-clearance-min` 作为最小兜底：即使宿主没有 `viewport-fit=cover`、`env()` 返回 0，信息头仍从该 token 开始，加上 `--sol-exp-info-row-height`，标题栏至少从两者之和开始，不会被状态栏压住。
- 底部不设最小兜底：DSH Mobile 宿主已经把 WebView 底边抬到手势条上方（`--dshm-safe-bottom` 被该插件显式设为 0），再叠加会双份留白。浏览器/其他 WebView 的 `env()` 有值时自然生效。
- 左右用于横屏/挖孔屏；竖屏通常为 0，不影响布局。
- 若设备实测显示顶部仍被 DSH Mobile 的 56px 原生条覆盖，优先在**空会话/引擎条展开**时叠加 `--dshm-engine-bar`，而不是无条件加 56px（见 §8 风险）。

### 4.5 上游风格映射

| 目标元素 | 采用 token | 上游依据 |
| --- | --- | --- |
| 信息头/视图头行高（桌面） | `var(--sol-exp-row-height)`（38px） | Files `_4EiRdG_header` |
| 信息头/视图头内边距 | `var(--sol-exp-space-6)` / `var(--sol-exp-space-16)` | Files `_4EiRdG_header` |
| 工具按钮（桌面） | `var(--sol-exp-control-size)`（28px）+ `var(--sol-exp-radius)` | Files `_4EiRdG_tool` / Rightbar `acoR2W_iconButton` |
| 图标 | `var(--sol-exp-icon-size)`（16px）/ `--sol-exp-icon-size-sm`（14px） | 本仓库 `icons.ts` 已统一 |
| 分隔线 | `var(--sol-exp-border)`（`.5px solid var(--dsw-alias-border-l3)`） | Files 头部 / 左栏 |
| 标题字体 | `var(--sol-exp-title-font)` → `var(--dsw-font-xs-strong-13)` | 主题 token |
| 次要信息 | `var(--sol-exp-meta-font)` → `var(--dsw-font-xxs-12)`；`--sol-exp-label-tertiary` | 主题 token |
| 圆角 | `var(--sol-exp-radius)` → `var(--dsw-radius-sm)`（8px） | 主题 token |
| 表面 | `var(--sol-exp-chrome-bg)` → `var(--dsw-specific-sidebar-fill)`（保持现状） | 左栏根容器；右栏 Files 用 `bg-base`，本次不整块换色 |

### 4.6 手机触控密度

| 控件 | 桌面 | 手机（coarse） |
| --- | --- | --- |
| 信息头关闭 | — | 44×44 |
| 标题栏按钮 | 28×28 | 44×44 |
| 视图头工具 | 28×28 | 44×44 |
| SCM 行内操作 | hover 显示，20×20 | 常显，40×40（行高 44 兜底） |
| SCM 行 | 约 30px | `min-height:44px` |
| SCM 分区头 | 约 36px | `min-height:44px`；右侧按钮 40×40 |
| 提交 / AI 按钮 | 约 30px | `min-height:44px` |
| 搜索输入 | 24px / 13px | 44px / 16px |
| 终端页签 | 26px | 40px；关闭 32×32 |
| 终端拖拽带 | 6px | 12px |
| 上下文菜单项 | 已 44px | 保持 44px |

> 表中所有尺寸都由 §4.7 的 token 提供（`--sol-exp-control-size`、`--sol-exp-touch-target`、`--sol-exp-scm-action-size` 等），规则里不再出现这些裸数字。

---

### 4.7 Token 层：参数只在定义处出现一次

上游主题提供颜色、字体、圆角、焦点环、动效 token，但**没有 spacing / size / control-height 这类几何 token**（已核对 `dsh-client-ui-theme` 0.2.x）。所以本次在插件内建一层 `--sol-exp-*` 语义 token：

- 颜色、字体、圆角、焦点环、动效**只 alias 上游 token**，不新增颜色值；
- 几何值（行高、控件尺寸、间距、触控目标）只在 `body` 的 token 定义处出现一次，所有规则用 `var()`；
- 手机/触屏只**重绑 token**（`--sol-exp-row-height` → `var(--sol-exp-row-height-touch)`），不在规则里散落 44px；
- sheet 的顶部/底部/左右安全区由 `--sol-exp-safe-*` 统一出口，portaled 的 toast / modal 也能复用。

```css
body {
  /* 触控目标：手机端主要可点区域的唯一来源 */
  --sol-exp-touch-target: 44px;

  /* 行高与控件：桌面继承上游 Files 头部（38 / 28）；触屏重绑到 touch target */
  --sol-exp-row-height: 38px;
  --sol-exp-row-height-touch: var(--sol-exp-touch-target);
  --sol-exp-control-size: 28px;
  --sol-exp-control-size-touch: var(--sol-exp-touch-target);
  --sol-exp-info-row-height: var(--sol-exp-touch-target);

  /* 图标与间距 */
  --sol-exp-icon-size: 16px;
  --sol-exp-icon-size-sm: 14px;
  --sol-exp-space-2: 2px;
  --sol-exp-space-4: 4px;
  --sol-exp-space-6: 6px;
  --sol-exp-space-8: 8px;
  --sol-exp-space-12: 12px;
  --sol-exp-space-16: 16px;

  /* 分隔线 / 圆角 / 字体 / 焦点环：全部 alias 上游 token */
  --sol-exp-hairline: .5px;
  --sol-exp-border: var(--sol-exp-hairline) solid var(--dsw-alias-border-l3);
  --sol-exp-radius: var(--dsw-radius-sm);
  --sol-exp-title-font: var(--dsw-font-xs-strong-13, 500 13px/20px var(--dsw-font-family, sans-serif));
  --sol-exp-meta-font: var(--dsw-font-xxs-12, 12px/18px var(--dsw-font-family, sans-serif));
  --sol-exp-focus-width: var(--dsw-focus-ring-width, 2px);
  --sol-exp-focus-color: var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  --sol-exp-focus-offset: -2px;
  --sol-exp-duration: var(--ds-transition-duration, .2s);
  --sol-exp-ease: var(--ds-ease-in-out, ease);

  /* 表面 / 文本 / 交互色：不新增颜色值 */
  --sol-exp-chrome-bg: var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-base));
  --sol-exp-label-primary: var(--dsw-alias-label-primary);
  --sol-exp-label-secondary: var(--dsw-alias-label-secondary);
  --sol-exp-label-tertiary: var(--dsw-alias-label-tertiary);
  --sol-exp-hover-bg: var(--dsw-alias-interactive-bg-hover);

  /* 安全区：宿主变量 > env > 插件兜底 */
  --sol-exp-top-clearance-min: 12px;
  --sol-exp-safe-top: max(env(safe-area-inset-top, 0px), var(--dshm-safe-top, 0px), var(--sol-exp-top-clearance-min));
  --sol-exp-safe-right: max(env(safe-area-inset-right, 0px), var(--dshm-safe-right, 0px), 0px);
  --sol-exp-safe-bottom: max(env(safe-area-inset-bottom, 0px), var(--dshm-safe-bottom, 0px), 0px);
  --sol-exp-safe-left: max(env(safe-area-inset-left, 0px), var(--dshm-safe-left, 0px), 0px);

  /* 其它组件参数 */
  --sol-exp-scm-action-size: 40px;
  --sol-exp-tree-row-padding-block: 9px;
  --sol-exp-input-min-height: var(--sol-exp-touch-target);
  --sol-exp-input-font-size: var(--dsw-font-base-16-font-size, 16px);
  --sol-exp-input-line-height: 24px;
  --sol-exp-terminal-tab-height: var(--sol-exp-touch-target);
  --sol-exp-terminal-close-size: 32px;
  --sol-exp-terminal-resize-hit: 12px;
  --sol-exp-toast-offset: 16px;
  --sol-exp-toast-max-width: 340px;
  --sol-exp-toast-max-height: 200px;
  --sol-exp-z-toast: 99999;
  --sol-exp-menu-edge: var(--sol-exp-space-8);
  --sol-exp-branch-max-width: 30vw;
  --sol-exp-vv-height: 100%;
  --sol-exp-keyboard-inset: 0px;
}

@media (pointer: coarse) {
  body {
    --sol-exp-row-height: var(--sol-exp-row-height-touch);
    --sol-exp-control-size: var(--sol-exp-control-size-touch);
    --sol-exp-scm-action-size: var(--sol-exp-touch-target);
    --sol-exp-terminal-close-size: var(--sol-exp-touch-target);
  }
}
```

**Token 来源对照**

| Token | 值 / alias | 来源 | 使用位置 |
| --- | --- | --- | --- |
| `--sol-exp-row-height` | `38px` | 上游 Files 头部 | 标题栏 / 视图头（桌面） |
| `--sol-exp-control-size` | `28px` | 上游 Files / Rightbar 图标按钮 | 图标按钮（桌面） |
| `--sol-exp-touch-target` | `44px` | 宿主移动端 chrome 约定 | 手机端所有主要可点目标 |
| `--sol-exp-info-row-height` | `var(--sol-exp-touch-target)` | 本方案 | 信息头内容行 |
| `--sol-exp-border` | `.5px solid var(--dsw-alias-border-l3)` | 上游 Files 头部 | 顶栏 / 视图头分隔线 |
| `--sol-exp-radius` | `var(--dsw-radius-sm)` | 上游主题 | 按钮圆角 |
| `--sol-exp-title-font` | `var(--dsw-font-xs-strong-13, …)` | 上游主题 | 工作区/视图标题 |
| `--sol-exp-meta-font` | `var(--dsw-font-xxs-12, …)` | 上游主题 | 分支 / 变更数 |
| `--sol-exp-safe-top` | `max(env(), var(--dshm-safe-top), 12px)` | 宿主 + 插件兜底 | 信息头顶部 |
| `--sol-exp-safe-bottom` | `max(env(), var(--dshm-safe-bottom), 0px)` | 宿主 + 插件兜底 | 面板底部 / toast / modal |
| `--sol-exp-input-font-size` | `var(--dsw-font-base-16-font-size, 16px)` | 上游主题 | 手机搜索输入 |
| `--sol-exp-space-*` | `2 / 4 / 6 / 8 / 12 / 16px` | 插件内间距刻度 | 所有 padding / gap / margin |

> 规则层面的验收：**新增/改动的选择器里不出现裸 `38px / 28px / 44px / 12px / 16px`**；这些字面量只允许出现在本节的 token 定义中。上游以后若提供 spacing/size token，只需改这里的 alias，不动任何规则。
>
> 仓库原约定是“颜色只用 `--dsw-alias-*`”。本次新增的 `--sol-exp-*` **只承载几何/语义别名**，颜色仍然全部来自 `--dsw-*`；实施时同步更新 `styles.ts` 顶部注释与 `CONTRIBUTING.md` 的措辞（“颜色用 `--dsw-*`，几何参数用 `--sol-exp-*`”），避免后续 review 误判。

---

## 5. 实现方案

### 5.1 手机 sheet 标记

在 `applyGrid()` 的手机分支里给列打一个公开属性，CSS 只认这个属性，不去嗅探宿主哈希类名：

```ts
// layout/grid.ts, isPortraitPhone() 分支
const col = state.layout.panelCol
if (col !== null) {
  const open = !state.layout.panelCollapsed
  if (open) col.dataset.solExpSheet = "1"
  else delete col.dataset.solExpSheet   // 注意：赋 "" 仍会匹配 [data-sol-exp-sheet]
  // ...现有 display / position / inset / height 逻辑
}
```

非手机分支和关闭状态都要清理：

```ts
if (state.layout.panelCol !== null) delete state.layout.panelCol.dataset.solExpSheet
```

> 不要用 `dataset.solExpSheet = ""` 代替 `delete`：空字符串属性仍然命中 `[data-sol-exp-sheet]`，信息头会在桌面/折叠后继续占位。

这样：

- 桌面端永远不会出现信息头；
- 手机折叠时列 `display:none`，信息头也不可见；
- 不依赖 React 重新渲染，纯 CSS 生效；
- 不触碰宿主 `data-sidebar-*` / `data-dshm-*`。

### 5.2 新增 `MobileHeader` 组件

新增 `src/client/layout/MobileHeader.ts`，遵守仓库约定：`createElement`、不写 `innerHTML`、图标来自 `icons.ts`、文案来自 `t()`。

```ts
import { createElement as h } from 'react'
import type { ReactNode } from 'react'
import { IconBranchOutline, IconCloseOutline, IconFolderClose } from '../icons.ts'
import { t } from '../locales.ts'
import type { AppState } from '../state/store.ts'
import type { PanelActions } from '../PanelRoot.ts'
import { isUsableBranch, syncLabel, workspaceName } from '../shared/labels.ts'

/* shared/labels.ts（纯函数，无 React 依赖）：
 * export function workspaceName(root: string): string
 * export function isUsableBranch(branch: unknown): branch is string
 * export function syncLabel(ahead: number, behind: number): string
 */

/* 图标 size 是 React prop，不能直接吃 CSS var；在模块内集中一次，
 * 与 CSS 的 --sol-exp-icon-size / --sol-exp-icon-size-sm 保持同值。 */
const HEADER_ICON_SIZE = 16
const HEADER_META_ICON_SIZE = 14

export function MobileHeader({ state, actions }: {
  state: AppState
  actions: PanelActions
}): ReactNode {
  const root = state.root
  const name = workspaceName(root)
  const status = state.scm.gitStatus
  const branch = isUsableBranch(status?.branch) ? status.branch : ''
  const ahead = Number(status?.ahead ?? 0)
  const behind = Number(status?.behind ?? 0)
  const sync = syncLabel(ahead, behind)
  const changes = state.scm.gitChangesCount
  const busy = state.tree.loading || state.search.searching || state.scm.committing

  return h('div', { className: 'sol-exp-mobilehead' },
    h('div', { className: 'sol-exp-mobilehead-row' },
      h('div', {
        className: 'sol-exp-mobilehead-workspace',
        title: root || undefined,
      },
        h(IconFolderClose, { size: HEADER_ICON_SIZE }),
        h('span', { className: 'sol-exp-mobilehead-name' },
          name !== '' ? name : t('panel.empty')),
      ),
      branch !== ''
        ? h('div', { className: 'sol-exp-mobilehead-branch', title: branch },
            h(IconBranchOutline, { size: HEADER_META_ICON_SIZE }),
            h('span', { className: 'sol-exp-mobilehead-branch-name' }, branch),
            sync !== ''
              ? h('span', { className: 'sol-exp-mobilehead-sync' }, sync)
              : null,
          )
        : (root !== '' ? h('span', { className: 'sol-exp-mobilehead-nogit' }, t('header.noGit')) : null),
      changes > 0
        ? h('span', { className: 'sol-exp-mobilehead-changes' },
            String(changes), h('span', { className: 'sol-exp-mobilehead-changes-unit' }, t('header.changes')))
        : null,
      busy ? h('span', { className: 'sol-exp-mobilehead-busy', 'aria-hidden': 'true' }, '…') : null,
      h('div', { style: { flex: 1 } }),
      h('button', {
        type: 'button',
        className: 'sol-exp-mobilehead-close',
        title: t('header.close'),
        'aria-label': t('header.close'),
        'data-sol-exp-close': '',
        onClick: (e) => { e.stopPropagation(); actions.togglePanel() },
      }, h(IconCloseOutline, { size: HEADER_ICON_SIZE })),
    ),
  )
}
```

`PanelRoot` 的渲染顺序改为：

```ts
h('div', { className: 'sol-exp-panel', onDragOver: (e) => e.preventDefault() },
  h(MobileHeader, { state, actions }),
  h(ActivityBar, { state, actions }),
  h('div', { className: 'sol-exp-body' },
    h('div', { className: 'sol-exp-main' }, content)),
)
```

> 信息头始终渲染，但 CSS 默认 `display:none`；只有 `[data-sol-exp-sheet]` 下显示。这样不需要新增 React 状态或 resize 监听。

### 5.3 样式实现（完整草案）

把下面几组规则加到 `styles.ts`。建议放在现有顶部样式之后、`@media (pointer: coarse)` 之前，最后再统一用一个 coarse 块覆盖，避免 specificity 打架。**所有规则只消费 §4.7 的 token，不在选择器里写裸尺寸/裸颜色。**

#### 5.3.1 sheet 基础

> 安全区 token 已在 §4.7 定义，这里只消费，不再写 `env()` / 12px 等裸值。

```css
[data-solution-explorer][data-sol-exp-sheet] .sol-exp-panel {
  box-sizing: border-box;
  padding-bottom: var(--sol-exp-safe-bottom);
}

[data-solution-explorer][data-sol-exp-sheet] .sol-exp-content,
[data-solution-explorer][data-sol-exp-sheet] .sol-exp-scm-top,
[data-solution-explorer][data-sol-exp-sheet] #sol-exp-commits-list,
[data-solution-explorer][data-sol-exp-sheet] .sol-exp-commit-files,
[data-solution-explorer][data-sol-exp-sheet] .sol-exp-mdview,
[data-solution-explorer][data-sol-exp-sheet] .sol-exp-pdfview,
[data-solution-explorer][data-sol-exp-sheet] .sol-exp-docview {
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}
```

#### 5.3.2 信息头

```css
.sol-exp-mobilehead { display: none; }

[data-solution-explorer][data-sol-exp-sheet] .sol-exp-mobilehead {
  flex: none;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  padding: var(--sol-exp-safe-top) var(--sol-exp-safe-right) 0 var(--sol-exp-safe-left);
  background: var(--sol-exp-chrome-bg);
  border-bottom: var(--sol-exp-border);
}

.sol-exp-mobilehead-row {
  display: flex;
  align-items: center;
  gap: var(--sol-exp-space-8);
  height: var(--sol-exp-info-row-height);
  padding: 0 var(--sol-exp-space-6) 0 var(--sol-exp-space-16);
  box-sizing: border-box;
  min-width: 0;
}

.sol-exp-mobilehead-workspace {
  display: inline-flex;
  align-items: center;
  gap: var(--sol-exp-space-6);
  min-width: 0;
  flex: 0 1 auto;
  color: var(--sol-exp-label-primary);
  font: var(--sol-exp-title-font);
}

.sol-exp-mobilehead-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.sol-exp-mobilehead-branch {
  display: inline-flex;
  align-items: center;
  gap: var(--sol-exp-space-4);
  min-width: 0;
  flex: 0 1 auto;
  color: var(--sol-exp-label-secondary);
  font: var(--sol-exp-meta-font);
}

.sol-exp-mobilehead-branch-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: var(--sol-exp-branch-max-width);
}

.sol-exp-mobilehead-sync {
  flex: none;
  color: var(--sol-exp-label-tertiary);
  font-variant-numeric: tabular-nums;
}

.sol-exp-mobilehead-nogit,
.sol-exp-mobilehead-changes {
  flex: none;
  color: var(--sol-exp-label-tertiary);
  font: var(--sol-exp-meta-font);
  white-space: nowrap;
}

.sol-exp-mobilehead-changes-unit { margin-left: var(--sol-exp-space-2); }

.sol-exp-mobilehead-busy {
  flex: none;
  color: var(--sol-exp-label-tertiary);
  font: var(--sol-exp-meta-font);
}

.sol-exp-mobilehead-close {
  flex: none;
  width: var(--sol-exp-touch-target);
  height: var(--sol-exp-touch-target);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: var(--sol-exp-radius);
  background: transparent;
  color: var(--sol-exp-label-secondary);
  cursor: pointer;
  touch-action: manipulation;
}

.sol-exp-mobilehead-close:hover {
  background: var(--sol-exp-hover-bg);
  color: var(--sol-exp-label-primary);
}

.sol-exp-mobilehead-close:focus-visible {
  outline: var(--sol-exp-focus-width) solid var(--sol-exp-focus-color);
  outline-offset: var(--sol-exp-focus-offset);
}
```

#### 5.3.3 标题栏 / 视图头对齐上游

```css
/* 桌面：向上游 Files 头部靠拢；尺寸全部来自 token */
.sol-exp-activity {
  height: var(--sol-exp-row-height);
  padding: 0 var(--sol-exp-space-6);
  gap: var(--sol-exp-space-2);
  border-bottom: var(--sol-exp-border);
}

.sol-exp-activity-btn {
  width: var(--sol-exp-control-size);
  height: var(--sol-exp-control-size);
  border-radius: var(--sol-exp-radius);
  touch-action: manipulation;
}

.sol-exp-header {
  height: var(--sol-exp-row-height);
  padding: 0 var(--sol-exp-space-6) 0 var(--sol-exp-space-16);
  gap: var(--sol-exp-space-4);
  border-radius: 0;
  border-bottom: var(--sol-exp-border);
  color: var(--sol-exp-label-secondary);
}

.sol-exp-title {
  color: var(--sol-exp-label-primary);
  font: var(--sol-exp-title-font);
}

.sol-exp-toolbar-btn {
  width: var(--sol-exp-control-size);
  height: var(--sol-exp-control-size);
  border-radius: var(--sol-exp-radius);
  color: var(--sol-exp-label-secondary);
  touch-action: manipulation;
}
```

> 注意：`.sol-exp-activity` 目前还把“收起”按钮放在最右；手机端把这个按钮隐藏（收进信息头），桌面保留。见 §5.3.4。

#### 5.3.4 手机 sheet 的行高与重复标题

```css
/* 手机 sheet 只是重绑 token 后的同一组规则，没有新的裸尺寸 */
[data-solution-explorer][data-sol-exp-sheet] .sol-exp-activity {
  height: var(--sol-exp-row-height);
  padding: 0 var(--sol-exp-space-4);
}

[data-solution-explorer][data-sol-exp-sheet] .sol-exp-activity-btn {
  width: var(--sol-exp-control-size);
  height: var(--sol-exp-control-size);
}

/* 手机上关闭由信息头负责，标题栏不再放第二个收起按钮 */
[data-solution-explorer][data-sol-exp-sheet] .sol-exp-panel-toggle {
  display: none;
}

[data-solution-explorer][data-sol-exp-sheet] .sol-exp-header {
  height: var(--sol-exp-row-height);
  justify-content: flex-end;
}

/* 工作区名已经在信息头，视图头不重复 */
[data-solution-explorer][data-sol-exp-sheet] .sol-exp-header .sol-exp-title {
  display: none;
}

[data-solution-explorer][data-sol-exp-sheet] .sol-exp-toolbar-btn {
  width: var(--sol-exp-control-size);
  height: var(--sol-exp-control-size);
  min-width: var(--sol-exp-control-size);
  min-height: var(--sol-exp-control-size);
}

/* 搜索页的标题行没有操作，整行隐藏，搜索框直接接在标题栏下 */
[data-solution-explorer][data-sol-exp-sheet] .sol-exp-search-panel > .sol-exp-header {
  display: none;
}
```

> 视图头隐藏标题后，右侧 5 个 `--sol-exp-control-size` 按钮在 320px 宽屏上仍可能挤：`5×44 + 4×2 + 16 + 6 = 250px`，剩 70px 给空白，可接受。若后续觉得拥挤，P2 把“展开/收起全部”收进溢出菜单。

#### 5.3.5 coarse pointer 统一触控块

```css
@media (pointer: coarse) {
  /* 树行 */
  .sol-exp-tree-node {
    min-height: var(--sol-exp-touch-target);
    padding-top: var(--sol-exp-tree-row-padding-block);
    padding-bottom: var(--sol-exp-tree-row-padding-block);
  }

  /* 搜索输入：高度/字号全部来自 token，避免移动浏览器聚焦缩放 */
  .sol-exp-search { padding: 0 var(--sol-exp-space-8) var(--sol-exp-space-6); }
  .sol-exp-search-input {
    min-height: var(--sol-exp-input-min-height);
    padding: 0 var(--sol-exp-space-12);
    font-size: var(--sol-exp-input-font-size);
    line-height: var(--sol-exp-input-line-height);
  }

  /* SCM 行 / 分区 / 提交按钮 */
  .sol-exp-scm-item,
  .sol-exp-repo-item,
  .sol-exp-search-item { min-height: var(--sol-exp-touch-target); }

  .sol-exp-scm-section-header { min-height: var(--sol-exp-touch-target); }
  .sol-exp-hdr-btn,
  .sol-exp-scm-action-btn {
    width: var(--sol-exp-scm-action-size);
    height: var(--sol-exp-scm-action-size);
  }

  /* 触屏没有 hover：行内操作常显 */
  .sol-exp-scm-actions { display: flex; }

  .sol-exp-commit-btn,
  .sol-exp-ai-btn { min-height: var(--sol-exp-touch-target); }
  .sol-exp-ai-btn { width: var(--sol-exp-touch-target); line-height: var(--sol-exp-touch-target); }

  /* 终端触控 */
  .sol-exp-term-tabs { height: var(--sol-exp-terminal-tab-height); }
  .sol-exp-term-tab { height: var(--sol-exp-terminal-tab-height); }
  .sol-exp-term-tab-close {
    width: var(--sol-exp-terminal-close-size);
    height: var(--sol-exp-terminal-close-size);
  }
  .sol-exp-term-resize {
    height: var(--sol-exp-terminal-resize-hit);
    top: calc(var(--sol-exp-terminal-resize-hit) / -2);
  }

  /* 对话框按钮 */
  .sol-exp-modal-btn { min-height: var(--sol-exp-touch-target); }
}
```

> 提醒：现有 `styles.ts:37-41` 的 coarse 块里有 `.sol-exp-toolbar-btn { min-width:36; min-height:36 }`，与新的 token 化尺寸冲突。实施时应合并成一个 coarse 块，或把旧块删掉，只保留一处真源。

#### 5.3.6 底部安全区

```css
/* 终端自身不重复加底部留白：.sol-exp-panel 已加 */
[data-solution-explorer][data-sol-exp-sheet] .sol-exp-terminal-shell {
  padding-bottom: 0;
}

/* toast：改用 class + token（具体样式见 shared/ui.ts 的迁移） */
.sol-exp-toast {
  position: fixed;
  right: var(--sol-exp-space-16);
  bottom: calc(var(--sol-exp-toast-offset) + var(--sol-exp-safe-bottom));
  z-index: var(--sol-exp-z-toast);
  max-width: var(--sol-exp-toast-max-width);
  max-height: var(--sol-exp-toast-max-height);
  overflow: auto;
  padding: var(--sol-exp-space-8) var(--sol-exp-space-12);
  border-radius: var(--sol-exp-radius);
  border: var(--sol-exp-hairline) solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-3));
  font: var(--sol-exp-meta-font);
  box-shadow: var(--dsw-elevation-prominent);
  white-space: pre-wrap;
  word-break: break-all;
  transition: opacity var(--sol-exp-duration) var(--sol-exp-ease);
}

/* 模态框上下留白，避免键盘/手势条（只对触屏生效，桌面保持原居中） */
@media (pointer: coarse) {
  .sol-exp-modal-mask {
    padding: calc(var(--sol-exp-safe-top) + var(--sol-exp-space-16)) var(--sol-exp-space-16)
             calc(var(--sol-exp-safe-bottom) + var(--sol-exp-space-16));
    box-sizing: border-box;
  }
}
```

`shared/ui.ts` 里的 toast 目前是一整段内联字符串；迁移成 `.sol-exp-toast` class 后，`showToast` 只负责设置 `textContent` 和错误态 class：

```ts
el.className = 'sol-exp-toast' + (isError ? ' error' : '')
```

> 提示框尺寸/层级也走 token（`--sol-exp-toast-max-width`、`--sol-exp-toast-max-height`、`--sol-exp-z-toast`）；以后调大提示框只改 token。

（`ContextMenu.ts` 的边界计算见 §5.7。）

### 5.4 信息头数据与交互

- **工作区名**：`workspaceName(state.root)`；`title` 放完整路径，长按可被系统文本选择/复制（如 WebView 支持）。
- **分支**：`state.scm.gitStatus?.branch`，`"unknown"` 视为无仓库；不额外请求。
- **ahead/behind**：`status.ahead` / `status.behind`。
- **变更数**：`state.scm.gitChangesCount`，与 SCM 图标徽标同源。
- **加载状态**：`tree.loading || search.searching || scm.committing`；不引入新的定时器。
- **关闭**：`actions.togglePanel()`；手机折叠后列 `display:none`，与右滑关闭同一出口。
- **关闭路径的现有守卫必须一起改**：`panel.ts` 的 `togglePanel` 在 `state.layout.panelWidth <= 0` 时直接 `return`（桌面语义）。手机 sheet 在 `autoOpen=false` 或工作区尚未就绪时可能 `panelWidth === 0`，但列仍可由手势/入口打开；此时信息头的关闭会**静默失效**。实现时在守卫前对 `isPortraitPhone()` 放行：
  ```ts
  if (!isPortraitPhone() && state.layout.panelWidth <= 0) return
  ```
  或新增 `commands.closeSheet` 只做 `panelCollapsed = true; render(); applyGrid()`。这是 P0 必须一起改的一项，并写入关闭测试用例。
- **点击分支/变更（P1，可选）**：切到 SCM 页签并打开对应面板。若要做，给 `PanelActions` 加：
  ```ts
  openScmBranch(): void
  openScmChanges(): void
  ```
  由 `panel.ts` 实现为 `commands.tab?.('scm')` + `commands.branchPanel?.()`；不直接调用 SCM 内部模块。

### 5.5 视图头手机去重

- Tree：隐藏 `.sol-exp-title`，保留右侧 5 个操作；工作区名由信息头承担。
- Search：整行隐藏（该行没有操作），搜索框直接接标题栏。
- SCM：本来没有 `.sol-exp-header`，不变。
- 桌面：全部不变。

### 5.6 键盘 / 可视视口（P1）

当前 sheet 是 `position:fixed; inset:0; height:100%`。键盘弹起时，Android WebView 可能只缩 visual viewport，不缩 layout viewport，导致提交框/搜索框被键盘盖住。

建议在 `panel.ts` 的 `ctx.effect` 里加一个仅在手机生效的监听：

```ts
const vv = window.visualViewport
const syncViewport = () => {
  if (!isPortraitPhone() || state.layout.panelCol === null) return
  const height = Math.round(vv?.height ?? window.innerHeight)
  const top = Math.round(vv?.offsetTop ?? 0)
  const keyboard = Math.max(0, Math.round(window.innerHeight - height - top))
  state.layout.panelCol.style.setProperty('--sol-exp-vv-height', height + 'px')
  state.layout.panelCol.style.setProperty('--sol-exp-keyboard-inset', keyboard + 'px')
}
vv?.addEventListener('resize', syncViewport)
vv?.addEventListener('scroll', syncViewport)
syncViewport()
```

CSS：

```css
[data-solution-explorer][data-sol-exp-sheet] {
  height: var(--sol-exp-vv-height, 100%);
}
```

注意：`grid.ts:117` 目前给列写了内联 `height = "100%"`，内联样式会压过上面的 CSS。实现时二选一：

- 把内联改成 `col.style.height = "var(--sol-exp-vv-height, 100%)"`；或
- 在 `syncViewport()` 里直接写 `state.layout.panelCol.style.height = height + "px"`，关闭/卸载时恢复 `"100%"`。

并在卸载时 `removeEventListener`。如果实测 Android WebView 的 `visualViewport.height` 不随键盘变化，则退化为“聚焦输入时把 sheet 内容滚动到可见区”，不要强行改高度。此项放 P1，不阻塞 P0 的安全区修复。

### 5.7 上下文菜单 / toast / 模态框的边界

- `ContextMenu.ts` 用 `window.innerHeight` 夹取菜单底部；手机上加安全区。因为 §4.7 的 token 定义在 `body`，从 `document.body` 读，不需要知道菜单挂在哪个父节点：
  ```ts
  const rootStyle = getComputedStyle(document.body)
  const edge = parseFloat(rootStyle.getPropertyValue('--sol-exp-menu-edge')) || 0
  const safeBottom = parseFloat(rootStyle.getPropertyValue('--sol-exp-safe-bottom')) || 0
  top: Math.max(edge, Math.min(menu.y - window.scrollY, window.innerHeight - box.height - edge - safeBottom))
  ```
  同时把模块里现有的 `const EDGE = 8` 换成 `--sol-exp-menu-edge` 的 token（token 定义见补丁：`--sol-exp-menu-edge: var(--sol-exp-space-8)`）。
- toast：改内联样式为 `.sol-exp-toast` class，见 §5.3.6；位置/尺寸全部走 token。
- 模态框：加 padding，`max-height: calc(100dvh - var(--sol-exp-safe-top) - var(--sol-exp-safe-bottom))`，内部滚动；输入框 `font-size: var(--sol-exp-input-font-size)`（coarse）。

### 5.8 底部操作条（P2，可选）

如果希望“手机操作习惯”再进一步，P2 可以把视图操作从顶部移到拇指区：

```text
┌──────────────────────────────┐
│ ...内容...                    │
├──────────────────────────────┤
│  ＋文件  ＋文件夹  ⟳   ⌄  ⌃  │ var(--sol-exp-touch-target) + var(--sol-exp-safe-bottom)
└──────────────────────────────┘
```

- 只在 sheet 且终端关闭时显示；打开终端时让位给终端。
- 隐藏 `.sol-exp-header` 的整个操作行，信息头/标题栏保留。
- 这是较大的交互变更，建议单独评审；P0/P1 不做。

### 5.9 文案

在 `locales.ts` 的 zh/en 同时新增（en 是 `Record<SolutionExplorerKey, string>`，漏一个会编译失败）：

| key | zh | en |
| --- | --- | --- |
| `header.noGit` | 无 Git | No Git |
| `header.changes` | 项更改 | changes |
| `header.workspace` | 工作区 | Workspace |
| `header.branch` | 分支 | Branch |
| `header.close` | 关闭面板 | Close panel |

> `header.workspace` / `header.branch` / `header.close` 主要给 tooltip/aria 用；可见文本尽量复用现有 `panel.collapse`、`scm.branch`、`scm.changes`，减少翻译面。

### 5.10 不改的部分（明确边界）

- `gestures.ts` / `gesture-guard.ts`：一行不改；信息头不加 `touchstart`。
- `native-rightbar.ts` / `host/config.ts`：不改；工作台入口与互斥桥保持原样。
- `layout/grid.ts` 只加 `dataset.solExpSheet` 的置/清，不改 grid 轨道、不改 z-index、不改拖拽。
- 桌面端 `.sol-exp-panel` 的宽度、rail、resize handle 不变。
- 不修改宿主 `viewport` meta；不改写宿主 `--dshm-*` / `--dsw-*`，只新增自己的 `--sol-exp-*` 命名空间。

---

## 6. 分阶段实施

### 6.1 阶段表

| 阶段 | 内容 | 出口条件 | 规模 |
| --- | --- | --- | --- |
| 0 | 基线：在 AVD/真机截取当前 sheet 顶部、测 `env()` / `--dshm-safe-top` 实际值、量当前行高与按钮尺寸 | 有一张带状态栏的对比图 + 一组 DOM 数字 | 0.5d |
| 1 | P0：`data-sol-exp-sheet` + `MobileHeader` + Token 层 + 安全区 + 标题栏下移 + 视图头去重 | 刘海/状态栏不再压住任何按钮；桌面无变化；新增规则无裸尺寸 | 1.5d |
| 2 | P1：coarse 触控块、SCM 常显操作、搜索输入、底部安全区、overscroll | 所有主要控件 ≥ `--sol-exp-touch-target`；SCM 单文件暂存/放弃可点 | 1d |
| 3 | P1/P2：visualViewport 键盘处理、上下文菜单/模态/toast 安全区、终端触控 | 键盘弹起时输入框可见；底部浮层不压手势条 | 1d |
| 4 | 回归：桌面 + 手机 + 平板 + 键盘/旋转/终端；构建与发布 | §7 全绿；`1.1.0` 可发 | 0.5d |

### 6.2 代码改动清单

| 文件 | 改动 | 规模 |
| --- | --- | --- |
| `src/client/shared/labels.ts` | **新增**：`workspaceName` / `syncLabel` / `isUsableBranch` 纯函数（不 import React） | ~30 行 |
| `src/client/layout/MobileHeader.ts` | **新增**：信息头组件（消费 `labels.ts`） | ~80 行 |
| `src/client/PanelRoot.ts` | 渲染 `MobileHeader`；活动栏改为 `<button>` 语义（可选） | ~20 行 |
| `src/client/styles.ts` | `body` Token 层（安全区/行高/控件/间距/字体 alias）、信息头、上游几何、coarse 触控块、底部安全区、overscroll | ~300 行 |
| `src/client/layout/grid.ts` | 手机分支置/清 `data-sol-exp-sheet` | ~4 行 |
| `src/client/locales.ts` | 5 个新 key（zh/en） | ~10 行 |
| `src/client/panel.ts` | P0：`togglePanel` 关闭守卫对手机放行；可选：`visualViewport` 监听、`openScmBranch` 动作 | ~40 行 |
| `src/client/shared/ui.ts` | toast 改为 `.sol-exp-toast` class，位置/尺寸走 token | ~10 行 |
| `src/client/explorer/ContextMenu.ts` | 菜单底部安全区夹取 + `--sol-exp-menu-edge` | ~8 行 |
| `scripts/check-style-tokens.mjs` | **新增（P2）**：扫描改动选择器，禁止裸 px / 裸颜色 | ~60 行 |
| `CONTRIBUTING.md` | 约定补一句：颜色用 `--dsw-*`，几何参数用 `--sol-exp-*` token | ~2 行 |
| `test/labels.test.ts` | `workspaceName` / `syncLabel` 等纯函数用例 | ~40 行 |
| `docs/mobile-sidebar-style-plan.md` | 本文件 | — |

### 6.3 提交建议

1. `feat(phone): add a safe-area info header above the sidebar title bar`（阶段 1）
2. `fix(phone): align sidebar chrome with upstream geometry and touch-target tokens`（阶段 2）
3. `fix(phone): keep sheet chrome above the keyboard and the gesture bar`（阶段 3）
4. `chore(release): 1.1.0`（阶段 4）

阶段 1 是用户可感知的主变更；阶段 2/3 可以独立回滚，避免把“样式对齐”和“触控修复”混在一个提交里。

---

## 7. 测试与验收

### 7.1 设备矩阵

| 环境 | 重点 |
| --- | --- |
| Android AVD（`Medium_Phone_API_35`，1080×2400 @420） | 状态栏/挖孔、手势条、字体缩放 |
| 真机 Android（DSH Mobile / 浏览器） | `env()` 是否为 0、原生 56px 条是否压住、键盘 |
| iPhone Safari / PWA standalone | 刘海、home indicator、输入框自动缩放 |
| 桌面 1280+ | 信息头 `display:none`、行高/按钮取 `--sol-exp-row-height` / `--sol-exp-control-size`（38/28）、无底部 padding |
| 平板竖屏（≥768） | 不是 sheet，信息头不显示；面板列样式仍向上游靠拢 |

### 7.2 DOM / CSS 断言

在 CDP 控制台执行（手机 sheet 打开时）：

```js
const col = document.querySelector('[data-solution-explorer]')
const head = col.querySelector('.sol-exp-mobilehead')
const activity = col.querySelector('.sol-exp-activity')
const close = col.querySelector('[data-sol-exp-close]')

const r = (el) => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, width: b.width, height: b.height } }
const rootStyle = getComputedStyle(document.body)
const token = (n) => parseFloat(rootStyle.getPropertyValue(n)) || 0
const safeTop = rootStyle.getPropertyValue('--sol-exp-safe-top').trim()

return {
  sheet: col.dataset.solExpSheet,
  safeTop,
  rowHeightToken: token('--sol-exp-row-height'),
  controlToken: token('--sol-exp-control-size'),
  touchToken: token('--sol-exp-touch-target'),
  head: r(head),
  activity: r(activity),
  close: r(close),
  activityButtons: [...activity.querySelectorAll('.sol-exp-activity-btn')].map(r),
  infoVisible: getComputedStyle(head).display !== 'none',
  titleHidden: getComputedStyle(col.querySelector('.sol-exp-title')).display === 'none',
}
```

必须满足：

- `sheet === '1'`；
- `infoVisible === true`；
- `activity.top >= head.bottom - 1`（标题栏在信息头下方，不重叠）；
- 手机：`close` 与所有 `.sol-exp-activity-btn` 的 `width/height >= touchToken`（`--sol-exp-touch-target`）；
- 页面顶部 `0 ~ safeTop` 区域内没有可点控件（`document.elementsFromPoint(10, 4)` 不属于按钮）；
- 桌面：`getComputedStyle(head).display === 'none'`，`activity.height === rowHeightToken`；
- token 存在且非空：`--sol-exp-row-height` / `--sol-exp-control-size` / `--sol-exp-touch-target` / `--sol-exp-safe-top` / `--sol-exp-safe-bottom`。

### 7.3 Token 审计

新增的样式规则必须满足：

1. 颜色只出现 `var(--dsw-*)` / `var(--sol-exp-*)`，不出现 `#hex` / `rgb()` / `hsl()`；
2. 行高、宽度、间距、圆角只出现 `var(--sol-exp-*)` / `var(--dsw-*)` / `0` / `100%` / `auto`；
3. 裸 `38px / 28px / 44px / 12px / 16px` 只允许出现在 §4.7 的 `body` token 定义里；
4. 可用 `scripts/check-style-tokens.mjs`（P2）自动扫描改动选择器，或在 review 时对 §5.3 的规则做一次 grep。

**建议脚本行为**：读取 `src/client/styles.ts` 的 `STYLES` 字符串 → 用 `lightningcss` 解析 → 只检查本次新增/改动的选择器集合 → 对 `height / width / min-height / min-width / padding / margin / gap / border-radius / font-size / border` 的值做白名单（`var(...)`、`0`、`auto`、`100%`、`none`、`flex` 等），发现裸 px 时打印选择器 + 行号并非零退出。

### 7.4 功能回归

1. 手机打开侧板：信息头显示工作区/分支/变更；标题栏下移；无遮挡。
2. 关闭：信息头 `✕`、右滑、折叠按钮（桌面）三条路径都正常；关闭后 `data-sol-exp-sheet` 被清。
   - **专项**：设置里把 `autoOpen` 关掉（`panelWidth === 0`），仍能从右缘手势打开 sheet，再用信息头 `✕` 关闭；验证 §5.4 的守卫放行生效。
3. 切换文件/搜索/SCM：信息头内容不跳动；搜索页无重复标题；SCM 变更数同步。
4. 搜索输入：聚焦不放大页面；键盘弹起时输入框可见。
5. SCM：单文件“暂存/放弃”可直接点；分区刷新/全部暂存/取消暂存可用；提交按钮高度 ≥ `--sol-exp-touch-target`。
6. 终端：打开后底部不被手势条遮挡；页签可点；关闭正常。
7. 上下文菜单：长按底部文件，菜单不超出屏幕/不被手势条遮挡。
8. 对话框/toast：底部安全区留白正确。
9. 旋转：竖屏→横屏不再是 sheet（`isPortraitPhone()` 为 false），信息头消失，桌面/平板布局恢复。
10. 桌面：面板宽度拖拽、rail、折叠、视图头与改动前一致（截图对比）。

### 7.5 单元与构建

```sh
pnpm test
pnpm build
pnpm exec tsc -p tsconfig.client.json --noUnusedLocals --noUnusedParameters --noEmit
pnpm exec tsc -p tsconfig.host.json   --noUnusedLocals --noUnusedParameters --noEmit
```

新增 `test/labels.test.ts` 覆盖：

- `workspaceName('') === ''`
- `workspaceName('E:\\Code\\DSH\\plugins\\dsh-solution-explorer') === 'dsh-solution-explorer'`
- `workspaceName('/home/me/project/') === 'project'`
- `syncLabel(0, 0) === ''`，`syncLabel(2, 0) === '↑2'`，`syncLabel(0, 3) === '↓3'`，`syncLabel(2, 3) === '↑2 ↓3'`
- `isUsableBranch('unknown') === false`，`isUsableBranch('main') === true`。

### 7.6 视觉对比

- 桌面 before/after 截图：应只有顶栏几何（36→38、1px→0.5px、圆角 token）差异，信息头不可见。
- 手机 before/after 截图：同一台设备、同一工作区、同一滚动位置；重点看顶部 120px。
- 截图存 `assets/` 或 `.scratch/`，发布前不提交临时截图。

---

## 8. 风险与回滚

| 风险 | 影响 | 处置 |
| --- | --- | --- |
| `env(safe-area-inset-top)` 为 0（宿主 viewport 没有 `viewport-fit=cover`） | 顶部仍可能被状态栏压住 | 信息头自身有 `--sol-exp-top-clearance-min` + `--sol-exp-info-row-height` 的 token 兜底；标题栏从两者之和开始。不要只依赖 `env()`。可先在 AVD/真机量 `getComputedStyle` 的 `--sol-exp-safe-top`，再决定是否与宿主协调注入 viewport；**默认不改宿主 meta**。 |
| DSH Mobile 的 56px 原生“引擎已就绪”条仍然覆盖 | 空会话时信息头第一行被原生条压住 | `dsh-mobile-layout` 的公开契约说明它只在空态需要为面板让位；实施时在空会话实测，确认存在再给信息头叠加 `--dshm-engine-bar`（默认 56px），非空态不叠加。不要无条件加 56px，避免普通会话多出一条空白。 |
| 底部 `env(safe-area-inset-bottom)` 与宿主已让出的导航条双份 | 内容整体偏上、底部空带 | 用 `max(env, --dshm-safe-bottom)`；`dsh-mobile-layout` 已把 `--dshm-safe-bottom` 设为 0，DSH Mobile 下不会双份。浏览器 standalone 才有 env 值。 |
| 信息头使手机顶部多出 `--sol-exp-safe-top + --sol-exp-info-row-height` | 小屏内容区变短 | 信息头只在 sheet 显示；P2 可在终端打开/矮屏时折叠信息头，或把 `--sol-exp-info-row-height` 调小；P0 先保证不遮挡。 |
| 视图头 5 个 touch-target 按钮在 320px 宽屏拥挤 | 标题/路径被压缩 | 已隐藏重复标题；仍拥挤时 P2 把“展开/折叠全部”收进溢出菜单，或把 `--sol-exp-control-size` 在窄屏调到 40。 |
| `--dsw-font-xs-strong-13` 等 token 不存在于旧宿主 | 字体回退 | 全部写 `var(--token, fallback)`；旧宿主回退到 13px/20px。 |
| 桌面被 coarse 媒体查询误伤（触屏笔记本） | 桌面出现 touch-target 尺寸控件 | 行高 token 默认 38px，`@media (pointer:coarse)` 只重绑 `--sol-exp-row-height` / `--sol-exp-control-size`；现有仓库已在全局 coarse 下把树行放大，本次沿用同一策略；触屏笔记本得到更大可点目标属于可接受副作用。真要对桌面零影响，可把 coarse 重绑收进 `[data-sol-exp-sheet]`，但平板触控会失去放大。 |
| 上游没有 spacing/size token | 无法全部用 `--dsw-*` | 已在 §4.7 建立唯一的 `--sol-exp-*` 几何 token 层；颜色/字体/圆角/焦点环仍 alias 上游。规则里只消费 token；未来上游补 token 时只改 token 定义。 |
| token 名与宿主/其他插件冲突 | 覆盖别人的变量 | 全部使用 `--sol-exp-` 前缀；不改宿主 `--dshm-*` / `--dsw-*`，只读取。 |
| 规则里又写回裸值 | token 层形同虚设 | `scripts/check-style-tokens.mjs` + review 双重检查；新增/改动选择器不允许裸 px / 裸颜色。 |
| 信息头数据更新不及时 | 分支/变更数陈旧 | `loadGitStatus` 在分支/变更变化时会 `render()`；信息头只读同一 state。若发现不刷新，在 `loadGitStatus` 的 render 条件里补 `gitChangesCount` 比较，不新增轮询。 |
| `ContextMenu` 读取 CSS 变量作用域错误 | 菜单底部仍越界 | §4.7 token 定义在 `body`，从 `document.body` 读即可；不要从 `<html>` 上读 `--dshm-*`（那是宿主变量）。 |
| CSS specificity 与现有 `styles.ts` 规则冲突 | 行高/按钮尺寸被旧规则覆盖 | 合并现有 `@media (pointer: coarse)` 块，只保留一处；新规则放在文件末尾并带 `[data-sol-exp-sheet]` 前缀。 |
| 未来宿主改 DOM | sheet 标记/信息头失效 | 只依赖本插件自己的 `[data-solution-explorer]` 与 `data-sol-exp-sheet`；不依赖宿主哈希类名。 |

**回滚：**

- 阶段 1：删除 `MobileHeader` 渲染 + 对应 CSS + `data-sol-exp-sheet` 置位即可恢复原样；不影响手势/宿主。
- 阶段 2/3：coarse 块与底部安全区是独立 CSS，可单独 revert。
- 不涉及 host 路由、数据库、会话状态，回滚无数据风险。

---

## 9. 开放问题（实施前需要拍板）

1. **顶部兜底取值**：`--sol-exp-top-clearance-min` 的默认值是否足够？如果 AVD/真机实测状态栏 24–32px 且 `env()` 为 0，`--sol-exp-info-row-height` 是否已经把文字放到安全位置？建议阶段 0 用截图 + `elementsFromPoint` 确认后再调 token，不改规则。
2. **是否叠加 `--dshm-engine-bar`**：只在空会话叠加，还是所有会话都不叠加？需要真机看原生条是否常驻。
3. **信息头是否可点击**：P0 只做展示 + 关闭；分支/变更点击跳 SCM 是否值得加？建议 P1 再加，避免 P0 引入额外命令。
4. **底部操作条**：是否要在 P2 把新建/刷新移到底部？这是对“手机操作习惯”最有效的改进，但会改变桌面/手机的操作位置一致性，建议单独评审。
5. **视图头是否保留标题**：P0 方案是手机隐藏、桌面保留；如果用户希望手机上仍看到“文件浏览器”文字，可以改成显示当前视图名而不是工作区名（需要 `layout.sheet` 状态或 CSS 伪元素方案）。

---

## 10. 实施记录

### 10.1 分支与提交

- 分支：`feat/mobile-sidebar-token-header`
- 提交：
  - `8cf8a93` `docs(phone): plan the mobile sidebar safe-area and token layer`
  - `3349747` `feat(phone): add pure workspace/branch label helpers`
  - `c05aec4` `feat(phone): render a workspace header above the sidebar title bar`
  - `fd05323` `feat(phone): tokenize sidebar chrome and show the info header on the sheet`
  - `f29638e` `fix(phone): keep toasts and context menus above the gesture bar`

### 10.2 已落地内容

| 项 | 实现 |
| --- | --- |
| Token 层 | `styles.ts` 顶部 `body` 定义 `--sol-exp-*`；颜色/字体/圆角/焦点环 alias `--dsw-*`；coarse 只重绑行高/控件/SCM/终端尺寸 token |
| 信息头 | 新增 `layout/MobileHeader.ts`；`PanelRoot` 渲染在标题栏之前；CSS 默认 `display:none`，仅 `[data-sol-exp-sheet]` 显示 |
| 标题栏下移 | 手机 sheet 打开时信息头占 `--sol-exp-safe-top + --sol-exp-info-row-height`，`.sol-exp-activity` 从第一行变为第二行 |
| Sheet 标记 | `applyGrid()` 在 grid 轨道 early return 之前置/清 `data-sol-exp-sheet`，避免 shell 轨道尚未就绪时信息头不出现 |
| 关闭守卫 | `panel.ts` 的 `togglePanel` 对 `isPortraitPhone()` 放行，`autoOpen=false` / `panelWidth=0` 时也能用信息头关闭 |
| 触控 | 活动栏/视图头 44px；SCM 行/分区/提交按钮放大；SCM 行内操作在 coarse 下常显；搜索输入 44px 高 / 16px 字号 |
| 底部安全区 | `.sol-exp-panel` 在 sheet 下加 `padding-bottom: var(--sol-exp-safe-bottom)`；toast/右键菜单/模态框同步避让 |
| 文案 | `header.noGit` / `header.changes` / `header.workspace` / `header.branch` / `header.close`，zh/en 同步 |
| 约定 | `styles.ts` 顶部注释与 `CONTRIBUTING.md` 补充 `--sol-exp-*` 几何 token 约定 |

### 10.3 与计划的偏差

1. **Sheet 标记位置**：计划写在 `isPortraitPhone()` 分支内；实际放在 `applyGrid()` 早退之前，因为 `shellTracks` 未就绪时该分支根本不会执行，信息头会缺席第一帧。
2. **Toast**：计划只要求改 `bottom` 一行；实际把内联样式抽成 `.sol-exp-toast` class，位置/尺寸/层级全部走 token，避免新 token 只服务一行内联样式。
3. **右键菜单安全区**：自定义属性值不会在 `getComputedStyle` 里解析成 px；改为读取 `.sol-exp-panel` 的实际 `padding-bottom`，否则 `parseFloat` 恒为 0。
4. **Token 作用域修正（背景透明问题）**：首版把 token 层写在 `:root`，但上游主题的 `--dsw-*` 颜色 token 挂在 `body`；`--sol-exp-chrome-bg: var(--dsw-specific-sidebar-fill)` 在 `:root` 解析不到，导致 `.sol-exp-panel` / 信息头背景透明、内容互相重叠。已改为在 `body` 定义 token，并给 chrome 背景加 `var(--dsw-alias-bg-base)` 兜底。
5. **未做**：`visualViewport` 键盘避让、底部操作条（P2）、`scripts/check-style-tokens.mjs`；这三项保留为后续独立提交，避免把仍需要真机键盘验证的改动混进本次。

### 10.4 验证结果

- `pnpm test`：15/15 通过（含新增 `test/labels.test.ts`）。
- `pnpm exec tsc -p tsconfig.client.json --noUnusedLocals --noUnusedParameters --noEmit`：通过。
- `pnpm build`：通过（`lib/index.js`、`lib/client.js`）。
- AVD：`emulator-5554`，1080×2400，部署新 `lib/client.js` 后通过 CDP 实测：
  - sheet 打开：`data-sol-exp-sheet="1"`，信息头 `display:flex`；
  - 信息头高 56（`12px` 顶部兜底 + `44px` 内容行），标题栏 `top=56`、高 44；
  - 关闭按钮 44×44，`top=12`；
  - 视图头 44px，标题隐藏；搜索输入 44px 高、16px 字号，搜索页标题行隐藏；
  - 临时把 `--sol-exp-safe-top` 覆盖为 `34px`：信息头高 78、标题栏 `top=78`，证明安全区完全由 token 驱动；
  - 信息头/面板背景计算值为 `rgb(249, 250, 251)`（非 `rgba(0,0,0,0)`），排除首版的透明背景问题；
  - 信息头关闭按钮点击后 sheet `display:none`、`data-sol-exp-sheet` 被移除。

### 10.5 仍需回归

- 桌面/平板细指针下信息头 `display:none`、行高 38、按钮 28；建议用 Web GUI 桌面窗口做一次截图对比。
- 有 Git 仓库的工作区：SCM 行内 stage/discard 在 AVD 上实际可点（当前 AVD 工作区 `demo-docs` 非 Git 仓库，只验证了 CSS/尺寸）。
- 真机/带刘海设备上的 `env()` 实际值；当前 AVD 的 `safe-top` 走的是 12px 兜底。
- `autoOpen=false` 且 `panelWidth=0` 的关闭路径（代码已放行，建议设置页实测一次）。
- 键盘弹起、终端打开、横竖屏旋转、toast/右键菜单底部避让。

---

## 附录 A：当前代码地图

| 关注点 | 位置 |
| --- | --- |
| 手机全屏 sheet | [`grid.ts:99-131`](../src/client/layout/grid.ts#L99-L131) |
| 面板根 / 活动栏 | [`PanelRoot.ts:52-77`](../src/client/PanelRoot.ts#L52-L77)、[`PanelRoot.ts:104-133`](../src/client/PanelRoot.ts#L104-L133) |
| 顶部行样式 | [`styles.ts:4-22`](../src/client/styles.ts#L4-L22)、[`styles.ts:163-171`](../src/client/styles.ts#L163-L171) |
| 现有 coarse 规则 | [`styles.ts:37-41`](../src/client/styles.ts#L37-L41) |
| SCM 行 / hover 操作 | [`styles.ts:69-83`](../src/client/styles.ts#L69-L83)、[`ScmPanel.ts:108-139`](../src/client/scm/ScmPanel.ts#L108-L139) |
| 树视图头 | [`TreePanel.ts:248-288`](../src/client/explorer/TreePanel.ts#L248-L288) |
| 搜索页 | [`SearchPanel.ts:66-80`](../src/client/explorer/SearchPanel.ts#L66-L80) |
| 手机判定 | [`form-factor.ts:21-27`](../src/client/touch/form-factor.ts#L21-L27) |
| toast / 模态 | [`ui.ts:17-29`](../src/client/shared/ui.ts#L17-L29)、[`styles.ts:235-249`](../src/client/styles.ts#L235-L249) |
| 右键菜单边界 | [`ContextMenu.ts:35-45`](../src/client/explorer/ContextMenu.ts#L35-L45) |

## 附录 B：上游参考值

> 下面是“来源值”，不是规则里的直接赋值；插件侧对应 §4.7 的 `--sol-exp-*` token。

- Files 视图头：`height:38px`、`padding:0 6px 0 16px`、`border-bottom:.5px solid var(--dsw-alias-border-l3)`、`gap:4px`。
- Files 工具：`28×28`、`border-radius:var(--dsw-radius-sm)`、`svg 15×15`。
- 右栏图标按钮：`28×28`、`padding:6px`、`svg 15px`。
- 左栏根：`padding:6px 8px`、`background:var(--dsw-specific-sidebar-fill)`、`font-size:14px`。
- 主题：`--dsw-radius-sm:8px`、`--dsw-font-xs-13:13px/20px`、`--dsw-font-xxs-12:12px/18px`。
- `dsh-mobile-layout`：`--dshm-safe-top/left/right/bottom`、`--dshm-header-height:56px`、v2 预设下的 `--dshm-engine-bar:56px`、手机 chrome 按钮 44px。

## 附录 C：验收记录模板

| 项 | 设备/环境 | 期望 | 实测 | 结论 |
| --- | --- | --- | --- | --- |
| 顶部不遮挡 | Android 刘海屏 / DSH Mobile | 信息头可见，按钮不进入状态栏 |  |  |
| `env()` 兜底 | `--sol-exp-safe-top` 计算值 | ≥ `--sol-exp-top-clearance-min` |  |  |
| 标题栏下移 | sheet 打开 | `activity.top >= head.bottom` |  |  |
| touch target | 关闭/活动栏/工具 | `width,height >= var(--sol-exp-touch-target)` |  |  |
| SCM 常显 | coarse | `.sol-exp-scm-actions` display flex |  |  |
| 底部安全区 | iPhone/Android 手势条 | 终端/toast 不被遮 |  |  |
| 桌面回归 | 1280+ | 信息头 `display:none`；`activity.height == var(--sol-exp-row-height)` |  |  |
| token 审计 | 改动选择器 | 无裸 px / 裸颜色（token 定义除外） |  |  |

---

*本文是评估与实施计划，不包含已落地的代码改动。落地时请按 §6 阶段拆分提交；样式参数统一走 §4.7 的 token，并在阶段 0 先量真实安全区，再决定 `--sol-exp-top-clearance-min` 是否调整。*
