# 工作区 `CLAUDE.md` 自动维护 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 ccws 在每个工作区里自动维护一份 `CLAUDE.md`(列出关联目录 + 提醒 Claude 注意 cwd),`init` 生成、`add`/`remove` 自动同步、`regen` 兜底修复;用 `begin…end` 标记区块保护用户手动编辑。

**Architecture:** 新增纯模块 `src/core/claude-md.ts`(渲染 + 三态区块读写,不依赖 `utils/log`);`syncClaudeMd` 是各命令的统一入口(读 settings → 写 CLAUDE.md)。`init`/`add`/`remove` 在改完 settings 后调 `syncClaudeMd`;新增 `regen [name]` 子命令(带 `--force`)走同一入口或强制全量重写。`src/core/config.ts` 加 `claudeMdPath`。

**Tech Stack:** TypeScript(strict,ESM,`.js` import 扩展名)、commander v15、vitest v4、`node:fs`。无新依赖。

## Global Constraints

- **三层架构**:`src/core/claude-md.ts` 是纯逻辑 + 文件 I/O,**不** import `utils/log`(单向向下);日志由 command 层按 `WriteOutcome` 打印。
- **标记常量是发布契约**:`BEGIN = "<!-- ccws:additional-directories:begin -->"`、`END = "<!-- ccws:additional-directories:end -->"` —— 一旦发布不得修改文本(老工作区的 CLAUDE.md 里有旧标记,新版必须识别)。Task 7 登记到项目 `CLAUDE.md`。
- **路径绝对**:`additionalDirectories` 本就是绝对路径,渲染时原样用。
- **不可变**:core 函数不修改入参。
- **settings.json 完整性**:`syncClaudeMd`/`readDirEntries` route through `readSettings` —— 损坏 JSON 即抛错,绝不覆盖。
- **输出纪律**:除 `utils/log.ts` 外禁用 `console.log`;命令失败只 `throw`,由 `cli.ts` 的 `fail()` 统一打印(不在 action 里调 `error()`,避免双重日志)。
- **fail-fast**:`regen` 工作区不存在 → 抛错引导 `init`,不隐式创建。
- **测试惯例**:`mkdtempSync(tmpdir())` 临时 root;涉及 cwd 就近推断时 root 须 `realpathSync`(macOS `/tmp`→`/private/tmp` 符号链接);import 用 `.js` 扩展名;coverage 阈值 80% 四维(`vitest.config.ts`)。
- **missing 判定口径**:与 `paths.ts` 的 `assertAllExist` 一致,都用 `existsSync`(`!existsSync(p)` 即 missing)。

---

## File Structure

- **Modify** `src/core/config.ts` — 追加 `claudeMdPath(root, name)`。
- **Create** `src/core/claude-md.ts` — 常量 `BEGIN`/`END`、`DirEntry`、`WriteOutcome`、`renderDirsBlock`、`renderFull`、`countOccurrences`、`writeClaudeMd`、`readDirEntries`、`syncClaudeMd`、`forceRewriteClaudeMd`。
- **Create** `tests/core/claude-md.test.ts` — 上述全部单测(分三个 task 增量写)。
- **Modify** `tests/core/config.test.ts` — 加 `claudeMdPath` 断言。
- **Modify** `src/commands/init.ts` — 末尾调 `syncClaudeMd`。
- **Modify** `tests/commands/init.test.ts` — 断言 CLAUDE.md 生成。
- **Modify** `src/commands/add.ts` — 写完 settings 调 `syncClaudeMd`。
- **Modify** `src/commands/remove.ts` — 写完 settings 调 `syncClaudeMd`。
- **Modify** `tests/commands/add.test.ts` / `tests/commands/remove.test.ts` — 断言区块同步 + 区块外保留。
- **Create** `src/commands/regen.ts` — `regenAction(name?, { root, force })`。
- **Create** `tests/commands/regen.test.ts` — regen 各路径单测。
- **Modify** `src/cli.ts` — 注册 `regen [name]` + `-r/--root` + `-f/--force`。
- **Modify** `tests/cli.test.ts` — 子命令列表加 `regen`、`--root` 列表加 `regen`、新增 `--force` 注册测试。
- **Modify** `CLAUDE.md`(项目) — CLI 子命令列表加 `regen`;「关键约定」节登记 `BEGIN`/`END` 标记契约。

---

## Task 依赖顺序

Task 1 → Task 2 → Task 3 → (Task 4 ∥ Task 5) → Task 6 → Task 7。

---

## Task 1: `claudeMdPath` + 纯渲染函数

**Files:**
- Modify: `src/core/config.ts`(在 `settingsPath` 之后追加)
- Create: `src/core/claude-md.ts`(常量 + 类型 + `renderDirsBlock` + `renderFull` + `countOccurrences`)
- Modify: `tests/core/config.test.ts`(paths describe 块加断言)
- Test: `tests/core/claude-md.test.ts`(本 task 只写渲染 + 计数部分)

**Interfaces:**
- Produces: `claudeMdPath(root, name): string`;`BEGIN`/`END` 常量;`DirEntry = { path: string; missing: boolean }`;`renderDirsBlock(entries: DirEntry[]): string`;`renderFull(entries: DirEntry[]): string`;`countOccurrences(haystack: string, needle: string): number`。Task 2/3 消费这些。

- [ ] **Step 1: 写失败测试**

修改 `tests/core/config.test.ts` 的 `paths` describe 块(第 31-36 行),加 `claudeMdPath` 断言:

```typescript
import {
  resolveRoot, workspacePath, settingsPath, claudeMdPath,
  detectWorkspaceFromCwd, discoverWorkspaces,
} from "../../src/core/config.js";
// ...
describe("paths", () => {
  it("workspacePath and settingsPath", () => {
    expect(workspacePath(root, "demo")).toBe(join(root, "demo"));
    expect(settingsPath(root, "demo")).toBe(join(root, "demo", ".claude", "settings.json"));
  });
  it("claudeMdPath", () => {
    expect(claudeMdPath(root, "demo")).toBe(join(root, "demo", "CLAUDE.md"));
  });
});
```

创建 `tests/core/claude-md.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  BEGIN,
  END,
  renderDirsBlock,
  renderFull,
  countOccurrences,
} from "../../src/core/claude-md.js";

describe("renderDirsBlock", () => {
  it("renders the empty hint when there are no entries", () => {
    expect(renderDirsBlock([])).toBe(
      "<!-- (none yet — use `ccws add <dir>` to associate directories) -->",
    );
  });
  it("renders one bullet per entry", () => {
    expect(
      renderDirsBlock([
        { path: "/a", missing: false },
        { path: "/b", missing: false },
      ]),
    ).toBe("- /a\n- /b");
  });
  it("marks missing entries with a warning", () => {
    expect(
      renderDirsBlock([
        { path: "/a", missing: false },
        { path: "/gone", missing: true },
      ]),
    ).toBe("- /a\n- /gone  ⚠️ missing");
  });
  it("preserves entry order", () => {
    const out = renderDirsBlock([
      { path: "/z", missing: false },
      { path: "/a", missing: false },
    ]);
    expect(out.split("\n")[0]).toBe("- /z");
  });
});

describe("renderFull", () => {
  it("contains header, BEGIN, END, and footer", () => {
    const out = renderFull([]);
    expect(out).toContain("# Workspace");
    expect(out).toContain(BEGIN);
    expect(out).toContain(END);
    expect(out).toContain("auto-maintained");
  });
  it("places BEGIN before END", () => {
    const out = renderFull([{ path: "/a", missing: false }]);
    expect(out.indexOf(BEGIN)).toBeLessThan(out.indexOf(END));
  });
  it("embeds the dirs block between the markers", () => {
    const out = renderFull([{ path: "/a", missing: false }]);
    const between = out.slice(out.indexOf(BEGIN) + BEGIN.length, out.indexOf(END));
    expect(between).toContain("- /a");
  });
  it("embeds the empty hint when no entries", () => {
    expect(renderFull([])).toContain("none yet");
  });
});

describe("countOccurrences", () => {
  it("counts non-overlapping occurrences", () => {
    expect(countOccurrences("aXaXa", "X")).toBe(2);
    expect(countOccurrences(BEGIN + "x" + BEGIN, BEGIN)).toBe(2);
  });
  it("returns 0 when absent", () => {
    expect(countOccurrences("aaa", "X")).toBe(0);
  });
  it("returns 0 for an empty needle", () => {
    expect(countOccurrences("aaa", "")).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun run test tests/core/claude-md.test.ts tests/core/config.test.ts`
Expected: FAIL — `claudeMdPath` 未导出;`../../src/core/claude-md.js` 模块不存在。

- [ ] **Step 3: 实现 `claudeMdPath`**

在 `src/core/config.ts` 的 `settingsPath` 函数之后追加:

```typescript
export function claudeMdPath(root: string, name: string): string {
  return join(workspacePath(root, name), "CLAUDE.md");
}
```

- [ ] **Step 4: 创建 `src/core/claude-md.ts`(本 task 只写渲染 + 计数部分)**

```typescript
/**
 * Maintenance markers wrapping the auto-managed directory list. These are a
 * published contract: once a workspace ships with them, later ccws versions
 * must keep recognizing the exact text. Do NOT edit.
 */
export const BEGIN = "<!-- ccws:additional-directories:begin -->";
export const END = "<!-- ccws:additional-directories:end -->";

export interface DirEntry {
  path: string;
  missing: boolean;
}

const EMPTY_HINT =
  "<!-- (none yet — use `ccws add <dir>` to associate directories) -->";

const HEADER = `# Workspace

This is a **ccws workspace**. The current directory (your \`cwd\`) is the workspace
itself and is usually empty — the actual project code lives in the **Associated
Directories** listed below.

> **Before running any shell command, check your current directory.** \`cd\` into
> the correct associated directory before operating on it.

## Associated Directories
`;

const FOOTER = `
> The list above is auto-maintained by \`ccws\` (\`init\` / \`add\` / \`remove\` / \`regen\`).
> Edit anything outside the \`begin…end\` markers freely; do not edit the list
> between them — it will be overwritten.
`;

/** Count non-overlapping occurrences of `needle` in `haystack`. Empty needle → 0. */
export function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

export function renderDirsBlock(entries: DirEntry[]): string {
  if (entries.length === 0) return EMPTY_HINT;
  return entries
    .map((e) => `- ${e.path}${e.missing ? "  ⚠️ missing" : ""}`)
    .join("\n");
}

export function renderFull(entries: DirEntry[]): string {
  return `${HEADER}\n${BEGIN}\n${renderDirsBlock(entries)}\n${END}\n${FOOTER}`;
}
```

> 注:本 task 的渲染/计数函数是纯字符串操作,无需任何 import。`node:fs`、`./config`、`./settings` 分别在 Task 2(`writeClaudeMd` 用 fs)、Task 3(`readDirEntries` 用 config/settings)按需添加 —— 每个 task 只 import 自己用到的,保持文件干净(`tsconfig` 未开 `noUnusedLocals`,但仍遵循此卫生规则)。

- [ ] **Step 5: 跑测试确认通过**

Run: `bun run test tests/core/claude-md.test.ts tests/core/config.test.ts`
Expected: PASS。

- [ ] **Step 6: 类型检查**

Run: `bunx tsc --noEmit`
Expected: 无错误(若有未使用 import 报错,按 Step 4 注释处理)。

- [ ] **Step 7: Commit**

```bash
git add src/core/config.ts src/core/claude-md.ts tests/core/config.test.ts tests/core/claude-md.test.ts
git commit -m "feat(claude-md): add claudeMdPath and pure renderers"
```

---

## Task 2: `writeClaudeMd`(三态 + 异常态)

**Files:**
- Modify: `src/core/claude-md.ts`(追加 `WriteOutcome` + `writeClaudeMd`)
- Test: `tests/core/claude-md.test.ts`(追加 `writeClaudeMd` describe 块)

**Interfaces:**
- Produces: `WriteOutcome = "created" | "rewrote-block" | "appended"`;`writeClaudeMd(path: string, entries: DirEntry[]): WriteOutcome`(异常态抛 `Error`,不写文件)。Task 3 的 `syncClaudeMd` 消费。

- [ ] **Step 1: 写失败测试**

在 `tests/core/claude-md.test.ts` 顶部 import 加 `writeClaudeMd`,并补 `beforeEach`/fs import:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BEGIN,
  END,
  renderDirsBlock,
  renderFull,
  countOccurrences,
  writeClaudeMd,
} from "../../src/core/claude-md.js";
```

在文件末尾追加:

```typescript
describe("writeClaudeMd", () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ccws-md-"));
    file = join(dir, "CLAUDE.md");
  });

  it("creates the file with full content when absent, returns 'created'", () => {
    const out = writeClaudeMd(file, [{ path: "/a", missing: false }]);
    expect(out).toBe("created");
    const content = readFileSync(file, "utf8");
    expect(content).toContain("# Workspace");
    expect(content).toContain("- /a");
  });

  it("rewrites only the block on a single complete pair, preserving outside content", () => {
    const initial =
      "# My custom notes\n\nimportant line\n\n" +
      `${BEGIN}\n- /old\n${END}\n\nfooter notes\n`;
    writeFileSync(file, initial, "utf8");
    const out = writeClaudeMd(file, [{ path: "/new", missing: false }]);
    expect(out).toBe("rewrote-block");
    const content = readFileSync(file, "utf8");
    expect(content).toContain("important line");
    expect(content).toContain("footer notes");
    expect(content).toContain("- /new");
    expect(content).not.toContain("- /old");
  });

  it("appends a block when no markers exist, returns 'appended'", () => {
    writeFileSync(file, "# Just my notes\n", "utf8");
    const out = writeClaudeMd(file, [{ path: "/a", missing: false }]);
    expect(out).toBe("appended");
    const content = readFileSync(file, "utf8");
    expect(content).toContain("# Just my notes");
    expect(content).toContain("- /a");
    expect(content).toContain(BEGIN);
    expect(content).toContain(END);
  });

  it("is idempotent: append then sync again rewrites the block, no second block", () => {
    writeFileSync(file, "# Notes\n", "utf8");
    writeClaudeMd(file, [{ path: "/a", missing: false }]);
    const out2 = writeClaudeMd(file, [
      { path: "/a", missing: false },
      { path: "/b", missing: false },
    ]);
    expect(out2).toBe("rewrote-block");
    const content = readFileSync(file, "utf8");
    expect(countOccurrences(content, BEGIN)).toBe(1);
    expect(countOccurrences(content, END)).toBe(1);
    expect(content).toContain("- /b");
  });

  it("throws and leaves the file unchanged on an orphan BEGIN", () => {
    writeFileSync(file, `# Notes\n${BEGIN}\n- /old\n`, "utf8");
    const before = readFileSync(file, "utf8");
    expect(() => writeClaudeMd(file, [{ path: "/a", missing: false }])).toThrow(
      /incomplete|malformed/i,
    );
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("throws on an orphan END", () => {
    writeFileSync(file, `# Notes\n${END}\n`, "utf8");
    expect(() => writeClaudeMd(file, [])).toThrow(/incomplete|malformed/i);
  });

  it("throws on multiple BEGIN markers (with a matching END)", () => {
    writeFileSync(file, `${BEGIN}\n${BEGIN}\n${END}\n`, "utf8");
    expect(() => writeClaudeMd(file, [])).toThrow(/incomplete|malformed/i);
  });

  it("throws when END appears before BEGIN", () => {
    writeFileSync(file, `${END}\n${BEGIN}\n`, "utf8");
    expect(() => writeClaudeMd(file, [])).toThrow(/incomplete|malformed/i);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun run test tests/core/claude-md.test.ts`
Expected: FAIL — `writeClaudeMd` 未导出。

- [ ] **Step 3: 实现 `writeClaudeMd`**

在 `src/core/claude-md.ts` **顶部**加 import(Task 1 未引入 fs):

```typescript
import { existsSync, readFileSync, writeFileSync } from "node:fs";
```

在 `renderFull` 之后追加:

```typescript
export type WriteOutcome = "created" | "rewrote-block" | "appended";

/**
 * Sync the dirs block of a CLAUDE.md file. Three states + an error state:
 *
 * - file absent                                   → write renderFull, return "created"
 * - exactly one BEGIN..END pair (BEGIN before END) → replace between markers, return "rewrote-block"
 * - no markers at all                              → append a pair, return "appended"
 * - anything else (orphan marker, multiple pairs, END before BEGIN)
 *                                                  → THROW, leave the file untouched
 *
 * The error state refuses to write because appending onto a malformed file can
 * produce multiple BEGINs, and the next "replace between markers" pass would
 * then span and destroy user content between them.
 */
export function writeClaudeMd(path: string, entries: DirEntry[]): WriteOutcome {
  if (!existsSync(path)) {
    writeFileSync(path, renderFull(entries), "utf8");
    return "created";
  }
  const content = readFileSync(path, "utf8");
  const beginIdx = content.indexOf(BEGIN);
  const endIdx = content.indexOf(END);
  const countBegin = countOccurrences(content, BEGIN);
  const countEnd = countOccurrences(content, END);

  if (countBegin === 1 && countEnd === 1 && beginIdx < endIdx) {
    const next =
      content.slice(0, beginIdx + BEGIN.length) +
      "\n" +
      renderDirsBlock(entries) +
      "\n" +
      content.slice(endIdx);
    writeFileSync(path, next, "utf8");
    return "rewrote-block";
  }

  if (countBegin === 0 && countEnd === 0) {
    const next =
      content.replace(/\n*$/, "") +
      "\n\n" +
      BEGIN +
      "\n" +
      renderDirsBlock(entries) +
      "\n" +
      END +
      "\n";
    writeFileSync(path, next, "utf8");
    return "appended";
  }

  throw new Error(
    `ccws maintenance markers in ${path} are incomplete/malformed — sync skipped to avoid damage. Fix the markers (ensure exactly one begin…end pair) or run \`ccws regen --force\` to rewrite the whole file.`,
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun run test tests/core/claude-md.test.ts`
Expected: PASS(全部 8 个 writeClaudeMd 用例 + Task 1 用例)。

- [ ] **Step 5: 类型检查 + 覆盖率**

Run: `bunx tsc --noEmit && bun run test tests/core/claude-md.test.ts -- --coverage`
Expected: 无类型错误;`src/core/claude-md.ts` 覆盖率 ≥80%(本 task 后 writeClaudeMd 三分支均覆盖)。

- [ ] **Step 6: Commit**

```bash
git add src/core/claude-md.ts tests/core/claude-md.test.ts
git commit -m "feat(claude-md): add writeClaudeMd three-state block sync"
```

---

## Task 3: `readDirEntries` + `syncClaudeMd` + `forceRewriteClaudeMd`

**Files:**
- Modify: `src/core/claude-md.ts`(追加三个函数)
- Test: `tests/core/claude-md.test.ts`(追加 describe 块)

**Interfaces:**
- Produces: `readDirEntries(root, name): DirEntry[]`;`syncClaudeMd(root, name): WriteOutcome`;`forceRewriteClaudeMd(path, entries): void`。Task 4/5/6 消费。

- [ ] **Step 1: 写失败测试**

在 `tests/core/claude-md.test.ts` 顶部 import 追加 `syncClaudeMd`、`readDirEntries`、`forceRewriteClaudeMd`,并补 `createWorkspace`/`writeAdditionalDirs`/`existsSync`/`realpathSync` import:

```typescript
import { mkdtempSync, readFileSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkspace } from "../../src/core/workspace.js";
import { writeAdditionalDirs } from "../../src/core/settings.js";
import { claudeMdPath, settingsPath } from "../../src/core/config.js";
import {
  BEGIN,
  END,
  renderDirsBlock,
  renderFull,
  countOccurrences,
  writeClaudeMd,
  syncClaudeMd,
  readDirEntries,
  forceRewriteClaudeMd,
} from "../../src/core/claude-md.js";
```

在文件末尾追加:

```typescript
describe("readDirEntries / syncClaudeMd / forceRewriteClaudeMd", () => {
  let root: string;
  let realDir: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "ccws-root-")));
    realDir = realpathSync(mkdtempSync(join(tmpdir(), "real-")));
  });

  it("readDirEntries maps settings dirs to entries with the missing flag", () => {
    createWorkspace(root, "demo");
    writeAdditionalDirs(settingsPath(root, "demo"), [realDir, "/does/not/exist"]);
    expect(readDirEntries(root, "demo")).toEqual([
      { path: realDir, missing: false },
      { path: "/does/not/exist", missing: true },
    ]);
  });

  it("readDirEntries returns [] when additionalDirectories is absent", () => {
    createWorkspace(root, "demo");
    expect(readDirEntries(root, "demo")).toEqual([]);
  });

  it("syncClaudeMd creates CLAUDE.md when absent, with the empty hint", () => {
    createWorkspace(root, "demo");
    const out = syncClaudeMd(root, "demo");
    expect(out).toBe("created");
    const content = readFileSync(claudeMdPath(root, "demo"), "utf8");
    expect(content).toContain("none yet");
  });

  it("syncClaudeMd reflects current dirs and marks missing ones", () => {
    createWorkspace(root, "demo");
    writeAdditionalDirs(settingsPath(root, "demo"), [realDir, "/gone"]);
    syncClaudeMd(root, "demo");
    const content = readFileSync(claudeMdPath(root, "demo"), "utf8");
    expect(content).toContain(`- ${realDir}`);
    expect(content).toContain("- /gone  ⚠️ missing");
  });

  it("syncClaudeMd is idempotent (second call returns 'rewrote-block')", () => {
    createWorkspace(root, "demo");
    writeAdditionalDirs(settingsPath(root, "demo"), [realDir]);
    syncClaudeMd(root, "demo");
    expect(syncClaudeMd(root, "demo")).toBe("rewrote-block");
  });

  it("syncClaudeMd routes corrupt settings through readSettings (throws, no write)", () => {
    createWorkspace(root, "demo");
    writeFileSync(settingsPath(root, "demo"), "{ not json", "utf8");
    expect(() => syncClaudeMd(root, "demo")).toThrow(/corrupt/i);
  });

  it("forceRewriteClaudeMd overwrites the whole file, discarding outside content", () => {
    createWorkspace(root, "demo");
    const file = claudeMdPath(root, "demo");
    writeFileSync(file, "# precious custom content\n", "utf8");
    forceRewriteClaudeMd(file, [{ path: realDir, missing: false }]);
    const content = readFileSync(file, "utf8");
    expect(content).not.toContain("precious custom content");
    expect(content).toContain("# Workspace");
    expect(content).toContain(`- ${realDir}`);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun run test tests/core/claude-md.test.ts`
Expected: FAIL — `syncClaudeMd`/`readDirEntries`/`forceRewriteClaudeMd` 未导出。

- [ ] **Step 3: 实现三个函数**

在 `src/core/claude-md.ts` **顶部**加 import(Task 1/2 未引入 config/settings):

```typescript
import { claudeMdPath, settingsPath } from "./config.js";
import { readSettings } from "./settings.js";
```

在 `writeClaudeMd` 之后追加:

```typescript
/** Read additionalDirectories from settings and tag each with missing flag. */
export function readDirEntries(root: string, name: string): DirEntry[] {
  const settings = readSettings(settingsPath(root, name));
  const dirs: string[] = settings.permissions?.additionalDirectories ?? [];
  return dirs.map((p) => ({ path: p, missing: !existsSync(p) }));
}

/** Read settings → write CLAUDE.md. Transparently returns writeClaudeMd's outcome / throws. */
export function syncClaudeMd(root: string, name: string): WriteOutcome {
  return writeClaudeMd(claudeMdPath(root, name), readDirEntries(root, name));
}

/** Unconditionally overwrite the whole file with renderFull (the --force path). */
export function forceRewriteClaudeMd(path: string, entries: DirEntry[]): void {
  writeFileSync(path, renderFull(entries), "utf8");
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun run test tests/core/claude-md.test.ts`
Expected: PASS。

- [ ] **Step 5: 类型检查**

Run: `bunx tsc --noEmit`
Expected: 无错误(`existsSync`/`readFileSync`/`writeFileSync`/`claudeMdPath`/`settingsPath`/`readSettings` 现在都被使用)。

- [ ] **Step 6: Commit**

```bash
git add src/core/claude-md.ts tests/core/claude-md.test.ts
git commit -m "feat(claude-md): add syncClaudeMd, readDirEntries, forceRewriteClaudeMd"
```

---

## Task 4: `init` 接入 `syncClaudeMd`

**Files:**
- Modify: `src/commands/init.ts`(末尾调 `syncClaudeMd`)
- Test: `tests/commands/init.test.ts`(加 CLAUDE.md 断言)

**Interfaces:**
- Consumes: `syncClaudeMd(root, name)` from Task 3。

- [ ] **Step 1: 写失败测试**

在 `tests/commands/init.test.ts` 顶部 import 加 `claudeMdPath` 和 `BEGIN`:

```typescript
import { claudeMdPath } from "../../src/core/config.js";
import { BEGIN } from "../../src/core/claude-md.js";
```

在 `describe("initAction", () => { ... })` 内末尾追加两个用例:

```typescript
  it("generates a CLAUDE.md with an empty dirs block on init", async () => {
    await initAction("demo", { root });
    const content = readFileSync(claudeMdPath(root, "demo"), "utf8");
    expect(content).toContain("# Workspace");
    expect(content).toContain(BEGIN);
    expect(content).toContain("none yet");
  });

  it("--interactive reflects collected dirs in CLAUDE.md", async () => {
    const dir = mkdtempSync(join(tmpdir(), "real-"));
    const answers = [dir, ""];
    let i = 0;
    const promptText = async () => answers[i++] ?? "";
    await initAction("demo", { root, interactive: true, promptText });
    const content = readFileSync(claudeMdPath(root, "demo"), "utf8");
    expect(content).toContain(`- ${resolve(dir)}`);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun run test tests/commands/init.test.ts`
Expected: FAIL — CLAUDE.md 不存在(`readFileSync` 抛 ENOENT)。

- [ ] **Step 3: 接入 `syncClaudeMd`**

在 `src/commands/init.ts` 顶部 import 加(与现有 `writeAdditionalDirs` 同处):

```typescript
import { syncClaudeMd } from "../core/claude-md.js";
```

在 `initAction` 内,把当前的:

```typescript
  if (opts.interactive) {
    // ... collectAndWriteDirs ...
  }

  success(`created workspace "${name}" at ${workspacePath(root, name)}`);
```

改为(在 `success` 之前插入一行):

```typescript
  if (opts.interactive) {
    // ... collectAndWriteDirs ...
  }

  syncClaudeMd(root, name);

  success(`created workspace "${name}" at ${workspacePath(root, name)}`);
```

> `--force` 路径:`rmSync` 已删掉旧 CLAUDE.md,`createWorkspace` 重建 settings,`syncClaudeMd` 走「文件不存在 → created」分支,自然全新生成,无需特殊处理。

- [ ] **Step 4: 跑测试确认通过**

Run: `bun run test tests/commands/init.test.ts`
Expected: PASS(含新增 2 个用例;原有用例不受影响 —— 它们只断言 settings.json)。

- [ ] **Step 5: 类型检查**

Run: `bunx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 6: Commit**

```bash
git add src/commands/init.ts tests/commands/init.test.ts
git commit -m "feat(init): sync CLAUDE.md on workspace creation"
```

---

## Task 5: `add` / `remove` 接入 `syncClaudeMd`

**Files:**
- Modify: `src/commands/add.ts`(写完 settings 调 `syncClaudeMd`)
- Modify: `src/commands/remove.ts`(写完 settings 调 `syncClaudeMd`)
- Test: `tests/commands/add.test.ts`、`tests/commands/remove.test.ts`(各加区块同步 + 区块外保留断言)

**Interfaces:**
- Consumes: `syncClaudeMd(root, name)` from Task 3。

- [ ] **Step 1: 写失败测试**

在 `tests/commands/add.test.ts` 顶部 import 加:

```typescript
import { claudeMdPath } from "../../src/core/config.js";
import { writeFileSync } from "node:fs"; // 若未导入
```

在 `describe("addAction", () => { ... })` 内追加:

```typescript
  it("syncs CLAUDE.md after add, preserving user content outside the block", async () => {
    await initAction("demo", { root });
    const file = claudeMdPath(root, "demo");
    // 用户在区块外(HEADER 区域)加备注
    let content = readFileSync(file, "utf8");
    content = content.replace("# Workspace", "# Workspace\n\nMy project notes\n");
    writeFileSync(file, content, "utf8");

    await addAction([realDir], { root, workspace: "demo" });

    const after = readFileSync(file, "utf8");
    expect(after).toContain("My project notes");
    expect(after).toContain(`- ${realDir}`);
  });
```

在 `tests/commands/remove.test.ts` 顶部 import 加:

```typescript
import { claudeMdPath } from "../../src/core/config.js";
import { BEGIN } from "../../src/core/claude-md.js";
```

在 `describe("removeAction", () => { ... })` 内追加:

```typescript
  it("syncs CLAUDE.md after remove — the removed dir disappears from the block", async () => {
    await initAction("demo", { root });
    await addAction([a, b], { root, workspace: "demo" });
    const file = claudeMdPath(root, "demo");
    expect(readFileSync(file, "utf8")).toContain(`- ${a}`);

    await removeAction([a], { root, workspace: "demo" });

    const after = readFileSync(file, "utf8");
    expect(after).not.toContain(`- ${a}`);
    expect(after).toContain(`- ${b}`);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun run test tests/commands/add.test.ts tests/commands/remove.test.ts`
Expected: FAIL — add 后 CLAUDE.md 区块不含新目录(`- ${realDir}` 缺);remove 后区块仍含 `- ${a}`。

- [ ] **Step 3: 接入 `add`**

在 `src/commands/add.ts` 顶部 import 加:

```typescript
import { syncClaudeMd } from "../core/claude-md.js";
```

在 `addAction` 内,把:

```typescript
  writeAdditionalDirs(settingsPath(root, name), abs);
  success(`added ${abs.length} director${abs.length === 1 ? "y" : "ies"} to "${name}"`);
```

改为:

```typescript
  writeAdditionalDirs(settingsPath(root, name), abs);
  syncClaudeMd(root, name);
  success(`added ${abs.length} director${abs.length === 1 ? "y" : "ies"} to "${name}"`);
```

- [ ] **Step 4: 接入 `remove`**

在 `src/commands/remove.ts` 顶部 import 加:

```typescript
import { syncClaudeMd } from "../core/claude-md.js";
```

在 `removeAction` 内,把:

```typescript
  setAdditionalDirs(settingsPath(root, name), next);
  success(`removed ${toRemove.size} director${toRemove.size === 1 ? "y" : "ies"} from "${name}"`);
```

改为:

```typescript
  setAdditionalDirs(settingsPath(root, name), next);
  syncClaudeMd(root, name);
  success(`removed ${toRemove.size} director${toRemove.size === 1 ? "y" : "ies"} from "${name}"`);
```

- [ ] **Step 5: 跑测试确认通过**

Run: `bun run test tests/commands/add.test.ts tests/commands/remove.test.ts`
Expected: PASS。

- [ ] **Step 6: 全套测试 + 类型检查**

Run: `bun run test && bunx tsc --noEmit`
Expected: 全绿;无类型错误。

- [ ] **Step 7: Commit**

```bash
git add src/commands/add.ts src/commands/remove.ts tests/commands/add.test.ts tests/commands/remove.test.ts
git commit -m "feat(add,remove): sync CLAUDE.md after directory changes"
```

---

## Task 6: `regen` 子命令 + cli 注册

**Files:**
- Create: `src/commands/regen.ts`
- Create: `tests/commands/regen.test.ts`
- Modify: `src/cli.ts`(注册 `regen [name]`)
- Modify: `tests/cli.test.ts`(子命令列表 + `--root` 列表 + `--force` 注册测试)

**Interfaces:**
- Consumes: `syncClaudeMd`、`forceRewriteClaudeMd`、`readDirEntries` from Task 3;`resolveRoot`、`detectWorkspaceFromCwd`、`claudeMdPath` from config;`workspaceExists`、`validateWorkspaceName` from workspace;`info`/`success` from log。
- Produces: `regenAction(name: string | undefined, opts: RegenOptions): Promise<void>`,`RegenOptions = { root?: string; force?: boolean }`。

- [ ] **Step 1: 写失败测试**

创建 `tests/commands/regen.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initAction } from "../../src/commands/init.js";
import { addAction } from "../../src/commands/add.js";
import { regenAction } from "../../src/commands/regen.js";
import { claudeMdPath } from "../../src/core/config.js";
import { BEGIN, END } from "../../src/core/claude-md.js";

let root: string;
let realDir: string;
beforeEach(() => {
  // realpathSync: macOS /tmp -> /private/tmp, keeps detectWorkspaceFromCwd correct.
  root = realpathSync(mkdtempSync(join(tmpdir(), "ccws-root-")));
  realDir = realpathSync(mkdtempSync(join(tmpdir(), "real-")));
});

describe("regenAction", () => {
  it("generates CLAUDE.md when absent (old-workspace migration)", async () => {
    await initAction("demo", { root });
    await addAction([realDir], { root, workspace: "demo" });
    const file = claudeMdPath(root, "demo");
    unlinkSync(file); // 模拟升级前已存在的老工作区

    await regenAction("demo", { root });

    expect(existsSync(file)).toBe(true);
    const content = readFileSync(file, "utf8");
    expect(content).toContain("# Workspace");
    expect(content).toContain(`- ${realDir}`);
  });

  it("refreshes the block when markers exist", async () => {
    await initAction("demo", { root });
    await addAction([realDir], { root, workspace: "demo" });
    const file = claudeMdPath(root, "demo");
    const stale = readFileSync(file, "utf8").replace(`- ${realDir}`, "- /stale");
    writeFileSync(file, stale, "utf8");

    await regenAction("demo", { root });

    const after = readFileSync(file, "utf8");
    expect(after).toContain(`- ${realDir}`);
    expect(after).not.toContain("- /stale");
  });

  it("throws and leaves the file unchanged on malformed markers", async () => {
    await initAction("demo", { root });
    const file = claudeMdPath(root, "demo");
    const malformed = `${BEGIN}\n- /old\n`; // orphan BEGIN
    writeFileSync(file, malformed, "utf8");

    await expect(regenAction("demo", { root })).rejects.toThrow(/incomplete|malformed/i);
    expect(readFileSync(file, "utf8")).toBe(malformed);
  });

  it("--force rewrites the whole file, discarding outside content", async () => {
    await initAction("demo", { root });
    await addAction([realDir], { root, workspace: "demo" });
    const file = claudeMdPath(root, "demo");
    writeFileSync(file, "# precious custom content\n", "utf8");

    await regenAction("demo", { root, force: true });

    const after = readFileSync(file, "utf8");
    expect(after).not.toContain("precious custom content");
    expect(after).toContain("# Workspace");
    expect(after).toContain(`- ${realDir}`);
  });

  it("fails fast when the workspace does not exist", async () => {
    await expect(regenAction("missing", { root })).rejects.toThrow(
      /workspace.*not.*exist|init/i,
    );
  });

  it("infers the workspace name from cwd when name is omitted", async () => {
    await initAction("demo", { root });
    await addAction([realDir], { root, workspace: "demo" });
    unlinkSync(claudeMdPath(root, "demo"));
    const prevCwd = process.cwd();
    process.chdir(join(root, "demo"));
    try {
      await regenAction(undefined, { root });
      expect(existsSync(claudeMdPath(root, "demo"))).toBe(true);
    } finally {
      process.chdir(prevCwd);
    }
  });

  it("fails when name is omitted and cwd is not inside a workspace", async () => {
    await expect(regenAction(undefined, { root })).rejects.toThrow(
      /not inside a workspace|name not given/i,
    );
  });

  it("rejects an invalid name (path separator)", async () => {
    await expect(regenAction("evil/child", { root })).rejects.toThrow(/invalid.*name/i);
  });
});
```

并在 `tests/cli.test.ts` 修改三处:

1. 第 21 行子命令列表加 `regen`:

```typescript
    for (const n of ["init", "add", "remove", "list", "status", "open", "update", "regen"]) {
```

2. 第 35 行 `--root` 列表加 `regen`:

```typescript
    for (const n of ["init", "add", "remove", "list", "status", "open", "regen"]) {
```

3. 在 `registers the update command ...` 测试之后,新增:

```typescript
  it("registers the regen command with --root and --force flags", () => {
    const program = buildCli();
    const regen = program.commands.find((c) => c.name() === "regen");
    expect(regen).toBeDefined();
    const flags = regen!.options.map((o) => o.long);
    expect(flags).toContain("--root");
    expect(flags).toContain("--force");
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun run test tests/commands/regen.test.ts tests/cli.test.ts`
Expected: FAIL — `regenAction` 模块不存在;cli 子命令列表不含 `regen`。

- [ ] **Step 3: 创建 `src/commands/regen.ts`**

```typescript
import { resolveRoot, detectWorkspaceFromCwd, claudeMdPath } from "../core/config.js";
import { workspaceExists, validateWorkspaceName } from "../core/workspace.js";
import {
  forceRewriteClaudeMd,
  readDirEntries,
  syncClaudeMd,
} from "../core/claude-md.js";
import { info, success } from "../utils/log.js";

export interface RegenOptions {
  root?: string;
  force?: boolean;
}

export async function regenAction(
  name: string | undefined,
  opts: RegenOptions,
): Promise<void> {
  const root = resolveRoot(opts.root);
  const ws = name ?? detectWorkspaceFromCwd(root);
  if (!ws) {
    throw new Error(
      "not inside a workspace and name not given — pass a workspace name or cd into a workspace",
    );
  }
  validateWorkspaceName(ws);
  if (!workspaceExists(root, ws)) {
    throw new Error(`workspace "${ws}" does not exist — run \`ccws init ${ws}\` first`);
  }

  if (opts.force) {
    forceRewriteClaudeMd(claudeMdPath(root, ws), readDirEntries(root, ws));
    success(`force-rewrote CLAUDE.md for "${ws}"`);
    return;
  }

  const outcome = syncClaudeMd(root, ws);
  if (outcome === "appended") {
    info(`appended ccws block to existing CLAUDE.md for "${ws}"`);
  } else if (outcome === "created") {
    success(`generated CLAUDE.md for "${ws}"`);
  } else {
    success(`refreshed CLAUDE.md for "${ws}"`);
  }
}
```

- [ ] **Step 4: 在 `src/cli.ts` 注册 `regen`**

顶部 import 加(与其它 command import 同处):

```typescript
import { regenAction } from "./commands/regen.js";
```

在 `update` 命令注册块之后、`return program;` 之前,插入:

```typescript
  program
    .command("regen [name]")
    .description("regenerate the workspace's CLAUDE.md from its associated directories")
    .addOption(rootOption())
    .option("-f, --force", "overwrite the entire CLAUDE.md (discards content outside the markers)")
    .action(async (name: string | undefined, opts) => {
      try {
        await regenAction(name, opts);
      } catch (e) {
        fail(e);
      }
    });
```

- [ ] **Step 5: 跑测试确认通过**

Run: `bun run test tests/commands/regen.test.ts tests/cli.test.ts`
Expected: PASS。

- [ ] **Step 6: 全套测试 + 类型检查 + 覆盖率**

Run: `bun run test -- --coverage && bunx tsc --noEmit`
Expected: 全绿;`src/commands/regen.ts` 覆盖率 ≥80%;无类型错误。

- [ ] **Step 7: Commit**

```bash
git add src/commands/regen.ts src/cli.ts tests/commands/regen.test.ts tests/cli.test.ts
git commit -m "feat(cli): add regen subcommand to rebuild workspace CLAUDE.md"
```

---

## Task 7: 项目 `CLAUDE.md` 文档更新

**Files:**
- Modify: `CLAUDE.md`(项目根,非工作区的)

**说明:** 无单测;本 task 是收尾文档 —— 把 `regen` 登记进 CLI 子命令列表,并把 `BEGIN`/`END` 标记契约写进「关键约定」,提醒后续维护者勿改标记文本。

- [ ] **Step 1: 更新 CLI 子命令列表**

在 `CLAUDE.md` 的「常用命令」节,找到:

```
CLI 子命令:`init`(含 `-i/--interactive`、`-f/--force`)、`add`、`remove`、`list`(别名 `ls`)、`status`、`open`、`update`(自更新二进制,带 `--check`/`--force`/`--repo`)。全局 `-r/--root <path>` 覆盖 `$ROOT`...
```

在 `update(...)` 之后、句号之前追加 `regen`:

```
CLI 子命令:`init`(含 `-i/--interactive`、`-f/--force`)、`add`、`remove`、`list`(别名 `ls`)、`status`、`open`、`update`(自更新二进制,带 `--check`/`--force`/`--repo`)、`regen`(重建工作区 CLAUDE.md,带 `--force`)。全局 `-r/--root <path>` 覆盖 `$ROOT`...
```

- [ ] **Step 2: 登记 `BEGIN`/`END` 标记契约**

在 `CLAUDE.md` 的「关键约定(改代码前必读)」节末尾追加一条:

```markdown
- **CLAUDE.md 自动维护**:每个工作区的 `CLAUDE.md` 由 `syncClaudeMd`(`src/core/claude-md.ts`)在 `init`/`add`/`remove`/`regen` 时自动维护;`BEGIN`/`END` 标记(`<!-- ccws:additional-directories:begin -->` / `...:end -->`)圈住自动同步的目录列表区块,**只重写区块内,区块外保留**。标记文本是**发布契约**——老工作区的 CLAUDE.md 里已有,新版 ccws 必须识别原文本,不得修改;若必须迁移,需同时识别新旧标记。标记异常(孤立/多对/顺序颠倒)时 `writeClaudeMd` 抛错、不写文件,由 `regen --force` 全量重写兜底。core 层(`claude-md.ts`)不依赖 `utils/log`,日志由 command 层按 `WriteOutcome` 打印。
```

- [ ] **Step 3: 验证未破坏构建**

Run: `bun run test && bunx tsc --noEmit`
Expected: 全绿(文档改动不影响代码)。

- [ ] **Step 4: 手动冒烟(可选但推荐)**

```bash
tmpRoot=$(mktemp -d)
realDir=$(mktemp -d)
bun run src/cli.ts init demo -r "$tmpRoot"
bun run src/cli.ts add "$realDir" -r "$tmpRoot" -w demo
cat "$tmpRoot/demo/CLAUDE.md"   # 应含 header + "- $realDir" 区块
# 模拟用户改区块外:
perl -0pi -e 's/# Workspace/# Workspace\n\nMY NOTE/' "$tmpRoot/demo/CLAUDE.md"
bun run src/cli.ts add "$realDir" -r "$tmpRoot" -w demo   # 再加一次(幂等)
cat "$tmpRoot/demo/CLAUDE.md"   # MY NOTE 应仍在,区块仍只一个
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: register regen subcommand and CLAUDE.md marker contract"
```

---

## Self-Review(实现者无需执行,计划作者已自查)

- **Spec 覆盖**:三态语义(Task 2)、`init`/`add`/`remove` 自动同步(Task 4/5)、`regen` 兜底 + `--force`(Task 6)、`claudeMdPath`(Task 1)、保护区块外编辑(Task 2/5 测试验证)、missing 标注(Task 3 `readDirEntries`)、settings 损坏 route through readSettings(Task 3 测试)、标记契约登记(Task 7)—— spec 各节均有对应 task。
- **占位符扫描**:各步骤代码块完整,无 TBD/TODO。
- **类型一致**:`DirEntry { path; missing }`、`WriteOutcome`、`RegenOptions` 在定义处与消费处签名一致;`regenAction` 的 `name: string | undefined` 与 commander `[name]` 一致。
- **有意偏离 spec(写失败错误上下文)**:spec 错误处理节提到「写 CLAUDE.md 失败时附『settings 已更新,运行 regen 修复』上下文」。本计划让 `writeFileSync` 的原生错误(如 EACCES,已含路径)直接冒泡,由 `cli.ts` 的 `fail()` 打印 —— 理由:① 写失败极罕见(同目录 settings.json 刚成功写过);② 「settings 已更新」上下文只对 add/remove/init 有意义,对 regen 误导,放 syncClaudeMd 不妥、放 command 层会重复 3 处;③ 标记异常(`writeClaudeMd` 主动 throw)保持定制信息,已含 `regen --force` 引导。若后续要严格匹配 spec,可在 `syncClaudeMd` 内 try/catch 区分:标记异常用专用 `Error` 子类 rethrow 原样,其余附上下文 rethrow。
