import { rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveRoot } from "../core/config.js";
import { createScratchWorkspace, markCwdTrusted, removeCwdEntry } from "../core/scratch.js";
import { resolveLaunchTarget, launchModeArgs, type Runner } from "./open.js";
import { runClaudeSession } from "../utils/claude-session.js";
import { success } from "../utils/log.js";

export type { Runner };

export interface ScratchOptions {
  root?: string;
  runner?: Runner;
  /** Test seam only; defaults to ~/.claude/projects. */
  sessionsRoot?: string;
  /** Test seam only; defaults to ~/.claude.json. */
  claudeJsonPath?: string;
}

/**
 * The use-and-discard session launcher: create a blank scratch workspace,
 * start claude in it (bypassPermissions default), and DELETE the workspace
 * once claude exits — truly thrown away, nothing survives the session. The
 * finally also covers launch failures (claude missing from PATH), so a failed
 * start leaves no skeleton behind. Transcripts under ~/.claude/projects are
 * claude's own and stay untouched.
 */
export async function scratchAction(opts: ScratchOptions): Promise<void> {
  const root = resolveRoot(opts.root);
  const claudeJsonPath = opts.claudeJsonPath ?? join(homedir(), ".claude.json");
  const { name, path } = createScratchWorkspace(root);
  success(`created scratch workspace "${name}" at ${path} — discarded when claude exits`);
  // Pre-trust the fresh cwd in claude's memory so its "Quick safety check"
  // folder-trust dialog does not fire for a directory ccws itself just
  // created. Best-effort: on failure claude simply asks once, as before.
  markCwdTrusted(claudeJsonPath, path);
  const { entry, cwd } = resolveLaunchTarget(root, name);
  try {
    await runClaudeSession({
      cwd,
      args: launchModeArgs(root, name, entry),
      runner: opts.runner,
      // Replace claude's own "Resume this session with:" hint (resume is dead
      // once the workspace is gone) with the discard notice.
      exitHint: () => `scratch session ended — workspace "${name}" discarded`,
      sessionsRoot: opts.sessionsRoot,
    });
  } finally {
    rmSync(path, { recursive: true, force: true });
    removeCwdEntry(claudeJsonPath, path);
  }
}
