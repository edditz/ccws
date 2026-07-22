import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkspace, workspaceExists } from "../../src/core/workspace.js";
import { settingsPath } from "../../src/core/config.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ccws-root-")); });

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
