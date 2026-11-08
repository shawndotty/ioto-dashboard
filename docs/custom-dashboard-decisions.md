# 自定义 Dashboard 关键决策（V2.7.2）

对应执行计划：`4-成果/IOTO Dashboard/Plan/Plan-20261108-061254.md` §3。
本文件只记录已确认、不再讨论的决策，供后续迭代（M5 拖拽、趋势组件）直接引用。

## 1. 13 条决策

1. **项目归属**：`3-任务/<Project>/` 文件夹优先 → frontmatter `Project` → 未分类；其他根目录仍以 frontmatter 为准。
2. **进度口径**：首版默认 `basis: "file"`（任务笔记全文 checkbox）；`section` 为可选项；UI 必须显示当前口径。
3. **进度分母**：`completed / total`，`total = completed + open + cancelled + other`；`total = 0` 时 `ratio = null`（显示「—」而不是 0%）。
4. **查询是一等资源**：组件只引用 `queryId`；排序/分组/分页属于呈现层，不进查询定义。
5. **Dashboard 只读**：只投影与下钻，不承担写操作（勾选、删除、AI 执行都不发生在面板内）。
6. **面板配置**：`schemaVersion: 2`，多面板从 schema 第一天支持；必须经 `DashboardRepository` 读写；不调用 `saveSettings()`。
7. **快照粒度**：本地日期、每日一条；项目 × `ioType` × `sectionRole` 的独立计数（不做交叉组合），附总量、`fileCount`、口径指纹。
8. **快照保留**：180 天；同日覆盖不追加；此前不补、不推断；索引未就绪不写假 0。
9. **同日多次采集**：覆盖为当日最后一次，`capturedAt` 更新。
10. **多设备**：日期 + 设备标识分键，读取端合并；冲突取 `capturedAt` 较新者，另一条保留到 `samples[]`（最多 3 条）。
11. **采集触发**：`onLayoutReady` 首次 + 索引变化后低频节流（≥30 分钟且跨日才写盘）。
12. **首个组件集**：KPI + 项目进度 + 未完成任务；趋势后置。
13. **现有三视图**：保留、冻结功能、只做回归，不模板化。

## 2. 存储落位

| 数据 | 位置 | 写入方式 | 理由 |
|---|---|---|---|
| 用户设置（7 个键） | `.obsidian/plugins/ioto-dashboard/data.json` | `plugin.updateData()` 合并写 | 保持现有结构 |
| 面板 / 用户查询 | `data.json` 的 `dashboardStore` 命名空间 | `DashboardRepository` → `plugin.updateData()` | 与设置共用串行写队列，避免整文件覆写 |
| 每日快照 | `.obsidian/plugins/ioto-dashboard/metrics-snapshots.json` | `adapter.write` + `tmp` → `rename` | 与设置物理隔离；损坏时只降级、不覆写 |

`src/main.ts` 的 `updateData(mutate)` 把「`loadData()` → 修改 → `saveData()`」串成单条 Promise 链。`saveSettings()` 只写 7 个设置键，`DashboardRepository` 只写 `dashboardStore`，双方都不会用自己手里的整份对象覆盖对方。

## 3. 旧视图的唯一预期差异

项目归属改为 folder-first 后，旧三视图的「项目」筛选**选项会变多**：此前没有 frontmatter `Project` 的任务根笔记不参与项目筛选，现在会按 `3-任务/<Project>/` 被归入对应项目。这是预期行为，不是回归；除此之外旧三视图零功能变化。

KPI 与项目进度组件首次选中 `basis` 时分别默认 `file` / `section`，编辑模式下会显示口径选择器，避免把「按笔记全文」误读为「仅当前分节」。

## 4. 与快照相关的验收口径

- 采集前后四根目录全部 `.md` 的 `(path, mtime, size)` 不变，`git status` 无笔记变更。
- `data.json` 的 SHA-256 不因采集而改变。
- 手动写坏 `metrics-snapshots.json`：插件正常加载、面板不报错、原文件保持原样。
- 删除快照文件：下次采集重建空结构后正常写入。
- 修改分节标题：只新增 `scopeChangedAt` 断点，不改写历史数据。
