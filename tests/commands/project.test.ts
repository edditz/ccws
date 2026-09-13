import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, existsSync, realpathSync, lstatSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { initAction } from "../../src/commands/init.js";
import { openAction } from "../../src/commands/open.js";
import { resumeAction } from "../../src/commands/resume.js";
import { listAction } from "../../src/commands/list.js";
import { statusAction } from "../../src/commands/status.js";
import { deleteAction } from "../../src/commands/delete.js";
import { addAction } from "../../src/commands/add.js";
import { bypassAction } from "../../src/commands/bypass.js";
import { workspaceExists } from "../../src/core/workspace.js";

let root: string;
let projectsHome: string;
beforeEach(() => {
  // realpathSync both: on macOS /tmp -> /private/tmp, and every path compared
  // below (targets, cwd) must share one namespace.
  root = realpathSync(mkdtempSync(join(tmpdir(), "ccws-root-")));
  projectsHome = realpathSync(mkdtempSync(join(tmpdir(), "ccws-projects-")));
});
afterEach(() => {
  vi.restoreAllMocks();
});

const makeProjectDir = (name: string): string => {
  const dir = join(projectsHome, name);
  mkdirSync(dir);
  return dir;
};

const exitedChild = (code: number): ChildProcess => {
  const c = new EventEmitter() as unknown as ChildProcess;
  queueMicrotask(() => c.emit("exit", code, null));
  return c;
};

const capture = (): (() => string) => {
  const buf: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((c) => { buf.push(String(c)); return true; });
  vi.spyOn(process.stderr, "write").mockImplementation((c) => { buf.push(String(c)); return true; });
  return () => buf.join("");
};

describe("init: project registration", () => {
  it("registers an existing directory as a project instead of creating a workspace", async () => {
    const target = makeProjectDir("myproj");
    const out = capture();
    await initAction(target, { root });
    expect(lstatSync(join(root, "myproj")).isSymbolicLink()).toBe(true);
    expect(workspaceExists(root, "myproj")).toBe(false);
    expect(out()).toContain("registered project");
    expect(out()).toContain("ccws open myproj");
  });

  it("refuses to register a directory named .ccws (reserved for internal state)", async () => {
    const target = makeProjectDir(".ccws");
    await expect(initAction(target, { root })).rejects.toThrow(/reserved for ccws internal state/);
    expect(existsSync(join(root, ".ccws"))).toBe(false);
  });

  it("registration creates no settings.json and no CLAUDE.md in $ROOT or the target", async () => {
    const target = makeProjectDir("clean");
    await initAction(target, { root });
    expect(existsSync(join(root, "clean", ".claude"))).toBe(false);
    expect(existsSync(join(target, ".claude"))).toBe(false);
    expect(existsSync(join(target, "CLAUDE.md"))).toBe(false);
  });

  it("refuses when the basename collides with an existing workspace", async () => {
    await initAction("clash", { root });
    const target = makeProjectDir("clash");
    try {
      await expect(initAction(target, { root })).rejects.toThrow(/already exists under \$ROOT/i);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });
});

describe("open/resume: project dispatch", () => {
  it("open launches claude with cwd at the project's real path", async () => {
    const target = makeProjectDir("myproj");
    await initAction(target, { root });
    const cwds: string[] = [];
    const runner = (_cmd: string, _args: string[], opts: { cwd: string }) => {
      cwds.push(opts.cwd);
      return exitedChild(0);
    };
    await openAction("myproj", { root, runner });
    expect(cwds).toEqual([target]);
  });

  it("open reports a dangling project with delete guidance", async () => {
    const target = makeProjectDir("gone");
    await initAction(target, { root });
    rmSync(target, { recursive: true });
    await expect(openAction("gone", { root, runner: () => {} }))
      .rejects.toThrow(/missing directory.*ccws delete|ccws delete.*missing/i);
  });

  it("resume runs claude --resume in the project directory", async () => {
    const target = makeProjectDir("myproj");
    await initAction(target, { root });
    const calls: Array<{ args: string[]; cwd: string }> = [];
    const runner = (_cmd: string, args: string[], opts: { cwd: string }) => {
      calls.push({ args, cwd: opts.cwd });
      return exitedChild(0);
    };
    await resumeAction("myproj", "abc-123", { root, runner });
    expect(calls).toEqual([{ args: ["--resume", "abc-123"], cwd: target }]);
  });

  it("unknown names still fail with init guidance", async () => {
    await expect(openAction("nope", { root, runner: () => {} })).rejects.toThrow(/does not exist/i);
  });
});

describe("list: mixed listing with type labels", () => {
  it("shows workspaces and projects as labeled groups", async () => {
    await initAction("demo", { root });
    const target = makeProjectDir("solo");
    await initAction(target, { root });
    const out = capture();
    await listAction([], { root });
    const text = out();
    expect(text).toContain("workspaces:");
    expect(text).toContain("projects:");
    expect(text).toContain("demo");
    expect(text).toContain("solo");
    expect(text).toContain(target);
  });

  it("lists only the projects section when no workspaces exist", async () => {
    const target = makeProjectDir("solo");
    await initAction(target, { root });
    const out = capture();
    await listAction([], { root });
    const text = out();
    expect(text).toContain("projects:");
    expect(text).not.toContain("workspaces:");
  });

  it("prints project detail for `list <name>`", async () => {
    const target = makeProjectDir("solo");
    await initAction(target, { root });
    const out = capture();
    await listAction(["solo"], { root });
    const text = out();
    expect(text).toContain("project: solo");
    expect(text).toContain(target);
    expect(text).not.toContain("workspace:");
  });

  it("marks a dangling project in listings", async () => {
    const target = makeProjectDir("gone");
    await initAction(target, { root });
    rmSync(target, { recursive: true });
    const out = capture();
    await listAction([], { root });
    expect(out()).toContain("target missing");
  });

  it("reports an empty root", async () => {
    const out = capture();
    await listAction([], { root });
    expect(out()).toContain("no workspaces or projects");
  });
});

describe("status: project awareness", () => {
  it("reports the project when cwd is inside the target directory", async () => {
    const target = makeProjectDir("myproj");
    mkdirSync(join(target, "src"));
    await initAction(target, { root });
    const out = capture();
    await statusAction({ root, cwd: join(target, "src") });
    const text = out();
    expect(text).toContain("project: myproj");
    expect(text).toContain("ccws open myproj");
  });

  it("reports the project when cwd is reached through the $ROOT symlink", async () => {
    const target = makeProjectDir("linked");
    await initAction(target, { root });
    const out = capture();
    // Lexical path under $ROOT through the symlink — detectWorkspaceFromCwd
    // hits "linked", resolveEntry must classify it as a project.
    await statusAction({ root, cwd: join(root, "linked", "sub") });
    expect(out()).toContain("project: linked");
  });

  it("warns about a dangling project with cleanup guidance", async () => {
    const target = makeProjectDir("gone");
    await initAction(target, { root });
    rmSync(target, { recursive: true });
    const out = capture();
    // Reach it through the lexical $ROOT path (the real cwd is long gone):
    // detectWorkspaceFromCwd hits "gone", resolveEntry flags it dangling.
    await statusAction({ root, cwd: join(root, "gone", "sub") });
    expect(out()).toContain("target missing");
    expect(out()).toContain("ccws delete gone");
  });
});

describe("delete: unregister only", () => {
  it("unregisters a project without confirmation and leaves the target untouched", async () => {
    const target = makeProjectDir("solo");
    await initAction(target, { root });
    const confirmFn = vi.fn();
    const out = capture();
    await deleteAction("solo", { root, confirmFn });
    expect(confirmFn).not.toHaveBeenCalled(); // not destructive — no prompt
    expect(lstatSync(join(root, "solo"), { throwIfNoEntry: false })).toBeUndefined();
    expect(existsSync(target)).toBe(true);
    expect(out()).toContain("left untouched");
  });

  it("cleans up a dangling registration", async () => {
    const target = makeProjectDir("gone");
    await initAction(target, { root });
    rmSync(target, { recursive: true });
    await deleteAction("gone", { root });
    expect(existsSync(join(root, "gone"))).toBe(false);
  });

  it("still fails for an unknown name", async () => {
    await expect(deleteAction("nope", { root, force: true })).rejects.toThrow(/nothing to delete/i);
  });
});

describe("workspace-only commands reject projects", () => {
  it("add refuses with a read-only message", async () => {
    const target = makeProjectDir("solo");
    const extra = makeProjectDir("extra");
    await initAction(target, { root });
    await expect(addAction([extra], { root, workspace: "solo" }))
      .rejects.toThrow(/project.*read-only|not a workspace/i);
  });

  it("bypass refuses with a read-only message", async () => {
    const target = makeProjectDir("solo");
    await initAction(target, { root });
    await expect(bypassAction("on", { root, workspace: "solo" }))
      .rejects.toThrow(/project.*read-only|not a workspace/i);
  });
});
