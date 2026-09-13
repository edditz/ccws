import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { initAction } from "../../src/commands/init.js";
import { openAction, type Runner } from "../../src/commands/open.js";
import { workspacePath } from "../../src/core/config.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ccws-root-")); });

// openAction awaits the spawned child and propagates its exit code via
// process.exitCode; save/restore around every test so failures never leak.
let savedExitCode: number | string | null | undefined;
beforeEach(() => { savedExitCode = process.exitCode; });
afterEach(() => {
  process.exitCode = savedExitCode;
  vi.restoreAllMocks();
});

// A ChildProcess-shaped EventEmitter whose "exit" fires on the next microtask,
// after openAction has synchronously attached its listeners.
const exitedChild = (code: number): ChildProcess => {
  const c = new EventEmitter() as unknown as ChildProcess;
  queueMicrotask(() => c.emit("exit", code, null));
  return c;
};

describe("openAction", () => {
  it("chdirs into workspace and runs claude", async () => {
    await initAction("demo", { root });
    let chdirArg = ""; const calls: string[] = [];
    const runner = (cmd: string, args: string[], opts: any) => {
      calls.push(cmd);
      chdirArg = opts.cwd;
    };
    await openAction("demo", { root, runner });
    expect(calls[0]).toBe("claude");
    expect(chdirArg).toBe(workspacePath(root, "demo"));
  });
  it("throws when workspace missing", async () => {
    await expect(openAction("nope", { root, runner: () => {} })).rejects.toThrow(/does not exist/i);
  });
  it("throws a helpful message when the runner fails to spawn claude", async () => {
    await initAction("demo", { root });
    const thrower = () => { throw new Error("spawn ENOENT"); };
    // Single error path: action throws (cli.ts fail prints it); no separate error() log.
    await expect(openAction("demo", { root, runner: thrower }))
      .rejects.toThrow(/claude.*not found in PATH|install Claude Code/i);
  });
  it("waits for the returned ChildProcess and resolves after it exits cleanly", async () => {
    await initAction("demo", { root });
    // openAction now awaits the child's exit; the fake must be a real event emitter.
    const runner: Runner = () => exitedChild(0);
    await expect(openAction("demo", { root, runner })).resolves.toBeUndefined();
  });
  it("prints the ccws resume hint after a clean claude exit", async () => {
    await initAction("demo", { root });
    const chunks: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    }) as never);
    // Empty sessions root keeps the post-exit scan off the real ~/.claude/projects.
    const sessionsRoot = mkdtempSync(join(tmpdir(), "ccws-empty-"));
    await openAction("demo", { root, runner: () => exitedChild(0), sessionsRoot });
    expect(chunks.join("")).toContain("resume this session: ccws resume demo");
  });
  it("propagates a non-zero claude exit code and prints no hint", async () => {
    await initAction("demo", { root });
    const chunks: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    }) as never);
    await openAction("demo", { root, runner: () => exitedChild(2) });
    expect(process.exitCode).toBe(2);
    expect(chunks.join("")).not.toContain("resume this session");
  });
});
