import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSettings, writeAdditionalDirs } from "../../src/core/settings.js";

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
});
