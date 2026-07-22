import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initAction } from "../../src/commands/init.js";
import { addAction } from "../../src/commands/add.js";
import { listAction } from "../../src/commands/list.js";
import { settingsPath } from "../../src/core/config.js";

let root: string; let real: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ccws-root-")); real = mkdtempSync(join(tmpdir(), "r-")); });
afterEach(() => vi.unstubAllGlobals());

const capture = () => {
  const buf: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((c) => { buf.push(String(c)); return true; });
  return () => buf.join("");
};

describe("listAction", () => {
  it("lists all workspaces with dir counts", async () => {
    await initAction("demo", { root });
    await addAction([real], { root, workspace: "demo" });
    await initAction("empty", { root });
    const out = capture();
    await listAction([], { root });
    expect(out()).toContain("demo");
    expect(out()).toContain("empty");
  });
  it("shows single workspace detail with existence markers", async () => {
    await initAction("demo", { root });
    // write settings directly so a missing path can be included (add would reject it atomically)
    writeFileSync(settingsPath(root, "demo"),
      JSON.stringify({ permissions: { additionalDirectories: [real, "/missing"] } }));
    const out = capture();
    await listAction(["demo"], { root });
    const text = out();
    expect(text).toContain(real);
    expect(text).toContain("/missing");
  });
});
