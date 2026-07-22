import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initAction } from "../../src/commands/init.js";
import { statusAction } from "../../src/commands/status.js";
import { settingsPath } from "../../src/core/config.js";

let root: string; let real: string;
beforeEach(() => {
  // realpathSync: on macOS /tmp -> /private/tmp; normalize so root and any cwd
  // derived from it share a namespace, keeping detectWorkspaceFromCwd's
  // `relative(root, cwd)` correct.
  root = realpathSync(mkdtempSync(join(tmpdir(), "ccws-root-")));
  real = realpathSync(mkdtempSync(join(tmpdir(), "r-")));
});
afterEach(() => vi.unstubAllGlobals());

const capture = () => {
  const buf: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((c) => { buf.push(String(c)); return true; });
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  return () => buf.join("");
};

describe("statusAction", () => {
  it("reports current workspace dirs with markers when cwd inside it", async () => {
    await initAction("demo", { root });
    writeFileSync(settingsPath(root, "demo"), JSON.stringify({ permissions: { additionalDirectories: [real, "/missing"] } }));
    const out = capture();
    await statusAction({ root, cwd: join(root, "demo", "sub") });
    const text = out();
    expect(text).toContain("demo");
    expect(text).toContain(real);
    expect(text).toContain("/missing");
  });
  it("warns when not inside any workspace", async () => {
    const err: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((c) => { err.push(String(c)); return true; });
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await statusAction({ root, cwd: "/tmp" });
    expect(err.join("")).toMatch(/not inside|no workspace/i);
  });
});
