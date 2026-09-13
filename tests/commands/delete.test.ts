import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, existsSync, realpathSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initAction } from "../../src/commands/init.js";
import { deleteAction } from "../../src/commands/delete.js";
import { createScratchWorkspace } from "../../src/core/scratch.js";
import { workspaceExists } from "../../src/core/workspace.js";
import { workspacePath, modeSidecarPath } from "../../src/core/config.js";
import { setStoredMode } from "../../src/core/mode.js";

let root: string;
beforeEach(() => {
  // realpathSync: on macOS /tmp -> /private/tmp; keep root and process.cwd()
  // in the same namespace for the cwd-inside-workspace test below.
  root = realpathSync(mkdtempSync(join(tmpdir(), "ccws-root-")));
});

describe("deleteAction", () => {
  it("deletes the workspace directory recursively without touching siblings", async () => {
    await initAction("demo", { root });
    await initAction("other", { root });
    await deleteAction("demo", { root, force: true });
    expect(workspaceExists(root, "demo")).toBe(false);
    expect(existsSync(workspacePath(root, "demo"))).toBe(false);
    expect(workspaceExists(root, "other")).toBe(true);
  });

  it("confirms via confirmFn and deletes when confirmed", async () => {
    await initAction("demo", { root });
    const confirmFn = vi.fn().mockResolvedValue(true);
    await deleteAction("demo", { root, confirmFn });
    expect(confirmFn).toHaveBeenCalledTimes(1);
    expect(workspaceExists(root, "demo")).toBe(false);
  });

  it("declining the confirmation aborts and keeps the workspace", async () => {
    await initAction("demo", { root });
    const confirmFn = vi.fn().mockResolvedValue(false);
    await deleteAction("demo", { root, confirmFn });
    expect(confirmFn).toHaveBeenCalledTimes(1);
    expect(workspaceExists(root, "demo")).toBe(true);
  });

  it("skips the confirmation when --force is given", async () => {
    await initAction("demo", { root });
    const confirmFn = vi.fn();
    await deleteAction("demo", { root, force: true, confirmFn });
    expect(confirmFn).not.toHaveBeenCalled();
    expect(workspaceExists(root, "demo")).toBe(false);
  });

  it("deletes a scratch workspace without confirmation (disposable by design)", async () => {
    const { name } = createScratchWorkspace(root);
    const confirmFn = vi.fn().mockResolvedValue(true);
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c) => { out.push(String(c)); return true; });
    try {
      await deleteAction(name, { root, confirmFn });
    } finally {
      vi.restoreAllMocks();
    }
    expect(confirmFn).not.toHaveBeenCalled();
    expect(existsSync(workspacePath(root, name))).toBe(false);
    expect(out.join("")).toContain("scratch");
  });

  it("fails fast when the workspace does not exist", async () => {
    await expect(deleteAction("missing", { root, force: true })).rejects.toThrow(/not.*exist|nothing to delete/i);
  });

  it("rejects a name with a path separator before touching anything", async () => {
    await expect(deleteAction("evil/child", { root, force: true })).rejects.toThrow(/invalid.*name/i);
    expect(existsSync(workspacePath(root, "evil"))).toBe(false);
  });

  it("rejects `..` without touching the root", async () => {
    await expect(deleteAction("..", { root, force: true })).rejects.toThrow(/invalid.*name/i);
    expect(existsSync(root)).toBe(true);
  });

  it("warns when the cwd is the workspace being deleted", async () => {
    await initAction("demo", { root });
    const wsDir = workspacePath(root, "demo");
    const prevCwd = process.cwd();
    process.chdir(wsDir);
    const chunks: string[] = [];
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation((c) => {
      chunks.push(String(c));
      return true;
    });
    try {
      await deleteAction("demo", { root, force: true });
      expect(chunks.join("")).toMatch(/inside|cwd/i);
    } finally {
      warnSpy.mockRestore();
      process.chdir(prevCwd);
    }
    expect(workspaceExists(root, "demo")).toBe(false);
  });

  it("warns when the cwd is inside a subdirectory of the workspace being deleted", async () => {
    await initAction("demo", { root });
    // .claude/ exists inside the workspace (settings.json lives there) — this
    // exercises the `startsWith(path + sep)` branch of the cwd check.
    const subDir = join(workspacePath(root, "demo"), ".claude");
    const prevCwd = process.cwd();
    process.chdir(subDir);
    const chunks: string[] = [];
    const warnSpy = vi.spyOn(process.stderr, "write").mockImplementation((c) => {
      chunks.push(String(c));
      return true;
    });
    try {
      await deleteAction("demo", { root, force: true });
      expect(chunks.join("")).toMatch(/inside|cwd/i);
    } finally {
      warnSpy.mockRestore();
      process.chdir(prevCwd);
    }
    expect(workspaceExists(root, "demo")).toBe(false);
  });
});

describe("deleteAction: projects", () => {
  const registerProject = (name: string): string => {
    const target = realpathSync(mkdtempSync(join(tmpdir(), "ccws-proj-")));
    symlinkSync(target, join(root, name));
    return target;
  };

  it("unregisters a project, removing both the symlink and its mode sidecar, target untouched", async () => {
    const target = registerProject("myproj");
    setStoredMode(root, { kind: "project", name: "myproj", target }, "auto");
    await deleteAction("myproj", { root });
    expect(existsSync(join(root, "myproj"))).toBe(false);
    expect(existsSync(modeSidecarPath(root, "myproj"))).toBe(false);
    expect(existsSync(target)).toBe(true);
  });

  it("unregisters a project without a sidecar without error", async () => {
    const target = registerProject("plain");
    await deleteAction("plain", { root });
    expect(existsSync(join(root, "plain"))).toBe(false);
    expect(existsSync(target)).toBe(true);
  });

  it("cleans the sidecar of a dangling entry too", async () => {
    const gone = join(root, "gone-target");
    mkdirSync(gone);
    symlinkSync(gone, join(root, "gone"));
    rmSync(gone, { recursive: true });
    setStoredMode(root, { kind: "dangling", name: "gone", target: gone }, "plan");
    await deleteAction("gone", { root });
    expect(existsSync(join(root, "gone"))).toBe(false);
    expect(existsSync(modeSidecarPath(root, "gone"))).toBe(false);
  });
});
