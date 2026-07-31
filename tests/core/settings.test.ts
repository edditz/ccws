import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSettings, writeAdditionalDirs, setAdditionalDirs, setBypassPermissions } from "../../src/core/settings.js";

let dir: string;
let settingsFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ccws-"));
  mkdirSync(join(dir, ".claude"));
  settingsFile = join(dir, ".claude", "settings.json");
});

describe("readSettings", () => {
  it("reads additionalDirectories", () => {
    writeFileSync(settingsFile, JSON.stringify({ permissions: { additionalDirectories: ["/a"] } }));
    expect(readSettings(settingsFile).permissions?.additionalDirectories).toEqual(["/a"]);
  });
  it("preserves unknown top-level fields", () => {
    writeFileSync(settingsFile, JSON.stringify({ model: "opus", permissions: { foo: 1 } }));
    const s = readSettings(settingsFile);
    expect(s.model).toBe("opus");
    expect(s.permissions?.foo).toBe(1);
  });
  it("throws on corrupt JSON without overwriting", () => {
    writeFileSync(settingsFile, "{ not json");
    expect(() => readSettings(settingsFile)).toThrow(/corrupt|parse/i);
    expect(readFileSync(settingsFile, "utf8")).toBe("{ not json");
  });
  it("throws when file is missing", () => {
    expect(() => readSettings(join(dir, "nope.json"))).toThrow(/not found|init/i);
  });
});

describe("writeAdditionalDirs", () => {
  it("writes dirs and preserves other fields + key order", () => {
    writeFileSync(settingsFile, JSON.stringify({ model: "opus", permissions: { additionalDirectories: ["/old"], keep: 1 } }));
    writeAdditionalDirs(settingsFile, ["/old", "/new"]);
    const raw = JSON.parse(readFileSync(settingsFile, "utf8"));
    expect(raw.permissions.additionalDirectories).toEqual(["/old", "/new"]);
    expect(raw.model).toBe("opus");
    expect(raw.permissions.keep).toBe(1);
    expect(Object.keys(raw)).toEqual(["model", "permissions"]);
  });
  it("creates the file when it does not exist", () => {
    const missing = join(dir, ".claude", "fresh.json");
    writeAdditionalDirs(missing, ["/a", "/a", "/b"]);
    const raw = JSON.parse(readFileSync(missing, "utf8"));
    expect(raw.permissions.additionalDirectories).toEqual(["/a", "/b"]);
  });
  it("adds permissions when settings lacks them", () => {
    writeFileSync(settingsFile, JSON.stringify({ model: "opus" }));
    writeAdditionalDirs(settingsFile, ["/x"]);
    const raw = JSON.parse(readFileSync(settingsFile, "utf8"));
    expect(raw.permissions.additionalDirectories).toEqual(["/x"]);
    expect(raw.model).toBe("opus");
  });
  it("throws on corrupt JSON without overwriting (aligns with readSettings)", () => {
    writeFileSync(settingsFile, "{ not json");
    expect(() => writeAdditionalDirs(settingsFile, ["/x"])).toThrow(/corrupt|parse/i);
    expect(readFileSync(settingsFile, "utf8")).toBe("{ not json");
  });
});

describe("setAdditionalDirs", () => {
  it("replaces the full list, preserving other fields", () => {
    writeFileSync(settingsFile, JSON.stringify({ model: "opus", permissions: { additionalDirectories: ["/old"], keep: 1 } }));
    setAdditionalDirs(settingsFile, ["/a", "/b"]);
    const raw = JSON.parse(readFileSync(settingsFile, "utf8"));
    expect(raw.permissions.additionalDirectories).toEqual(["/a", "/b"]);
    expect(raw.model).toBe("opus");
    expect(raw.permissions.keep).toBe(1);
  });
  it("dedupes the input list", () => {
    writeFileSync(settingsFile, JSON.stringify({ permissions: { additionalDirectories: ["/old"] } }));
    setAdditionalDirs(settingsFile, ["/a", "/a", "/b"]);
    const raw = JSON.parse(readFileSync(settingsFile, "utf8"));
    expect(raw.permissions.additionalDirectories).toEqual(["/a", "/b"]);
  });
  it("creates the file when it does not exist", () => {
    const missing = join(dir, ".claude", "fresh.json");
    setAdditionalDirs(missing, ["/a", "/b"]);
    const raw = JSON.parse(readFileSync(missing, "utf8"));
    expect(raw.permissions.additionalDirectories).toEqual(["/a", "/b"]);
  });
  it("adds permissions when settings lacks them", () => {
    writeFileSync(settingsFile, JSON.stringify({ model: "opus" }));
    setAdditionalDirs(settingsFile, ["/x"]);
    const raw = JSON.parse(readFileSync(settingsFile, "utf8"));
    expect(raw.permissions.additionalDirectories).toEqual(["/x"]);
    expect(raw.model).toBe("opus");
  });
  it("throws on corrupt JSON without overwriting (aligns with readSettings)", () => {
    writeFileSync(settingsFile, "{ not json");
    expect(() => setAdditionalDirs(settingsFile, ["/x"])).toThrow(/corrupt|parse/i);
    expect(readFileSync(settingsFile, "utf8")).toBe("{ not json");
  });
});

describe("setBypassPermissions", () => {
  it("enables bypass by writing defaultMode, preserving other fields", () => {
    writeFileSync(settingsFile, JSON.stringify({ model: "opus", permissions: { additionalDirectories: ["/a"] } }));
    setBypassPermissions(settingsFile, true);
    const raw = JSON.parse(readFileSync(settingsFile, "utf8"));
    expect(raw.permissions.defaultMode).toBe("bypassPermissions");
    expect(raw.permissions.additionalDirectories).toEqual(["/a"]);
    expect(raw.model).toBe("opus");
  });
  it("disables bypass by removing defaultMode, preserving other fields", () => {
    writeFileSync(settingsFile, JSON.stringify({ model: "opus", permissions: { defaultMode: "bypassPermissions", keep: 1 } }));
    setBypassPermissions(settingsFile, false);
    const raw = JSON.parse(readFileSync(settingsFile, "utf8"));
    expect(raw.permissions.defaultMode).toBeUndefined();
    expect(raw.permissions.keep).toBe(1);
    expect(raw.model).toBe("opus");
  });
  it("adds permissions when settings lacks them", () => {
    writeFileSync(settingsFile, JSON.stringify({ model: "opus" }));
    setBypassPermissions(settingsFile, true);
    const raw = JSON.parse(readFileSync(settingsFile, "utf8"));
    expect(raw.permissions.defaultMode).toBe("bypassPermissions");
    expect(raw.model).toBe("opus");
  });
  it("creates the file when it does not exist", () => {
    const missing = join(dir, ".claude", "fresh.json");
    setBypassPermissions(missing, true);
    const raw = JSON.parse(readFileSync(missing, "utf8"));
    expect(raw.permissions.defaultMode).toBe("bypassPermissions");
  });
  it("throws on corrupt JSON without overwriting (aligns with readSettings)", () => {
    writeFileSync(settingsFile, "{ not json");
    expect(() => setBypassPermissions(settingsFile, true)).toThrow(/corrupt|parse/i);
    expect(readFileSync(settingsFile, "utf8")).toBe("{ not json");
  });
});
