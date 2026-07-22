import { describe, it, expect, vi, afterEach } from "vitest";
import { info, success, error, warn } from "../../src/utils/log.js";

afterEach(() => vi.unstubAllGlobals());

describe("log", () => {
  it("info writes to stdout without prefix symbol collision", () => {
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    info("hello");
    expect(spy.mock.calls[0][0]).toContain("hello");
  });
  it("error writes to stderr", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    error("boom");
    expect(spy.mock.calls[0][0].toString()).toContain("boom");
  });
  it("success and warn do not throw", () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(() => { success("ok"); warn("hmm"); }).not.toThrow();
  });
});
