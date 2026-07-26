# `ccws update` 自更新命令 — 设计稿

日期:2026-07-26
状态:已与用户确认设计,待写实现计划

## 背景与动机

ccws 当前通过 **GitHub Releases 编译二进制**(`bun build --compile`)分发,`scripts/install.sh`
负责下载匹配平台的 asset、校验 SHA-256、装到 `~/.local/bin`(详见 `RELEASING.md`)。没有 npm
发布工作流,`package.json` 的 `bin` 只在源码直接跑时用。

用户希望加一个 `update` 子命令做**自更新**:无需重新跑 install.sh,二进制自己拉最新版并替换自己。

## 范围

- 目标分发渠道:**GitHub Releases 编译二进制**(已确认)。不覆盖 npm/bun 源码安装的情况——
  在这些场景下 `update` 检测到并以错误信息引导用户改用 install.sh。
- 平台矩阵:覆盖现有 5 个 asset(`darwin-arm64`、`darwin-x64`、`linux-x64`、`linux-arm64`、
  `windows-x64.exe`)。
- 不在本期范围:prerelease 通道、后台自动检查、npm/brew 包管理器委托、签名验证(仅 SHA-256)。

## 行为契约

`ccws update [options]`

- 无参数:查 GitHub 最新 Release → 若较新则下载、校验、原地替换;已是最新则打印提示并退出 0。
- `--check`:只查不装。有更新时打印最新版号并以**退出码 1** 退出(脚本/CI 友好);已是最新退出 0。
- `--force`:即使最新版号 ≤ 当前也重装(用于修复损坏的本地二进制)。
- `--repo <owner/repo>`(可选):覆盖来源 repo。优先级 `--repo` > `CCWS_REPO` 环境变量 > 写死的
  `edditz/ccws`。命名上与全局 `-r/--root`(工作区根)无关,是本子命令独有 flag,不冲突。
- 输出纪律不变:info/success→stdout,error→stderr,全部经 `utils/log`;命令失败只 `throw`,由
  `cli.ts` 的 `fail()` 统一打印(避免双重日志)。

## 数据流

```
resolve repo(--repo > CCWS_REPO > "edditz/ccws")
  → GET https://api.github.com/repos/<repo>/releases/latest          [injectable fetch]
  → 解析 tag_name (形如 v1.2.3) → stripLeadingV
  → compareVersions(latest, current)                                  [core 纯函数]
  → 决策:
       - 结果 <= 0(最新 ≤ 当前)且 无 --force → 打印"已是最新" + 退出 0
       - --check                            → 打印"有更新 → <ver>" + 退出码 1(不下载)
       - 否则继续下载替换
  → platformToAsset(process.platform, process.arch)                   [core 纯函数]
  → 下载 asset 字节 + checksums.txt 字节                              [injectable fetch]
  → pickChecksum(checksumsText, asset) → 期望 sha256                   [core 纯函数]
  → sha256(下载字节) === 期望?  不匹配 → 抛错,不动任何文件
  → detectBinaryTarget():
       - execPath 不可写(权限)→ 抛错引导 sudo / 检查安装目录
       - execPath 是 bun/node 解释器(源码运行)→ 抛错引导 install.sh
  → atomicReplace(execPath, bytes, { isWindows })                     [injectable replacer]
       - Unix:   同目录 temp 文件 → chmod 0o755 → fs.rename 覆盖(同文件系统原子)
       - Windows: 运行中 .exe rename 成 .old;写新 .exe;尽力 unlink .old
                  (失败则留给下次,不报错)
  → success: "Updated ccws <old> → <new>. Re-run ccws in a new shell."
```

## 模块划分(严守三层)

### `src/core/updater.ts`(纯,无 I/O)

- `compareVersions(a, b): -1 | 0 | 1` — 解析 `x.y.z` 数值比较,**不引入 semver 依赖**。
  约定:`a < b` 返回 `-1`,`a === b` 返回 `0`,`a > b` 返回 `1`。
  决策处用 `compareVersions(latest, current)`:`<= 0`(latest 不比 current 新)→ 跳过;
  `> 0`(latest 更新)→ 下载替换。
- `platformToAsset(platform: string, arch: string): string` — 返回 asset 名,未知平台抛错。
  映射表与 `scripts/install.sh` 保持一致。
- `pickChecksum(checksumsText: string, asset: string): string | null` — 从 `<hash>  <name>` 行
  里取该 asset 的 sha256;未命中返回 null。
- `stripLeadingV(tag: string): string` — 去掉版本号前的 `v`。

### `src/commands/update.ts`(编排 + I/O seam)

- 定义 `UpdateDeps` 接口:`fetch`, `sha256`, `replaceBinary`, `execPath`, `platform`, `arch`。
- 导出 `defaultDeps`:全局 `fetch`、`node:crypto` 的 `createHash('sha256')`、`fs` 的原子替换、
  `process.execPath`、`process.platform/arch`。
- 导出 `updateAction(opts, deps = defaultDeps)`:纯 async,所有副作用经 `deps` 与 `log.*`。
  - `opts`:`{ check: boolean; force: boolean; repo?: string }`。
- 错误一律 `throw`,不在 action 里调 `error()`。

### `src/cli.ts`

注册 `update` 子命令,带 `--check`、`--force`、`--repo <owner/repo>`;action `try/catch → fail`,
与现有命令写法一致。

### `src/utils/log.ts`

不动(已有 info/success/error/warn)。

## 错误处理

- 网络/非 2xx → `throw new Error("Failed to fetch latest release: <status>")`。
- GitHub API 限流(403 + rate limit 标志)→ 抛错提示稍后重试。
- checksum 不匹配 → 抛错,**不替换任何文件**(原子失败原则,与 `add` 一致)。
- execPath 不可写(权限)→ 抛错引导 `sudo ccws update` 或检查安装目录。
- execPath 是 bun/node 解释器(源码运行 / npm 装)→ 抛错引导 `curl -fsSL ...install.sh | bash`。
- 未知平台 → 抛错并列出受支持平台。

## 测试策略

### core 单测(无 I/O)

- `compareVersions`:major/minor/patch 各级升降级、相等、不同位数。
- `platformToAsset`:5 个目标命中;未知平台(如 `win32/arm64`)抛错。
- `pickChecksum`:命中;asset 不在 checksums 里返回 null;多空格/`*` 前缀容错。
- `stripLeadingV`:带 `v`、不带 `v`、`vv` 边界。

### 命令集成测(注入 deps)

用假 `fetch` 返回 release JSON + asset 字节 + checksums;用假 `replaceBinary` 记录调用。覆盖:

- 有新版 → `replaceBinary` 被调用、success 日志含新旧版本号。
- 已最新(无 `--force`)→ `replaceBinary` 不调用、info 日志、退出 0。
- `--check` + 有新版 → `replaceBinary` 不调用、退出码 1。
- `--force` + 同版 → `replaceBinary` 被调用。
- checksum 不匹配 → 抛错、`replaceBinary` 不调用(原子失败)。
- 源码运行(execPath 是 bun)→ 抛错引导 install.sh。
- `--repo` / `CCWS_REPO` 优先级。

### 不单测的部分

真实网络下载 + 真实 fs rename(同 `open` 的 `defaultRunner` 原则),靠代码审查 + 平台分支单测保证。

覆盖率仍走 `vitest.config.ts` 的 80% 阈值。

## 关键约定对齐

- **版本号单一来源**:当前版本仍从 `package.json` import 读取;最新版来自 Release `tag_name`。
- **原子失败**:checksum 不过不动文件,与 `add` 的 `assertAllExist` 哲学一致。
- **不可变**:core 函数不修改入参。
- **输出纪律**:除 `utils/log.ts` 外禁用 `console.log`;失败只 `throw`。

## 风险与待实现期验证

1. **`process.execPath` 在 `bun build --compile` 二进制下是否指向磁盘上的真实 ccws**:
   `cli.ts` 注释只说 `argv[1]` / `import.meta.url` 是虚拟 bunfs 路径,`execPath` 应是真实路径
   但**必须实测确认**。实现时先写一个最小 probe 打印 `process.execPath` 验证;若不是真实路径,
   改用其他定位策略(如 `realpathSync(process.argv[0])`)。
2. **Windows rename trick**:CI 矩阵无 windows runner 跑真实替换,靠 `platform === 'win32'` 分支
   单测 + 代码审查保证。Windows 上 `.old` 删除失败不视为错误。

## 未采纳的备选方案(留档)

- **Re-run install.sh**:update 内部 shell out 调 `curl install.sh | bash`。代码最少,但二进制执行
  远程脚本体验糙、依赖 curl/bash,且 install.sh 必须传 `--repo`。已否决。
- **包管理器委托**(brew/npm):当前无 brew formula、无 npm 发布,不可用。未来加了这些渠道再议。
- **交互式确认**(`@clack/prompts`):已否决,保持脚本友好;`--check` 已覆盖"只查"需求。
