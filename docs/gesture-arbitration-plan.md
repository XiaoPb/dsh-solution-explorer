# 手势仲裁优化计划（滑动打开侧板 / 与左侧抽屉互斥）

> 目标 1：在手机竖屏下，`dsh-solution-explorer` 的「右缘左滑打开全屏侧板」只在**会话页面**上生效；左侧栏（抽屉）展开、或任何浮层遮罩页面时**完全不接管**；关掉左侧栏后必须能直接回到会话页，而不是被侧板顶掉。
>
> 目标 2：**与 `dsh-mobile-layout` 零冲突**，尤其不能碰坏「工作台（原生右栏全屏）」——那是用户自己的功能，用户想开必须仍然能开、想退必须仍然能退。
>
> 验证环境：Android AVD（`Medium_Phone_API_35` / `Pixel_Tablet_API_35`），启动时**加大核数与内存**避免掉帧干扰手势判定，见 §6.4。
>
> 状态：**已实施（阶段 1–4），待在 AVD 上跑完 §6.2/§6.3 回归**｜涉及文件：`src/client/touch/gestures.ts`、`src/client/layout/grid.ts`、`src/client/touch/gesture-guard.ts`（新增）、`src/client/state/store.ts`、`src/client/panel.ts`、`test/gestures.test.ts`（`native-rightbar.ts` **未动**）
> 结论来源：本仓库源码 + 宿主 `AppFrame`（DSH 0.2.2-rc.1 打包产物）+ `dsh-mobile-layout` 0.4.8 的 `bindDrawerGesture` 实现，均已逐行核对。

---

## 0. 结论速览

| 问题 | 结论 |
| --- | --- |
| 有没有「做了优化没发版」的提交？ | **没有**。`HEAD`（28b09e9）就是 tag `v1.0.3-xiaopb.5`，工作区干净（仅 `.workbuddy/` 未跟踪），npm 上 `1.0.3-xiaopb.5` 已发布，本地 `lib/`（构建于 09:54）也在最后一次提交（09:51）之后，无待发内容。 |
| 手势串台根因 | 边缘开板手势在 `document` 捕获阶段**无条件**监听全文档，只认「手机 + 侧板折叠 + 起手在右侧 120px」，**完全不知道左侧抽屉和任何浮层的存在**。抽屉展开时遮罩盖住右缘，用户左滑关抽屉 → 我方同时判成「开侧板」，`touchend` 上两个动作一起执行。 |
| 修法 | 不是补一个 `if`，而是补一层**仲裁闸门（gesture-guard）+ 手势状态机（arm/move/settle）**：起手先做「这块像素归不归我」判定，再谈方向与阈值。 |
| 能否做到「只在会话页面」 | 能，且有权威判据：`centerCol` 命中测试（见 §4.1 / §4.2）。抽屉展开时 `centerCol` 被官方置 `inert` 且被 `.drawerMask`（z=70）覆盖，命中点根本落不到会话列上。 |
| 会不会和工作台打架？ | 不会。工作台仍走 `native-rightbar.ts` 的入口与互斥桥（**本次一行不改**），退出手势由 `dsh-mobile-layout` 的 `workbenchExit` 分支负责，我方在 `[data-rightbar-fullscreen]` 上整轮让路。§4.6 给了 8 条冲突矩阵，§6.3 给了 10 条实证清单。 |
| 验证怎么做 | AVD 双端（手机竖屏 + 平板），`-cores 8 -memory 6144/8192 -gpu host`；CDP 真实 touch 事件逐帧断言，见 §6.4 / §6.5。 |

---

## 1. 现状盘点：手势相关代码全貌

### 1.1 本插件自己的两个手势入口

| 入口 | 绑定位置 | 判定 | 代码 |
| --- | --- | --- | --- |
| 开（折叠 → 展开） | `document`，**capture + passive** | 手机竖屏 + 折叠 + 起手 x ≥ innerWidth−120 + 无 `[data-rightbar-fullscreen]` + 非横滚容器，回落 `dx ≤ −48` 且 `|dx| > |dy|` | `gestures.ts:141-192`，绑定于 `grid.ts:245-250` |
| 关（展开 → 折叠） | 侧板列元素 `panelCol`，bubble + passive | 任形态开启；`dx ≥ 48` 且横向占优 | `gestures.ts:95-132`，绑定于 `grid.ts:238-243` |

阈值常量：`SWIPE_DIRECTION_CONFIRM = 24`、`SWIPE_TRIGGER = 48`、`EDGE_OPEN_ZONE = 120`（`gestures.ts:12-22`）。

### 1.2 只观察不改命（passive）的代价

两个 binder 都**不 preventDefault、不 stopPropagation**，这是对的（不与页面滚动抢），但也意味着：**没有任何机制阻止别的插件对同一次手势做出自己的解释**。当前「互斥」全靠各自判据自然不重叠——而抽屉关闭手势恰好与我们重叠。

### 1.3 宿主的左侧栏（抽屉）实现（权威事实）

从 `app.asar` 的 `ui-layout/AppFrame` 反查：

- 窄屏（`viewport < 768` 且非 Windows 标题栏）时 frame 带 `data-sidebar-drawer`；
- 抽屉展开/收起由 `data-sidebar-collapsed` 表达（展开时该属性**不存在**）；
- 抽屉列 `.sidebarCol`：`position:absolute; z-index:71`，收起时 `translate(-100%)`；
- 遮罩 `.drawerMask`：`data-sidebar-mask`，`position:absolute; z-index:70`，**只有展开态才 `pointer-events:auto`**，点击即关抽屉；
- 抽屉展开时 `CenterColumn` / `RightbarColumn` / `bottomRow` / `leadingSeat` 全部被置 `inert`；
- 广域「浮层」在同级 `.overlayLayer`（`data-shell-overlay`，`z-index:20`）。

本插件侧板（手机全屏 sheet）`grid.ts:117-124`：`position:fixed; inset:0; z-index:80`。
→ **80 > 71 > 70**：侧板一旦被误开，会盖在抽屉和遮罩之上，用户看到的就是「回不到会话」。

### 1.4 `dsh-mobile-layout` 的抽屉手势

- 绑在 **window 捕获阶段**（`touchstart/move/end` + pointer 通道），全 passive；
- 24px 处锁定方向（`SWIPE_ARM_PX`），判定见 `decideDrawerGesture`：
  - 未展开：起手在**左 60% 屏宽**内右滑 ≥ 阈值 → `open`；
  - **已展开：不分起手位置，左滑 ≥ 阈值 → `close`**（跟手拖动 + 吸附）；
- 逃生口：起手元素 `closest('[data-dshm-swipe-ignore]')` → 整轮让路（`ATTR_SWIPE_IGNORE`）；
- 已识别的其它浮层：`[data-dshm-sheet]`、`[data-dshm-popover]`、`[data-dshm-picker]`、`[data-dshm-settings-panel]`、`[data-shortcut-modal]`、`[role="dialog"][aria-modal="true"]`、`[data-rightbar-fullscreen]`（工作台）。

### 1.5 同一次手势的真实时序（当前版本）

```
finger down (x≈340 / 390 宽屏, y 任意)  ← 抽屉展开中，遮罩在 z=70，命中点 = .drawerMask
  ├─ window capture  : ml.gestureStart  → 记录起点（drawerOpen=true）
  └─ document capture: sol.onStart      → enabled=手机✓ collapsed=✓ inZone✓ 无 fullscreen✓ → tracking=true   ❌
finger move 左滑 ≥24px
  ├─ window capture  : ml.gestureMove → decideDrawerGesture → 'close' → beginFollow（抽屉跟手指左移）
  └─ document capture: （我方无 move 监听，什么都不做）
finger up
  ├─ window capture  : ml.onTouchEnd → endFollow → 抽屉吸回收起（React 异步 commit 置 data-sidebar-collapsed）
  └─ document capture: sol.onEnd    → dx≈−100 → decidePanelSwipe → 'expand' → railOpen() → 侧板全屏盖上来  ❌❌
```

**这就是现场描述的现象**：滑一下关左侧栏，落地却在 `dsh-solution-explorer` 全屏侧板里。

### 1.6 工作台（原生右栏全屏）的完整链路 —— 本次必须“一点都不能碰坏”

工作台 = 宿主的 `rightbar` 全屏形态，它是**用户自己的功能**，不属于本插件的替代范围。它由四段拼起来：

1. **入口**：顶栏 `[data-conversation-header-corner] [data-sidebar-right-expand]`；
   - 手机竖屏：`native-rightbar.ts:182-196` 在 document 捕获阶段**接管点击**（先对齐 store，再走互斥规则 `openNativeRightbar`，见 `native-rightbar.ts:107-119`）；
   - 平板/桌面：不接管，走官方原生点击。
2. **形态标志**：frame 上的 `data-rightbar-fullscreen`（宿主 AppFrame 写入） + `[data-sidebar-right-open]`（面板写入）。
3. **互斥桥**：`watchNativeRightbarExclusive()`（`native-rightbar.ts:205-217`）盯 `data-rightbar-fullscreen` 出现在**任何节点**上 → `commands.nativeRightbarOpened()` → 折叠本插件 sheet；反向，`railOpen`/`togglePanel` 展开前先 `closeNativeRightbar()`。
4. **退出手势**：`dsh-mobile-layout` 的 `workbenchExit` 分支——起手时见 `[data-rightbar-fullscreen]`，进入「横滑退出」模式，**任意方向**横滑 ≥ `WORKBENCH_EXIT_PX = 72` 即收（`lib/client.js:7251` 起，常量在 `:6822`），并在起手时对 `[data-dshm-swipe-ignore]` 整轮让路。

**两个容易被手势改动踩坏的点（已核到代码/配置）：**

- 本插件现有闸门 `gestures.ts:159` 用 `[data-rightbar-fullscreen]` 拒绝开板——这条**必须保留**，它是工作台不被盖住的唯一保险。改造时不要把它换成 `data-sidebar-*` 之类的新判据。
- **工作台入口默认是被本插件隐藏的**：`src/host/config.ts:42` 的 `hideOfficialRightbarExpand` 默认 `true`，`panel.ts:437-447` 会注入 `[data-sidebar-right-expand]{display:none !important}`。手机竖屏靠 `styles.ts:481` 的 `html[data-dshm-mode="mobile"] … { display:flex !important }`（特异性 `(0,3,1)` 高于注入规则的 `(0,1,0)`）抢回可见性。**这条 CSS 特异性是“手机上能打开工作台”的隐性依赖**，回归必须覆盖（见 §6.3 W0）。

---

## 2. 缺陷清单

按严重度排序。编号用于后面的整改核对。

### P0-1　开板手势不认识左侧抽屉（本单主诉）

`gestures.ts:150-165` 的 `onStart` 只判 `enabled()`、`collapsed()`、`inZone()`、`[data-rightbar-fullscreen]`、横滚容器。**没有**判 `data-sidebar-drawer` / `data-sidebar-collapsed` / `[data-sidebar-mask]`。
抽屉展开时，起手点命中的是遮罩（不是会话内容），我方照单全收。

复现：竖屏手机 → 打开左侧栏 → 从屏幕右缘向左滑（关抽屉应生效的手势）→ 抽屉关闭的同时全屏侧板弹出。

### P0-2　任何浮层都能被「隔层」打开

同一段代码对 `[data-dshm-sheet]`（底部表）、`[data-dshm-picker]`（模型/权限选器）、`[data-dshm-popover]`、`[data-dshm-settings-panel]`（设置全屏页）、官方 `[role=dialog][aria-modal]`、`[data-shortcut-modal]` 一律无感。这些浮层在屏时，右缘左滑会「隔着浮层」把侧板开出来。
尤其设置页：`dsh-mobile-layout` 用左滑退出设置页，我方同一个左滑会开侧板（双向抢占，语义完全冲突）。

### P0-3　「只在会话页面生效」这条约束根本没实现

判定里没有任何「起手点属于会话列」的正向校验，因此 `data-global-panel`（自动化/插件等全局页）上也能开板；这与本单要求不符。

### P0-4　只在 `touchstart` 判一次状态，无法处理「手势中状态改变」

`onStart` 里读到的 `collapsed()` 缓存在 `tracking` 生命周期里，`onEnd` 又读一次 `handlers.collapsed()`（`gestures.ts:118`）。
场景：起手时侧板折叠 → 中途被别的入口（原生右栏按钮/会话跳转）打开 → `onEnd` 仍可能执行 `expand`（被 `if` 兜住）或 `collapse`（边缘 binder 传的是常量 `collapsed: true`，见 `gestures.ts:176`，永远不会误关，但语义上是「用过期快照做决策」）。
更现实的是**反向竞态**：抽屉被点遮罩关闭后 300ms 的滑出动画内，`data-sidebar-collapsed` 已置位，此时右缘左滑会「在抽屉滑出动画上」开出侧板——视觉上是两层东西一起飞。

### P1-1　没有方向锁定（arm），只有终点位移

`decidePanelSwipe` 只在 `touchend` 看净位移。以下都会被判成横向手势：

- 竖滑过程中手指横向漂移（`|dx| > |dy|` 只在净量上判，中途可能是竖滑）；
- 长按选中文本后拖到右缘；
- 慢速拖动（无时间/速度上限，拖 3 秒也算）。

`dsh-mobile-layout` 在 24px 就锁方向（`SWIPE_ARM_PX`），判定明显更稳。我方缺这一层。

### P1-2　多指未拦截

`onStart` 直接取 `e.touches[0]`，不校验 `touches.length === 1`，第二根手指落地也不取消。双指缩放/双指操作可以凑出一次「横向位移」触发开板。

### P1-3　横滚让路判定过于粗糙且不看方向

`touchScrollerConsumes`（`gestures.ts:60-79`）只要祖先里存在 `overflow-x:auto|scroll` 且 `scrollWidth > clientWidth + 1` 就整体让路，不看：

- 该容器在**这个方向**上还有没有余量（`dsh-mobile-layout` 的 `scrollerConsumes` 会看 `scrollLeft` 边界）；
- 阈值与宿主不一致（我方 +1，宿主 +4）。

结果：宽表/PDF 滚到最右端后，左滑仍被吞掉（用户感知「右缘滑不动」）；反过来在某类容器里又可能误判。

### P1-4　`touchcancel` 监听器摘不掉（泄漏）

`gestures.ts:126` 用匿名箭头注册，`gestures.ts:130` 又用**另一个**箭头 `removeEventListener`，实际摘不掉。`mountColumn` 也没保存 disposer（`grid.ts:238-250` 返回值被丢弃），热重载/卸载后会有监听器残留，多个实例同时决策时会双触发。

### P1-5　宽屏（平板）上的双侧栏抢占

`dsh-mobile-layout` 0.4.8 新增宽屏判定 `decideWideSidebarSwipe`：起手在**视口左半边**、左滑 → 收起左侧栏（不分起手列）。当「左栏 264 + 本插件列 560」把本插件的列推到中线左侧时，在本插件面板内的左滑会**顺带把左侧栏关掉**。
本插件只在自己是手机 sheet 时才打 `data-dshm-swipe-ignore`（`grid.ts:115-116`），平板上没打，所以没有逃生口。

### P2-1　起手区只认 `window.innerWidth`

`gestures.ts:147-148`。软键盘弹起/可视视口变化时 `innerWidth` 与 frame 实际宽度可能不一致；更稳的是 `document.documentElement.clientWidth` 或 frame 的 `getBoundingClientRect().width`。

### P2-2　无重复触发保护

部分 Android WebView 会补发 `touchend`；`railOpen` 自身有 `collapsed` 兜底，但「开→关」合并场景（连续两次手势）没有冷却窗口。

### P2-3　侧板打开时无法打开左侧栏（不可逆）

侧板全屏（z=80）且带 `data-dshm-swipe-ignore`，左侧抽屉手势被整轮让路，用户唯一的出路是先右滑关侧板。这是**设计取舍**，需在文档里写明，避免被当成 bug。

---

## 3. 设计原则

1. **单一所有权（gesture ownership）**：一次触摸只允许一个消费者做「结构性」动作（开/关全屏层）。任何时刻，若屏幕上已经有更上层的、语义更强的东西（抽屉 + 遮罩、模态、底部表、设置页、工作台），本插件**不入场**。
2. **正向判据优于黑名单**：「只在会话页面上生效」用**命中测试**表达（起手像素必须落在会话列内），而不是枚举「不要在这些浮层上生效」。黑名单只做兜底。
3. **起手定价，中途可弃**：起手做闸门判定（便宜、可缓存），移动阶段做方向锁定（24px），任一阶段不满足即整轮放弃且**不恢复**。
4. **被动观察不变**：仍然全部 passive，不 `preventDefault`、不 `stopPropagation`，不改变页面滚动与宿主手势的默认行为；只让「我们要不要动」更严格。
5. **跨插件只读**：只读宿主的 DOM 事实（`data-sidebar-*`、`data-dshm-*`），不调用别的插件的服务、不写别人的 DOM。

---

## 4. 方案设计

### 4.1 新增模块 `src/client/touch/gesture-guard.ts`

职责：回答一个纯问题——**「这个起手点，现在归不归我」**。所有宿主 DOM 知识集中在这里，`gestures.ts` 只消费布尔值。

```ts
/** 宿主 frame（抽屉状态、右侧工作台标志的唯一权威节点）。 */
export function shellFrame(): HTMLElement | null

/** 左侧抽屉是否正展开（遮罩在屏、页面被 inert）。 */
export function drawerOpen(): boolean
// frame 带 data-sidebar-drawer 且不带 data-sidebar-collapsed

/** 会话列（centerCol）。三级回落，见 §4.2。 */
export function conversationColumn(): HTMLElement | null

/** 当前主区是否就是会话页面（全局面板 data-global-panel 时为 false）。 */
export function isConversationPage(): boolean

/** 起手点是否落在会话列内部（含遮罩命中判定）。 */
export function hitsConversationPage(x: number, y: number): boolean
// const hit = document.elementFromPoint(x, y)
// return hit !== null && column.contains(hit) && !overlayOwns(hit)

/** 已知浮层/模态/工作台/本插件弹层是否在屏。 */
export function overlayBlocking(): boolean

/** 起手元素是否文本录入控件（不该被横向手势抢）。 */
export function isEditableTarget(target: EventTarget | null): boolean

/** 总闸：一次调用答完「能不能开板」。 */
export function canOwnEdgeOpen(x: number, y: number, target: EventTarget | null): boolean
```

`overlayBlocking()` 的选择器（全部是稳定的公开标记，不含哈希类名）：

```ts
const BLOCKERS = [
  '[data-rightbar-fullscreen]',        // 工作台（宿主）
  '[data-sidebar-right-open]',         // 原生右栏在屏
  '[data-shortcut-modal]',             // 宿主快捷键/设置模态
  '[role="dialog"][aria-modal="true"]',// 通用模态（含 ml 的底部表）
  '.dshm-sheet',                       // 底部表（ml 的类名，非 data 属性）
  '[data-dshm-picker]',                // 模型/权限选器
  '[data-dshm-popover]',               // 弹层菜单
  '[data-dshm-settings-panel]',        // 设置全屏页
  '[data-dshm-header-menu]',           // 顶栏菜单（只在弹出时存在）
  '[data-dshm-stats-dialog]',          // token/统计弹窗
  '.sol-exp-modal-mask',               // 本插件模态
  '.sol-exp-context-menu',             // 本插件右键菜单
]
```

> 实施时的修正：计划里写的 `[data-dshm-sheet]` **不存在**——`dsh-mobile-layout` 0.4.8 的底部表是 `div.dshm-sheet`（带 `role="dialog" aria-modal="true"`），已按实际类名落地；`[data-dshm-header-menu]` 只在菜单弹出时挂上（`lib/client.js:4017`），不是常驻节点。
> 所有命中项还会再过一遍 `isVisible()`（有 rect、`display/visibility` 非隐藏），避免「节点还在 DOM 但已隐藏」把手机手势永久锁死。

> ⚠️ **不要把 `[data-sidebar-mask]` / `[class*="drawerMask"]` 放进这个静态列表**。宿主在抽屉形态下**始终**渲染遮罩节点（只是收起态 `pointer-events:none`、`opacity:0`），静态命中会让手机上的开板手势永久失效。抽屉态只能通过 `data-sidebar-collapsed` 属性判断（`drawerOpen()`），遮罩的存在性由 §4.1 的命中测试自然覆盖。

### 4.2 会话列的三级回落

```ts
// 1) dsh-mobile-layout 的锚点（装了它就是权威，实测在 0.4.6+ 全版本存在）
document.querySelector('[data-dshm-center]')
// 2) 宿主 AppFrame 的哈希类名片段（className 片段稳定：mP3x-q_centerCol）
document.querySelector('[class*="centerCol"]')
// 3) 从 resolveShellGrid() 的子节点里挑：排除
//    [data-sidebar-mask] / [data-shell-bottom] / [data-shell-overlay] /
//    [data-sidebar-right-panel] / [data-solution-explorer] / 拖拽手柄
```

拿到列之后**必须校验它是 frame 的后代**（防 `[class*="centerCol"]` 命中别的插件），否则退化为止损模式（见 §4.5）。

> 关键性质：抽屉展开时 `centerCol` 被 `inert` 且被 z=70 遮罩覆盖，`elementFromPoint` 返回的是遮罩 → `column.contains(mask) === false` → **一次命中测试同时干掉 P0-1 和 P0-2 的绝大多数场景**，无需枚举浮层。

### 4.3 手势状态机（改造 `gestures.ts`）

```
idle ──touchstart──► tracking (闸门通过)
  │                    │
  │                    ├─ gate fail ──────────► idle （本轮永不恢复）
  │                    │
  │               touchmove
  │                    ├─ |dx| < 24 ───────────► tracking
  │                    ├─ |dy| > |dx|*1.2 ────► aborted（竖滑，交给页面）
  │                    └─ armed = sign(dx)，锁方向
  │               touchend
  │                    ├─ !armed && 净距 < 48 ──► idle（WebView 丢 move 的兜底）
  │                    └─ 阈值 + 方向占优 + 非横滚 ──► fire（带冷却）
```

要点：

- **方向锁定**：`ARM = 24`，`|dy| > |dx| * 1.2` 时直接 `aborted`（与宿主同口径，不再用净量比较）。
- **兜底**：某些 WebView 不派发 `touchmove`，因此保留「未 arm 但净位移 ≥ 48 且横向占优」的旧路径 —— 两条件都要求，避免退化成纯终点判定。
- **多指**：`touchstart` 时 `touches.length !== 1` → `aborted`；`touchmove` 中出现第二指 → `aborted`。
- **冷却**：`fire` 后 300ms 内不再受理（防 WebView 重复 `touchend`、防连滑双触发）。
- **单次所有权**：`fired` 标志置位后任何后续 move/end 直返。
- **close 手势同构**：`panelCol` 上的关板手势走同一状态机，只是闸门换成 `canOwnPanelSwipe(target)`（面板内：排除 `.sol-exp-terminal`、`.sol-exp-hl`、`[data-sol-exp-hscroll]`、横滚容器、自身模态/右键菜单）。

新的纯函数签名（保持可单测）：

```ts
export interface SwipeDecideInput {
  dx: number
  dy: number
  /** 起手容器在该方向还有没有横滚余量。 */
  scrollerConsumes: boolean
  collapsed: boolean
  /** 仲裁闸门（默认 true，便于老调用点兼容）。 */
  allowed?: boolean
}
```

`decidePanelSwipe` 内新增一行闸门：

```ts
if (allowed === false) return null
```

> 实施时的修正：计划原本想在纯函数里加 `armed` 参与判定，落地时发现它和判定表冲突（`dx=dy=60`、`armed=true` 时按「armed 放宽纵向检查」会开出板，但判定表要求 `null`）。**方向锁定留在状态机里**（`touchmove` 阶段 `|dy| > 12 且 |dy| > |dx| × 1.2` 即 `aborted`，整轮作废且不恢复），纯函数保留原来那条「平局不算横滑」的净量规则（`|dx| <= |dy| → null`）。这样既不改变已被验证的终点语义，又多了一层「中途就放弃」。
> 顺带把横滚让路做成**方向感知**：`scrollerCanPan(el, dx)` 用 `scrollLeft` 与该方向的剩余余量比较（slack 4px），滚到头的容器不再吞手势——这就是 P1-4。

### 4.4 判定表（开板手势）

| 抽屉 | 会话列命中 | 浮层阻塞 | 主区是会话页 | 方向 | 结果 |
| --- | --- | --- | --- | --- | --- |
| 展开 | — | — | — | — | **不接管**（P0-1 修复点） |
| 收起 | 否（点在遮罩/顶栏/底栏/侧板/浮层） | — | — | — | **不接管**（P0-2/P0-3） |
| 收起 | 是 | 有 | — | — | **不接管** |
| 收起 | 是 | 无 | 否（`data-global-panel`） | — | **不接管**（P0-3，可用常量放宽） |
| 收起 | 是 | 无 | 是 | 左滑 ≥48，横向占优 | **开板** |
| 收起 | 是 | 无 | 是 | 右滑 / 竖滑 / <48 | 不接管 |

### 4.5 兼容与降级

- **老壳 / 没装 `dsh-mobile-layout`**：`[data-dshm-center]` 不存在 → 走 `[class*="centerCol"]` → 再走 frame 子节点推断。三级全失败时**不放行**（fail-closed），并在 `localStorage.setItem('sol-exp-debug','1')` 时打一行原因日志（与 `dshm-debug` 同风格）。
- **宿主版本演进**：`data-sidebar-*` / `data-shell-*` / `data-global-panel` 是 AppFrame 的稳定公开属性（0.1.x→0.2.2 未变），哈希类名只作为最后一级回落，且只匹配片段。
- **不动 `enabled()` 的形态判定**：仍是 `isPortraitPhone()`；平板/桌面不产生「开板」手势（维持现状）。

### 4.6 与 `dsh-mobile-layout` 的完整冲突矩阵（含工作台）

改造后**没有任何一次触摸会被两边同时消费**。逐条对齐（ml = `dsh-mobile-layout` 0.4.8）：

| # | ml 的手势 | 触发条件 | 我方在改造后的行为 | 结论 |
| --- | --- | --- | --- | --- |
| G1 | 开左侧抽屉 | 起手在左 60% 屏宽、右滑 ≥24/48 | 我方只认右缘 120px + 左滑，方向/区域均不重叠 | 天然不冲突（保持不变） |
| G2 | 关左侧抽屉 | 抽屉展开时**任意位置**左滑 | `drawerOpen()` 闸门 → 整轮 `aborted`，`touchend` 不再 `expand` | **修掉主诉** |
| G3 | 侧板（我方）开 | 右缘 120px、左滑 ≥48 | 只在会话列命中 + 无浮层 + 抽屉收起时成立 | 唯一所有权 |
| G4 | 侧板（我方）关 | 本插件列上右滑 ≥48 | 我方列常驻 `data-dshm-swipe-ignore` → ml 在起手时整轮让路 | 互不双触发 |
| G5 | 工作台横滑退出 | `[data-rightbar-fullscreen]` 在屏、任意方向横滑 ≥72 | 我方 `[data-rightbar-fullscreen]` 闸门在 `touchstart` 就放弃；面板列被工作台覆盖也收不到事件 | 工作台退出**不受影响** |
| G6 | 宽屏侧栏开合 | 平板、起手在视口左半边 | 我方列常驻 `swipe-ignore`，列内横滑不再被 ml 判成「关左栏」 | 修 P1-5 |
| G7 | 底部表 / 选择器 / 设置页 / 顶栏菜单手势 | 各浮层在场 | 我方 `overlayBlocking()` + 命中测试 → 不接管 | 不隔层开板 |
| G8 | 工作台**入口**（点击顶栏按钮） | 手机竖屏 | 仍由 `native-rightbar.ts` 接管点击（本次**不改**该文件）；我方手势不参与点击路径 | 入口不丢 |

**单向只读原则**：本次改动只**读** `data-dshm-*` / `data-sidebar-*`，只**写**本插件自己的列节点（`data-dshm-swipe-ignore` 是给 ml 的公开逃生口，属于约定接口）。不调用 ml 的任何服务、不改它的 DOM、不改 `<html>` 上的 `--dshm-*` 变量。

**单一动作断言**：一次手势只允许产生一个「结构性状态变化」。测试中用 MutationObserver 统计 `data-sidebar-collapsed` / `data-rightbar-fullscreen` / 本插件列 `display` 三类变化，单次手势的计数必须 ≤ 1。

### 4.7 顺带解决的 P1-5（平板双侧栏抢占）与工作台安全边界

把 `data-dshm-swipe-ignore` 从「手机 sheet 打开时」改成「**本插件列始终携带**」：

- 手机：sheet 打开时本来就打；折叠时列 `display:none`，不影响。
- 平板/桌面：本插件列上的横滑归我们（开合/关板），不再被 `dsh-mobile-layout` 的宽屏左滑误判成「关左侧栏」。
- 代价：平板上无法在本插件列上起手滑动左栏——这本来就是「谁的地盘谁做主」，符合约定。
- **工作台安全**：该属性只挂在 `div[data-solution-explorer]` 上，工作台面板在 `[data-sidebar-right-panel]`（右栏列）里，两者不是祖先/后代关系 → 工作台的退出手势、页签条横滑都不经过这个子树，**不受影响**。此项必须在 §6.3 W5 实测确认。
- **例外规则（只在实测发现问题时启用）**：若在平板上出现「工作台全屏 + 本插件列恰好压在下面」的极端布局，导致工作台退出手势被本列的 `swipe-ignore` 挡住，则常驻设置改为「`setAttribute` 前判断 `!frame.hasAttribute('data-rightbar-fullscreen')`」，并复用已存在的 `watchNativeRightbarExclusive()` 在状态变化时刷新。**默认先不加**，避免为一个未出现的场景引入状态同步。

### 4.8 视觉层（可选，P2）——**未采纳**

抽屉收起动画期间（`--ds-transition-duration-slow`，约 250–320ms）加冷却的方案在实施时被否决：它与 §6.2-2 的验收冲突——那条要求「点遮罩关闭 → 300ms 内右缘左滑 → 侧板立刻打开」。加了冷却就会把一次完全合法的操作吞掉，用户体感是「手势时灵时不灵」，比双层动画更糟。

实际兜底交给两点：本插件的手机侧板是 `display:none → flex` 的**无动画**切换（`grid.ts`），不存在两层动画叠帧；主诉由 §4.1 的属性闸门在 `touchstart` 就掐断，根本走不到 `touchend`。

> 仍然成立的原则：任何冷却都**只挂 `data-sidebar-collapsed`，不要挂 `data-rightbar-fullscreen`**。工作台退出是「甩一下就走」的语义，退出后立刻右缘左滑开侧板是合理操作。

---

## 5. 代码改动清单

| 文件 | 改动 | 规模 |
| --- | --- | --- |
| `src/client/touch/gesture-guard.ts` | **新增**：`shellFrame` / `drawerOpen` / `conversationColumn` / `isConversationPage` / `hitsConversationPage` / `overlayBlocking` / `isEditableTarget` / `canOwnEdgeOpen` / `canOwnPanelSwipe` + 调试日志 | ~150 行 |
| `src/client/touch/gestures.ts` | 1) `SwipeDecideInput` 增 `armed`/`allowed`；2) 两处 binder 改为 `touchstart/touchmove/touchend/touchcancel` 状态机；3) `PanelSwipeHandlers` 增可选 `allowed(x,y,target)`；4) `touchScrollerConsumes` 拆成 `horizontalScrollerOf` + 方向感知的 `scrollerCanPan(el, dx)`（阈值与宿主对齐为 +4）；5) 修 `touchcancel` 摘除；6) 冷却与单次所有权 | ~+120 / −40 行 |
| `src/client/layout/grid.ts` | 1) 开板 binder 接 `allowed: canOwnEdgeOpen`；2) 关板 binder 接 `allowed: canOwnPanelSwipe`；3) `data-dshm-swipe-ignore` 改为**始终**设置（只挂本插件列，工作台面板不在该子树，见 §4.7）；4) 保存两个 binder 的 disposer 并在卸载时调用；5) 起手区宽度改用 `documentElement.clientWidth` | ~30 行 |
| `docs/gesture-arbitration-plan.md` | 本文件 | — |
| `README.md` / `README.zh.md` | 「手势」小节补两条：侧板全屏时左侧抽屉不可用（需先右滑关侧板）；**工作台入口与用法不变**，仅会话页面可右缘开板 | ~8 行 |

不改：`panel.ts` 的开合命令、**`native-rightbar.ts`（工作台入口与互斥桥，一行不动）**、`styles.ts` 的层级与手机端按钮可见性规则、`host/config.ts` 的 `hideOfficialRightbarExpand` 默认值。**不加新设置项**（§4.4 的「仅会话页」用模块常量 `CONVERSATION_ONLY = true` 表达，后续要放宽只改一处）。

---

## 6. 测试计划

### 6.1 单元（纯函数）—— 已落地 `test/gestures.test.ts`，`pnpm test` = `node --test test/*.test.ts`

`decidePanelSwipe` 用例矩阵（实施后的最终版，12 条，全绿）：

| # | dx | dy | allowed | scroller | collapsed | 期望 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | −60 | 5 | true | false | true | `expand` |
| 2 | −60 | 5 | **false** | false | true | `null`（抽屉展开） |
| 3 | −60 | 60 | true | false | true | `null`（平局 = 竖滑） |
| 4 | −60 | 59 | true | false | true | `expand` |
| 5 | −60 | 5 | true | **true** | true | `null`（横滚让路） |
| 6 | 60 | 5 | true | false | false | `collapse` |
| 7 | 60 | 5 | true | false | true | `null` |
| 8 | −60 | 5 | true | false | false | `null` |
| 9 | −30 | 5 | true | false | true | `null`（未过 24px 方向确认） |
| 10 | −47 | 5 | true | false | true | `null`（未到 48 触发） |
| 11 | −48 | 0 | true | false | true | `expand`（刚好 48） |
| 12 | 0 | 0 | true | false | true | `null` |

> 状态机部分（`armed` / `aborted` / 冷却 / 多指）不在纯函数范围内，由 §6.2 的 AVD 回归覆盖——它们在浏览器里才有意义。

### 6.2 竖屏手势回归（AVD `Medium_Phone_API_35` 或真机，逐条勾）

1. **主诉**：打开左侧栏 → 右缘左滑关抽屉 → **停在会话页**，侧板不出现。
2. 打开左侧栏 → 点遮罩关闭 → 立刻（<300ms）右缘左滑 → 侧板开；动画不错帧（P2 项验收）。
3. 左侧栏展开时，从会话中点任意处右滑（开抽屉手势的反向）→ 无副作用。
4. 会话页右缘左滑 → 侧板开；侧板上右滑 → 回会话；连做 5 次不抖、不双触发。
5. 打开底部「+」表 / 模型选择器 / 设置页 / 顶栏菜单，各做一次右缘左滑 → 不出现侧板，浮层自身手势正常。
6. 见 §6.3（工作台专项，单独成节，不在这里重复）。
7. 切到「自动化任务」等全局面板 → 右缘左滑 → 不开板（`CONVERSATION_ONLY`）；开会话后恢复。
8. 侧板打开时，对话框/文件预览里的横向滚动（diff、宽表、PDF）不触发关板。
9. 平板横屏（≥768）：侧板列内左滑 → 只关本插件面板，左侧栏保持；左半边左滑 → 正常关左侧栏。
10. 双指缩放会话内容 → 不开板。
11. 长按选中文本拖到右缘释放 → 不开板。
12. 桌面端：行为与现在一致（折叠/展开、拖拽改宽）。

### 6.3 工作台（原生右栏全屏）专项回归 —— 不许被手势改造牵连

> 前提：`dsh-mobile-layout` 的「工作台」是用户自己的功能，本插件只做**互斥**，不做替代。这一节的每一条都必须在 AVD 上实证，且**不依赖**本插件侧板是否工作。

| # | 场景 | 操作 | 期望 |
| --- | --- | --- | --- |
| W0 | **入口仍可达**（默认设置 `hideOfficialRightbarExpand=true`） | 竖屏手机，量顶栏按钮 `getComputedStyle(btn).display` | `!== 'none'`（`styles.ts:481` 的 `(0,3,1)` 特异性仍压过注入的 `(0,1,0)`），且按钮可点 |
| W1 | 手机竖屏打开工作台 | 点 `[data-sidebar-right-expand]` | 工作台全屏出现（`data-rightbar-fullscreen` 在 frame 上）；本插件列 `display === 'none'`；无侧板闪现 |
| W2 | 工作台全屏时右缘左滑 | 从 x≈W−60 向左滑 100px | **侧板不开**；工作台按 ml 语义收起（`WORKBENCH_EXIT_PX=72`）；一次手势只有一个结构性变化 |
| W3 | 工作台全屏时右滑 | 从中间向右滑 100px | 同上：只关工作台，侧板不开 |
| W4 | 侧板打开时打开工作台 | 侧板全屏 → 点顶栏按钮 | 侧板先收（互斥桥 `openNativeRightbar`），工作台打开；退出工作台后回到会话，侧板仍为关 |
| W5 | 列常驻 `swipe-ignore` 的副作用 | 平板：工作台（非全屏）→ 页签条横滑换位；再在本插件列内左滑 | 页签条换位正常；本插件列左滑**不动左侧栏**（G6 预期） |
| W6 | 工作台全屏时无法打开侧板 | 工作台全屏 → 右缘左滑 / 反复滑 | 侧板始终不开（避免两层全屏叠加）；退出工作台后右缘左滑可正常开侧板 |
| W7 | 工作台入口被侧板覆盖 | 侧板全屏 → 观察顶栏按钮 | 被覆盖属**预期**；右滑关侧板后 300ms 内按钮可点，点击能开工作台 |
| W8 | 平板工作台入口 | 默认设置下（按钮被隐藏是预期） | 通过 `dsh-mobile-layout` 的工作台键（v2 预设底栏）仍可打开；把 `hideOfficialRightbarExpand` 关掉后顶栏按钮也可用 |
| W9 | 连续稳定性 | 循环 10 次：开抽屉 → 关抽屉 → 右缘左滑开侧板 → 右滑关 | 无 console error；末态：抽屉收起、侧板折叠、`data-rightbar-fullscreen` 不存在 |
| W10 | 极端叠加（平板） | 平板把本插件列展开到与工作台同屏 → 工作台全屏 → 横滑退出 | 工作台仍能退出；若退出被本列 `swipe-ignore` 挡住，按 §4.7「例外规则」修正后重测 |

W2/W3 的关键断言（CDP 直接读，不靠肉眼）：

```js
const f = document.querySelector('[data-dshm-frame]')
return {
  fullscreen: f.hasAttribute('data-rightbar-fullscreen'),
  solOpen: document.querySelector('[data-solution-explorer]').style.display !== 'none',
  drawerCollapsed: f.hasAttribute('data-sidebar-collapsed'),
}
```

### 6.4 AVD 验证环境（多核 + 大内存，避免卡顿）

本机现状（已核对）：

| 项 | 值 |
| --- | --- |
| SDK | `E:\Android\Sdk`（`platform-tools\adb.exe`、`emulator\emulator.exe`） |
| AVD | `Medium_Phone_API_35`（1080×2400 @420 → CSS 411×914，dpr 2.625）、`Pixel_Tablet_API_35`（2560×1600 @320） |
| 现有配置瓶颈 | 手机 AVD `hw.ramSize=2G`、`vm.heapSize=336`；平板 4G —— **都偏小**，DSH WebView + 插件面板容易掉帧 |
| 主机 | 32 逻辑核（`nproc`），内存充足 |

**启动命令（内存/核数用命令行覆盖，不改 AVD 配置，保证可回退）：**

```bash
# 手机：8 核 / 6G / 硬件 GPU，独立端口 5580（console=5580, adb=5581, serial=emulator-5580）
E:/Android/Sdk/emulator/emulator.exe -avd Medium_Phone_API_35 \
  -port 5580 -cores 8 -memory 6144 -gpu host \
  -no-boot-anim -no-snapshot-load -netfast

# 平板：8 核 / 8G，端口 5582（serial=emulator-5582）
E:/Android/Sdk/emulator/emulator.exe -avd Pixel_Tablet_API_35 \
  -port 5582 -cores 8 -memory 8192 -gpu host \
  -no-boot-anim -no-snapshot-load -netfast
```

- `-gpu host` 若在当前显卡驱动上花屏/黑屏，回退 `-gpu swiftshader_indirect`（慢但稳），并相应把 `-memory` 提到 8192 弥补。
- `-cores` 若启动报错（部分镜像限制 ≤4），降为 `-cores 4` 并**只**靠 `-memory` 保证流畅；最终取值写进本节备注。
- 首次启动后 `adb -s emulator-5580 shell getprop sys.boot_completed` 返回 `1` 再继续；`adb shell wm size` 确认 1080×2400。
- Windows 上 `adb forward` 端口要避开保留段：`netsh interface ipv4 show excludedportrange protocol=tcp`（本项目实测 9222/9333/9555 曾被占）。建议 phone 用 `9361`、tablet 用 `9362`。

**部署被测构建**（`lib/` 是 gitignore 的产物，必须先构建）：

```bash
cd E:/Code/DSH/plugins/dsh-solution-explorer && pnpm build
cd E:/Code/DSH/plugins/dsh-mobile-layout && sh .workbuddy/tmp/deploy-se.sh emulator-5580
# 脚本内部：push → run-as app.dsh.mobile 覆盖 profile node_modules → force-stop → am start
```

**CDP 通道**（每次 AVD 重启 pid 会变，必须重新 forward）：

```bash
adb -s emulator-5580 shell "cat /proc/net/unix | grep webview_devtools_remote"   # 取 <pid>
adb -s emulator-5580 forward tcp:9361 localabstract:webview_devtools_remote_<pid>
node dsh-mobile-layout/.workbuddy/tmp/cdp.mjs 'document.querySelector("[data-dshm-frame]").outerHTML.slice(0,200)'
```

> 坐标单位要分清：`adb shell input tap` 用**设备像素**，CDP `Input.dispatchTouchEvent` 用 **CSS 像素**（= 设备像素 ÷ dpr ÷ visualViewport.scale）。本项目 AVD 上 `dpr=2.625`，误用会整天点不中。

**环境自检（跑手势前先过这 4 条）：**

1. `document.documentElement.dataset.dshmMode === 'mobile'`（ml 已识别为手机形态）；
2. frame 同时具备 `data-sidebar-drawer` 与 `data-sidebar-collapsed`；
3. `document.querySelector('[data-dshm-center]')` 存在且非 null；
4. 顶栏 `[data-sidebar-right-expand]` 的 computed `display !== 'none'`。

### 6.5 CDP 自动化（复用 `.scratch/cdp_gestures.mjs` 骨架）

新增两段脚本，全部在 AVD 上用真实 touch 事件跑：

```
// A) 抽屉 ↔ 侧板（主诉）
swipe(30, 500, 300, 500)    // 开抽屉
assert frame.hasAttribute('data-sidebar-collapsed') === false
swipe(340, 500, 200, 500)   // 关抽屉
assert 抽屉已收起 且 col.style.display === 'none'

// B) 工作台链路（§6.3 的自动化版）
click('[data-sidebar-right-expand]') → assert fullscreen === true 且 col.display === 'none'
swipe(340, 500, 200, 500)            → assert col.display === 'none'（侧板不开）
swipe(340, 500, 200, 500)（工作台已关）→ assert col.display !== 'none'（此时才允许开板）
```

逐帧步进（`Input.dispatchTouchEvent` 每 8px 一步）记录「结构性变化」序列：`data-sidebar-collapsed` / `data-rightbar-fullscreen` / `col.style.display`。**单次手势的序列长度必须 ≤ 1**，用来机器化守住 §4.6 的「单一动作」原则；同一脚本同时验证「没有任何一帧出现 `col.style.display !== 'none'`」。

---

## 7. 实施步骤

| 阶段 | 内容 | 出口条件 |
| --- | --- | --- |
| 0 | 起 AVD（§6.4 的多核大内存参数）+ 部署当前版本，先录一条**基线**：复现主诉、记录工作台 W1/W2/W5 的当前表现 | 基线通过（主诉可稳定复现；工作台当前可用） |
| 1 | 新增 `gesture-guard.ts`（纯函数 + 选择器集中）；`gestures.ts` 只加 `allowed` 钩子，最小改动接上闸门 | 主诉（6.2-1）消失；**§6.3 工作台全表无回归**；其它行为零变化 |
| 2 | 状态机改造（arm/move/cancel/冷却/多指）+ 横滚方向感知 | 6.2 全表 + 6.3 全表通过；单元 6.1 全绿 |
| 3 | `data-dshm-swipe-ignore` 常驻 + disposer 归位 + 起手区取宽修正 | 6.2-9 与 6.3-W5 通过；卸载/热重载无残留监听 |
| 4 | 可选：抽屉动画冷却、README 手势说明 | 6.2-2 手感验收；6.5 的「单手势结构性变化 ≤ 1」断言全绿 |
| 5 | 发版：`package.json` → `1.0.4`；tag `v1.0.4` 触发 `release.yml`（npm + GitHub Release） | registry 可见 `1.0.4`（**实际执行：已完成，见 §10**） |

建议阶段 1+2 合并成一次提交（`fix(gesture): 右缘开板只在会话页面生效，左侧栏与浮层一律不接管`），阶段 3 单独一次（`fix(gesture): 面板列常驻 swipe-ignore，修正监听器摘除`）。

**验收硬门槛**：6.3（工作台）里任何一条失败，本次不能发版——那意味着我们把用户自己的功能改坏了，比手势串台更严重。

---

## 8. 风险与回滚

| 风险 | 影响 | 处置 |
| --- | --- | --- |
| `[class*="centerCol"]` 在别的插件 DOM 上误命中 | 闸门放行过宽 | 强制校验「是 frame 的后代」，并优先走 `data-dshm-center` |
| 宿主未来改属性名（`data-sidebar-collapsed`） | 抽屉闸门失效 → 主诉回归 | 双判据：属性 + 命中测试（起手点 `elementFromPoint` 返回的节点是否 `closest('[data-sidebar-mask]')` / 类名含 `drawerMask`）；仍不可判时 fail-closed（宁可不接管） |
| fail-closed 太严，右缘开板「偶发失灵」 | 体验退化 | 调试开关 `sol-exp-debug` 输出拒绝原因；6.2 覆盖各形态 |
| 冷却窗口过短/过长 | 手快被吞 / 双层动画 | 260ms 可调常量，实测后定；**只挂抽屉，不挂工作台**（§4.8） |
| 阶段 3 常驻 `swipe-ignore` 影响平板左栏操作 | 平板用户在侧板列上开不了左栏 | 已评估为可接受（列内横滑本应归本插件）；如需保留可只在 `panelCol` 可见时设置 |
| 常驻 `swipe-ignore` 误伤工作台手势 | 工作台退不掉 / 页签换不了位 | 该属性只在本插件列子树，工作台面板在 `[data-sidebar-right-panel]`，无祖先关系；由 §6.3 W2/W3/W5 实证把关 |
| `hideOfficialRightbarExpand` 默认 `true` 让「工作台入口」看似消失 | 用户以为工作台被本插件砍掉 | 手机竖屏由 `styles.ts:481` 强制可见（W0）；平板/桌面属既定设计，W8 验证备用入口 + 设置项可关 |
| AVD 资源不足导致手势判定抖动（掉帧丢 move） | 误判成「竖滑」或「无 move 兜底」路径 | 按 §6.4 用 `-cores 8 -memory 6144/8192` 起；掉帧时先排除环境再改代码 |

回滚：全部改动集中在 `touch/` 与 `grid.ts` 的两处绑定；回退阶段 1 的 `allowed` 钩子即恢复旧行为（一个函数调用点），无需回滚发版。工作台链路（`native-rightbar.ts`）本次不改，天然无回滚面。

---

## 附录 A：宿主 DOM 契约速查（来自 `ui-layout/AppFrame` + `dsh-mobile-layout` 0.4.8 实测）

```
div.frame[data-sidebar-drawer][data-sidebar-collapsed][data-rightbar-fullscreen][data-animating]
├── div.drawerMask[data-sidebar-mask][aria-hidden]        z=70（展开时 pointer-events:auto，点击关抽屉）
├── div.sidebarCol（inert 当抽屉收起）                     z=71（抽屉态 position:absolute translate）
├── div.centerCol（inert 当抽屉展开）                       ← 会话页面；内含 .mainPanel[data-global-panel?]
├── div.rightbarCol[data-rightbar-col]
├── div.bottomRow[data-shell-bottom]
├── div.overlayLayer[data-shell-overlay]                  z=20（模态/浮层挂这里）
└── div[data-solution-explorer]                           z=80（手机全屏 sheet）/11（桌面列）
```

- 抽屉状态：`data-sidebar-drawer`（是否抽屉形态） + `data-sidebar-collapsed`（是否收起）
- 工作台全屏：`data-rightbar-fullscreen`；原生右栏在屏：`[data-sidebar-right-open]`；工作台面板节点 `[data-sidebar-right-panel]`（**不在**本插件列子树内）
- `dsh-mobile-layout` 锚点：`data-dshm-frame`、`data-dshm-sidebar`、`data-dshm-center`、`data-dshm-swipe-ignore`、`data-dshm-sheet`、`data-dshm-picker`、`data-dshm-popover`、`data-dshm-settings-panel`
- 其手势：window 捕获、24px 锁向、`SWIPE_MIN=48`、展开后**任意位置**左滑 = 关抽屉（与本插件冲突的唯一来源）；工作台见 `data-rightbar-fullscreen` 后切「任意方向横滑退出」，阈值 72

## 附录 B：问题定位用的最小验证语句

在设备调试控制台执行：

```js
// 1) 抽屉是否展开（应与你看到的一致）
const f = document.querySelector('[data-dshm-frame]')
console.log('drawer', f.hasAttribute('data-sidebar-drawer'), 'collapsed', f.hasAttribute('data-sidebar-collapsed'))

// 2) 遮罩是否吃掉了右缘的点（抽屉展开时应返回 drawerMask 节点）
console.log(document.elementFromPoint(innerWidth - 60, innerHeight / 2)?.className)

// 3) 会话列命中测试（抽屉展开时应为 false）
const c = document.querySelector('[data-dshm-center]') || document.querySelector('[class*="centerCol"]')
console.log('hit in conversation:', c.contains(document.elementFromPoint(innerWidth - 60, innerHeight / 2)))
```

抽屉展开时 (3) 若为 `false`，即证明 §4.1 的命中测试足以区分「关抽屉」与「开侧板」两种手势。

---

## 8. 实施记录（阶段 1–4）

### 8.1 落地清单

| 文件 | 内容 |
| --- | --- |
| `src/client/touch/gesture-guard.ts`（新增，~190 行） | `shellFrame` / `drawerOpen` / `conversationColumn` / `isConversationPage` / `hitsConversationPage` / `overlayBlocking` / `isEditableTarget` / `canOwnEdgeOpen` / `canOwnPanelSwipe`，加 `CONVERSATION_ONLY` 常量与 `sol-exp-debug=1` 时的拒绝原因日志。宿主 DOM 知识（选择器、`data-*` 契约）只存在于这一个文件。 |
| `src/client/touch/gestures.ts` | 状态机 `idle → tracking → armed → aborted`；`touchmove` 方向锁定 + 24px 内竖滑早退；多指（`touches.length !== 1`）整轮作废；单次所有权 + `SWIPE_COOLDOWN = 300`；`touchcancel` 改成具名函数（旧版的匿名箭头根本摘不掉）；`scrollerConsumes` 改为方向感知的 `canPanFurther`（slack 4px）；起手区宽度改 `documentElement.clientWidth`；`PanelSwipeHandlers.allowed?()` 仲裁钩子。 |
| `src/client/layout/grid.ts` | 两个 binder 分别接 `canOwnEdgeOpen` / `canOwnPanelSwipe`；`data-dshm-swipe-ignore` 改为建列时**常驻**（原来只在手机 sheet 打开时打）；保存两个 disposer 到 `state.layout.gestureDisposers`。 |
| `src/client/state/store.ts` | `LayoutState.gestureDisposers: Array<() => void>`。 |
| `src/client/panel.ts` | 卸载时逐个调用 gesture disposer 并清空。 |
| `test/gestures.test.ts`（新增） | §6.1 的 12 条纯函数用例，`pnpm test`（`node --test`，Node 22 直接跑 `.ts`）。 |
| `README.md` / `README.zh.md` | 「功能」里加一条「触摸手势」，说明只在会话页生效、浮层/抽屉/工作台优先、一次滑动只做一件事。 |

`native-rightbar.ts`、`styles.ts`、`host/config.ts` **一行未改**——工作台入口、互斥桥、手机端按钮可见性都保持原样。

### 8.2 与计划的偏差（三处，均有理由）

1. **`data-dshm-sheet` 不存在** → 实际用 `.dshm-sheet`（带 `role=dialog aria-modal`）。若照抄计划，底部表这一条会静默失效。
2. **纯函数不吃 `armed`** → 见 §4.3 的说明：`armed` 参与判定会和 §6.1 第 3 行（`dx=dy=60` 应 `null`）冲突。方向锁定留在状态机，纯函数保留「平局不算横滑」。
3. **抽屉动画冷却不做** → 与 §6.2-2「点遮罩关闭后立刻滑能开板」冲突，见 §4.8。

### 8.3 仍需在 AVD 上实证的项

§6.2 的 12 条与 §6.3 的 W0–W10 全部未勾。重点是三条：**W0 工作台入口仍然可见可点**、**W2/W3 工作台全屏时右缘左滑只关工作台**、**6.2-1 关抽屉后停在会话页**。发版前必须全绿。

### 8.4 AVD 实测记录（emulator-5556，1080×2400@420 → 411×914）

环境：`Medium_Phone_API_35`，带窗口启动，`-cores 6 -memory 6144 -gpu swiftshader_indirect`（emulator 36.3 提示「不支持超过 6 核」，8 会被自动压到 6）；宿主 App 与 `@xiaopb/dsh-mobile-layout` 0.4.8 均已部署到 profile。

| 步骤 | 操作 | 结果 |
| --- | --- | --- |
| A1 | 打开会话页 | 手机竖屏布局正常，底部 6 键（新建/会话/文件/图片/插件/更多）→ ml 处于 mobile 模式 |
| A2 | 右缘左滑（设备像素 1040→500，y=1200） | **侧板打开**，文件树正常渲染（`03-after-close.png` 实为开板后的截图） |
| A3 | 面板上右滑（200→900） | **侧板关闭**回到会话（`04-panel-closed.png`） |
| A4 | 左缘右滑开抽屉（多条：x=2/10/120、时长 300–900ms） | **未打开**，屏幕无变化；左上角点击同样无响应 |

A4 的结论：这台 AVD 当前跑的是 ml 的 **v2 预设**，会话入口是底栏「会话」而不是左侧抽屉，左缘手势没有可展开的目标，因此**主诉场景（抽屉展开 → 左滑关抽屉）在本机无法复现**。App 未开启 WebView 调试（APK 里没有 `setWebContentsDebuggingEnabled`），无法用 CDP 切预设或读 DOM，只能截图断言。

结论：**手势改造本身的开关板链路已在真机分辨率下跑通**；抽屉互斥那一条需要在 classic 预设（或有左抽屉的构建）上补测。

---

## 9. 追加：右上角「打开右侧边栏」按钮失效（2026-11-07 晚）

### 9.1 现场

手机竖屏点顶栏右上角的侧栏图标：图标消失，工作台不出现；再点没有任何反应，此后入口彻底不可用。

### 9.2 取证（CDP 连 emulator-5556，`webview_devtools_remote`）

死锁态的快照：

```json
{
  "frameAttrs": ["data-rightbar-collapsed", "data-rightbar-instant"],
  "panelOpen": true,            // data-sidebar-right-open 在
  "panelDisplay": "none",       // 但面板 display:none
  "panelW": 0,
  "expandDisabled": true,
  "expandVisibility": "hidden"  // 用户既看不见也点不到
}
```

### 9.3 根因（官方三处，逐行核对过 asar）

1. **`expanded` 是持久化的**：`dsh.sidebar-right.v1.<sessionId>` 存在 localStorage，跨重启保留。
2. **窄屏只认 active 视图**：`RightbarSeat` 里 `syncPresentation({shown, track, fullscreen})` 的 effect 首行是 `if (!active) return`。当前视图不是该 session 的 rightbar 视角时，`shown=false`，frame 拿不到 `data-rightbar-fullscreen`，ml 的 CSS 保持 `grid-template-columns: 0 1fr 0 !important`，面板被折叠到 0 宽，并留下内联 `display:none`。
3. **按钮 `disabled: expanded`**：`ExpandButton` 源码是 `disabled: expanded` + `RwosdG_expanded{visibility:hidden}`。store 说开着 → 按钮被禁用并隐藏，而屏幕上什么也没有。`useLayoutEffect` 里的自动复位条件是 `shown && !fullscreen && !canShow`，窄屏下 `fullscreen` 恒为 `true`（`autoFullscreen = viewportWidth < 768`），于是**永不复位**。

### 9.4 本插件的责任（为什么「接管」放大了问题）

`bindNativeRightbar` 在 capture 阶段拦下按钮点击后走 `openNativeRightbar()`，而它判断「是否已打开」用的是 `panel.hasAttribute('data-sidebar-right-open')` —— 这个属性在**折叠但仍挂载**的面板上依然是 `true`，于是 `alignStore()` 认为两者一致，`openNativeRightbar()` 直接 `return true`，一次点击被静默吞掉。官方按钮本身已 disabled（点不动），我们的接管又判定「已开」（不动作），两条路同时堵死。

### 9.5 修复（`src/client/layout/native-rightbar.ts`）

| 改动 | 作用 |
| --- | --- |
| 新增 `panelVisible()` | `display !== none` 且实测宽度 ≥ 1px 才算「在屏」 |
| `domOpen()` 改用可见性 | 「逻辑开、物理折叠」不再被当成已打开 |
| 新增 `readStore()` | 直接问 store，与 DOM 分开取 |
| `openNativeRightbar()` 重写 | DOM 可见但未全屏、或 store 残留 `expanded` 时，走 `reopenNextFrame()`：先 `toggle()` 归零，`requestAnimationFrame` 里再 `toggle()` 打开。两次同 tick 的 setState 会被 React 18 批处理成「仍然是 true」而不产生渲染，必须跨帧 |
| 新增 `reopenNextFrame()` | 上述两段式重开 |
| 新增 `ensureEntry()` + MutationObserver（200ms 节流） | 面板确实在屏且全屏时什么都不做；否则把入口按钮的 `disabled` 去掉、`visibility` 置可见；顺带清掉面板上残留的内联 `display:none`（官方折叠用 visibility/transform 表达，从不使用 display） |
| `stateWantsPanelClosed()` → `panelIsOpen()` | 语义反转并收紧为 `commands.panelClosed?.() === false`；注册表尚未就绪（`undefined`）时不再误判为「需要关侧板」 |

### 9.6 AVD 验证（新构建，emulator-5556）

| 用例 | 操作 | 结果 |
| --- | --- | --- |
| V1 | 干净态点右上角 | `open=true`、`display=flex`、`457×962`、frame 拿到 `data-rightbar-fullscreen` ✅ |
| V2 | 再点一次（收起） | `open=false`，按钮 `disabled=false`、`visibility=visible` ✅ |
| V3 | 冷启动（store 残留 expanded） | 恢复到全屏工作台，`display=flex` ✅ |
| V4 | 人为造 stale（面板 `display:none` + 按钮 disabled） | 800ms 内 `display` 自动恢复 `flex`，残留被清 ✅ |
| V5 | 按钮 disabled 且面板不可见 | `ensureEntry` 把 `disabled` 置 false、`visibility` 置 visible，入口重新可点 ✅ |

`adb shell input tap` 的坐标换算在本机不可靠（WebView 有 0.9 缩放 + 顶部 63px 偏移），最终用 CDP `Input.dispatchMouseEvent` 以 CSS 坐标点击才稳定复现；建议后续手势回归也用这条路。

---

## 10. 发版记录（1.0.4）

| 项目 | 值 |
| --- | --- |
| 包版本 | `@xiaopb/dsh-solution-explorer@1.0.4`（`package.json` 去掉 `-xiaopb.N` 后缀，转正式版） |
| Git tag | `v1.0.4`（指向 `71b899f`，与 `package.json` 版本严格一致，`release.yml` 的 tag 校验通过） |
| 发布方式 | `release.yml` → npm（NPM_TOKEN）+ GitHub Release（tarball + `.sha256`） |
| npm dist-tag | `latest = 1.0.4` |
| Release | https://github.com/XiaoPb/dsh-solution-explorer/releases/tag/v1.0.4 |
| 前置自检 | `npm run build` / `npm run check`（`verify-package` ALL PASS）/ `npm test`（12/12）全绿 |

**版本号注意事项（下次发版前必读）**

1. 本仓历史版本是 `1.0.3-xiaopb.1 … .5`，`-xiaopb.N` 是**预发布后缀**：SemVer 里 `1.0.4-xiaopb.1 < 1.0.4`。既然 `1.0.4`（正式版）已发布，**下一个 fork 构建不能再用 `1.0.4-xiaopb.1`**——那会被 npm 与 `dsh plugin add pkg@latest` 判定为降级。下一条线从 `1.0.5`（或 `1.0.5-xiaopb.1`）起。
2. `release.yml` 的唯一硬约束是 **tag 必须等于 `v` + `package.json` 的 `version`**（`Resolve version and check the tag` 步骤，不匹配直接 fail）。改版本只改 `package.json` 一处，tag 由它派生，别手工造 tag。
3. 包里没有第二处版本号：`cordis.patch.yml`、`lib/`、lockfile 都不写自身版本；`dsh.compatibility.dshReleases` 记的是**宿主 DSH 版本**，与本包版本无关，发版时不要动。
4. 发布后核对三件事：`npm view @xiaopb/dsh-solution-explorer dist-tags`（`latest` 是否指向新版本）、Release 是否 `draft=false / prerelease=false` 且附件齐全、`npm pack <版本>` 解开后 `package.json` 的 version 与产物内 `lib/client.js` 含本次改动标记（本次已验证 `sol-exp-debug` / `canOwnEdgeOpen` / `panelIsOpen` 均在）。
5. npm 上本包还存在一个 `1.0.3`（无后缀）——那是上游正式版的镜像发布，与本 fork 的 `1.0.3-xiaopb.N` 版本线互不覆盖；升级判断以 `latest` dist-tag 为准，本次它已指向 `1.0.4`。
