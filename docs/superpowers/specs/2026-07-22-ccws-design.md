# ccws — Claude Code 工作区管理 CLI 设计稿

- 日期:2026-07-22
- 状态:Draft(待用户审查)
- 项目名:`ccws`(Claude Code WorkSpace)

## 1. 背景与目标

Claude Code 支持通过 `.claude/settings.json` 的 `permissions.additionalDirectories` 数组,把多个外部目录纳入当前会话的可访问范围(等价于 CLI 的 `--add-dir`、SDK 的 `additionalDirectories`)。利用这一点,可以用一个"空文件夹"作为聚合点,关联若干真实项目目录,形成一个**工作区**:在该文件夹启动 Claude Code,即可同时操作所有关联目录。

目前手动管理这套关联需要直接编辑 JSON,体验差、易出错、无全局视图。**ccws** 是一个命令行工具,提供工作区的创建、目录关联管理、状态查看、一键启动 Claude Code 等能力。

**目标**:

- 用命令行取代手编 JSON 管理工作区
- 提供全局工作区视图(约定根目录扫描,无中心索引)
- 可脚本化(命令优先),兼顾人工向导(可选交互)
- 单文件可执行分发,免装 Node 运行时

## 2. 核心概念

- **工作区(Workspace)**:约定根目录下的一个子目录 `$ROOT/<name>/`,内含 `.claude/settings.json`,其 `permissions.additionalDirectories: string[]` 列出关联的外部目录。
- **约定根(Convention Root)`$ROOT`**:所有工作区的统一存放处,默认 `~/ccws/`,可被环境变量 `CCWS_ROOT` 或全局 `--root <path>` 覆盖。
- **工作区发现**:扫描 `$ROOT` 下每个含 `.claude/settings.json` 的一级子目录。
- **就近推断**:当命令未显式指定 `--workspace <name>` 时,若当前 cwd 位于 `$ROOT/<x>/` 内(含其子孙),则默认操作工作区 `<x>`;否则要求显式指定 `--workspace`。

## 3. 功能范围(命令规格)

| 命令 | 行为 |
|---|---|
| `ccws init <name> [--root <path>] [--interactive] [--force]` | 在 `$ROOT/<name>` 创建目录 + 生成 `.claude/settings.json` 骨架(`permissions.additionalDirectories: []`)。`--interactive` 用 `@clack/prompts` 选要关联的目录。已存在则报错,`--force` 覆盖重建。 |
| `ccws add <dir...> [--workspace <name>]` | 将目录加入该工作区的 `permissions.additionalDirectories`。`--workspace` 缺省时按就近推断。**路径一律存绝对路径**(相对路径输入用 `path.resolve` 相对当前 cwd 解析为绝对)。去重;**先校验全部目录存在,任一不存在则整次操作失败(原子性:不写入任何变更),并列出无效路径**。 |
| `ccws remove <dir...> [--workspace <name>]` | 从 `permissions.additionalDirectories` 移除,按规范化路径匹配;未匹配的给出提示。 |
| `ccws list [name]` (别名 `ls`) | 无参:扫描 `$ROOT` 列出所有工作区 + 各自关联目录数。有参:显示该工作区详情(关联目录清单 + 每个路径是否存在)。 |
| `ccws status` | 按 cwd 就近判断当前工作区,显示其关联目录与有效性;不在任何工作区内则提示。 |
| `ccws open <name>` | `process.chdir('$ROOT/<name>')` 后 `spawn('claude', { stdio: 'inherit' })`,继承终端。 |

全局选项:`-r, --root <path>`(覆盖 `$ROOT`)、`-V, --version`、`-h, --help`。`$ROOT` 解析优先级:命令行 `--root` > 环境变量 `CCWS_ROOT` > 默认 `~/ccws/`。

## 4. 非目标(YAGNI)

- 不维护中心注册表/数据库(用约定根扫描代替)
- 不做工作区模板、标签、分组(v1 不做)
- 不做远端同步、团队共享
- 不管 `settings.json` 的其他字段(只读写 `permissions.additionalDirectories`)
- 不做 `ccws` 自身的交互式 TUI 主界面(交互仅在 `init --interactive`)

## 5. 架构与项目结构

技术栈:TypeScript + Node 运行时,`commander` 做 CLI,`@clack/prompts` 做可选交互,`vitest` 做测试,`bun build --compile` 产出单文件可执行。

```
ccws/
├── package.json              # bin + scripts(build 用 bun build --compile)
├── tsconfig.json
├── README.md
├── src/
│   ├── cli.ts                # commander 入口,注册子命令与全局选项
│   ├── commands/             # init | add | remove | list | status | open
│   │   ├── init.ts
│   │   ├── add.ts
│   │   ├── remove.ts
│   │   ├── list.ts
│   │   ├── status.ts
│   │   └── open.ts
│   ├── core/
│   │   ├── config.ts         # $ROOT 解析(--root > CCWS_ROOT > ~/ccws)、就近推断、工作区发现(扫描)
│   │   ├── workspace.ts      # 工作区 CRUD(建目录 + 生成 settings.json 骨架)
│   │   ├── settings.ts       # .claude/settings.json 读写:保留其余字段,仅合并 additionalDirectories
│   │   └── paths.ts          # 路径规范化(→绝对路径)、存在性校验、去重
│   ├── utils/
│   │   ├── log.ts            # 输出格式化(成功/错误/表格)
│   │   └── fs.ts             # 安全文件操作
│   └── types.ts              # SettingsJson / Workspace 等类型
└── tests/                    # core 单元 + commands 集成
    ├── core/
    └── commands/
```

**分层职责**(高内聚、低耦合,便于独立测试):

- `commands/*`:只做参数解析 → 调 core → 用 utils 输出。不含业务逻辑。
- `core/*`:纯逻辑,可被命令与测试直接调用,不直接 `console.log`。
- `utils/*`:副作用收敛(文件 I/O、终端输出)。

## 6. 数据模型与文件操作策略

**SettingsJson 类型**(`src/types.ts`):

```ts
interface SettingsJson {
  permissions?: {
    additionalDirectories?: string[];
    // 保留其余未知字段
    [key: string]: unknown;
  };
  [key: string]: unknown; // 保留顶层其余字段
}
```

**读写策略**(`core/settings.ts`):

1. 读取 `.claude/settings.json`;若不存在,add/remove 报错并引导 `ccws init`。
2. `JSON.parse` 失败 → 报错,**绝不覆盖**原文件。
3. 解析后对象保留原 key 顺序(V8 对字符串 key 保插入顺序),只修改 `permissions.additionalDirectories`。
4. 写回:`JSON.stringify(obj, null, 2) + "\n"`,2 空格缩进。
5. `permissions` 或 `additionalDirectories` 不存在时按需补建为 `[]`。

**路径规范化**(`core/paths.ts`):

- 统一用 `path.resolve(input)`(相对路径输入相对当前 cwd 解析为绝对路径;不强制 `realpath`,避免符号链接/不存在路径报错)。
- 去重基于规范化后的(绝对路径)字符串。

**工作区发现**(`core/config.ts`):

- 列 `$ROOT` 下所有一级子目录,过滤出含 `.claude/settings.json` 的,解析为 `{ name, path, dirs: string[], missing: number }`。

## 7. 错误处理与边界

| 场景 | 处理 |
|---|---|
| `settings.json` 非 JSON | 报错,保留原文件不动 |
| `--root` / `CCWS_ROOT` 指向非目录或不可访问 | 报错退出 |
| `init <name>` 已存在 | 报错;`--force` 覆盖 |
| `add` 任一目录不存在 | 整次操作失败、**不修改 settings.json**(原子性),列出无效路径,退出非 0 |
| `add` 目录重复 | 去重,提示 "already associated" |
| `remove` 目录未关联 | 提示 "not associated",非 0 退出 |
| 未显式 `--workspace` 且 cwd 不在任何工作区内 | 报错,要求 `--workspace` 或 `cd` 进工作区 |
| 工作区不存在 | 报错并列出可用工作区 |
| `open` 时 `claude` 不在 PATH | 报错并提示安装 Claude Code |
| 任何未捕获错误 | 打印友好信息,退出码 1;`--debug` 打印堆栈 |

退出码约定:成功 0;任何用户可恢复错误(含目录不存在)1;未捕获异常 1。

## 8. 测试策略(vitest)

- **core 单元**:
  - `settings.ts`:读/写/合并、保留未知字段、JSON 损坏时不覆盖、key 顺序。
  - `paths.ts`:规范化为绝对路径、去重、边界(空、`.`、`..`)。
  - `config.ts`:`$ROOT` 解析优先级、就近推断、工作区发现。
- **commands 集成**(用临时目录作 `$ROOT`):
  - `init` 建目录与骨架、`--force` 覆盖、已存在报错。
  - `add`/`remove` 改动文件系统 + 去重 + 输出;`add` 任一目录不存在 → 原子失败(断言 settings.json 未被修改)。
  - `list`/`status` 输出格式。
  - `open` 用 stub 替换 `claude`(避免真实启动),断言 `chdir` 与 spawn 参数。
- **覆盖率目标**:≥ 80%。

## 9. 构建与分发

- 开发:`bun install`、`bun run src/cli.ts <cmd>`(或 `pnpm`)。
- 构建:`bun build src/cli.ts --compile --outfile=ccws` → 当前平台单文件。
- 全平台矩阵:`scripts/build-all.sh` 循环 `--target` 产出:
  - `bun-darwin-arm64` → `ccws-darwin-arm64`
  - `bun-darwin-x64` → `ccws-darwin-x64`
  - `bun-linux-x64` → `ccws-linux-x64`
  - `bun-windows-x64` → `ccws-windows-x64.exe`
- 产物放 `dist/`,可选 GitHub Actions release 矩阵构建(后续)。

## 10. 验收标准

1. `ccws init demo && ccws add ~/projects/a ~/projects/b -w demo` 后,`demo/.claude/settings.json` 的 `permissions.additionalDirectories` 含两个绝对路径,其余字段不变。
2. `ccws list` 列出 `demo` 及关联数;`ccws list demo` 显示详情与存在性。
3. `ccws status` 在 `$ROOT/demo` 内正确识别。
4. `ccws open demo` 能在该目录拉起 `claude`(或 stub 验证调用)。
5. 单文件可执行在 macOS 上可直接运行,无需 Node。
6. 测试覆盖率 ≥ 80%。
