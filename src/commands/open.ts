import { resolveRoot, workspacePath } from "../core/config.js";
import { workspaceExists } from "../core/workspace.js";
import { runClaudeSession, resumeHint, type Runner } from "../utils/claude-session.js";

export type { Runner };

export interface OpenOptions { root?: string; runner?: Runner; sessionsRoot?: string }

export async function openAction(name: string, opts: OpenOptions): Promise<void> {
  const root = resolveRoot(opts.root);
  if (!workspaceExists(root, name)) {
    throw new Error(`workspace "${name}" does not exist — run \`ccws init ${name}\` first`);
  }
  await runClaudeSession({
    cwd: workspacePath(root, name),
    runner: opts.runner,
    exitHint: (id) => resumeHint(name, id),
    sessionsRoot: opts.sessionsRoot,
  });
}
