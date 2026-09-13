import { spawn, type ChildProcess } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as log from "./log.js";

// Injected runners may return void (tests) or a ChildProcess (production defaultRunner)
// so the default runner can attach an async "error" listener for spawn failures that
// try/catch cannot reach (ENOENT after spawn is synchronous, but EPERM/EACCES/crash
// arrive as an asynchronous "error" event).
export type Runner = (
  cmd: string,
  args: string[],
  opts: { cwd: string; stdio: "inherit" },
) => ChildProcess | void;

export const defaultRunner: Runner = (cmd, args, opts) => {
  const child = spawn(cmd, args, opts);
  child.on("error", () => {
    log.error("`claude` failed to start — not found in PATH or crashed; install Claude Code first");
    process.exit(1);
  });
  return child;
};

// Trailing lines claude 2.1.x prints on interactive exit ("Resume this session with:
// claude --resume <id>"). There is no official switch to silence it, so on a clean
// exit we erase the block with a cursor-up + erase-to-end sequence. Over-erasing only
// trims the bottom of claude's final TUI frame (scrollback intact); under-erasing
// leaves stale hint lines. Re-verify against the installed claude when upgrading.
export const CLAUDE_EXIT_HINT_LINES = 3;

// claude stores one <session-id>.jsonl per session under ~/.claude/projects/,
// in a dir named after the munged cwd: every non-alphanumeric char becomes "-"
// (/Users/eddie/.ccws/dev → -Users-eddie--ccws-dev). Re-verify against the
// installed claude when upgrading — same contract class as CLAUDE_EXIT_HINT_LINES.
export const mungeProjectDir = (cwd: string): string => cwd.replace(/[^A-Za-z0-9]/g, "-");

// Best-effort recovery of the session claude just ran: the newest jsonl under
// the munged cwd whose mtime is at or after the spawn mark (resuming an old
// session updates the original file, a new session creates one). Returns
// undefined whenever nothing matches — callers fall back to an id-less hint.
export const findRecentSessionId = (
  sessionsRoot: string,
  cwd: string,
  sinceMs: number,
): string | undefined => {
  const dir = join(sessionsRoot, mungeProjectDir(cwd));
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return undefined; // no sessions for this cwd (or unreadable root)
  }
  const candidates = entries
    .filter((name) => name.endsWith(".jsonl"))
    .flatMap((name) => {
      try {
        return [{ name, mtimeMs: statSync(join(dir, name)).mtimeMs }];
      } catch {
        return []; // raced deletion: skip, not fail
      }
    })
    .filter((f) => f.mtimeMs >= sinceMs)
    // Name tie-break keeps the pick deterministic when mtimes collide.
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name));
  return candidates[0]?.name.replace(/\.jsonl$/, "");
};

// The clean-exit hint both commands print; the id (when recovered) is copy-
// pastable as-is: `ccws resume <name> <id>`.
export const resumeHint = (name: string, sessionId: string | undefined): string =>
  `resume this session: ccws resume ${name}${sessionId ? ` ${sessionId}` : ""}`;

export interface RunClaudeSessionOptions {
  cwd: string;
  args?: readonly string[];
  runner?: Runner;
  /**
   * Presence enables clean-exit suppression: erase claude's exit hint lines,
   * then print this. Receives the session id recovered from disk (undefined
   * when none matches this run).
   */
  exitHint?: (sessionId: string | undefined) => string;
  /** Test seam only; defaults to `process.stdout.isTTY === true`. */
  isTTY?: boolean;
  /** Test seam only; defaults to ~/.claude/projects. */
  sessionsRoot?: string;
}

// Resolves with the child's exit code, or null when it dies by signal or errors out
// without exiting. Listening on "error" too is defensive: a custom runner whose child
// only emits "error" must not hang the wait. The production defaultRunner exits the
// process on "error" itself, so this path only matters for injected runners.
const waitForExit = (child: ChildProcess): Promise<number | null> =>
  new Promise((resolve) => {
    let settled = false;
    const finish = (code: number | null): void => {
      if (settled) return;
      settled = true;
      resolve(code);
    };
    child.once("exit", (code) => finish(code));
    child.once("error", () => finish(null));
  });

// While claude is foreground, Ctrl+C belongs to it: parent and child share the
// foreground process group, and ccws must survive until claude exits to print
// its exit hint. The no-op handler absorbs SIGINT; it is removed right after.
const ignoreSigintWhile = async <T>(run: () => Promise<T>): Promise<T> => {
  const handler = (): void => {};
  process.on("SIGINT", handler);
  try {
    return await run();
  } finally {
    process.removeListener("SIGINT", handler);
  }
};

export async function runClaudeSession(opts: RunClaudeSessionOptions): Promise<void> {
  const {
    cwd,
    args = [],
    runner = defaultRunner,
    exitHint,
    isTTY = process.stdout.isTTY === true,
    sessionsRoot = join(homedir(), ".claude", "projects"),
  } = opts;
  const startedAt = Date.now(); // mtime floor: only sessions claude touched during this run count
  let child: ChildProcess | void;
  try {
    child = runner("claude", [...args], { cwd, stdio: "inherit" });
  } catch {
    throw new Error("`claude` not found in PATH — install Claude Code first");
  }
  if (!child) return; // void-returning runner (test stubs): nothing to wait for
  const code = await ignoreSigintWhile(() => waitForExit(child));
  if (code !== 0) {
    // Non-zero exit (or signal/error death): claude's own output — e.g. its
    // "No conversation found with session ID" error — must stay visible.
    process.exitCode = code ?? 1;
    return;
  }
  if (exitHint === undefined) return;
  if (isTTY) {
    // Move up over claude's exit-hint block, return to column 0, erase to screen end.
    process.stdout.write(`\x1b[${CLAUDE_EXIT_HINT_LINES}A\r\x1b[J`);
  }
  log.info(exitHint(findRecentSessionId(sessionsRoot, cwd, startedAt)));
}
