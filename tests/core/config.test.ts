import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, mkdir, symlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveRoot, workspacePath, settingsPath, claudeMdPath, modesStoreDir, modeSidecarPath,
  detectWorkspaceFromCwd, discoverWorkspaces, discoverProjects,
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
  it("defaults to ~/.ccws", () => {
    expect(resolveRoot(undefined)).toBe(join(process.env.HOME ?? "/tmp", ".ccws"));
  });
});

describe("paths", () => {
  it("workspacePath and settingsPath", () => {
    expect(workspacePath(root, "demo")).toBe(join(root, "demo"));
    expect(settingsPath(root, "demo")).toBe(join(root, "demo", ".claude", "settings.json"));
  });
  it("claudeMdPath", () => {
    expect(claudeMdPath(root, "demo")).toBe(join(root, "demo", "CLAUDE.md"));
  });
  it("modesStoreDir and modeSidecarPath", () => {
    expect(modesStoreDir(root)).toBe(join(root, ".ccws", "modes"));
    expect(modeSidecarPath(root, "demo")).toBe(join(root, ".ccws", "modes", "demo"));
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
    expect(ws[0].mode).toBeUndefined();
    expect(ws[0].path).toBe(workspacePath(root, "demo"));
  });
  it("reports mode from permissions.defaultMode", () => {
    mkdirSync(join(root, "open", ".claude"), { recursive: true });
    writeFileSync(join(root, "open", ".claude", "settings.json"),
      JSON.stringify({ permissions: { additionalDirectories: [], defaultMode: "bypassPermissions" } }));
    mkdirSync(join(root, "locked", ".claude"), { recursive: true });
    writeFileSync(join(root, "locked", ".claude", "settings.json"),
      JSON.stringify({ permissions: { additionalDirectories: [] } }));

    const ws = discoverWorkspaces(root);
    const byName = Object.fromEntries(ws.map((w) => [w.name, w.mode]));
    expect(byName).toEqual({ open: "bypassPermissions", locked: undefined });
  });
  it("ignores the .ccws sidecar store in workspace and project discovery", () => {
    mkdirSync(modesStoreDir(root), { recursive: true });
    writeFileSync(modeSidecarPath(root, "demo"), "plan\n");
    const target = realpathSync(mkdtempSync(join(tmpdir(), "proj-")));
    symlinkSync(target, join(root, "proj"));

    expect(discoverWorkspaces(root).map((w) => w.name)).toEqual([]);
    expect(discoverProjects(root).map((p) => p.name)).toEqual(["proj"]);
  });
  it("carries the scratch marker through for scratch workspaces only", () => {
    mkdirSync(join(root, "scratch-1", ".claude"), { recursive: true });
    writeFileSync(join(root, "scratch-1", ".claude", "settings.json"),
      JSON.stringify({ permissions: { additionalDirectories: [] }, ccws: { kind: "scratch" } }));
    mkdirSync(join(root, "plain", ".claude"), { recursive: true });
    writeFileSync(join(root, "plain", ".claude", "settings.json"),
      JSON.stringify({ permissions: { additionalDirectories: [] } }));

    const byName = Object.fromEntries(discoverWorkspaces(root).map((w) => [w.name, w.scratch]));
    expect(byName).toEqual({
      "scratch-1": { kind: "scratch" },
      plain: undefined,
    });
  });
  it("leaves scratch undefined when settings are corrupt", () => {
    mkdirSync(join(root, "broken", ".claude"), { recursive: true });
    writeFileSync(join(root, "broken", ".claude", "settings.json"), "{ not json");
    expect(discoverWorkspaces(root)[0].scratch).toBeUndefined();
  });
});
