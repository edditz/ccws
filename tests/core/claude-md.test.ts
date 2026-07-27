import { describe, it, expect } from "vitest";
import {
  BEGIN,
  END,
  renderDirsBlock,
  renderFull,
  countOccurrences,
} from "../../src/core/claude-md.js";

describe("renderDirsBlock", () => {
  it("renders the empty hint when there are no entries", () => {
    expect(renderDirsBlock([])).toBe(
      "<!-- (none yet — use `ccws add <dir>` to associate directories) -->",
    );
  });
  it("renders one bullet per entry", () => {
    expect(
      renderDirsBlock([
        { path: "/a", missing: false },
        { path: "/b", missing: false },
      ]),
    ).toBe("- /a\n- /b");
  });
  it("marks missing entries with a warning", () => {
    expect(
      renderDirsBlock([
        { path: "/a", missing: false },
        { path: "/gone", missing: true },
      ]),
    ).toBe("- /a\n- /gone  ⚠️ missing");
  });
  it("preserves entry order", () => {
    const out = renderDirsBlock([
      { path: "/z", missing: false },
      { path: "/a", missing: false },
    ]);
    expect(out.split("\n")[0]).toBe("- /z");
  });
});

describe("renderFull", () => {
  it("contains header, BEGIN, END, and footer", () => {
    const out = renderFull([]);
    expect(out).toContain("# Workspace");
    expect(out).toContain(BEGIN);
    expect(out).toContain(END);
    expect(out).toContain("auto-maintained");
  });
  it("places BEGIN before END", () => {
    const out = renderFull([{ path: "/a", missing: false }]);
    expect(out.indexOf(BEGIN)).toBeLessThan(out.indexOf(END));
  });
  it("embeds the dirs block between the markers", () => {
    const out = renderFull([{ path: "/a", missing: false }]);
    const between = out.slice(out.indexOf(BEGIN) + BEGIN.length, out.indexOf(END));
    expect(between).toContain("- /a");
  });
  it("embeds the empty hint when no entries", () => {
    expect(renderFull([])).toContain("none yet");
  });
});

describe("countOccurrences", () => {
  it("counts non-overlapping occurrences", () => {
    expect(countOccurrences("aXaXa", "X")).toBe(2);
    expect(countOccurrences(BEGIN + "x" + BEGIN, BEGIN)).toBe(2);
  });
  it("returns 0 when absent", () => {
    expect(countOccurrences("aaa", "X")).toBe(0);
  });
  it("returns 0 for an empty needle", () => {
    expect(countOccurrences("aaa", "")).toBe(0);
  });
});
