import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { scratchAction } from "../../src/commands/scratch.js";
import type { Runner } from "../../src/commands/open.js";

let root: string;
let sessionsRoot: string;
let claudeJsonPath: string;
let outText: () => string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "ccws-root-")));
  sessionsRoot = mkdtempSync(join(tmpdir(), "ccws-sessions-"));
  claudeJsonPath = join(root, "claude.json");
});

const readClaudeJson = (): Record<string, unknown> =>
  JSON.parse(readFileSync(claudeJsonPath, "utf8"));

let savedExitCode: number | string | null | undefined;
beforeEach(() => { savedExitCode = process.exitCode; });
afterEach(() => {
  process.exitCode = savedExitCode;
  vi.restoreAllMocks();
});

const spyOutput = (): void => {
  const outChunks: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation(((c: unknown) => {
    outChunks.push(String(c));
    return true;
  }) as never);
  outText = () => outChunks.join("");
};

// A ChildProcess-shaped EventEmitter whose "exit" fires on the next microtask.
const exitedChild = (code: number): ChildProcess => {
  const c = new EventEmitter() as unknown as ChildProcess;
  queueMicrotask(() => c.emit("exit", code, null));
  return c;
};

describe("scratchAction", () => {
  it("creates the scratch workspace, launches claude with bypassPermissions, discards it on exit", async () => {
    spyOutput();
    const calls: { cmd: string; args: string[]; cwd: string }[] = [];
    const runner: Runner = (cmd, args, opts) => {
      calls.push({ cmd, args, cwd: opts.cwd });
      return exitedChild(0);
    };
    await scratchAction({ root, runner, sessionsRoot, claudeJsonPath });
    expect(calls).toHaveLength(1);
    expect(calls[0].cmd).toBe("claude");
    expect(calls[0].args).toEqual(["--permission-mode", "bypassPermissions"]);
    // The session runs in a freshly generated random scratch name under $ROOT.
    expect(dirname(calls[0].cwd)).toBe(root);
    expect(basename(calls[0].cwd)).toMatch(/^[a-z]{4,8}(-[a-z]{4,8}){0,2}$/);
    // Use-and-discard: the workspace is gone once claude exits.
    expect(existsSync(calls[0].cwd)).toBe(false);
    expect(outText()).toContain("created scratch workspace");
    expect(outText()).toContain("discarded when claude exits");
    // claude's own resume hint is replaced by the discard notice — resume is
    // dead once the workspace is gone.
    expect(outText()).toContain("scratch session ended — workspace");
    expect(outText()).not.toContain("resume this session");
  });
  it("pre-trusts the cwd in claude's config before spawn, and drops the entry on discard", async () => {
    spyOutput();
    let trustedAtSpawn = false;
    const runner: Runner = (_cmd, _args, opts) => {
      // Read claude's trust memory at spawn time: the mark must already exist.
      const config = JSON.parse(readFileSync(claudeJsonPath, "utf8")) as {
        projects?: Record<string, { hasTrustDialogAccepted?: boolean }>;
      };
      trustedAtSpawn = config.projects?.[opts.cwd]?.hasTrustDialogAccepted === true;
      return exitedChild(0);
    };
    await scratchAction({ root, runner, sessionsRoot, claudeJsonPath });
    expect(trustedAtSpawn).toBe(true);
    expect(existsSync(claudeJsonPath)).toBe(true);
    expect(readClaudeJson().projects ?? {}).toEqual({});
  });
  it("discards the workspace even on a non-zero claude exit", async () => {
    spyOutput();
    let cwd = "";
    const runner: Runner = (_cmd, _args, opts) => {
      cwd = opts.cwd;
      return exitedChild(2);
    };
    await scratchAction({ root, runner, sessionsRoot, claudeJsonPath });
    expect(process.exitCode).toBe(2);
    expect(existsSync(cwd)).toBe(false);
  });
  it("cleans the skeleton up when claude fails to launch", async () => {
    spyOutput();
    const thrower = () => { throw new Error("spawn ENOENT"); };
    await expect(scratchAction({ root, runner: thrower, sessionsRoot, claudeJsonPath }))
      .rejects.toThrow(/claude.*not found in PATH|install Claude Code/i);
    expect(readdirSync(root).filter((n) => n.startsWith("scratch-"))).toEqual([]);
  });
});
