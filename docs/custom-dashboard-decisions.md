# 自定义 Dashboard 关键决策（V2.7.2）

对应执行计划：`4-成果/IOTO Dashboard/Plan/Plan-20261108-061254.md` §3。
本文件只记录已确认、不再讨论的决策，供后续迭代（M5 拖拽、趋势组件）直接引用。

## 1. 26 条决策

1. **项目归属**：`3-任务/<Project>/` 文件夹优先 → frontmatter `Project` → 未分类；其他根目录仍以 frontmatter 为准。
2. **进度口径**：首版默认 `basis: "file"`（任务笔记全文 checkbox）；`section` 为可选项；UI 必须显示当前口径。
3. **进度分母**：`completed / total`，`total = completed + open + cancelled + other`；`total = 0` 时 `ratio = null`（显示「—」而不是 0%）。分母默认包含已取消任务；项目进度组件的 `ratioBase` 可切换为「不含已取消」，此时分母为 `total - cancelled`。
4. **查询是一等资源**：组件只引用 `queryId`；排序/分组/分页属于呈现层，不进查询定义。
5. **Dashboard 只读**：只投影与下钻，不承担写操作（勾选、删除、AI 执行都不发生在面板内）。
6. **面板配置**：`schemaVersion: 3`，多 Page 从 schema 第一天支持；必须经 `DashboardRepository` 读写；不调用 `saveSettings()`。
7. **快照粒度**：本地日期、每日一条；项目 × `ioType` × `sectionRole` 的独立计数（不做交叉组合），附总量、`fileCount`、口径指纹。
8. **快照保留**：180 天；同日覆盖不追加；此前不补、不推断；索引未就绪不写假 0。
9. **同日多次采集**：覆盖为当日最后一次，`capturedAt` 更新。
10. **多设备**：日期 + 设备标识分键，读取端合并；冲突取 `capturedAt` 较新者，另一条保留到 `samples[]`（最多 3 条）。
11. **采集触发**：`onLayoutReady` 首次 + 索引变化后低频节流（≥30 分钟且跨日才写盘）。
12. **首个组件集**：KPI + 项目进度 + 未完成任务；趋势后置。
13. **现有三视图**：保留、冻结功能、只做回归，不模板化。
14. **Page 语义**：`pages[]` 是组件分组维度，组件归属完全由所在 Page 的 `components` 数组表达（组件不再携带 `pageId`）；`queries` 全局共享，删除 Page 不删查询；`removePage` 必须保留最后一页。v2 的 `dashboards` / `activeDashboardId` 只在 `normalize()` 中只读兼容，且 id 迁移后保持不变。（“内部不再保留 dashboard 层级”这一条已被 #17 废止。）
15. **组件设置面板（Inspector）**：设置项由组件定义以声明式 `settings` 数组给出（`queryId` / `basis` / `limit` / `title`），面板与卡片都不硬编码字段；输入统一经纯函数 `coerceSettingValue` 归一，非法输入返回 `{}` 不改仓库。写入一律走 `DashboardRepository.updateComponent`，而 patch 中值为 `undefined` 表示删除该键（清空标题 = 删除 `title`，回到默认标题）。选中态是**会话级**的，不写入 `data.json` 或 workspace 布局；多个窗口各自选中，`clear(leafId)` 只清本画布。桌面默认开右侧栏宿主、移动端内嵌在画布底部（`inspectorHost` 可强制为 `sidebar` / `inline`）。面板只复用已有能力，不新增持久化字段，`schemaVersion` 仍为 3。
16. **面板操作层级**：「移除组件」不再常驻面板底部危险区，改为挂在面板标题行（面包屑右侧）的 `⋯` 菜单，且仍走 `ConfirmModal` 二次确认；查看模式下 `⋯` 整体禁用。布局区只保留尺寸（宽/高统一步进器，数值为纯数字，范围见悬停提示）与顺序（`↑ ↓` + 位置 `2 / 5`），「恢复默认尺寸」收为「布局」标题行右侧的 `↺` 图标按钮。卡片标题行的 `×` 移除同样二次确认。危险区样式与文案不再存在。
17. **多 Dashboard（工作台）层级**：`schemaVersion` 升级为 4，`dashboards[]` 成为一级结构；每个 Dashboard 自带 `pages[]` 与 `lastPageId`，`queries[]` 仍全局共享。**本条废止 #14 中“内部不再保留 dashboard 层级”的约定**，#14 其余规则继续适用（删除守卫改为“每个 Dashboard 至少保留一页”）。v3 的 `pages[]` 迁移为单个默认 Dashboard，v2 中仅含 `components[]` 的元素作为旧 Page 追加到默认 Dashboard；加载只迁移内存、不回写，下一次真实变更才落盘 v4。最后一个 Dashboard 禁止删除；删除当前项回退到 `dashboards[0]`。每个 Dashboard 注册独占命令，命令 id 仅由稳定 dashboard id 派生（`open-ioto-canvas-*`，不含名称），重命名不影响已绑定快捷键；另提供「打开仪表盘…」选择器。Dashboard 的增删改在 `save()` 成功后经 `onChange` 单点广播，视图按 dashboard/page 的 id+名称签名决定是否重渲染。
18. **一视图一 Dashboard（打开即聚焦）**：**本条废止 #17 中“标题即切换器、在同一 leaf 原地换内容”的交互**。一个标签页只显示一个固定 Dashboard：工具栏标题是纯文本名称，不提供任何切换器；每个 leaf 通过自身的 `dashboardId` 绑定 Dashboard，`activeDashboard` 只做精确匹配，未绑定或 id 失效时由 `resolveLeafTargets()` 兜底并写回。打开入口（Picker、每个 Dashboard 的独占命令）统一为 open-or-focus：用 `workspace.iterateAllLeaves` 在所有窗口里查找已绑定该 Dashboard 的 leaf，命中则 `revealLeaf`，未命中则新开标签；`newTab` 选项因此删除。管理弹窗只负责管理：点击某个仪表盘时，已打开则聚焦其标签、未打开则新开标签，弹窗保持打开并显示「已打开」徽标；新建 / 复制在新标签打开，当前 leaf 不变；删除时关闭其他正在显示该 Dashboard 的标签（操作所在 leaf 除外，回退到剩余第一个 Dashboard），并在确认文案里提示会关闭 N 个标签。`activeDashboardId` 语义收窄为「ribbon / 命令的默认落点」，不再承担「当前页」含义。
19. **无查询组件与 Markdown 卡片**：(1) `queryless: true` 的组件不解析查询、不请求数据、不参与数据版本重建，`statusOf` 直接返回 ready，添加流程短路、不提示「请先创建查询」。(2) Markdown 内容存 `config.options.markdown`，不升级 schema；图片一律用 `![[...]]` / `![](url)` 引用而非 base64，单卡内容不宜过长（随 `data.json` 回写）。(3) 查看模式只渲染不可编辑；编辑只发生在画布编辑态的 `textarea`，失焦或 `Cmd/Ctrl+Enter` 提交，输入过程只更新内存草稿。(4) `options.hideTitle` 为全组件共享设置，查看模式隐藏标题但保留 header 作为右上角浮层，搜索等 header 操作不丢失；容器（`acceptsChildren`）在编辑态同样遵守 `hideTitle`，header 保持脱流浮层，只在 hover / 选中 / `focus-within` 时显示拖拽、重命名与删除，保证嵌套网格在编辑态与查看态高度一致。
20. **按钮组件（Action）**：(1) 按钮是 `queryless` 组件，不解析查询、不请求数据，配置全部存 `config.options` 标量，`schemaVersion` 保持 7。(2) 一卡一动作，多按钮用网格拼排；`target` 设置种类只有一种（`picker: note | command | page`），由视图统一打开选择器。(3) URL 仅放行 `http/https/mailto`，无 scheme 补 `https://`，显式拒绝 `javascript:` / `data:` / `file:`；编辑态按钮 `disabled` + `pointer-events: none`，点击穿透给卡片选中；命令失败以 Notice 反馈，不做配置期预检，系统命令可选中并打标。(4) 页面 id 全局唯一，允许跨 Dashboard 跳转；跳转会把目标 Dashboard 的 `lastPageId` 更新为落点页。
21. **画布禅模式（Zen Mode）**：只作用于画布视图自身，隐藏顶部工具栏（仪表盘名 / 管理 / 编辑），保留页签并常驻右侧退出图标，不隐藏 Obsidian 标签栏、侧栏、异常横幅或空仪表盘 CTA。隐藏方式为在 `contentEl` 挂 `is-zen` 类、由 CSS 控制显隐，不删 DOM；页面栏拆为「外层 row + 内层滚动 strip + 右侧固定退出按钮」，`syncPagesBar()` 只清空内层，退出按钮只在 `ensureShell()` 创建一次。状态字段与状态键统一为 `isZenMode`，随 leaf 布局持久化（`getState/setState` + `requestSaveLayout()`），不进 `data.json`，`schemaVersion` 仍为 7。进入前先退出编辑态并清选中；编辑态不渲染进入按钮；Escape 有选中先取消、无选中才退出；另提供 `toggle-ioto-canvas-zen-mode` 命令便于移动端与快捷键。
22. **卡片表面（Surface）**：共享样式设置 `options.surface` 三档 `card | flat | plain`，只对 `markdown` / `button` 显示，**缺省按 `card` 解释**，因此旧看板与新增该设置前的卡片外观零变化；`createConfig` 只为这两个类型写入 `surface: "plain"`。`flat` 去边框、保留底色；`plain` 去边框、去底色、正文去内边距。编辑态对 `flat` + `plain` 统一加「编辑皮肤」：1px 低对比虚线 `outline` 标占地（不参与布局，切换编辑/预览不位移）、hover/选中升为 accent、选中为 2px 实线；header 改为右上角绝对定位悬浮操作条，只在 hover / 选中 / `focus-within` 出现，触摸设备常显。拖拽 ghost 通过 `:not(.ioto-drag-ghost)` 排除，始终保留边框与底色。Button 的尺寸语义是「内容自适应 + 居中」（`min-width: 96px`，`max-width: 320px`），`plain` 下自定义背景色落到按钮本体而非卡片；Markdown 在 `plain` 下隐藏无效的背景色控件。`schemaVersion` 仍为 7，无数据迁移。
23. **容器的选中操作统一走工具栏上下文**：容器的重命名 / 删除不再渲染在卡片 header 内，而是与 `plain` / `flat` 裸表面组件一样进入顶部工具栏 `.ioto-dashboard-selected-context`（组件名 + 重命名 + 删除），位于「添加组件」左侧；选中条件由 `selectedBareComponent()`（只认裸表面）放宽为 `selectedToolbarComponent()`（裸表面 **或** `type === "container"`）。容器编辑态 header 因此只保留拖拽手柄，`hideTitle` 下浮层从右上角移到**左上角**，并把显示触发由 `hover / 选中 / focus-within` 收窄为 `focus-within / 选中`（触摸设备仅选中），避免容器 `:hover` 因子组件冒泡而盖住子卡片手柄；未选中容器时不占位、不拦截子组件拖拽。表格 / 图表等其他 `card` 表面组件不受影响，仍在 header 内显示按钮。窄屏（≤ 520px）隐藏上下文标题文本，保留两个图标按钮。不新增 schema 字段、不改 locale，右键菜单与检查器仍提供同等的重命名 / 复制 / 移动 / 删除。
24. **卡片头部统一高度 + 项目进度搜索**：(1) 所有显示标题行的卡片头部（含嵌套卡片）统一 `min-height: 42px`，内容行固定 24px（头部直属图标按钮、拖拽手柄行高、搜索输入框统一 24px），用 `min-height` 而非 `height`，放大字体 / 主题加宽头部时不被裁切。42 = 24（内容行）+ 16（上下 padding）+ 约 1（发丝边框）+ 余量；40 低于自然高度 40.56 故对带控制件的头部是空操作、纯标题头部却会被压到 39.99（仍差 0.57px），41 为最小可行整数，42 取偶数并留余量。隐藏标题的浮层头部（`.is-title-overlay`，绝对定位）不参与统一。(2) 项目进度组件复用 `card-search.ts`，只对「已渲染行」做 DOM 过滤，匹配行上显示的项目名（含本地化的「未分类」），不新增搜索 UI 或数据层参数；空数据集不渲染搜索按钮，编辑态不渲染搜索，关键字通过 `card-search` 的按 config 状态在数据刷新重建后保留。(3) 已知取舍：`limit > 0` 时只搜索前 N 个项目（默认 0 = 全部，无影响）；如后续反馈强烈，再升级为「先过滤后截断」。

25. **按钮交互与颜色**：(1) 预览态光标用 `cursor: var(--cursor-link)` 跟随主题，不写死 `pointer`。(2) 按钮底色、悬停、按下统一走 `--ioto-btn-bg` / `--ioto-btn-bg-hover` / `--ioto-btn-bg-active` 三个变量，悬停与按下用 `color-mix()` 混 `--text-normal` 派生，方向随主题自适应；悬停包在 `@media (hover: hover)` 内，触屏不粘住，按下态用 `:active` 兜底。(3) 预设新增 `success` / `danger`，由插件类 `ioto-btn-success` / `ioto-btn-danger` 提供底色（Obsidian 按钮没有 `mod-success`），只用主题变量 `--background-modifier-success` / `--background-modifier-error`。(4) `variant: custom` 才显示 `buttonColor` 取色器；自定义色与预设互斥，切回预设即忽略 `buttonColor`；`buttonColor` 只放在组件自身 `settings`，不进 `STYLE_SETTINGS`。自定义色按 WCAG 亮度自动选择黑/白文字，显式卡片级 `textColor` 始终优先。`createConfig` 不写 `buttonColor`（未设置 = 跟随预设，重置天然成立）。(5) 旧 `has-custom-bg` 入口不再直接写 `background-color`，改为提供 `--ioto-btn-color`，与自定义色共用同一派生路径并因此获得悬停/按下反馈。(6) `schemaVersion` 不变（7），无数据迁移。
26. **导入 / 导出**：(1) 四类包共用 `formatVersion: 1` 信封（`kind` / `pluginVersion` / `storeSchemaVersion` / `exportedAt` / `source` / `payload` / `warnings`），包内只含定义与配置，不含快照、不发起任何网络请求，复制与落盘都是本地操作。(2) 语义固定为「追加 + 全新副本」：导入永远新建 page / dashboard / user query，id 统一重写为 `*:import-<时间戳>-*`，名称冲突追加本地化后缀「（导入）」；唯一例外是整库备份恢复，走 `replace` 并保留原 id，且必须二次确认。(3) 导出时 `saved:` 查询就地物化为 `user:` 快照（名称带「（来自收藏查询）」），因为收藏查询存在 settings 而非 `dashboardStore`；`builtin:` 只随包引用、导入时不落库。(4) 组件 `queryId` 按 `queryIdMap` 重写，包内缺失的查询置空并告警；目标类型不兼容时同样置空回退默认查询；按钮 `options.pageId` 按 `pageIdMap` 重写，指向包外页面时保留原值并告警。(5) 父页面不在包内的 page 降级为顶层页面；查询的 `folders` 以包内 `source.roots` 与当前根目录做前缀改写，未命中保留原路径并告警。(6) 导入落盘走 `DashboardRepository.applyImport`：内存合并完成后经一次 `plugin.updateData` 同时写入 `dashboardStore` 与新增的 `customFilters`，只广播一次；数据损坏（`damaged`）时直接拒绝，绝不覆盖。`schemaVersion` 仍为 7。
## 2. 存储落位

| 数据 | 位置 | 写入方式 | 理由 |
|---|---|---|---|
| 用户设置（7 个键） | `.obsidian/plugins/ioto-dashboard/data.json` | `plugin.updateData()` 合并写 | 保持现有结构 |
| 页面 / 用户查询 | `data.json` 的 `dashboardStore` 命名空间 | `DashboardRepository` → `plugin.updateData()` | 与设置共用串行写队列，避免整文件覆写 |
| 每日快照 | `.obsidian/plugins/ioto-dashboard/metrics-snapshots.json` | `adapter.write` + `tmp` → `rename` | 与设置物理隔离；损坏时只降级、不覆写 |

`src/main.ts` 的 `updateData(mutate)` 把「`loadData()` → 修改 → `saveData()`」串成单条 Promise 链。`saveSettings()` 只写 7 个设置键，`DashboardRepository` 只写 `dashboardStore`，双方都不会用自己手里的整份对象覆盖对方。

## 3. 旧视图的唯一预期差异

项目归属改为 folder-first 后，旧三视图的「项目」筛选**选项会变多**：此前没有 frontmatter `Project` 的任务根笔记不参与项目筛选，现在会按 `3-任务/<Project>/` 被归入对应项目。这是预期行为，不是回归；除此之外旧三视图零功能变化。

KPI 与项目进度组件首次选中 `basis` 时均默认 `file`，编辑模式下会显示口径选择器，避免把「按笔记全文」误读为「仅当前分节」。

## 4. 与快照相关的验收口径

- 采集前后四根目录全部 `.md` 的 `(path, mtime, size)` 不变，`git status` 无笔记变更。
- `data.json` 的 SHA-256 不因采集而改变。
- 手动写坏 `metrics-snapshots.json`：插件正常加载、面板不报错、原文件保持原样。
- 删除快照文件：下次采集重建空结构后正常写入。
- 修改分节标题：只新增 `scopeChangedAt` 断点，不改写历史数据。
