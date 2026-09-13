# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目

`ccws` 管理 Claude Code **工作区**与**单项目**:

- **workspace**:一个空文件夹,通过其 `.claude/settings.json` 的 `permissions.additionalDirectories` 关联多个外部目录;在该文件夹启动 claude 即可访问全部关联目录。ccws 全权管理其内容(settings.json + CLAUDE.md 自动同步)。
- **project**:散落磁盘各处的现有项目目录,以 `$ROOT` 下指向它的 symlink 登记。ccws 只做登记、启动与会话恢复,**一个字节都不写进项目目录**(只读硬约束);claude 的 cwd 是项目真实路径(登记时 `realpathSync` 固化)。

约定根 `$ROOT`(默认 `~/.ccws/`)是 workspace(真目录)与 project(symlink)共享的**单一名字空间**,二者 basename 不可能冲突;**无中心索引**,靠扫描 `$ROOT` 发现。类型判据一律 `lstatSync`(绝不 follow):symlink → project,真目录 + `.claude/settings.json` → workspace——即使 project 目标里恰好有自己的 `.claude/settings.json`(用户自己的)也不误判。

## 常用命令

```bash
bun install                              # 装依赖
bun run test                             # 全套测试(vitest run)
bun run test tests/core/paths.test.ts    # 单个测试文件
bun run test:watch                       # 监听模式
bun run test -- --coverage               # 带覆盖率(阈值 ≥80% 各维度)
bunx tsc --noEmit                        # 类型检查(无 lint 工具)
bun run src/cli.ts <cmd>                 # 直接跑源码 CLI
bun run build                            # 当前平台单文件 binary → dist/ccws
bun run build:all                        # 全平台矩阵(darwin/linux/windows)
```

CLI 子命令:`init`(双语义:参数是已存在的目录 → 登记为 project(`core/project.ts` 的 `createProject`,建 `$ROOT/<basename>` symlink);否则 → 创建新 workspace,含 `-i/--interactive`、`-f/--force`)、`add`、`remove`、`list`(别名 `ls`,workspace 与 project 分组融合显示、注明类型,project 按目标 mtime 排序,悬空标 `target missing`,`-l` 显示 `mode: <value|default>`)、`status`(按 cwd 就近识别 workspace 或 project,含"cwd 在某 project 目标目录内"的 realpath 前缀匹配)、`open`/`resume`(`resolveLaunchTarget`(commands/open.ts)分流:workspace 在 `$ROOT/<name>` 启动 claude,project 在 symlink 目标启动;有存储 mode 时给 claude 前置 `--permission-mode <mode>`;`resume <name> [session-id]`,带 id → `claude --resume <id>`,不带 → 交互选择器;悬空 project 报错引导 `delete`)、`update`(自更新二进制,带 `--check`/`--force`/`--repo`)、`regen`(重建工作区 CLAUDE.md,带 `--force`)、`mode`(`mode [name] [value]`:workspace 与 project 通用的权限模式 get/set;单参是模式关键字则对 cwd entry 设置、否则视为名字做 getter;`off`/`default` 清除)、`bypass`(workspace 专属快捷方式:`on`/`off` = `mode <name> bypassPermissions`/清除,无参 getter)、`delete`(别名 `rm`:workspace → 递归删除整个工作区,确认框 + `-f/--force` 跳过;project → 仅 `unlinkSync` 登记链接 + 清理 mode sidecar,目标目录绝不动,无需确认)。`add`/`remove`/`regen`/`bypass` 对 project 一律经 `requireWorkspace`(core/workspace.ts)拦截报只读错误(`mode` 除外——它的 project 存储在 `$ROOT` sidecar,不碰目标)。全局 `-r/--root <path>` 覆盖 `$ROOT`(优先级 `--root` > `CCWS_ROOT` 环境变量 > `~/.ccws/`)。`open`/`resume` 会等待 claude 退出并传播其退出码;干净退出时擦除 claude 自带的 `Resume this session with:` 提示行、改打印 `resume this session: ccws resume <name> <session-id>`(id 从磁盘找回,见架构层 claude-session.ts)。project 的 session 恢复依赖 ccws 启动时统一传 realpath 作 cwd——自己 `cd` 穿过 `$ROOT` symlink 再跑 claude 会把 session 落在 symlink 路径的 munge 目录,ccws 找不回;直接在项目真实路径里手动跑 claude 则完全兼容。

## 架构

严格三层,依赖单向向下:

- **`src/core/`** — 纯逻辑,不直接做终端 I/O。`paths.ts`(绝对路径规范化/去重/存在校验 + `isSymlink`)、`settings.ts`(读写 settings.json + `setDefaultMode`)、`config.ts`(`$ROOT` 解析、cwd 就近推断、`resolveEntry` 四态分流、workspace/project 双扫描发现、`detectProjectFromCwd`、`modesStoreDir`/`modeSidecarPath`)、`mode.ts`(封闭模式集 `PERMISSION_MODES` + `parseModeValue` 写路径校验 + `resolveStoredMode`/`setStoredMode` 双后端统一读写 + `removeModeSidecar`)、`workspace.ts`(创建/存在判断 + `validateWorkspaceName`(含保留名 `.ccws`)+ `requireWorkspace` 只读拦截)、`project.ts`(`createProject` 登记:realpath 目标 + basename 命名 + 冲突校验 + `symlinkSync`)。
- **`src/commands/`** — 编排层:解析参数 → 调 core → 用 `utils/log` 输出。**不含业务逻辑**。
- **`src/utils/log.ts`** — 唯一的终端输出口(info/success→stdout,error/warn→stderr)。**`src/utils/claude-session.ts`** — spawn claude + 等待退出 + 干净退出时的提示行擦除(SIGINT 处理也在这里),`open`/`resume` 共用;提示行里的 session id 靠退出后扫 `~/.claude/projects/<munged-cwd>/` 找回:munge 规则 = cwd 非字母数字字符全部替换为 `-`,取 mtime ≥ 启动时刻的最新 `*.jsonl` 文件名;擦除行数常量 `CLAUDE_EXIT_HINT_LINES` 与此 munge 规则都是 **claude 的外部契约**,claude 升级后需重校;扫不到(best-effort)时回退不带 id 的提示。
- **`src/cli.ts`** — commander 入口,注册全部子命令;所有错误经 `fail()` 统一 `log.error` + `process.exit(1)`。`buildCli()` export 供测试;`isMain()` 判断直接执行(在 `bun build --compile` 下走 realpath 回退,见 cli.ts 注释)。

**数据流**:workspace 命令拿到 `--workspace` 或按 cwd 就近推断工作区名 → 读 `$ROOT/<name>/.claude/settings.json` → 改 `permissions.additionalDirectories` → 写回(保留其余字段)。project 流程:`init <path>` → `createProject` 在 `$ROOT/<basename>` 建 symlink → `open`/`resume` 经 `resolveEntry` 分流拿 target 作 cwd 启动 claude → `delete` 只 unlink 该 symlink。

## 关键约定(改代码前必读)

- **路径一律绝对**:`path.resolve` 规范化后存入 `additionalDirectories`,从不存相对路径。
- **`add` 原子失败**:所有目录先 `assertAllExist` 通过才写;任一不存在 → 整次失败、settings.json 不动。
- **settings.json 完整性**:读写须保留未知字段与 key 顺序;`readSettings` 对损坏 JSON 抛错(绝不覆盖),两个 writer(`writeAdditionalDirs` 合并 / `setAdditionalDirs` 替换)都 route through `readSettings` 以共享此行为。
- **workspace name 校验**:`validateWorkspaceName`(core/workspace.ts)拒绝含 `/`、`\` 或 `.`/`..` 段的名字,防路径遍历;字面 `.ccws` 为保留名(ccws 内部状态目录),防止 project mode 写入穿透 symlink 进用户目录;`createWorkspace` 与各命令入口都调用它。
- **fail-fast**:workspace 不存在 → 报错引导 `init`,不隐式创建。
- **project 只读**:ccws 对 project 目标目录只读,唯一拥有的是 `$ROOT` 下的 symlink;`delete` 对 project 只 `unlinkSync`,物理上碰不到真项目(也因此无需确认框)。所有写操作命令经 `requireWorkspace` 拒绝 project。
- **权限模式(mode)**:workspace 的 mode 存其 `permissions.defaultMode`(旧版 claude 直接读文件,新版靠启动 flag,双通道);project 的 mode 存 `$ROOT/.ccws/modes/<name>` sidecar(内容 = 模式串,每 entry 一文件);`open`/`resume` 经 `resolveStoredMode` 读到非空值就前置 `claude --permission-mode <mode>`——`--permission-mode` 的取值集与优先级是 **claude 的外部契约**(claude ≥2.1.257 忽略 project 级 settings 里的 `bypassPermissions`/`auto`,flag 为唯一可靠通道),claude 升级后需复校。写路径按封闭集 `PERMISSION_MODES`(acceptEdits/auto/bypassPermissions/manual/dontAsk/plan)校验(`parseModeValue` 友好报错),读路径不校验原样透传(claude 自己校验,不阻挡未来新模式)。启动路径 best-effort:读 mode 失败(corrupt settings)只 `warn` 降级为不带 flag 照常启动,报告类命令(status/list/mode)保持严格抛错。
- **project 判据与悬空**:`lstatSync` 是唯一类型判据(绝不用 follow 语义的 `statSync`/`existsSync` 判类型);目标被移走/删除后 symlink 悬空,`resolveEntry` 返回 `dangling`,`ls` 标注 `target missing`,`open` 报错引导 `delete`,`delete` 可清理。
- **输出纪律**:源码除 `utils/log.ts` 外**禁用 `console.log`**;命令失败只 `throw`(由 cli.ts 的 `fail` 统一打印,不要在 action 里再调 `error()` 否则双重日志)。
- **不可变**:不修改入参,构造新对象。
- **版本号单一来源**:`package.json` 的 `version` 是唯一真值;`src/cli.ts` 与测试通过 import attributes(`import pkg from "../package.json" with { type: "json" }`)读取,禁止硬编码版本字符串。改版本只动 `package.json` 一处。
- **CLAUDE.md 自动维护**:每个工作区的 `CLAUDE.md` 由 `syncClaudeMd`(`src/core/claude-md.ts`)在 `init`/`add`/`remove`/`regen` 时自动维护;`BEGIN`/`END` 标记(`<!-- ccws:additional-directories:begin -->` / `...:end -->`)圈住自动同步的目录列表区块,**只重写区块内,区块外保留**。标记文本是**发布契约**——老工作区的 CLAUDE.md 里已有,新版 ccws 必须识别原文本,不得修改;若必须迁移,需同时识别新旧标记。标记异常(孤立/多对/顺序颠倒)时 `writeClaudeMd` 抛错、不写文件,由 `regen --force` 全量重写兜底。core 层(`claude-md.ts`)不依赖 `utils/log`,日志由 command 层按 `WriteOutcome` 打印。

## 测试惯例

- 用 `mkdtempSync(tmpdir())` 临时目录作 `CCWS_ROOT`,测完无需清理。
- **macOS 符号链接陷阱**:`detectWorkspaceFromCwd` 用 `path.relative` 做词法判断,而 `/tmp` 是 `/private/tmp` 的符号链接——测试里须对 root `realpathSync` 再传入,否则就近推断失效。project 测试同理:target、root、cwd 都要在同一 realpath 命名空间比较;`detectProjectFromCwd` 内部已 `realpathSync(cwd)`。
- **`open`/`resume` 测试**:用 `opts.runner` 注入 stub,避免真实 spawn `claude`(真实 defaultRunner 路径不单测);返回 ChildProcess 的 stub 必须是真实 event emitter 并 emit `exit`(命令现在会等待子进程),只 emit `error` 也能让等待侧正常 resolve。
- coverage thresholds 已在 `vitest.config.ts` 接好(各维度 80%),低于会 fail。

## 参考文档

完整设计与逐任务实现计划见 `docs/superpowers/`(specs/ 为设计稿,plans/ 为 TDD 实现计划)。发布/部署流程见 `RELEASING.md`,版本历史见 `CHANGELOG.md`。
