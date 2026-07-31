import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initAction } from "../../src/commands/init.js";
import { bypassAction } from "../../src/commands/bypass.js";
import { settingsPath } from "../../src/core/config.js";

let root: string;
beforeEach(() => {
  // realpathSync: on macOS /tmp -> /private/tmp; resolve so root and cwd share
  // a namespace for detectWorkspaceFromCwd's `relative(root, cwd)` in the
  // cwd-detection test below.
  root = realpathSync(mkdtempSync(join(tmpdir(), "ccws-root-")));
});

const readMode = (name: string): string | undefined =>
  JSON.parse(readFileSync(settingsPath(root, name), "utf8")).permissions.defaultMode as
    | string
    | undefined;

describe("bypassAction", () => {
  it("enables bypass by writing defaultMode", async () => {
    await initAction("demo", { root });
    await bypassAction("on", { root, workspace: "demo" });
    expect(readMode("demo")).toBe("bypassPermissions");
  });
  it("disables bypass by removing defaultMode", async () => {
    await initAction("demo", { root });
    await bypassAction("on", { root, workspace: "demo" });
    await bypassAction("off", { root, workspace: "demo" });
    expect(readMode("demo")).toBeUndefined();
  });
  it("preserves the rest of the permissions object when toggling", async () => {
    await initAction("demo", { root });
    await bypassAction("on", { root, workspace: "demo" });
    const raw = JSON.parse(readFileSync(settingsPath(root, "demo"), "utf8"));
    expect(Array.isArray(raw.permissions.additionalDirectories)).toBe(true);
    expect(raw.permissions.defaultMode).toBe("bypassPermissions");
  });
  it("fails fast when workspace does not exist", async () => {
    await expect(bypassAction("on", { root, workspace: "missing" })).rejects.toThrow(/workspace.*not.*exist|init/i);
  });
  it("rejects an invalid --workspace name (path separator)", async () => {
    await expect(bypassAction("on", { root, workspace: "evil/child" })).rejects.toThrow(/invalid.*name/i);
  });
  it("infers the workspace name from cwd when --workspace is omitted", async () => {
    await initAction("demo", { root });
    const wsDir = join(root, "demo");
    const prevCwd = process.cwd();
    process.chdir(wsDir);
    try {
      await bypassAction("on", { root });
      expect(readMode("demo")).toBe("bypassPermissions");
    } finally {
      process.chdir(prevCwd);
    }
  });
  it("fails when --workspace is omitted and cwd is not inside a workspace root", async () => {
    await expect(bypassAction("on", { root })).rejects.toThrow(/not inside a workspace|--workspace/i);
  });
  it("getter reports bypass on when defaultMode is bypassPermissions", async () => {
    await initAction("demo", { root });
    await bypassAction("on", { root, workspace: "demo" });
    const chunks: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      chunks.push(String(c));
      return true;
    });
    try {
      await bypassAction(undefined, { root, workspace: "demo" });
      expect(chunks.join("")).toMatch(/bypass permissions: ON/i);
    } finally {
      spy.mockRestore();
    }
  });
  it("getter reports off with the current mode when not bypassing", async () => {
    await initAction("demo", { root });
    const chunks: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      chunks.push(String(c));
      return true;
    });
    try {
      await bypassAction(undefined, { root, workspace: "demo" });
      expect(chunks.join("")).toMatch(/bypass permissions: off/i);
    } finally {
      spy.mockRestore();
    }
  });
  it("getter reports off with a non-default mode when defaultMode is set to something else", async () => {
    await initAction("demo", { root });
    await bypassAction("on", { root, workspace: "demo" });
    const chunks: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      chunks.push(String(c));
      return true;
    });
    try {
      // Simulate the user having a different defaultMode set by hand.
      const path = settingsPath(root, "demo");
      const raw = JSON.parse(readFileSync(path, "utf8"));
      raw.permissions.defaultMode = "acceptEdits";
      writeFileSync(path, JSON.stringify(raw, null, 2) + "\n", "utf8");
      await bypassAction(undefined, { root, workspace: "demo" });
      expect(chunks.join("")).toMatch(/defaultMode: acceptEdits/i);
    } finally {
      spy.mockRestore();
    }
  });
  it("is idempotent: enabling twice keeps a single defaultMode", async () => {
    await initAction("demo", { root });
    await bypassAction("on", { root, workspace: "demo" });
    await bypassAction("on", { root, workspace: "demo" });
    expect(readMode("demo")).toBe("bypassPermissions");
  });
  it("is idempotent: disabling when already off does not throw", async () => {
    await initAction("demo", { root });
    await expect(bypassAction("off", { root, workspace: "demo" })).resolves.toBeUndefined();
    expect(readMode("demo")).toBeUndefined();
  });
  it("getter infers the workspace name from cwd", async () => {
    await initAction("demo", { root });
    await bypassAction("on", { root, workspace: "demo" });
    const wsDir = join(root, "demo");
    const prevCwd = process.cwd();
    process.chdir(wsDir);
    const chunks: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      chunks.push(String(c));
      return true;
    });
    try {
      await bypassAction(undefined, { root });
      expect(chunks.join("")).toMatch(/bypass permissions: ON/i);
    } finally {
      spy.mockRestore();
      process.chdir(prevCwd);
    }
  });
});
