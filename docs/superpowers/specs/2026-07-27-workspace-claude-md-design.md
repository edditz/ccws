# 工作区 `CLAUDE.md` 自动维护 — 设计稿

日期:2026-07-27
状态:已与用户确认设计,待写实现计划

## 背景与动机

ccws 工作区是一个「空文件夹」:目录树里只有 `.claude/settings.json`,真实的项目代码全在
`permissions.additionalDirectories` 关联的**外部目录**里。当用户在这个空文件夹启动 claude 时,
`cwd` 是工作区本身,但 Claude 实际要操作的代码在别处 —— 实践中 Claude 经常**忘了先 `cd` 到关联目录**
就直接跑 shell 命令,导致操作落空或报错。

Claude Code 启动时会自动加载 `cwd` 下的 `CLAUDE.md`。本设计利用这个注入点:让 ccws 在每个工作区里
**自动维护一份 `CLAUDE.md`**,列出该工作区的关联目录(绝对路径)并提醒「注意当前所在位置」。
这样 Claude 一进来就知道:自己在哪个工作区、有哪些目录可去、动手前要先确认/切换目录。

## 范围

- 在工作区目录 `$ROOT/<name>/CLAUDE.md` 生成并维护一份说明文件。
- 维护时机:**全自动** —— `init` 创建时生成;`add`/`remove` 改动关联目录后自动同步。
- 兜底/迁移:新增 `ccws regen [name]` 子命令,用于老工作区(升级 ccws 前已存在、没有 CLAUDE.md)
  补齐、或修复被手动搞乱的文件。
- **保护用户手动编辑**:用 `begin…end` 标记区块圈住「关联目录」列表,自动同步只重写区块内;
  区块外的提醒文案、用户备注原样保留。
- 不在本期范围:全局可定制模板文件(用户可直接编辑区块外内容实现定制,YAGNI);给每条目录加
  用户备注(无数据源,YAGNI);CLAUDE.md 的多语言切换(固定英文文案)。

## 行为契约

### `CLAUDE.md` 内容(英文,首次生成)

````markdown
# Workspace

This is a **ccws workspace**. The current directory (your `cwd`) is the workspace
itself and is usually empty — the actual project code lives in the **Associated
Directories** listed below.

> **Before running any shell command, check your current directory.** `cd` into
> the correct associated directory before operating on it.

## Associated Directories

<!-- ccws:additional-directories:begin -->
<!-- (none yet — use `ccws add <dir>` to associate directories) -->
<!-- ccws:additional-directories:end -->

> The list above is auto-maintained by `ccws` (`init` / `add` / `remove` / `regen`).
> Edit anything outside the `begin…end` markers freely; do not edit the list
> between them — it will be overwritten.
````

- 标记区块内的目录列表用绝对路径,**每条一行**;对当前不存在的目录追加 `  ⚠️ missing`
  (复用 `assertAllExist`/`existsSync`,让 Claude 知道该目录当前不可用)。
- 空目录时区块内为单行注释提示(如上)。

### 各命令的 CLAUDE.md 行为

- `init <name>`:`createWorkspace` 写 settings skeleton → (若 `-i` 先 `collectAndWriteDirs`)
  → 流程末尾调**一次** `syncClaudeMd`(此时 settings 已反映最终目录:非交互为空,交互为收集的目录)。
  只 sync 一次,不冗余。
- `init --force`:`rmSync` 整个工作区(含旧 CLAUDE.md)→ 重建 → `syncClaudeMd`(走「文件不存在」分支,
  等同全新生成)。
- `add`:`writeAdditionalDirs` 写完 settings → `syncClaudeMd`(区块同步新目录)。
- `remove`:`setAdditionalDirs` 写完 settings → `syncClaudeMd`(区块同步移除)。
- `regen [name]`:只读 settings、不改 settings,执行一次 `syncClaudeMd`。用于补齐/修复。
  `name` 缺省时按 cwd 就近推断(同 `list`/`open` 的位置参数风格)。

### 标记区块更新语义(三态模型)

先计数文件里 `BEGIN`/`END` 的出现次数,分三态处理(`CLAUDE.md` 不存在的情况另算,见数据流):

| 状态 | 判定 | 处理 | 返回 |
|---|---|---|---|
| **完整且唯一对** | 恰好 1 个 `BEGIN` + 1 个 `END`,且 `BEGIN` 出现在 `END` 之前 | 只替换两标记**之间**的内容,区块外保留 | `rewrote-block` |
| **完全无标记** | 0 个 `BEGIN`、0 个 `END` | 末尾**追加**一对完整标记 + 目录列表,保留用户原有全部内容 | `appended` |
| **标记异常** | 其他一切:孤立 `BEGIN`、孤立 `END`、多对、`END` 在 `BEGIN` 之前 | **不改动文件**,抛错(见错误处理),由用户修复 | 抛错 |

**为什么「标记异常」既不追加也不替换**:一旦文件出现不成对的标记,「追加」会把它变成多 `BEGIN`,
下一次「替换 `BEGIN…END` 之间」就会**跨越并吞掉**夹在中间的用户内容。所以异常态一律拒绝自动改动,
绝不冒误删用户内容的风险 —— 用户有两条明确修复路径:手动修标记、或 `ccws regen --force` 全量重写。

## 数据流

```
syncClaudeMd(root, name):
  readSettings(settingsPath(root, name))                      [route through readSettings: 损坏即抛错]
    .permissions.additionalDirectories ?? []
  → entries = dirs.map(path => ({ path, missing: !existsSync(path) }))
  → writeClaudeMd(claudeMdPath(root, name), entries)

writeClaudeMd(path, entries):  → 返回 'created' | 'rewrote-block' | 'appended';异常态抛错(不写文件)
  if !existsSync(path):  writeFileSync(renderFull(entries)); return 'created'
  content = readFileSync(path, "utf8")
  beginIdx = content.indexOf(BEGIN); endIdx = content.indexOf(END)
  countBegin = countOccurrences(content, BEGIN); countEnd = countOccurrences(content, END)
  if countBegin === 1 && countEnd === 1 && beginIdx < endIdx:           // 完整且唯一对
    next = content.slice(0, beginIdx + BEGIN.length) + "\n" + renderDirsBlock(entries)
           + "\n" + content.slice(endIdx)
    writeFileSync(path, next); return 'rewrote-block'
  if countBegin === 0 && countEnd === 0:                                // 完全无标记
    next = content.replace(/\n*$/, "") + "\n\n" + BEGIN + "\n"
           + renderDirsBlock(entries) + "\n" + END + "\n"
    writeFileSync(path, next); return 'appended'
  // 标记异常:不写文件,抛错
  throw new Error("CLAUDE.md 的 ccws 维护标记不完整/异常,已跳过同步以免损坏 — 手动修复标记或 `ccws regen --force`")
```

四个命令的 CLAUDE.md 更新都收敛到 `syncClaudeMd` 一个入口;`writeClaudeMd` 是无状态的文件级操作。

## 模块划分(严守三层)

### `src/core/config.ts`(追加)

- `claudeMdPath(root, name): string` — `join(workspacePath(root, name), "CLAUDE.md")`。
  与 `settingsPath` 等 path helper 同住。

### `src/core/claude-md.ts`(新增,纯逻辑 + 文件 I/O,无终端 I/O)

- 标记常量(导出供测试断言):
  - `BEGIN = "<!-- ccws:additional-directories:begin -->"`
  - `END   = "<!-- ccws:additional-directories:end -->"`
- `interface DirEntry { path: string; missing: boolean }`
- `renderDirsBlock(entries: DirEntry[]): string` —
  空时返回 `'<!-- (none yet — use \\`ccws add <dir>\\` to associate directories) -->'`;
  非空时每行 `'- ' + path + (missing ? '  ⚠️ missing' : '')`,`\n` 连接。
- `renderFull(entries: DirEntry[]): string` — 完整文件(header + 区块 + footer)。
- `type WriteOutcome = 'created' | 'rewrote-block' | 'appended'`。
- `writeClaudeMd(path: string, entries: DirEntry[]): WriteOutcome` — 按「标记区块更新语义」三态分支,
  异常态**抛错**(`Error`,不写文件)。计数 `BEGIN`/`END` 用字符串计数(标记含 `--`,无需正则转义)。
- `syncClaudeMd(root: string, name: string): WriteOutcome` — 读 settings → 算 entries → 调 `writeClaudeMd`,
  透传其返回值/抛错。**不修改入参**(不可变);`missing` 判定用 `existsSync`。
- core 层**不依赖** `utils/log`(单向向下);由 command 层按 `WriteOutcome` 打印日志
  (`created`/`appended` → info 或 warn,`rewrote-block` → info 或静默)。

### `src/core/workspace.ts`(不动)

- `createWorkspace` 职责不变,仍只写 settings skeleton。CLAUDE.md 由 command 层编排,保持单一职责。

### `src/commands/init.ts`(改)

- `initAction` 末尾(interactive 收集之后)调一次 `syncClaudeMd(root, name)`。
- `--force` 路径不变(`rmSync` 整个目录,含旧 CLAUDE.md),重建后 `syncClaudeMd` 自然生成全新的。

### `src/commands/add.ts` / `remove.ts`(改)

- 各自在写完 settings 后调 `syncClaudeMd(root, name)`,并按返回状态决定是否额外 info(可选)。

### `src/commands/regen.ts`(新增)

- `regenAction(name: string | undefined, opts: { root?: string; force?: boolean }): void`
- 解析 `root = resolveRoot(opts.root)`;`ws = name ?? detectWorkspaceFromCwd(root)`;
  `ws` 为空 → 抛错引导;`validateWorkspaceName(ws)`;不存在 → 抛错引导 `init`。
- 默认走 `syncClaudeMd(root, ws)`(三态判定):正常情况刷新区块;遇标记异常则 syncClaudeMd 抛错 →
  由 `fail()` 打印、退出非 0、**文件不被改动**。
- `--force`:**绕过三态判定**,无视现有内容,整文件覆盖重写为 `renderFull(entries)`(语义:
  「我知道会丢区块外内容,重置」)。用于标记异常时用户确认要全量重置。实现期在 core 暴露一个
  `forceRewriteClaudeMd(path, entries)`(或 command 层直接调 `writeFileSync(renderFull(...))`)。
- 不读/写 `additionalDirectories` 之外的字段,不改 settings。

### `src/cli.ts`(改)

- 注册 `regen [name]` 子命令,带全局 `-r/--root` + `-f/--force`(强制全量重写 CLAUDE.md);
  action `try/catch → fail`,写法与现有命令一致。

### `src/utils/log.ts`(不动)

## 错误处理

- **settings 损坏** → `syncClaudeMd` 经 `readSettings` 抛错,沿用「绝不覆盖损坏 JSON」约定。
- **`CLAUDE.md` 写失败**(同目录 settings.json 刚成功写过,极少见)→ 抛错,信息明确:
  `settings.json 已更新,但 CLAUDE.md 同步失败 — 运行 \`ccws regen\` 修复`。**不回滚 settings**
  (CLAUDE.md 是辅助产物,settings 是真值;与「原子失败保护数据」一致 —— 真值优先)。
- **CLAUDE.md 完全无标记** → 末尾追加区块 + 状态 `'appended'`(由 command 层 info/warn 打印),不覆盖原内容。
- **CLAUDE.md 标记异常**(孤立 `BEGIN`/`END`、多对、`END` 在 `BEGIN` 前) → **不写文件**,抛错:
  `CLAUDE.md 的 ccws 维护标记不完整/异常,已跳过同步 — 手动修复标记(确保恰好一对 begin…end),
  或 ccws regen --force <name> 全量重写(会覆盖整个 CLAUDE.md)`。由 `cli.ts` 的 `fail()` 打印。
- **`regen` 找不到工作区** → 抛错引导 `init`(fail-fast,不隐式创建)。
- 命令失败只 `throw`,由 `cli.ts` 的 `fail()` 统一打印(不双重日志)。

## 测试策略

沿用 `mkdtempSync(tmpdir())` 临时 `CCWS_ROOT` 惯例;**macOS 符号链接陷阱**:root 须 `realpathSync`
后再传入(尤其涉及 cwd 就近推断的 `regen` 测试)。

### core 单测(`tests/core/claude-md.test.ts`)

- `renderDirsBlock`:空 → 单行注释提示;单条;多条;含 `missing` 标注;顺序保留。
- `renderFull`:含 header 固定文案、`BEGIN`/`END` 标记、空区块提示。
- `writeClaudeMd` 三态 + 异常态(用临时文件):
  1. 文件不存在 → 写 full,读回含 header + 标记 + 区块,返回 `'created'`。
  2. 存在 + 完整唯一对 + 区块外有用户备注 → 只换区块内,区块外备注逐字保留,返回 `'rewrote-block'`。
  3. 存在 + 完全无标记 → 原内容保留 + 末尾追加区块,返回 `'appended'`;**再次调用**(现已有完整对)
     → 返回 `'rewrote-block'`,幂等、不重复追加。
  4. 存在 + 标记异常(孤立 `begin` / 孤立 `end` / 多对 / `end` 在 `begin` 前)→ **抛错且文件内容未变**
     (读回等于写入前)。
- `syncClaudeMd`:读 settings 的 dirs → 正确映射成 entries(含 missing 判定,用临时目录造一个
  存在 + 一个不存在的目录验证 `⚠️ missing`);幂等(连续两次调用不产生重复标记/损坏)。

### 命令集成测

- `init`:创建后 `$ROOT/<name>/CLAUDE.md` 存在,内容含 header + 空区块提示。
- `init -i`(注入 `promptText`):收集目录后 CLAUDE.md 区块含那些目录(绝对路径)。
- `add`:加目录后区块同步新增;**区块外预先写入的用户备注不变**(关键不变量)。
- `remove`:删目录后区块同步移除;区块外备注不变。
- `regen`:老工作区(手动造一个只有 settings.json、无 CLAUDE.md 的)→ regen 后生成完整 CLAUDE.md;
  手动搞乱区块内文本 → regen 后区块内恢复成 settings 的真值。
- `regen` 遇标记异常(孤立 begin)→ 抛错 + 退出非 0 + **文件未被改动**;`regen --force` → 整文件重写、
  原区块外的用户内容被覆盖(force 语义,需测试确认用户内容确实被 `renderFull` 替换)。
- `regen` 的 name 解析:位置参数 > cwd 就近(root 须 `realpathSync`)。

### 不单测的部分

无(纯文件 I/O,全可临时目录覆盖)。覆盖率仍走 `vitest.config.ts` 的 80% 阈值。

## 关键约定对齐

- **路径一律绝对**:`additionalDirectories` 本就是绝对路径,渲染时原样使用。
- **不可变**:core 函数不修改入参,构造新字符串/对象。
- **settings.json 完整性**:`syncClaudeMd` route through `readSettings`,损坏即抛、绝不覆盖。
- **输出纪律**:core 不依赖 `utils/log`;command 层负责把 `writeClaudeMd` 返回的状态打成日志;
  除 `utils/log.ts` 外禁用 `console.log`;命令失败只 `throw`。
- **fail-fast**:`regen` 工作区不存在 → 报错引导 `init`,不隐式创建。
- **版本号 / 无关字段**:本改动不碰版本号、不动 settings 未知字段与 key 顺序。

## 风险与待实现期验证

1. **`existsSync` 判 missing 的语义**:工作区关联的目录可能是符号链接或稍后克隆;`existsSync`
   对符号链接跟随,行为与 `assertAllExist` 一致(`assertAllExist` 用的也是 `existsSync`)。实现时
   对照 `paths.ts` 的 `assertAllExist` 实现,确保 `missing` 判定与 `list`/`status` 显示的 missing 数
   **一致**(同一判定函数,避免两处口径分歧)。**可能重构**:抽一个共享的 `dirExists`/`missingDirs`
   给 `assertAllExist` 与 `renderDirsBlock` 复用。
2. **三态判定的健壮性**:`writeClaudeMd` 用「计数 `BEGIN`/`END` 出现次数 + 比较 `indexOf` 位置」判定,
   不用正则(标记含 `--` 无需转义,计数比正则更不易错)。「完整唯一对」分支替换时严格用
   `slice(0, beginIdx + BEGIN.length)` 与 `slice(endIdx)`,**只动两标记之间,绝不跨越**。「完全无标记」
   追加后文件变为恰好一对 → 下次走替换分支,**天然幂等**(无标记文件连续两次 sync 不会追加两个区块)。
   「标记异常」绝不写文件。计数函数(`countOccurrences`)需单测,各类边界均需覆盖。
3. **`init --force` 删 CLAUDE.md**:`rmSync(workspacePath, { recursive: true })` 已含 CLAUDE.md,
   重建时 `syncClaudeMd` 走「文件不存在 → full」分支。测试覆盖 force 路径。
4. **标记常量的稳定性**:`BEGIN`/`END` 字符串一旦发布即是契约 —— 老工作区的 CLAUDE.md 里有旧标记,
   ccws 新版本必须仍能识别。后续不得随意改标记文本;如需迁移,要同时识别新旧标记。本期定稿后,在
   **项目 `CLAUDE.md`**(ccws 仓库的开发者约定文档,非工作区的)的「关键约定」节登记标记文本,提醒
   后续维护者勿改。

## 未采纳的备选方案(留档)

- **全局可定制模板文件**(`~/.ccws/CLAUDE.md.tpl` + 占位符):灵活,但标记区块方案下用户直接编辑
  区块外内容即可定制,多一层模板机制与约定属 YAGNI。已否决。
- **全量重写 CLAUDE.md**(每次 add/remove 整文件覆盖):实现最简,但冲掉用户手动编辑(提醒措辞、
  备注),与「保护用户编辑」需求冲突。已否决。
- **纯手动命令**(不加自动同步,只给 regen):CLI 表面最小,但目录列表易过时 —— 正是用户想避免的。
  已否决。
- **半自动**(init 生成骨架,add/remove 不动 CLAUDE.md,靠 regen 刷新):仍需用户记得跑 regen,
  不符合「全自动」诉求。已否决。
- **中文/双语固定文案**:ccws 是公开发布的开源工具(edditz/ccws),英文对其他用户更友好;Claude Code
  理解英文无障碍;区块外内容用户可随时手改成中文。已选英文。
- **自动修复不完整标记**(检测到孤立 begin/end 时自动补全缺失的半个):分支多、难测、易错,且隐式
  改写用户文件违反「绝不冒误删风险」原则。已否决,改为「异常态抛错 + `regen --force` 显式重置」。
