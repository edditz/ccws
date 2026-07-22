import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initAction } from "../../src/commands/init.js";
import { addAction } from "../../src/commands/add.js";
import { settingsPath } from "../../src/core/config.js";

let root: string;
let realDir: string;
beforeEach(() => {
  // realpathSync: on macOS /tmp -> /private/tmp; resolve so root and process.cwd()
  // (which chdir resolves to the real path) share a namespace, keeping
  // detectWorkspaceFromCwd's `relative(root, cwd)` correct.
  root = realpathSync(mkdtempSync(join(tmpdir(), "ccws-root-")));
  realDir = realpathSync(mkdtempSync(join(tmpdir(), "real-")));
});

const readDirs = (name: string) =>
  JSON.parse(readFileSync(settingsPath(root, name), "utf8")).permissions.additionalDirectories as string[];

describe("addAction", () => {
  it("adds existing dirs as absolute paths", async () => {
    await initAction("demo", { root });
    await addAction([realDir], { root, workspace: "demo" });
    expect(readDirs("demo")).toEqual([realDir]);
  });
  it("dedupes and merges", async () => {
    await initAction("demo", { root });
    await addAction([realDir], { root, workspace: "demo" });
    await addAction([realDir], { root, workspace: "demo" });
    expect(readDirs("demo")).toEqual([realDir]);
  });
  it("fails atomically if any dir missing — settings unchanged", async () => {
    await initAction("demo", { root });
    const before = readFileSync(settingsPath(root, "demo"), "utf8");
    await expect(addAction([realDir, "/does/not/exist"], { root, workspace: "demo" }))
      .rejects.toThrow(/not exist/i);
    expect(readFileSync(settingsPath(root, "demo"), "utf8")).toBe(before);
  });
  it("fails when workspace missing", async () => {
    await expect(addAction([realDir], { root, workspace: "nope" })).rejects.toThrow(/workspace.*not.*exist|init/i);
  });
  it("rejects an invalid --workspace name (path separator)", async () => {
    await expect(addAction([realDir], { root, workspace: "evil/child" })).rejects.toThrow(/invalid.*name/i);
  });

  it("infers the workspace name from cwd when --workspace is omitted", async () => {
    await initAction("demo", { root });
    // Make cwd live directly under <root>/demo so detectWorkspaceFromCwd resolves to "demo".
    const wsDir = join(root, "demo");
    const prevCwd = process.cwd();
    process.chdir(wsDir);
    try {
      await addAction([realDir], { root });
      expect(readDirs("demo")).toEqual([realDir]);
    } finally {
      process.chdir(prevCwd);
    }
  });

  it("fails when --workspace is omitted and cwd is not inside a workspace root", async () => {
    // process.cwd() is the repo root (outside the temp `root`), so detection yields null.
    await expect(addAction([realDir], { root })).rejects.toThrow(/not inside a workspace|--workspace/i);
  });
});
