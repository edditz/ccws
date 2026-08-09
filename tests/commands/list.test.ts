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
  it("lists all workspaces with dir counts (concise by default)", async () => {
    await initAction("demo", { root });
    await addAction([real], { root, workspace: "demo" });
    await initAction("empty", { root });
    const out = capture();
    await listAction([], { root });
    const text = out();
    expect(text).toContain("demo");
    expect(text).toContain("empty");
    expect(text).not.toContain("bypass:");
    expect(text).not.toContain(join(root, "demo"));
  });
  it("shows path and bypass status in long mode", async () => {
    await initAction("demo", { root });
    await addAction([real], { root, workspace: "demo" });
    await initAction("empty", { root });
    const out = capture();
    await listAction([], { root, long: true });
    const text = out();
    expect(text).toContain(join(root, "demo"));
    expect(text).toContain(join(root, "empty"));
    expect(text).toContain("bypass: off");
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
    expect(text).not.toContain("bypass:");
  });
  it("marks bypass on in long mode for both views", async () => {
    await initAction("demo", { root });
    writeFileSync(settingsPath(root, "demo"),
      JSON.stringify({ permissions: { additionalDirectories: [], defaultMode: "bypassPermissions" } }));
    const out = capture();
    await listAction([], { root, long: true });
    expect(out()).toContain("bypass: ON");
    const out2 = capture();
    await listAction(["demo"], { root, long: true });
    expect(out2()).toContain(`bypass: ON`);
  });
});
