# `ccws mode` 权限模式命令 — 设计稿

日期:2026-09-13
状态:已实现

## 背景与动机

Claude Code v2.1.257(2026-09-01)起,项目级 `.claude/settings.json` 里的
`permissions.defaultMode: "bypassPermissions"` 与 `"auto"` 被静默忽略,
session 落在 Manual 模式。ccws 的 `bypass on`(写 workspace settings.json)
因此失效;且 project 此前完全没有权限模式支持。

官方 changelog 原文:

> Changed `defaultMode: "bypassPermissions"` in `.claude/settings.json` or
> `.claude/settings.local.json` to be ignored, like `"auto"`; set it in user
> or managed settings, or pass `--permission-mode`

仍然可靠的通道是启动 flag:`claude --permission-mode <mode>`,优先级最高、
对全部模式生效(本机 claude 2.1.231 实测接受
`acceptEdits / auto / bypassPermissions / manual / dontAsk / plan`)。

用户需求:泛化 bypass 为 `ccws mode` 命令,**workspace 与 project 都支持**;
`bypass` 保留为常驻快捷方式(不标废弃)。

## 关键决策

- **双后端存储,统一读写接口**(`src/core/mode.ts`):
  - workspace:继续用其 `permissions.defaultMode`(`setDefaultMode` 泛化自
    `setBypassPermissions`)。零迁移;旧版 claude(<2.1.257)读文件、新版靠
    flag,双通道兼容,值相同叠加无冲突。
  - project:sidecar 文件 `$ROOT/.ccws/modes/<name>`(内容 = 模式串 + `\n`)。
    project 目标只读,`$ROOT` 是 ccws 唯一可写处;每 entry 一文件,无读改写
    竞争、无单点损坏。`delete` 注销时一并清理。两个 discover 天然忽略
    `.ccws` 目录(非 symlink、无 settings.json)。
- **取值集合**以 claude `--help` 为准:`acceptEdits | auto | bypassPermissions |
  manual | dontAsk | plan`;`off`/`default` 为清除别名。**写路径校验**
  (`parseModeValue` 友好报错列出合法值),**读路径不校验**原样透传——claude
  拥有模式词表且会扩值,存储的未来新模式不能挡住读取;claude 启动时自己校验。
- **命令面** `mode [name] [value]`:0 参 getter(cwd 就近解析,workspace →
  project 两步,同 status);单参是模式关键字 → 对 cwd entry 设置(与
  `bypass on` 习惯对齐),否则视为 entry 名 → getter;2 参显式设置。取值
  优先(value-first)是确定性的:名字若撞关键字,2 参形式是逃生口
  (`ccws mode auto plan` 设置名为 auto 的 entry)。dangling 允许 get/set
  (sidecar 是 ccws 自己的状态,不碰缺失目标)。
- **启动传参**:`launchCwd` 重构为 `resolveLaunchTarget` 返回
  `{ entry, cwd }`;`launchModeArgs` 读到非空 mode 就前置
  `["--permission-mode", mode]`(resume 中置于 `--resume` 前;顺序与 claude
  无关,固定顺序只为测试断言稳定)。**best-effort 降级**:读 mode 失败
  (corrupt settings)只 `warn` 后不带 flag 照常启动——启动不因边缘元数据
  阻塞,降级方向只会更多确认提示、不会更少;报告类命令(status/list/mode)
  保持严格抛错。
- **`.ccws` 保留名**:`validateWorkspaceName` 拒绝字面 `.ccws`。具体风险:
  `init <名为.ccws的目录>` 会在 `$ROOT` 建 `.ccws` symlink 指向用户目录,
  首次 project mode 写入 `mkdirSync($ROOT/.ccws/modes, {recursive:true})` 会
  穿过 symlink 在用户目录里建 `modes/`,破坏只读保证。双层防护:入口校验
  挡新增登记,`setStoredMode` 再用 `lstat` 结构性检查 `$ROOT/.ccws` 必须是
  真目录(存量遗留的 symlink/文件也拒绝),约定之外再关一道门。
- **显示**:`ls -l` workspace 行 `bypass: ON/off` → `mode: <value|default>`;
  project 行(分组与单名视图)仅在存有 mode 时追加 `mode: <value>`
  (project 行以目标路径为主,不为每个 project 刷 `mode: default` 噪音);
  `status` 对 workspace 与健康 project 各加一行 mode,dangling 跳过
  (target missing 警告优先)。
- **bypass 快捷方式**:内部改走 `setDefaultMode(path, BYPASS_MODE)` /
  `(path, undefined)`,信息与 `requireWorkspace` 拦截不变,存量测试原样通过;
  help 描述标注为 `ccws mode bypassPermissions` 的快捷方式。

## 外部契约(claude 升级后需复校)

- `--permission-mode` 的取值集(当前 6 值)与最高优先级;
- project 级 settings 忽略 `bypassPermissions`/`auto` 的行为(v2.1.257 起);
- 退出提示行擦除 `CLAUDE_EXIT_HINT_LINES` 与 mode 无关,但随版本一并复校。

## 边界情况

- 名字撞关键字(`ccws mode auto` 优先当值解析)→ 2 参逃生口;
- corrupt settings:`open`/`resume` warn 降级,`mode`/`list`/`status` 抛错;
- sidecar 垃圾内容/空白文件:读路径透传/视为未设置;
- workspace settings `defaultMode` 非 string(如 42):读为 undefined,不上命令行;
- 孤儿 sidecar(entry 被裸 `rm` 而非 `ccws delete`):永久无害,不做 GC;
- cwd 在 `$ROOT/.ccws/...` 内:lexical 推断得到 `.ccws` → resolveEntry 为
  missing → 视为"不在任何 entry 内"(同 status 的 plain-subdir 分支)。
