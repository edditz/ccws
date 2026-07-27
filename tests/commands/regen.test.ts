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
