# 提交图（Commit Graph）：实现与验证

本插件的源代码管理面板按 VS Code 的 Source Control Graph 绘制提交历史。这份文档记录
绘制模型、与 VS Code 的对齐点、以及为什么在几处刻意偏离它。

## 目标

- 连接线在行间连续，不能出现断裂或悬空端点。
- 合并回线（次父连接）必须落在父提交真正所在的泳道。
- 视觉规格与 VS Code 一致：泳道宽度、圆角半径、节点形状、配色、绘制顺序。

## 实现来源

不是照外观模仿，而是逐条对齐官方实现：

- 绘图：[`scmHistory.ts`](https://cdn.jsdelivr.net/gh/microsoft/vscode@main/src/vs/workbench/contrib/scm/browser/scmHistory.ts)
  的 `renderSCMHistoryItemGraph` 与 `toISCMHistoryItemViewModelArray`。
- 样式：[`scm.css`](https://cdn.jsdelivr.net/gh/microsoft/vscode@main/src/vs/workbench/contrib/scm/browser/media/scm.css)
  （`media/scmHistory.css` 在 main 上不存在；svg 的尺寸是内联的，只有圆描边来自 CSS）。
- 调用方：[`scmHistoryViewPane.ts`](https://cdn.jsdelivr.net/gh/microsoft/vscode@main/src/vs/workbench/contrib/scm/browser/scmHistoryViewPane.ts)，
  从这里可以确认"当前分支引用色"是如何注入 `colorMap` 的。

## 三层结构

| 层 | 文件 | 职责 |
|---|---|---|
| 几何 | `src/client/scm/graph-path.ts` | 只产出 SVG path 字符串：垂直段、圆角换道、收拢曲线、合并父连接、常量 |
| 规划 | `src/client/scm/graph.ts` | `planGraph`：把提交流水号变成每行的 input/output 泳道视图模型 |
| 绘制 | `src/client/scm/graph-draw.ts` | `drawGraphRow`：把一行视图模型变成有序的线段 + 圆，可脱离 DOM 断言 |
| 渲染 | `src/client/scm/CommitsList.ts` | `GraphSvg`：把绘制结果映射成 React SVG 元素 |

`planGraph` 每个提交返回：`input`（进入本行的泳道）、`output`（离开本行的泳道）、
`circleIndex`（节点列）、`inputIndex`（节点在本行 input 中的下标，新开泳道为 -1）、
`color`、`parentCount`、`extraParents`（次父解析后的列与颜色）、`width`。
渲染层不需要再从 `forks` 反推任何东西。

## 与 VS Code 的数值对齐

| 项 | VS Code | 本插件 |
|---|---|---|
| 泳道宽度 | 11 | 11 |
| 泳道中心 | `11 * (i + 1)` | 同 |
| 行高 | 22 | 28（匹配列表行高，SVG 填满整行） |
| 节点圆心 y | 11 | 14（`行高 / 2`） |
| 换道圆角 | 5 | 5 |
| 合并弧 | `A 11 11` | `A 11 14`（椭圆弧；行高 22 时退化为 `A 11 11`） |
| 普通节点 | r=5 | r=5 |
| merge 节点 | 外 r=6 + 内 r=3 | 同 |
| 当前提交节点 | 外 r=7 + 内 r=2（内圆 stroke 4） | 同 |
| 圆描边 | 行背景色 2px | 同（`--sol-exp-graph-bg`，hover/选中同步） |
| 列宽 | `11 * (max(in, out, 1) + 1)`，逐行 | 取所有行的最大值，整列统一 |

配色：泳道 0 = `scmGraph.historyItemRefColor`（chartsBlue `#3794FF`，来自当前分支引用）；
其余泳道按 `scmGraph.foreground1..5`（`#FFB000` / `#DC267F` / `#994F00` / `#40B0A6` /
`#B66DFF`）轮换，`colorIndex` 从 -1 起，即第一条新泳道是 amber。

绘制顺序完全照搬 VS Code：先按列画 input 泳道（垂直或圆角换道），再画次父连接，
然后画节点自身的上下半段竖线，最后画节点圆——节点最后落笔才能盖住线头。

## 三处刻意偏离

1. **收拢重复泳道。** VS Code 在"首父已占列"时会在本行保留一条同 id 的重复泳道；它的
   渲染器里为这种情况写了一条 base-commit 曲线，但判据是 `index !== circleIndex`，而
   `circleIndex` 恒等于 `inputIndex`，所以那段代码不可达，实际渲染出来是一条悬空短线。
   本插件用 `laneClosePath(from, circle) = M fromX 0 A 11 14 … H circleX` 把它收拢进节点。
2. **根提交不再丢弃其他泳道。** VS Code 在 `parents.length === 0` 时直接让 `output` 为空，
   多 root 历史（`git merge --allow-unrelated-histories`）里其他分支的线会断在行底。
   本插件保留这些泳道，并在下一行左移一格。
3. **整列统一列宽。** VS Code 每行按自身泳道数决定 svg 宽度，文字会随行左右跳；本插件
   取最大值，哈希/正文列始终对齐。

## 验证

单测（`pnpm test`，65 项全部通过）：

- `test/graph-path.test.ts`：把每条 path 的字符串钉死（含 28px 行高下的椭圆弧）。
- `test/graph.test.ts`：planner 记账——泳道继承、重复泳道、次父列、调色板回绕、
  多 root 保留泳道、前缀（分页）稳定性。
- `test/graph-draw.test.ts`：绘制顺序、节点几何，以及**逐行连续性**——上一行的底部
  端点集合必须等于下一行的顶部端点集合；另外覆盖"折叠后左移"、octopus、三层嵌套。
- `test/graph-fixture.ts`：线性、diamond、模拟器简史（11 提交 / 2 merge）、
  复杂史（41 提交 / 11 merge / 单行最多 8 泳道）。

真机（Android 模拟器 + 真实 git 仓库）：

- 41 行提交、11 个 merge（含三层嵌套、octopus、多条分支同时汇入主分支、长寿分支），
  用 `isPointInStroke` 探测每行上下边缘：0 处断裂、0 处悬空泳道。
- `rowH == svgH == 28`，无横向溢出，节点 `cy = 14`，圆描边取到行背景色。

## 复现验证

`docs/` 不进 npm 包，验证脚本放在 `.scratch/`（已被 gitignore），可按需重建：
部署（`avd-deploy.ps1`）→ 构造历史（`avd-multilevel-merges.sh`、
`avd-concurrent-merges.sh`）→ 校验并截图（`avd-graph-multilevel.mjs`）。
离线调试可用 `graph-debug.mjs` 把 `avd-history.txt` 直接回放进 planner。

## 已知边界

- 泳道只在提交处释放：同一基提交被多条分支占用时，会同时存在多条同色/异色泳道，
  直到基提交那一行一起收拢。这是 VS Code 的模型（`git log --graph` 会提前并线）。
- 未跟踪/不可达的提交不在图里：`git log` 从 HEAD 出发，多 root 仅出现在
  `--allow-unrelated-histories` 合并后。
- 图中不显示 ref 标签（分支/远程徽标），只有节点；标签渲染在列表右侧的分支信息里。
