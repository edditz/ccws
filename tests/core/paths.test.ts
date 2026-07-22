import { describe, it, expect } from "vitest";
import { toAbsolute, dedupe, assertAllExist } from "../../src/core/paths.js";
import { tmpdir } from "node:os";
import { mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";

describe("toAbsolute", () => {
  it("resolves relative input against cwd", () => {
    expect(toAbsolute("foo/bar")).toBe(join(process.cwd(), "foo/bar"));
  });
  it("returns absolute input unchanged (normalized)", () => {
    expect(toAbsolute("/x/./y")).toBe("/x/y");
  });
});

describe("dedupe", () => {
  it("removes duplicates, preserves order", () => {
    expect(dedupe(["/a", "/b", "/a", "/c", "/b"])).toEqual(["/a", "/b", "/c"]);
  });
  it("returns empty for empty input", () => {
    expect(dedupe([])).toEqual([]);
  });
});

describe("assertAllExist", () => {
  it("returns [] when all paths exist", () => {
    const d = mkdtempSync(join(tmpdir(), "ccws-"));
    expect(assertAllExist([d])).toEqual([]);
  });
  it("returns the missing subset", () => {
    const d = mkdtempSync(join(tmpdir(), "ccws-"));
    const missing = join(d, "nope");
    expect(assertAllExist([d, missing])).toEqual([missing]);
  });
});
