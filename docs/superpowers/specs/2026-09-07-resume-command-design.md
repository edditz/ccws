# `ccws resume` 恢复命令与 claude 退出提示屏蔽 — 设计稿

日期:2026-09-07
状态:已实现(含退出屏蔽;open/resume 行为统一)

## 背景与动机

claude 2.1.x 每次交互式会话结束都会在终端打印
`Resume this session with: claude --resume <session-id>`,没有任何官方开关可以关闭。
ccws 的 `open` 命令以 `stdio: "inherit"` spawn claude 后立即返回(fire-and-forget),
用户退出会话后看到的是 claude 原生命令提示,与 ccws 的命令体系脱节。

用户需求:

1. 新增 `ccws resume <name> [session-id]`,**与 claude 原生语义保持一致**:
   带 session-id 走 `claude --resume <id>` 精确恢复;不带 id 走 `claude --resume`
   打开 claude 的交互会话选择器。id 透传不校验(claude 负责解析与报错)。
2. claude 进程退出时屏蔽它打印的提示,改打印 ccws 自己的
   `resume this session: ccws resume <name>`(带 id 时附上 id,`--resume` 续同一会话、
   id 跨次恢复仍有效)。
3. 屏蔽行为对 `open` 与 `resume` 统一生效(用户确认)。

## 关键决策

- **ccws 必须存活到 claude 退出**才能做"退出后"动作 → `open`/`resume` 从
  spawn 即返回改为 `await` 子进程退出,并传播退出码(`process.exitCode`)。
  Ctrl+C 时父子同在前台进程组,ccws 若按默认行为终止就活不到打印提示 →
  等待期间挂 no-op SIGINT handler,claude 自己处理并退出后移除。
- **屏蔽机制**:claude 2.1.231 的 TUI 运行在备用屏幕(`?1049h/l`),退出恢复主屏后
  在还原光标处打印(pty 实测):1 空行 + `Resume this session with:` +
  `claude --resume <uuid>` 共 3 行,光标停在第 4 行。因此
  `\x1b[3A\r\x1b[J`(上移 3 行、回列首、擦到屏底)可精确覆盖。行数常量
  `CLAUDE_EXIT_HINT_LINES` 带注释,claude 升级后需重校。
- **仅干净退出(code 0)才擦除+提示**;非零退出/信号死亡原样保留 claude 输出
  (如 `No conversation found with session ID`),并传播退出码。
  空闲会话(零消息)退出 claude 不打印提示,此时擦除只影响主屏底部 3 行
  (接受:仅限 code 0,视觉损失有界)。
- **TTY 门控**:非 TTY(stdout 管道)跳过 ANSI 擦除,hint 仍打印;
  `isTTY` 是 util 层测试缝,command 层不透传。
- **模块归属**:spawn + inherit stdio + ANSI 写出是终端 I/O,按分层约定放
  `src/utils/claude-session.ts`(与 `log.ts` 同层),不进纯逻辑的 `core/`。
  `Runner` 类型与 `defaultRunner` 从 `open.ts` 迁入,`open.ts` re-export 保持兼容。
- workspace 守卫文案与 open 等既有命令逐字重复(仓库既有风格,不抽公共)。

## 范围外

- SIGTERM/SIGHUP:ccws 被外部杀死时 claude 成孤儿继续跑,与旧行为一致,不处理。
- 会话枚举/列表:交给 claude 自己的选择器(`claude --resume`),ccws 不解析
  `~/.claude/projects/`。
- Windows legacy conhost 的 ANSI 降级(Windows Terminal 正常)。
