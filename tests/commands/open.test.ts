import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import { initAction } from "../../src/commands/init.js";
import { openAction, type Runner } from "../../src/commands/open.js";
import { workspacePath } from "../../src/core/config.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ccws-root-")); });

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
  it("accepts a runner that returns a ChildProcess-like handle (async error path is owned by the runner)", async () => {
    await initAction("demo", { root });
    // defaultRunner returns a ChildProcess on which callers may attach an async "error" listener.
    // openAction tolerates a non-void return without breaking. Here we only assert the contract:
    // a Runner may return ChildProcess (typed) and openAction resolves cleanly.
    const runner: Runner = () => ({ on: () => {} }) as unknown as ChildProcess;
    await expect(openAction("demo", { root, runner })).resolves.toBeUndefined();
  });
});
