import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, mkdir } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveRoot, workspacePath, settingsPath,
  detectWorkspaceFromCwd, discoverWorkspaces,
} from "../../src/core/config.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ccws-root-"));
  delete process.env.CCWS_ROOT;
});
afterEach(() => { delete process.env.CCWS_ROOT; });

describe("resolveRoot", () => {
  it("prefers --root over env and default", () => {
    process.env.CCWS_ROOT = "/from-env";
    expect(resolveRoot("/cli-root")).toBe("/cli-root");
  });
  it("falls back to CCWS_ROOT", () => {
    process.env.CCWS_ROOT = root;
    expect(resolveRoot(undefined)).toBe(root);
  });
  it("defaults to ~/ccws", () => {
    expect(resolveRoot(undefined)).toBe(join(process.env.HOME ?? "/tmp", "ccws"));
  });
});

describe("paths", () => {
  it("workspacePath and settingsPath", () => {
    expect(workspacePath(root, "demo")).toBe(join(root, "demo"));
    expect(settingsPath(root, "demo")).toBe(join(root, "demo", ".claude", "settings.json"));
  });
});

describe("detectWorkspaceFromCwd", () => {
  it("returns name when cwd is inside a workspace", () => {
    const inside = join(root, "demo", "sub");
    mkdirSync(inside, { recursive: true });
    expect(detectWorkspaceFromCwd(root, inside)).toBe("demo");
  });
  it("returns null when cwd is outside any workspace", () => {
    expect(detectWorkspaceFromCwd(root, "/tmp")).toBeNull();
  });
});

describe("discoverWorkspaces", () => {
  it("lists workspaces with their dirs and missing count", () => {
    mkdirSync(join(root, "demo", ".claude"), { recursive: true });
    writeFileSync(join(root, "demo", ".claude", "settings.json"),
      JSON.stringify({ permissions: { additionalDirectories: ["/exists", "/nope"] } }));
    mkdirSync(join(root, "not-a-workspace")); // no .claude
    const real = mkdtempSync(join(tmpdir(), "real-"));
    writeFileSync(join(root, "demo", ".claude", "settings.json"),
      JSON.stringify({ permissions: { additionalDirectories: [real, "/nope"] } }));

    const ws = discoverWorkspaces(root);
    expect(ws.map((w) => w.name)).toEqual(["demo"]);
    expect(ws[0].dirs).toEqual([real, "/nope"]);
    expect(ws[0].missing).toBe(1);
  });
});
