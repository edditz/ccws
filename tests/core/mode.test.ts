import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, symlinkSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PERMISSION_MODES, MODE_CLEAR_VALUES, isModeInput, parseModeValue,
  resolveStoredMode, setStoredMode, removeModeSidecar,
} from "../../src/core/mode.js";
import { modesStoreDir, modeSidecarPath, settingsPath } from "../../src/core/config.js";
import type { NamedEntry } from "../../src/types.js";

let root: string;
let target: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "ccws-root-")));
  target = realpathSync(mkdtempSync(join(tmpdir(), "proj-")));
});

const workspace = (name: string): NamedEntry => ({ kind: "workspace", name });
const project = (name: string, tgt = target): NamedEntry => ({ kind: "project", name, target: tgt });

describe("isModeInput / parseModeValue", () => {
  it("accepts every documented permission mode", () => {
    for (const m of PERMISSION_MODES) expect(isModeInput(m)).toBe(true);
  });
  it("accepts the clear aliases", () => {
    for (const c of MODE_CLEAR_VALUES) expect(isModeInput(c)).toBe(true);
  });
  it("rejects non-modes without throwing", () => {
    expect(isModeInput("on")).toBe(false);
    expect(isModeInput("yolo")).toBe(false);
    expect(isModeInput("")).toBe(false);
  });
  it("parseModeValue returns the input for valid values", () => {
    expect(parseModeValue("plan")).toBe("plan");
    expect(parseModeValue("off")).toBe("off");
  });
  it("parseModeValue throws listing the valid values", () => {
    expect(() => parseModeValue("yolo")).toThrow(
      /invalid mode "yolo" — expected one of: acceptEdits, auto, bypassPermissions, manual, dontAsk, plan, off\/default \(clears\)/,
    );
    expect(() => parseModeValue("on")).toThrow(/invalid mode "on"/);
  });
});

describe("resolveStoredMode", () => {
  it("reads defaultMode from a workspace's settings.json", () => {
    mkdirSync(join(root, "demo", ".claude"), { recursive: true });
    writeFileSync(settingsPath(root, "demo"),
      JSON.stringify({ permissions: { defaultMode: "plan" } }));
    expect(resolveStoredMode(root, workspace("demo"))).toBe("plan");
  });
  it("returns undefined for a workspace without defaultMode", () => {
    mkdirSync(join(root, "demo", ".claude"), { recursive: true });
    writeFileSync(settingsPath(root, "demo"), JSON.stringify({ permissions: {} }));
    expect(resolveStoredMode(root, workspace("demo"))).toBeUndefined();
  });
  it("reads a project's sidecar, trimmed", () => {
    symlinkSync(target, join(root, "proj"));
    mkdirSync(modesStoreDir(root), { recursive: true });
    writeFileSync(modeSidecarPath(root, "proj"), "auto\n");
    expect(resolveStoredMode(root, project("proj"))).toBe("auto");
  });
  it("returns undefined when the sidecar is missing or blank", () => {
    symlinkSync(target, join(root, "proj"));
    expect(resolveStoredMode(root, project("proj"))).toBeUndefined();
    mkdirSync(modesStoreDir(root), { recursive: true });
    writeFileSync(modeSidecarPath(root, "proj"), "   \n");
    expect(resolveStoredMode(root, project("proj"))).toBeUndefined();
  });
  it("passes non-string defaultMode through as undefined", () => {
    mkdirSync(join(root, "demo", ".claude"), { recursive: true });
    writeFileSync(settingsPath(root, "demo"),
      JSON.stringify({ permissions: { defaultMode: 42 } }));
    expect(resolveStoredMode(root, workspace("demo"))).toBeUndefined();
  });
  it("throws on corrupt workspace settings (strict read)", () => {
    mkdirSync(join(root, "demo", ".claude"), { recursive: true });
    writeFileSync(settingsPath(root, "demo"), "{ not json");
    expect(() => resolveStoredMode(root, workspace("demo"))).toThrow(/corrupt/);
  });
});

describe("setStoredMode", () => {
  it("writes defaultMode for a workspace, preserving other fields", () => {
    mkdirSync(join(root, "demo", ".claude"), { recursive: true });
    writeFileSync(settingsPath(root, "demo"),
      JSON.stringify({ model: "opus", permissions: { additionalDirectories: ["/a"] } }));
    setStoredMode(root, workspace("demo"), "acceptEdits");
    const raw = JSON.parse(readFileSync(settingsPath(root, "demo"), "utf8"));
    expect(raw.permissions.defaultMode).toBe("acceptEdits");
    expect(raw.model).toBe("opus");
  });
  it("clears defaultMode for a workspace", () => {
    mkdirSync(join(root, "demo", ".claude"), { recursive: true });
    writeFileSync(settingsPath(root, "demo"),
      JSON.stringify({ permissions: { defaultMode: "plan", additionalDirectories: [] } }));
    setStoredMode(root, workspace("demo"), undefined);
    const raw = JSON.parse(readFileSync(settingsPath(root, "demo"), "utf8"));
    expect(raw.permissions.defaultMode).toBeUndefined();
    expect(raw.permissions.additionalDirectories).toEqual([]);
  });
  it("writes a sidecar for a project without touching the target", () => {
    symlinkSync(target, join(root, "proj"));
    const before = readdirSync(target).sort();
    setStoredMode(root, project("proj"), "auto");
    expect(readFileSync(modeSidecarPath(root, "proj"), "utf8")).toBe("auto\n");
    expect(readdirSync(target).sort()).toEqual(before);
    expect(existsSync(join(target, ".claude", "settings.json"))).toBe(false);
  });
  it("removes the sidecar when clearing a project mode", () => {
    symlinkSync(target, join(root, "proj"));
    setStoredMode(root, project("proj"), "auto");
    setStoredMode(root, project("proj"), undefined);
    expect(existsSync(modeSidecarPath(root, "proj"))).toBe(false);
  });
  it("clearing an unset project mode is a no-op", () => {
    symlinkSync(target, join(root, "proj"));
    expect(() => setStoredMode(root, project("proj"), undefined)).not.toThrow();
  });
  it("supports dangling entries (sidecar only)", () => {
    const gone = join(root, "gone-target");
    mkdirSync(gone);
    symlinkSync(gone, join(root, "gone"));
    rmSync(gone, { recursive: true });
    setStoredMode(root, { kind: "dangling", name: "gone", target: gone }, "plan");
    expect(readFileSync(modeSidecarPath(root, "gone"), "utf8")).toBe("plan\n");
    expect(resolveStoredMode(root, { kind: "dangling", name: "gone", target: gone })).toBe("plan");
  });
  it("overwrites an existing sidecar", () => {
    symlinkSync(target, join(root, "proj"));
    setStoredMode(root, project("proj"), "auto");
    setStoredMode(root, project("proj"), "plan");
    expect(readFileSync(modeSidecarPath(root, "proj"), "utf8")).toBe("plan\n");
  });
  it("refuses to write through a non-directory $ROOT/.ccws (file or symlink)", () => {
    symlinkSync(target, join(root, "proj"));
    writeFileSync(join(root, ".ccws"), "stray");
    expect(() => setStoredMode(root, project("proj"), "auto")).toThrow(/reserved for ccws internal state/);
    const realRoot2 = realpathSync(mkdtempSync(join(tmpdir(), "ccws-root-")));
    const pierced = realpathSync(mkdtempSync(join(tmpdir(), "pierce-")));
    symlinkSync(pierced, join(realRoot2, ".ccws"));
    const t2 = realpathSync(mkdtempSync(join(tmpdir(), "proj-")));
    symlinkSync(t2, join(realRoot2, "proj"));
    expect(() => setStoredMode(realRoot2, project("proj", t2), "auto")).toThrow(/reserved for ccws internal state/);
    expect(existsSync(join(pierced, "modes"))).toBe(false);
  });
});

describe("removeModeSidecar", () => {
  it("removes an existing sidecar and tolerates absence", () => {
    mkdirSync(modesStoreDir(root), { recursive: true });
    writeFileSync(modeSidecarPath(root, "proj"), "auto\n");
    removeModeSidecar(root, "proj");
    expect(existsSync(modeSidecarPath(root, "proj"))).toBe(false);
    expect(() => removeModeSidecar(root, "proj")).not.toThrow();
  });
});
