# IOTO Dashboard 数据层契约（V2.7.1）

本文件冻结 `src/data` 的对外契约。视图层只允许通过 `VaultIndex.getSnapshot()` 读取数据、通过 `subscribe()` 感知变化，不得直接读写 `app.vault` / `metadataCache` 的笔记内容。

## 1. 目录与依赖边界

```
src/data/
├── types.ts                 # 冻结契约（本文件的代码版本）
├── note-source.ts           # 文件夹归属、frontmatter 归一化、NoteRecord 计数
├── task-source.ts           # 标题分节 + 勾选框单遍解析
├── project-source.ts        # _project.md → ProjectRecord
├── note-query.ts            # 笔记筛选
├── task-query.ts            # 任务筛选
├── sort.ts                  # 笔记/任务排序
├── saved-query-adapter.ts   # SavedQuery → FilterState（只读）
└── vault-index.ts           # 唯一数据入口：缓存、事件失效、快照
```

约束（由 `tests/data/contract-imports.test.mjs` 强制）：

- `src/data` 不得导入 `views/`、`ui/`、`settings`、`services`、`lang/`、`models/`。
- 对 `obsidian` 只允许 `import type`；唯一例外是 `vault-index.ts` 的 `import { TFile }`，用于 `instanceof TFile` 判定（`obsidianmd/no-tfile-tfolder-cast` 规则要求）。
- 已有字段不得改名或改变语义；新增字段必须可选。

## 2. 核心记录

### NoteRecord

| 字段 | 语义 |
| --- | --- |
| `path` / `basename` / `folder` | Vault 相对路径、文件名、所在目录 |
| `ioType` | `Input` / `Output` / `Task` / `Outcome` / `Unknown`，**只由根文件夹决定，绝不按标题猜测** |
| `project` / `subject` / `status` | 读取 frontmatter `Project/project`、`Subject/subject`、`Status/status`；对象/数组经 `toText` 归一，绝不出现 `[object Object]` |
| `ctime` / `mtime` / `size` | `TFile.stat` |
| `fileTaskCount` | 文件内全部有效勾选框（注释已剥离、空文本跳过） |
| `fileCompletedCount` | 其中 `marker === "done"` |
| `sectionTaskCount` | 位于默认分节范围（`task/input/output/outcome`）内的任务数 |
| `sectionCompletedCount` | 上述范围内完成数 |
| `frontmatter` | 原始 frontmatter，供自定义筛选读取 |

### TaskRecord

| 字段 | 语义 |
| --- | --- |
| `path` / `line` | 笔记路径 + 0 基行号；两者共同构成天然去重键（不再跨笔记按文本去重） |
| `marker` | 见下方标记映射 |
| `isCompleted` | **仅 `done` 为 true** |
| `text` | 已剥离 `- [ ]`、`%%…%%`、`<!-- -->` 的任务文本 |
| `indent` | 以 4 空格折算的缩进宽度 |
| `ioType` | 继承笔记归属 |
| `sectionRole` / `sectionHeading` | 所在分节角色与实际标题文本 |
| `project` / `noteStatus` | 继承笔记 frontmatter |
| `noteCtime` / `noteMtime` / `noteBasename` / `noteSize` | 继承笔记元信息，供排序 |
| `noteFrontmatter` | 原始 frontmatter，供自定义筛选 |

## 3. 标记映射（唯一口径）

| 勾选框字符 | `marker` | `isCompleted` |
| --- | --- | --- |
| `" "` | `open` | false |
| `x` / `X` | `done` | true |
| `-` | `cancelled` | false |
| `/` | `in-progress` | false |
| `>` | `forwarded` | false |
| 其他 | `other` | false |

由此：

- 「已完成」= `marker === "done"`，`[-]`、`[/]`、`[>]` 均不算完成。
- 「未完成」= `marker === "open"`，`[-]`、`[/]`、`[>]` 也不算未完成（它们不进入「未完成」筛选，但会出现在「全部」中）。

## 4. 标题分节

- 标题文本先 `trim`、去除块 ID（` ^abc`）、转小写，再与配置关键词做**前缀匹配**（`输出 THINK（补充）` 命中 `输出 THINK`）。
- 使用标题栈：子标题继承父标题角色；同级/更高级标题出栈。
- 未命中任何关键词的标题保持父角色；顶层未命中为 `other`。
- 关键词优先级：`task` → `input` → `output` → `outcome` → `goal` → `review`。
- 重复标题、带后缀标题都会被收集（替代旧 `findIndex` + 范围法只保留首个分节的缺陷）。
- 解析在单遍扫描中跳过代码围栏与 `%%…%%` / `<!-- -->` 块注释。

默认关键词（可由 ioto-settings 覆盖，`main.ts#getSectionHeadings`）：

| 角色 | 默认 |
| --- | --- |
| task | 任务 |
| input | 输入 LEARN |
| output | 输出 THINK |
| outcome | 成果 DO |
| goal | 目标 |
| review | 复盘、Review |

## 5. 范围默认值

```ts
DEFAULT_SCOPE_SECTIONS = ["task", "input", "output", "outcome"]
DEFAULT_TASK_SCOPE = {
  folders: "task",
  sections: DEFAULT_SCOPE_SECTIONS,
  includeEmptyText: false,
  includePlaceholders: false,
}
```

| 视图 | 文件夹范围 | 分节范围 |
| --- | --- | --- |
| Dashboard「输入/输出/成果」任务页签 | `task` | 对应单一角色（`input` / `output` / `outcome`） |
| TaskView | `task` | `task + input + output + outcome` |
| NoteView | 仅笔记，`ioType ∈ {Input, Output, Outcome}` | — |

`folders: "ioo"` 表示只看 `Input/Output/Outcome` 文件夹；`"all"` 表示全部。空文本与占位任务在解析阶段即被丢弃，两个 `include*` 字段固定为 `false` 以锁定语义。

## 6. VaultIndex 生命周期

- **构建**：遍历 `1-输入`、`2-输出`、`3-任务`、`4-成果` 四个根目录，`cachedRead` 并发 32 读取；每文件缓存 `(mtime, size)` 签名。
- **事件**：`vault` 的 `modify` / `create` / `delete` / `rename` 与 `metadataCache` 的 `changed`。修改只标记 dirty 并通知订阅者，下次 `getSnapshot()` 才重读；删除/重命名直接移除记录。
- **订阅**：`subscribe(listener)` 返回取消函数；监听器异常被捕获，不影响其他订阅者。
- **设置变更**：`saveSettings()` 触发 600ms 防抖的 `rebuild()`；`rebuild()` 保留缓存，签名未变的文件不重读，已移出根目录的文件自然淘汰。
- **快照**：`notes` 按路径排序；`tasks` 顺序对视图无影响（视图自行排序）。

## 7. SavedQuery 适配

`SavedQuery` 不再直接传入数据层：

- `createDefaultFilterState(overrides)` 补齐全部 `FilterState` 字段，`custom` 深拷贝。
- `savedQueryToFilterState(query)` 只读取 `query.filters`，不改写、不新增字段；`name` / `sortOption` / `sortOrder` / `groupOption` 由各视图自行持有。

## 8. 与旧实现的关键差异

1. 任务来源从「metadataCache `listItems` + 首个分节范围」改为「正文单遍解析」：重复标题、嵌套子标题、代码围栏、块注释均正确处理。
2. 去重键从任务文本改为 `(path, line)`：不同笔记中的同名任务不再被误删。
3. 完成判定统一为 `done`：`[-]` 不再被计为完成。
4. 任务标题类型与笔记类型解耦：任务页签按分节角色筛选，笔记页签按文件夹归属筛选。
5. 分页与分组计数基于完整筛选结果：组头数字与总数一致，页面只渲染当前页。

## 9. 真实 Vault 基线（2026-11-07）

| 指标 | 数值 |
| --- | --- |
| 纳入索引的 Markdown 文件 | 1169（Input 23 / Output 61 / Task 274 / Outcome 811） |
| 原始勾选框行 | 2842 |
| 解析后有效任务 | 2710（132 行为占位、注释、空文本或代码围栏） |
| `3-任务` 文件夹任务 | 1838（其中 open 21） |
| 分节分布 | task 938 / output 68 / outcome 815 / input 29 / other 860 |
| TaskView 默认范围 | 1836（其中 open 21） |
| Dashboard 页签 | 输入 29 / 输出 68 / 成果 815 |

## 10. 验证

```bash
cd .obsidian/plugins/ioto-dashboard
npm test        # node:test + jiti，含 data 层契约/解析/查询/索引测试
npm run build   # tsc -noEmit + esbuild production
npm run lint
```

数据层测试位于 `tests/data/`，fixtures 位于 `tests/fixtures/data/`。
