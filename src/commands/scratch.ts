import { rmSync } from "node:fs";
import { resolveRoot } from "../core/config.js";
import { createScratchWorkspace } from "../core/scratch.js";
import { resolveLaunchTarget, launchModeArgs, type Runner } from "./open.js";
import { runClaudeSession } from "../utils/claude-session.js";
import { success } from "../utils/log.js";

export type { Runner };

export interface ScratchOptions {
  root?: string;
  runner?: Runner;
  /** Test seam only; defaults to ~/.claude/projects. */
  sessionsRoot?: string;
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
  const { name, path } = createScratchWorkspace(root);
  success(`created scratch workspace "${name}" at ${path} — discarded when claude exits`);
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
  }
}
