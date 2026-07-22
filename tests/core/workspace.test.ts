import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkspace, workspaceExists, validateWorkspaceName } from "../../src/core/workspace.js";
import { settingsPath } from "../../src/core/config.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ccws-root-")); });

describe("validateWorkspaceName", () => {
  it("accepts plain names", () => {
    expect(() => validateWorkspaceName("demo")).not.toThrow();
    expect(() => validateWorkspaceName("demo123")).not.toThrow();
    expect(() => validateWorkspaceName("name_with-dots.and_underscores")).not.toThrow();
  });

  it("accepts names that contain two adjacent dots as literal characters (a..b, foo..bar, v1..0)", () => {
    expect(() => validateWorkspaceName("a..b")).not.toThrow();
    expect(() => validateWorkspaceName("foo..bar")).not.toThrow();
    expect(() => validateWorkspaceName("v1..0")).not.toThrow();
  });

  it("rejects empty / whitespace-only names", () => {
    expect(() => validateWorkspaceName("")).toThrow(/non-empty/i);
    expect(() => validateWorkspaceName("   ")).toThrow(/non-empty/i);
    expect(() => validateWorkspaceName("\t\n")).toThrow(/non-empty/i);
  });

  it("rejects names containing a forward slash separator", () => {
    expect(() => validateWorkspaceName("a/b")).toThrow(/invalid workspace name/i);
    expect(() => validateWorkspaceName("/leading")).toThrow(/invalid workspace name/i);
    expect(() => validateWorkspaceName("trailing/")).toThrow(/invalid workspace name/i);
  });

  it("rejects names containing a backslash separator", () => {
    expect(() => validateWorkspaceName("a\\b")).toThrow(/invalid workspace name/i);
    expect(() => validateWorkspaceName("evil\\child")).toThrow(/invalid workspace name/i);
  });

  it("rejects the exact '.' and '..' path segments", () => {
    expect(() => validateWorkspaceName(".")).toThrow(/invalid workspace name/i);
    expect(() => validateWorkspaceName("..")).toThrow(/invalid workspace name/i);
  });

  it("rejects a parent-dir segment at the start (path traversal)", () => {
    expect(() => validateWorkspaceName("../evil")).toThrow(/invalid workspace name/i);
    expect(() => validateWorkspaceName("..\\evil")).toThrow(/invalid workspace name/i);
  });

  it("rejects a parent-dir segment in the middle (a/../b)", () => {
    expect(() => validateWorkspaceName("a/../b")).toThrow(/invalid workspace name/i);
    expect(() => validateWorkspaceName("a/..")).toThrow(/invalid workspace name/i);
    expect(() => validateWorkspaceName("./x")).toThrow(/invalid workspace name/i);
  });
});

describe("createWorkspace", () => {
  it("creates dir + settings skeleton with empty additionalDirectories", () => {
    createWorkspace(root, "demo");
    const raw = JSON.parse(readFileSync(settingsPath(root, "demo"), "utf8"));
    expect(raw.permissions.additionalDirectories).toEqual([]);
  });
  it("throws if workspace already exists", () => {
    createWorkspace(root, "demo");
    expect(() => createWorkspace(root, "demo")).toThrow(/exists|force/i);
  });
});

describe("workspaceExists", () => {
  it("false before create, true after", () => {
    expect(workspaceExists(root, "demo")).toBe(false);
    createWorkspace(root, "demo");
    expect(workspaceExists(root, "demo")).toBe(true);
  });
});
