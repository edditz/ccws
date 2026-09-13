# `ccws scratch` 一次性会话命令 — 设计稿

日期:2026-09-13
状态:已实现

## 背景与动机

用户经常需要一次性会话:随时随地打开一个临时 claude 会话,用完即弃,
希望 ccws 充当启动器。当前只有 workspace(多目录聚合,创建成本高)与
project(登记已有项目)两种 entry,对"随手开一个空会话"来说太重。

最终需求边界(经两轮收敛):

1. **命令**:`ccws scratch` 一键创建 + 启动,零交互——这是唯一新增命令。
2. **生命周期**:**claude 退出即删除**,不保留、不可 resume、无保留期。
   (初版曾按用户选择实现"保留 7 天 + 自动 GC + `scratch clean`",
   后用户明确改为真·用完即弃,相关机器全部拆除。)
3. **默认权限模式** `bypassPermissions`(创建时写入,`mode`/`bypass` 可改)。
4. **纯空白会话**:不提供 `--add`;`add`/`remove`/`regen` 对 scratch 拦截;
   `mode`/`bypass`/`delete`/`status`/`ls <name>` 正常工作,`ls` 列表不展示。

## 关键决策

- **布局:顶层带 marker 的 workspace(方案 A)**。scratch 就是
  `$ROOT/<name>` 真目录 workspace,不是新的目录形态。`resolveEntry` 的
  单段名假设、`open`/`resume` 启动链、cwd 就近推断、mode 读写、`delete`
  全部零改动即工作。备选方案 `$ROOT/.ccws/scratch/` 子目录被否:破坏
  单段名不变量,`resolveEntry`/`workspacePath`/`detectWorkspaceFromCwd`
  (只取 relative 第一段,会返回 `.ccws`)全套要改,牵动面大。
- **marker 是唯一判据**:settings.json 顶层自有字段
  `"ccws": {"kind":"scratch"}`。`SettingsJson` 已有索引签名,`readSettings`
  与全部 writer 均保留未知字段(`setDefaultMode` 的 spread 不抹 marker)。
  名字是随机 1~3 个小写字母词以 `-` 连接(每词 4~8 字母),无任何语义,
  同名手建/`ccws init` 出来的是普通
  workspace。**`ccws` 字段自此成为
  settings.json 的发布契约**。`parseScratchMeta`(core/settings.ts)只认
  `kind === "scratch"`,容忍 marker 内多余字段(如初版遗留的 createdAt,
  平滑兼容);畸形 marker(非对象、kind 不符)返回 undefined → 按普通
  workspace 处理(delete 保留确认,安全默认)。
- **退出即删(try/finally)**:`scratchAction` 在 `runClaudeSession` 外包
  try/finally,finally 里 `rmSync(path, {recursive, force})`——claude 正常
  退出、非零退出、启动失败(claude 不在 PATH)三种路径都清理。transcript
  属 claude 资产,`~/.claude/projects` 绝不碰。
- **退出提示替换为丢弃说明**:workspace 已删,resume 已死,claude 自带的
  `Resume this session with:` 提示会误导——复用 `runClaudeSession` 的
  `exitHint` 钩子(既擦除 claude 的提示行,又打印替换文案):
  `scratch session ended — workspace "<name>" discarded`。不再做 session-id
  找回(id 无用),`sessionsRoot` 仅作为测试 seam 保留。
- **`ls` 完全不展示 scratch**(用户明确要求):瞬态条目不刷屏。显式窗口
  是 `ls <name>`(静态注记 "discarded when claude exits")与 `status`
  (cwd 在其内时同样注记)。空态文案保持 workspaces/projects 二元。
- **生成名冲突检查用 `!existsSync && !isSymlink`** 而非
  `resolveEntry === "missing"`:plain dir(无 settings.json)对 resolveEntry
  也是 missing,用四态判空会让 `createWorkspace` 往用户目录里 mkdir
  `.claude`(设计评审发现的真实 bug);该检查同时覆盖 project symlink
  与 dangling。冲突时加 4 位随机后缀重试(上限 5 次)。
- **守卫**:`requireNonScratchWorkspace`(core/scratch.ts,**不能放
  workspace.ts**,会成环)包 `requireWorkspace` + marker 检查;
  add/remove/regen 换用;`bypass` 不拦(mode 对 scratch 照常)。
- **`delete` 对 scratch 免确认**:marker 命中跳过 confirm——用完即弃
  语义;这是异常残留(如终端被 kill -9 留下的孤儿 scratch)的唯一清理
  路径,**没有任何自动清理机制**(按用户要求最小化)。

## 边界情况(已定对策)

| 边界 | 对策/结论 |
|---|---|
| corrupt settings 的 scratch | 解析不出 marker → 按普通 workspace,delete 带确认 |
| 手建同形随机名 / `ccws init <随机词名>` | marker 是唯一判据 → 普通 workspace |
| 生成名与存量撞名(含 plain dir/symlink/dangling) | `!existsSync && !isSymlink` 检查 + 随机后缀重试 |
| `ccws` 字段被未来 writer 抹掉 | settings.json 发布契约,写进项目 CLAUDE.md 约定;现有 writer 均保留未知字段 |
| 终端被 kill -9 / 断电留下孤儿 scratch | 不自动清理(用户要求);`ccws delete <name>` 免确认清除 |
| 旧版(7 天保留期)留下的带 createdAt 的 scratch | `parseScratchMeta` 容忍多余字段,仍识别为 scratch,可 `delete` 清掉 |
| `ccws` 字段写入即契约 | 见上 |

## 测试要点

- 退出即弃:断言 runner 收到的 cwd 在 action resolve 后已不存在;
  非零退出码照常传播且目录已删;thrower runner(启动失败)断言 finally
  清理无残留。
- `now` 注入控生成名(确定性断言名字格式与冲突后缀)。
- 冲突三态(plain dir / symlink / dangling)断言不穿透写入。
