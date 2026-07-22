import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initAction } from "../../src/commands/init.js";
import { addAction } from "../../src/commands/add.js";
import { removeAction } from "../../src/commands/remove.js";
import { settingsPath } from "../../src/core/config.js";

let root: string;
let a: string;
let b: string;
beforeEach(() => {
  // realpathSync: on macOS /tmp -> /private/tmp; resolve so root and cwd share
  // a namespace for detectWorkspaceFromCwd's `relative(root, cwd)` in the
  // cwd-detection test below.
  root = realpathSync(mkdtempSync(join(tmpdir(), "ccws-root-")));
  a = mkdtempSync(join(tmpdir(), "a-"));
  b = mkdtempSync(join(tmpdir(), "b-"));
});
const readDirs = (name: string) =>
  JSON.parse(readFileSync(settingsPath(root, name), "utf8")).permissions.additionalDirectories as string[];

describe("removeAction", () => {
  it("removes a matching dir", async () => {
    await initAction("demo", { root });
    await addAction([a, b], { root, workspace: "demo" });
    await removeAction([a], { root, workspace: "demo" });
    expect(readDirs("demo")).toEqual([b]);
  });
  it("throws when dir not associated", async () => {
    await initAction("demo", { root });
    await addAction([a], { root, workspace: "demo" });
    await expect(removeAction(["/nope"], { root, workspace: "demo" })).rejects.toThrow(/not associated/i);
  });
  it("preserves other dirs and fields when removing", async () => {
    await initAction("demo", { root });
    await addAction([a, b], { root, workspace: "demo" });
    await removeAction([a], { root, workspace: "demo" });
    const raw = JSON.parse(readFileSync(settingsPath(root, "demo"), "utf8"));
    expect(raw.permissions.additionalDirectories).toEqual([b]);
    // skeleton permissions shape is preserved (no clobbering of permissions object)
    expect(Array.isArray(raw.permissions.additionalDirectories)).toBe(true);
  });
  it("fails fast when workspace does not exist", async () => {
    await expect(removeAction([a], { root, workspace: "missing" })).rejects.toThrow(/workspace.*not.*exist|init/i);
  });
  it("rejects an invalid --workspace name (path separator)", async () => {
    await expect(removeAction([a], { root, workspace: "evil/child" })).rejects.toThrow(/invalid.*name/i);
  });
  it("is atomic: settings unchanged when nothing matches", async () => {
    await initAction("demo", { root });
    await addAction([a], { root, workspace: "demo" });
    const before = readFileSync(settingsPath(root, "demo"), "utf8");
    await expect(removeAction(["/nope"], { root, workspace: "demo" })).rejects.toThrow();
    expect(readFileSync(settingsPath(root, "demo"), "utf8")).toBe(before);
  });
  it("infers the workspace name from cwd when --workspace is omitted", async () => {
    await initAction("demo", { root });
    await addAction([a, b], { root, workspace: "demo" });
    const wsDir = join(root, "demo");
    const prevCwd = process.cwd();
    process.chdir(wsDir);
    try {
      await removeAction([a], { root });
      expect(readDirs("demo")).toEqual([b]);
    } finally {
      process.chdir(prevCwd);
    }
  });
  it("fails when --workspace is omitted and cwd is not inside a workspace root", async () => {
    await expect(removeAction([a], { root })).rejects.toThrow(/not inside a workspace|--workspace/i);
  });
});
