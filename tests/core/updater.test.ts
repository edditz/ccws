import { describe, it, expect } from "vitest";
import {
  stripLeadingV,
  compareVersions,
  platformToAsset,
  pickChecksum,
  isInterpreterExecPath,
} from "../../src/core/updater.js";

describe("stripLeadingV", () => {
  it("strips a single leading v", () => {
    expect(stripLeadingV("v1.2.3")).toBe("1.2.3");
    expect(stripLeadingV("1.2.3")).toBe("1.2.3");
  });
  it("strips only one v prefix", () => {
    expect(stripLeadingV("vv1.0.0")).toBe("v1.0.0");
  });
});

describe("compareVersions", () => {
  it("returns 0 for equal versions", () => {
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });
  it("returns 1 when a > b at major, minor, or patch", () => {
    expect(compareVersions("2.0.0", "1.0.0")).toBe(1);
    expect(compareVersions("1.2.0", "1.1.0")).toBe(1);
    expect(compareVersions("1.0.1", "1.0.0")).toBe(1);
  });
  it("returns -1 when a < b", () => {
    expect(compareVersions("1.0.0", "2.0.0")).toBe(-1);
    expect(compareVersions("1.1.0", "1.2.0")).toBe(-1);
  });
  it("treats missing components as 0", () => {
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
    expect(compareVersions("1", "1.0.0")).toBe(0);
  });
  it("ignores pre-release suffixes", () => {
    expect(compareVersions("1.0.0-beta", "1.0.0")).toBe(0);
    expect(compareVersions("1.2.0-rc.1", "1.1.0")).toBe(1);
  });
  it("treats non-numeric components as 0", () => {
    expect(compareVersions("x.y.z", "0.0.0")).toBe(0);
  });
});

describe("platformToAsset", () => {
  it("maps every supported target", () => {
    expect(platformToAsset("darwin", "arm64")).toBe("ccws-darwin-arm64");
    expect(platformToAsset("darwin", "x64")).toBe("ccws-darwin-x64");
    expect(platformToAsset("linux", "x64")).toBe("ccws-linux-x64");
    expect(platformToAsset("linux", "arm64")).toBe("ccws-linux-arm64");
    expect(platformToAsset("win32", "x64")).toBe("ccws-windows-x64.exe");
  });
  it("throws on unsupported platform", () => {
    expect(() => platformToAsset("freebsd", "x64")).toThrow(/unsupported platform/i);
  });
  it("throws on unsupported arch", () => {
    expect(() => platformToAsset("darwin", "ia32")).toThrow(/unsupported arch/i);
  });
});

describe("pickChecksum", () => {
  const mkText = (hash: string, name = "ccws-darwin-arm64") =>
    `${hash}  ${name}\n${"9".repeat(64)}  ccws-linux-x64\n`;
  it("finds the matching asset hash (two-space format)", () => {
    const h = "a".repeat(64);
    expect(pickChecksum(mkText(h), "ccws-darwin-arm64")).toBe(h);
  });
  it("finds the matching asset hash (binary * format)", () => {
    const h = "b".repeat(64);
    expect(pickChecksum(`${h} *ccws-darwin-arm64\n`, "ccws-darwin-arm64")).toBe(h);
  });
  it("lowercases an uppercase hex hash", () => {
    const h = "A".repeat(64);
    expect(pickChecksum(mkText(h), "ccws-darwin-arm64")).toBe(h.toLowerCase());
  });
  it("returns null when the asset is absent", () => {
    expect(pickChecksum(mkText("c".repeat(64)), "ccws-windows-x64.exe")).toBeNull();
  });
});

describe("isInterpreterExecPath", () => {
  it("flags JS runtimes and package managers (unix and windows)", () => {
    expect(isInterpreterExecPath("/usr/local/bin/bun")).toBe(true);
    expect(isInterpreterExecPath("/usr/bin/node")).toBe(true);
    expect(isInterpreterExecPath("/foo/npm")).toBe(true);
    expect(isInterpreterExecPath("C:\\Program Files\\nodejs\\node.exe")).toBe(true);
  });
  it("does not flag the ccws binary", () => {
    expect(isInterpreterExecPath("/home/u/.local/bin/ccws")).toBe(false);
    expect(isInterpreterExecPath("C:\\Users\\u\\bin\\ccws.exe")).toBe(false);
  });
});
