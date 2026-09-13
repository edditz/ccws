# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目

`ccws` 管理 Claude Code **工作区**:一个空文件夹,通过其 `.claude/settings.json` 的 `permissions.additionalDirectories` 关联多个外部目录;在该文件夹启动 claude 即可访问全部关联目录。约定根 `$ROOT`(默认 `~/.ccws/`)下每个子目录是一个工作区,**无中心索引**,靠扫描 `$ROOT` 发现。

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

CLI 子命令:`init`(含 `-i/--interactive`、`-f/--force`)、`add`、`remove`、`list`(别名 `ls`)、`status`、`open`、`resume`(恢复工作区里的 claude 会话:`resume <name> [session-id]`,带 id → `claude --resume <id>`,不带 → 交互选择器)、`update`(自更新二进制,带 `--check`/`--force`/`--repo`)、`regen`(重建工作区 CLAUDE.md,带 `--force`)、`bypass`(开关工作区 `permissions.defaultMode: "bypassPermissions"`,`on`/`off`/无参 getter)、`delete`(别名 `rm`,递归删除整个工作区,确认框 + `-f/--force` 跳过)。全局 `-r/--root <path>` 覆盖 `$ROOT`(优先级 `--root` > `CCWS_ROOT` 环境变量 > `~/.ccws/`)。`open`/`resume` 会等待 claude 退出并传播其退出码;干净退出时擦除 claude 自带的 `Resume this session with:` 提示行、改打印 `resume this session: ccws resume <name> <session-id>`(id 从磁盘找回,见架构层 claude-session.ts)。

## 架构

严格三层,依赖单向向下:

- **`src/core/`** — 纯逻辑,不直接做终端 I/O。`paths.ts`(绝对路径规范化/去重/存在校验)、`settings.ts`(读写 settings.json)、`config.ts`(`$ROOT` 解析、cwd 就近推断、工作区扫描发现)、`workspace.ts`(创建/存在判断 + `validateWorkspaceName`)。
- **`src/commands/`** — 编排层:解析参数 → 调 core → 用 `utils/log` 输出。**不含业务逻辑**。
- **`src/utils/log.ts`** — 唯一的终端输出口(info/success→stdout,error/warn→stderr)。**`src/utils/claude-session.ts`** — spawn claude + 等待退出 + 干净退出时的提示行擦除(SIGINT 处理也在这里),`open`/`resume` 共用;提示行里的 session id 靠退出后扫 `~/.claude/projects/<munged-cwd>/` 找回:munge 规则 = cwd 非字母数字字符全部替换为 `-`,取 mtime ≥ 启动时刻的最新 `*.jsonl` 文件名;擦除行数常量 `CLAUDE_EXIT_HINT_LINES` 与此 munge 规则都是 **claude 的外部契约**,claude 升级后需重校;扫不到(best-effort)时回退不带 id 的提示。
- **`src/cli.ts`** — commander 入口,注册全部子命令;所有错误经 `fail()` 统一 `log.error` + `process.exit(1)`。`buildCli()` export 供测试;`isMain()` 判断直接执行(在 `bun build --compile` 下走 realpath 回退,见 cli.ts 注释)。

**数据流**:命令拿到 `--workspace` 或按 cwd 就近推断工作区名 → 读 `$ROOT/<name>/.claude/settings.json` → 改 `permissions.additionalDirectories` → 写回(保留其余字段)。

## 关键约定(改代码前必读)

- **路径一律绝对**:`path.resolve` 规范化后存入 `additionalDirectories`,从不存相对路径。
- **`add` 原子失败**:所有目录先 `assertAllExist` 通过才写;任一不存在 → 整次失败、settings.json 不动。
- **settings.json 完整性**:读写须保留未知字段与 key 顺序;`readSettings` 对损坏 JSON 抛错(绝不覆盖),两个 writer(`writeAdditionalDirs` 合并 / `setAdditionalDirs` 替换)都 route through `readSettings` 以共享此行为。
- **workspace name 校验**:`validateWorkspaceName`(core/workspace.ts)拒绝含 `/`、`\` 或 `.`/`..` 段的名字,防路径遍历;`createWorkspace` 与各命令入口都调用它。
- **fail-fast**:workspace 不存在 → 报错引导 `init`,不隐式创建。
- **输出纪律**:源码除 `utils/log.ts` 外**禁用 `console.log`**;命令失败只 `throw`(由 cli.ts 的 `fail` 统一打印,不要在 action 里再调 `error()` 否则双重日志)。
- **不可变**:不修改入参,构造新对象。
- **版本号单一来源**:`package.json` 的 `version` 是唯一真值;`src/cli.ts` 与测试通过 import attributes(`import pkg from "../package.json" with { type: "json" }`)读取,禁止硬编码版本字符串。改版本只动 `package.json` 一处。
- **CLAUDE.md 自动维护**:每个工作区的 `CLAUDE.md` 由 `syncClaudeMd`(`src/core/claude-md.ts`)在 `init`/`add`/`remove`/`regen` 时自动维护;`BEGIN`/`END` 标记(`<!-- ccws:additional-directories:begin -->` / `...:end -->`)圈住自动同步的目录列表区块,**只重写区块内,区块外保留**。标记文本是**发布契约**——老工作区的 CLAUDE.md 里已有,新版 ccws 必须识别原文本,不得修改;若必须迁移,需同时识别新旧标记。标记异常(孤立/多对/顺序颠倒)时 `writeClaudeMd` 抛错、不写文件,由 `regen --force` 全量重写兜底。core 层(`claude-md.ts`)不依赖 `utils/log`,日志由 command 层按 `WriteOutcome` 打印。

## 测试惯例

- 用 `mkdtempSync(tmpdir())` 临时目录作 `CCWS_ROOT`,测完无需清理。
- **macOS 符号链接陷阱**:`detectWorkspaceFromCwd` 用 `path.relative` 做词法判断,而 `/tmp` 是 `/private/tmp` 的符号链接——测试里须对 root `realpathSync` 再传入,否则就近推断失效。
- **`open`/`resume` 测试**:用 `opts.runner` 注入 stub,避免真实 spawn `claude`(真实 defaultRunner 路径不单测);返回 ChildProcess 的 stub 必须是真实 event emitter 并 emit `exit`(命令现在会等待子进程),只 emit `error` 也能让等待侧正常 resolve。
- coverage thresholds 已在 `vitest.config.ts` 接好(各维度 80%),低于会 fail。

## 参考文档

完整设计与逐任务实现计划见 `docs/superpowers/`(specs/ 为设计稿,plans/ 为 TDD 实现计划)。发布/部署流程见 `RELEASING.md`,版本历史见 `CHANGELOG.md`。
