import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
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

  it("warns (does not throw) when cwd is in a non-workspace subdir of root", async () => {
    // A real directory under <root> that is NOT a workspace (no .claude/settings.json).
    // detectWorkspaceFromCwd would return its name, but workspaceExists must reject it.
    const notAWorkspace = join(root, "just-a-folder");
    mkdirSync(notAWorkspace, { recursive: true });
    const err: string[] = [];
    const out: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((c) => { err.push(String(c)); return true; });
    vi.spyOn(process.stdout, "write").mockImplementation((c) => { out.push(String(c)); return true; });
    // Must NOT throw a misleading "settings.json not found — run ccws init" error.
    await expect(statusAction({ root, cwd: notAWorkspace })).resolves.toBeUndefined();
    const errText = err.join("");
    const outText = out.join("");
    // Either stream may carry the warning; union both and assert the intent.
    expect(`${errText}${outText}`).toMatch(/not inside|no workspace/i);
    expect(`${errText}${outText}`).not.toMatch(/settings\.json not found|run ccws init/i);
  });
});
