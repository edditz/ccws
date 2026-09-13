import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runClaudeSession,
  CLAUDE_EXIT_HINT_LINES,
  findRecentSessionId,
  mungeProjectDir,
  type Runner,
} from "../../src/utils/claude-session.js";

// runClaudeSession propagates child exit codes via process.exitCode; save and
// restore it around every test so failures never leak into sibling tests.
let savedExitCode: number | string | null | undefined;
beforeEach(() => {
  savedExitCode = process.exitCode;
});
afterEach(() => {
  process.exitCode = savedExitCode;
  vi.restoreAllMocks();
});

// A ChildProcess-shaped EventEmitter whose events fire on the next microtask,
// after runClaudeSession has synchronously attached its own listeners.
const fakeChild = (emit: (c: ChildProcess) => void): ChildProcess => {
  const c = new EventEmitter() as unknown as ChildProcess;
  queueMicrotask(() => emit(c));
  return c;
};
const exited = (code: number | null): ChildProcess => fakeChild((c) => c.emit("exit", code, null));

const spyStdout = (): { chunks: string[] } => {
  const chunks: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  }) as never);
  return { chunks };
};

// An empty sessions root: no munged cwd dir exists under it, so the post-exit
// scan deterministically finds nothing. Injected wherever a hint is expected so
// tests never depend on the real ~/.claude/projects state.
const noSessions = (): string => mkdtempSync(join(tmpdir(), "ccws-empty-"));

const sessionsRootFor = (): string => mkdtempSync(join(tmpdir(), "ccws-sessions-"));

// Writes <id>.jsonl into the munged-cwd dir under root, with a pinned mtime.
const seedSession = (root: string, cwd: string, id: string, mtime: Date): string => {
  const dir = join(root, mungeProjectDir(cwd));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${id}.jsonl`);
  writeFileSync(file, "{}\n");
  utimesSync(file, mtime, mtime);
  return file;
};

describe("mungeProjectDir", () => {
  it("maps a cwd onto claude's project-dir naming (non-alphanumerics → '-')", () => {
    expect(mungeProjectDir("/Users/eddie/.ccws/ccws-dev")).toBe("-Users-eddie--ccws-ccws-dev");
    expect(mungeProjectDir("/Users/eddie/github-projects/ccws")).toBe("-Users-eddie-github-projects-ccws");
  });
});

describe("findRecentSessionId", () => {
  const now = Date.now();

  it("returns undefined when the munged project dir does not exist", () => {
    expect(findRecentSessionId(sessionsRootFor(), "/nope/ws", now)).toBeUndefined();
  });

  it("ignores jsonl files older than the since mark", () => {
    const root = sessionsRootFor();
    seedSession(root, "/w", "old-id", new Date(now - 60_000));
    expect(findRecentSessionId(root, "/w", now)).toBeUndefined();
  });

  it("picks the newest jsonl at or after the since mark", () => {
    const root = sessionsRootFor();
    seedSession(root, "/w", "older-id", new Date(now));
    seedSession(root, "/w", "newest-id", new Date(now + 5_000));
    expect(findRecentSessionId(root, "/w", now)).toBe("newest-id");
  });

  it("ignores non-jsonl entries", () => {
    const root = sessionsRootFor();
    seedSession(root, "/w", "an-id", new Date(now + 5_000));
    writeFileSync(join(root, mungeProjectDir("/w"), "notes.txt"), "x");
    expect(findRecentSessionId(root, "/w", now)).toBe("an-id");
  });
});

describe("runClaudeSession", () => {
  it("runs claude with the given args and cwd via the injected runner", async () => {
    const calls: Array<{ cmd: string; args: string[]; opts: { cwd: string; stdio: string } }> = [];
    const runner: Runner = (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return exited(0);
    };
    await runClaudeSession({ cwd: "/tmp/ws", args: ["--resume", "abc"], runner, exitHint: () => "hi" });
    expect(calls).toEqual([
      { cmd: "claude", args: ["--resume", "abc"], opts: { cwd: "/tmp/ws", stdio: "inherit" } },
    ]);
  });

  it("resolves immediately when the runner returns void (test-stub contract)", async () => {
    const runner: Runner = () => {};
    await expect(runClaudeSession({ cwd: "/x", runner })).resolves.toBeUndefined();
  });

  it("does not resolve until the child exits", async () => {
    const c = new EventEmitter() as unknown as ChildProcess;
    let settled = false;
    const p = runClaudeSession({ cwd: "/x", runner: () => c });
    void p.then(() => {
      settled = true;
    });
    await new Promise<void>((r) => queueMicrotask(() => r()));
    expect(settled).toBe(false);
    c.emit("exit", 0, null);
    await p;
    expect(settled).toBe(true);
  });

  it("erases claude's exit hint lines, then prints the ccws hint, on a clean exit", async () => {
    const { chunks } = spyStdout();
    await runClaudeSession({
      cwd: "/x",
      runner: () => exited(0),
      exitHint: () => "resume this session: x",
      isTTY: true,
      sessionsRoot: noSessions(),
    });
    const erase = `\x1b[${CLAUDE_EXIT_HINT_LINES}A\r\x1b[J`;
    expect(chunks).toContain(erase);
    expect(chunks).toContain("• resume this session: x\n");
    expect(chunks.indexOf(erase)).toBeLessThan(chunks.indexOf("• resume this session: x\n"));
  });

  it("appends the session id found on disk to the exit hint", async () => {
    const { chunks } = spyStdout();
    const sessionsRoot = sessionsRootFor();
    const cwd = "/tmp/ws";
    // runClaudeSession stamps its own since-mark just before spawn, so seed the
    // jsonl with a future mtime to guarantee it counts as "this run".
    seedSession(sessionsRoot, cwd, "sess-1234", new Date(Date.now() + 60_000));
    await runClaudeSession({
      cwd,
      runner: () => exited(0),
      exitHint: (id) => `resume this session: ws${id ? ` ${id}` : ""}`,
      isTTY: true,
      sessionsRoot,
    });
    const erase = `\x1b[${CLAUDE_EXIT_HINT_LINES}A\r\x1b[J`;
    expect(chunks).toContain("• resume this session: ws sess-1234\n");
    expect(chunks.indexOf(erase)).toBeLessThan(chunks.indexOf("• resume this session: ws sess-1234\n"));
  });

  it("falls back to an id-less hint when no session file matches this run", async () => {
    const { chunks } = spyStdout();
    const sessionsRoot = sessionsRootFor();
    seedSession(sessionsRoot, "/tmp/ws", "stale-id", new Date(Date.now() - 120_000));
    await runClaudeSession({
      cwd: "/tmp/ws",
      runner: () => exited(0),
      exitHint: (id) => `resume this session: ws${id ? ` ${id}` : ""}`,
      sessionsRoot,
    });
    expect(chunks).toContain("• resume this session: ws\n");
    expect(chunks.join("")).not.toContain("stale-id");
  });

  it("recovers a jsonl seeded while claude ran (real mtime, pins the since-mark before spawn)", async () => {
    const { chunks } = spyStdout();
    const sessionsRoot = sessionsRootFor();
    const cwd = "/tmp/ws";
    seedSession(sessionsRoot, cwd, "pre-run-id", new Date(Date.now() - 60_000));
    const runner: Runner = () => {
      // Seeded after the since-mark (taken just before spawn): a real
      // wall-clock mtime passes the >= filter. Pinned 5s into the future —
      // seeding "now" lands in the same millisecond as the mark, and the
      // utimesSync → statSync round-trip on APFS reads back ~1ns low
      // (902 → 901.999), flakily failing the >= by a nanosecond. Real
      // session files differ from the spawn mark by a session's duration,
      // never by microseconds.
      seedSession(sessionsRoot, cwd, "live-id", new Date(Date.now() + 5_000));
      return exited(0);
    };
    await runClaudeSession({
      cwd,
      runner,
      exitHint: (id) => `resume this session: ws${id ? ` ${id}` : ""}`,
      sessionsRoot,
    });
    expect(chunks).toContain("• resume this session: ws live-id\n");
  });

  it("prints the hint but no ANSI escape when stdout is not a TTY", async () => {
    const { chunks } = spyStdout();
    await runClaudeSession({
      cwd: "/x",
      runner: () => exited(0),
      exitHint: () => "resume this session: x",
      isTTY: false,
      sessionsRoot: noSessions(),
    });
    expect(chunks).toContain("• resume this session: x\n");
    expect(chunks.some((c) => c.includes("\x1b"))).toBe(false);
  });

  it("prints nothing on a clean exit without an exitHint", async () => {
    const { chunks } = spyStdout();
    await runClaudeSession({ cwd: "/x", runner: () => exited(0) });
    expect(chunks).toEqual([]);
    expect(process.exitCode).toBe(savedExitCode);
  });

  it("propagates a non-zero exit code without printing a hint", async () => {
    const { chunks } = spyStdout();
    await runClaudeSession({
      cwd: "/x",
      runner: () => exited(3),
      exitHint: () => "resume this session: x",
      sessionsRoot: noSessions(),
    });
    expect(chunks).toEqual([]);
    expect(process.exitCode).toBe(3);
  });

  it("maps a signal death (null code) to exit code 1 without a hint", async () => {
    const { chunks } = spyStdout();
    await runClaudeSession({
      cwd: "/x",
      runner: () => exited(null),
      exitHint: () => "resume this session: x",
      sessionsRoot: noSessions(),
    });
    expect(chunks).toEqual([]);
    expect(process.exitCode).toBe(1);
  });

  it("resolves when the child errors out without exiting (no hang)", async () => {
    const { chunks } = spyStdout();
    await runClaudeSession({
      cwd: "/x",
      runner: () => fakeChild((c) => c.emit("error", new Error("EPERM"))),
      exitHint: () => "resume this session: x",
      sessionsRoot: noSessions(),
    });
    expect(chunks).toEqual([]);
    expect(process.exitCode).toBe(1);
  });

  it("ignores SIGINT while waiting and restores the listener afterwards", async () => {
    const baseline = process.listenerCount("SIGINT");
    const c = new EventEmitter() as unknown as ChildProcess;
    const p = runClaudeSession({ cwd: "/x", runner: () => c });
    expect(process.listenerCount("SIGINT")).toBe(baseline + 1);
    c.emit("exit", 0, null);
    await p;
    expect(process.listenerCount("SIGINT")).toBe(baseline);
  });

  it("forwards SIGHUP/SIGTERM to the child when opted in, and detaches afterwards", async () => {
    const before = { hup: process.listenerCount("SIGHUP"), term: process.listenerCount("SIGTERM") };
    const killed: string[] = [];
    const c = new EventEmitter() as unknown as ChildProcess;
    c.kill = ((signal: string) => {
      killed.push(signal);
      return true;
    }) as ChildProcess["kill"];
    const p = runClaudeSession({ cwd: "/x", runner: () => c, forwardSignals: true });
    expect(process.listenerCount("SIGHUP")).toBe(before.hup + 1);
    expect(process.listenerCount("SIGTERM")).toBe(before.term + 1);
    process.emit("SIGHUP", "SIGHUP"); // terminal closed
    process.emit("SIGTERM", "SIGTERM"); // direct `kill <pid>`
    expect(killed).toEqual(["SIGHUP", "SIGTERM"]);
    c.emit("exit", null, "SIGHUP"); // the forwarded signal kills claude
    await p;
    expect(process.listenerCount("SIGHUP")).toBe(before.hup);
    expect(process.listenerCount("SIGTERM")).toBe(before.term);
    process.emit("SIGHUP", "SIGHUP"); // detached: no further forwarding
    expect(killed).toEqual(["SIGHUP", "SIGTERM"]);
    expect(process.exitCode).toBe(1);
  });

  it("keeps SIGHUP/SIGTERM at their default disposition without forwardSignals", async () => {
    const before = { hup: process.listenerCount("SIGHUP"), term: process.listenerCount("SIGTERM") };
    const killed: string[] = [];
    const c = new EventEmitter() as unknown as ChildProcess;
    c.kill = ((signal: string) => {
      killed.push(signal);
      return true;
    }) as ChildProcess["kill"];
    const p = runClaudeSession({ cwd: "/x", runner: () => c });
    expect(process.listenerCount("SIGHUP")).toBe(before.hup);
    expect(process.listenerCount("SIGTERM")).toBe(before.term);
    process.emit("SIGHUP", "SIGHUP");
    process.emit("SIGTERM", "SIGTERM");
    c.emit("exit", 0, null);
    await p;
    expect(killed).toEqual([]);
  });

  it("converts a synchronous spawn failure into a friendly error", async () => {
    const runner: Runner = () => {
      throw new Error("spawn ENOENT");
    };
    await expect(runClaudeSession({ cwd: "/x", runner })).rejects.toThrow(/not found in PATH/);
  });
});
