import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generateScratchName,
  createScratchWorkspace,
  readScratchMeta,
  isScratchWorkspace,
  requireNonScratchWorkspace,
} from "../../src/core/scratch.js";
import { workspacePath, settingsPath } from "../../src/core/config.js";
import { createWorkspace } from "../../src/core/workspace.js";

let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "ccws-root-")));
});

const readRaw = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(settingsPath(root, name), "utf8"));

// 1-3 lowercase-letter words joined by "-", each word 4-8 letters.
const RANDOM_NAME = /^[a-z]{4,8}(-[a-z]{4,8}){0,2}$/;

describe("generateScratchName", () => {
  it("joins 1-3 random-letter words with hyphens", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateScratchName()).toMatch(RANDOM_NAME);
    }
  });
  it("is driven by the injected random source (deterministic under a stub)", () => {
    // word count: 1 + floor(0.0*3) = 1; each word: 4 + floor(0.0*5) = 4 letters,
    // each letter: 97 + floor(0.0*26) = "a".
    expect(generateScratchName(() => 0)).toBe("aaaa");
  });
});

describe("createScratchWorkspace", () => {
  it("creates a workspace with a random name, the scratch marker, and bypassPermissions mode", () => {
    const { name, path } = createScratchWorkspace(root);
    expect(name).toMatch(RANDOM_NAME);
    expect(path).toBe(workspacePath(root, name));
    expect(existsSync(path)).toBe(true);
    const raw = readRaw(name);
    expect(raw.ccws).toEqual({ kind: "scratch" });
    expect(raw.permissions).toMatchObject({ additionalDirectories: [], defaultMode: "bypassPermissions" });
    // Scratch sessions never manage directories — no CLAUDE.md is generated.
    expect(existsSync(join(path, "CLAUDE.md"))).toBe(false);
  });
  it("regenerates on collision with a plain directory, without writing into it", () => {
    const squatter = workspacePath(root, "taken-name");
    mkdirSync(squatter); // plain dir, no .claude — resolveEntry would call it "missing"
    const names = ["taken-name", "free-name"];
    let i = 0;
    const { name } = createScratchWorkspace(root, { nameGenerator: () => names[i++] });
    expect(name).toBe("free-name");
    expect(existsSync(join(squatter, ".claude"))).toBe(false);
  });
  it("regenerates on collision with a project symlink, without writing through it", () => {
    const target = realpathSync(mkdtempSync(join(tmpdir(), "proj-")));
    symlinkSync(target, workspacePath(root, "taken-name"));
    const names = ["taken-name", "free-name"];
    let i = 0;
    const { name } = createScratchWorkspace(root, { nameGenerator: () => names[i++] });
    expect(name).toBe("free-name");
    expect(existsSync(join(target, ".claude"))).toBe(false);
  });
  it("gives up after too many collisions with a clear error", () => {
    const squatter = workspacePath(root, "taken-name");
    mkdirSync(squatter);
    expect(() => createScratchWorkspace(root, { nameGenerator: () => "taken-name" }))
      .toThrow(/could not find a free scratch name/);
    // The squatter was never touched by the failed attempts.
    expect(existsSync(squatter)).toBe(true);
    expect(existsSync(join(squatter, ".claude"))).toBe(false);
  });
});

describe("readScratchMeta / isScratchWorkspace", () => {
  it("returns the marker for a scratch workspace", () => {
    const { name } = createScratchWorkspace(root);
    expect(readScratchMeta(root, name)).toEqual({ kind: "scratch" });
    expect(isScratchWorkspace(root, name)).toBe(true);
  });
  it("returns undefined for a regular workspace", () => {
    createWorkspace(root, "plain");
    expect(readScratchMeta(root, "plain")).toBeUndefined();
    expect(isScratchWorkspace(root, "plain")).toBe(false);
  });
  it("returns undefined for corrupt settings (degrades to regular)", () => {
    const { name } = createScratchWorkspace(root);
    writeFileSync(settingsPath(root, name), "{ not json");
    expect(readScratchMeta(root, name)).toBeUndefined();
    expect(isScratchWorkspace(root, name)).toBe(false);
  });
  it("tolerates extra fields inside the marker (legacy createdAt)", () => {
    createWorkspace(root, "legacy");
    writeFileSync(settingsPath(root, "legacy"),
      JSON.stringify({ permissions: { additionalDirectories: [] }, ccws: { kind: "scratch", createdAt: "2026-09-13T00:00:00.000Z" } }));
    expect(readScratchMeta(root, "legacy")).toEqual({ kind: "scratch" });
  });
  it("returns undefined for a missing entry", () => {
    expect(readScratchMeta(root, "nope")).toBeUndefined();
  });
});

describe("requireNonScratchWorkspace", () => {
  it("passes for a regular workspace", () => {
    createWorkspace(root, "plain");
    expect(() => requireNonScratchWorkspace(root, "plain")).not.toThrow();
  });
  it("rejects a scratch workspace with init guidance", () => {
    const { name } = createScratchWorkspace(root);
    expect(() => requireNonScratchWorkspace(root, name)).toThrow(/scratch/i);
    expect(() => requireNonScratchWorkspace(root, name)).toThrow(/ccws init/);
  });
  it("keeps requireWorkspace's guards for missing entries", () => {
    expect(() => requireNonScratchWorkspace(root, "nope")).toThrow(/ccws init/);
  });
});
