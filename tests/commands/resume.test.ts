import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { initAction } from "../../src/commands/init.js";
import { resumeAction, type ResumeOptions } from "../../src/commands/resume.js";
import { workspacePath, settingsPath } from "../../src/core/config.js";
import type { Runner } from "../../src/utils/claude-session.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ccws-root-")); });

// resumeAction awaits the spawned child and propagates its exit code via
// process.exitCode; save/restore around every test so failures never leak.
let savedExitCode: number | string | null | undefined;
beforeEach(() => { savedExitCode = process.exitCode; });
afterEach(() => {
  process.exitCode = savedExitCode;
  vi.restoreAllMocks();
});

const exitedChild = (code: number): ChildProcess => {
  const c = new EventEmitter() as unknown as ChildProcess;
  queueMicrotask(() => c.emit("exit", code, null));
  return c;
};

interface SpawnCall { cmd: string; args: string[]; cwd: string }
const recordingRunner = (calls: SpawnCall[], code = 0): Runner => (cmd, args, opts) => {
  calls.push({ cmd, args, cwd: opts.cwd });
  return exitedChild(code);
};

const spyStdout = (): string[] => {
  const chunks: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  }) as never);
  return chunks;
};

describe("resumeAction", () => {
  it("runs claude --resume (picker) in the workspace when no session id is given", async () => {
    await initAction("demo", { root });
    const calls: SpawnCall[] = [];
    await resumeAction("demo", undefined, { root, runner: recordingRunner(calls) });
    expect(calls).toEqual([{ cmd: "claude", args: ["--resume"], cwd: workspacePath(root, "demo") }]);
  });

  it("passes the session id through to claude --resume", async () => {
    await initAction("demo", { root });
    const calls: SpawnCall[] = [];
    await resumeAction("demo", "abc-123", { root, runner: recordingRunner(calls) });
    expect(calls).toEqual([
      { cmd: "claude", args: ["--resume", "abc-123"], cwd: workspacePath(root, "demo") },
    ]);
  });

  it("throws when workspace missing", async () => {
    await expect(resumeAction("nope", undefined, { root, runner: () => {} }))
      .rejects.toThrow(/does not exist/i);
  });

  it("throws a helpful message when the runner fails to spawn claude", async () => {
    await initAction("demo", { root });
    const thrower: Runner = () => {
      throw new Error("spawn ENOENT");
    };
    await expect(resumeAction("demo", undefined, { root, runner: thrower }))
      .rejects.toThrow(/claude.*not found in PATH|install Claude Code/i);
  });

  it("prints a ccws resume hint after a clean claude exit", async () => {
    await initAction("demo", { root });
    const chunks = spyStdout();
    // Empty sessions root keeps the post-exit scan off the real ~/.claude/projects.
    const sessionsRoot = mkdtempSync(join(tmpdir(), "ccws-empty-"));
    await resumeAction("demo", undefined, { root, runner: recordingRunner([]), sessionsRoot });
    expect(chunks.join("")).toContain("• resume this session: ccws resume demo");
  });

  it("includes the session id in the hint when one was given", async () => {
    await initAction("demo", { root });
    const chunks = spyStdout();
    const sessionsRoot = mkdtempSync(join(tmpdir(), "ccws-empty-"));
    await resumeAction("demo", "abc-123", { root, runner: recordingRunner([]), sessionsRoot });
    expect(chunks.join("")).toContain("• resume this session: ccws resume demo abc-123");
  });

  it("propagates a non-zero claude exit code and prints no hint", async () => {
    await initAction("demo", { root });
    const chunks = spyStdout();
    await resumeAction("demo", undefined, { root, runner: recordingRunner([], 2) });
    expect(process.exitCode).toBe(2);
    expect(chunks.join("")).not.toContain("resume this session");
  });

  it("prepends --permission-mode before --resume when a mode is stored", async () => {
    await initAction("demo", { root });
    writeFileSync(settingsPath(root, "demo"),
      JSON.stringify({ permissions: { additionalDirectories: [], defaultMode: "plan" } }));
    const calls: SpawnCall[] = [];
    await resumeAction("demo", "abc-123", { root, runner: recordingRunner(calls) });
    expect(calls).toEqual([
      { cmd: "claude", args: ["--permission-mode", "plan", "--resume", "abc-123"], cwd: workspacePath(root, "demo") },
    ]);
  });
});

// ResumeOptions must stay structurally compatible with the runner-injection
// contract shared with open (root + runner); guard against accidental drift.
describe("ResumeOptions", () => {
  it("accepts the same option shape as OpenOptions", async () => {
    const opts: ResumeOptions = { root, runner: () => {} };
    expect(opts.runner).toBeTypeOf("function");
  });
});
