import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkspace } from "../../src/core/workspace.js";
import { writeAdditionalDirs } from "../../src/core/settings.js";
import { claudeMdPath, settingsPath } from "../../src/core/config.js";
import {
  BEGIN,
  END,
  renderDirsBlock,
  renderFull,
  countOccurrences,
  writeClaudeMd,
  syncClaudeMd,
  readDirEntries,
  forceRewriteClaudeMd,
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

describe("writeClaudeMd", () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ccws-md-"));
    file = join(dir, "CLAUDE.md");
  });

  it("creates the file with full content when absent, returns 'created'", () => {
    const out = writeClaudeMd(file, [{ path: "/a", missing: false }]);
    expect(out).toBe("created");
    const content = readFileSync(file, "utf8");
    expect(content).toContain("# Workspace");
    expect(content).toContain("- /a");
  });

  it("rewrites only the block on a single complete pair, preserving outside content", () => {
    const initial =
      "# My custom notes\n\nimportant line\n\n" +
      `${BEGIN}\n- /old\n${END}\n\nfooter notes\n`;
    writeFileSync(file, initial, "utf8");
    const out = writeClaudeMd(file, [{ path: "/new", missing: false }]);
    expect(out).toBe("rewrote-block");
    const content = readFileSync(file, "utf8");
    expect(content).toContain("important line");
    expect(content).toContain("footer notes");
    expect(content).toContain("- /new");
    expect(content).not.toContain("- /old");
  });

  it("appends a block when no markers exist, returns 'appended'", () => {
    writeFileSync(file, "# Just my notes\n", "utf8");
    const out = writeClaudeMd(file, [{ path: "/a", missing: false }]);
    expect(out).toBe("appended");
    const content = readFileSync(file, "utf8");
    expect(content).toContain("# Just my notes");
    expect(content).toContain("- /a");
    expect(content).toContain(BEGIN);
    expect(content).toContain(END);
  });

  it("is idempotent: append then sync again rewrites the block, no second block", () => {
    writeFileSync(file, "# Notes\n", "utf8");
    writeClaudeMd(file, [{ path: "/a", missing: false }]);
    const out2 = writeClaudeMd(file, [
      { path: "/a", missing: false },
      { path: "/b", missing: false },
    ]);
    expect(out2).toBe("rewrote-block");
    const content = readFileSync(file, "utf8");
    expect(countOccurrences(content, BEGIN)).toBe(1);
    expect(countOccurrences(content, END)).toBe(1);
    expect(content).toContain("- /b");
  });

  it("throws and leaves the file unchanged on an orphan BEGIN", () => {
    writeFileSync(file, `# Notes\n${BEGIN}\n- /old\n`, "utf8");
    const before = readFileSync(file, "utf8");
    expect(() => writeClaudeMd(file, [{ path: "/a", missing: false }])).toThrow(
      /incomplete|malformed/i,
    );
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("throws on an orphan END", () => {
    writeFileSync(file, `# Notes\n${END}\n`, "utf8");
    expect(() => writeClaudeMd(file, [])).toThrow(/incomplete|malformed/i);
  });

  it("throws on multiple BEGIN markers (with a matching END)", () => {
    writeFileSync(file, `${BEGIN}\n${BEGIN}\n${END}\n`, "utf8");
    expect(() => writeClaudeMd(file, [])).toThrow(/incomplete|malformed/i);
  });

  it("throws when END appears before BEGIN", () => {
    writeFileSync(file, `${END}\n${BEGIN}\n`, "utf8");
    expect(() => writeClaudeMd(file, [])).toThrow(/incomplete|malformed/i);
  });
});

describe("readDirEntries / syncClaudeMd / forceRewriteClaudeMd", () => {
  let root: string;
  let realDir: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "ccws-root-")));
    realDir = realpathSync(mkdtempSync(join(tmpdir(), "real-")));
  });

  it("readDirEntries maps settings dirs to entries with the missing flag", () => {
    createWorkspace(root, "demo");
    writeAdditionalDirs(settingsPath(root, "demo"), [realDir, "/does/not/exist"]);
    expect(readDirEntries(root, "demo")).toEqual([
      { path: realDir, missing: false },
      { path: "/does/not/exist", missing: true },
    ]);
  });

  it("readDirEntries returns [] when additionalDirectories is absent", () => {
    createWorkspace(root, "demo");
    expect(readDirEntries(root, "demo")).toEqual([]);
  });

  it("syncClaudeMd creates CLAUDE.md when absent, with the empty hint", () => {
    createWorkspace(root, "demo");
    const out = syncClaudeMd(root, "demo");
    expect(out).toBe("created");
    const content = readFileSync(claudeMdPath(root, "demo"), "utf8");
    expect(content).toContain("none yet");
  });

  it("syncClaudeMd reflects current dirs and marks missing ones", () => {
    createWorkspace(root, "demo");
    writeAdditionalDirs(settingsPath(root, "demo"), [realDir, "/gone"]);
    syncClaudeMd(root, "demo");
    const content = readFileSync(claudeMdPath(root, "demo"), "utf8");
    expect(content).toContain(`- ${realDir}`);
    expect(content).toContain("- /gone  ⚠️ missing");
  });

  it("syncClaudeMd is idempotent (second call returns 'rewrote-block')", () => {
    createWorkspace(root, "demo");
    writeAdditionalDirs(settingsPath(root, "demo"), [realDir]);
    syncClaudeMd(root, "demo");
    expect(syncClaudeMd(root, "demo")).toBe("rewrote-block");
  });

  it("syncClaudeMd routes corrupt settings through readSettings (throws, no write)", () => {
    createWorkspace(root, "demo");
    writeFileSync(settingsPath(root, "demo"), "{ not json", "utf8");
    expect(() => syncClaudeMd(root, "demo")).toThrow(/corrupt/i);
  });

  it("forceRewriteClaudeMd overwrites the whole file, discarding outside content", () => {
    createWorkspace(root, "demo");
    const file = claudeMdPath(root, "demo");
    writeFileSync(file, "# precious custom content\n", "utf8");
    forceRewriteClaudeMd(file, [{ path: realDir, missing: false }]);
    const content = readFileSync(file, "utf8");
    expect(content).not.toContain("precious custom content");
    expect(content).toContain("# Workspace");
    expect(content).toContain(`- ${realDir}`);
  });
});
