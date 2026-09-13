import { resolveRoot, resolveEntry, workspacePath } from "../core/config.js";
import { runClaudeSession, resumeHint, type Runner } from "../utils/claude-session.js";

export type { Runner };

export interface OpenOptions { root?: string; runner?: Runner; sessionsRoot?: string }

/**
 * Resolve the directory claude should run in for `$ROOT/<name>`: the workspace
 * itself for workspaces, the symlink target (already a realpath) for projects.
 * Shared by open and resume so both stay consistent. Throws with next-step
 * guidance for unknown names and dangling projects.
 */
export function launchCwd(root: string, name: string): string {
  const entry = resolveEntry(root, name);
  if (entry.kind === "missing") {
    throw new Error(
      `"${name}" does not exist — run \`ccws init ${name}\` for a new workspace, or \`ccws init <path>\` to register a project`,
    );
  }
  if (entry.kind === "dangling") {
    throw new Error(
      `project "${name}" points to a missing directory: ${entry.target} — run \`ccws delete ${name}\` to clean up`,
    );
  }
  return entry.kind === "project" ? entry.target : workspacePath(root, name);
}

export async function openAction(name: string, opts: OpenOptions): Promise<void> {
  const root = resolveRoot(opts.root);
  const cwd = launchCwd(root, name);
  await runClaudeSession({
    cwd,
    runner: opts.runner,
    exitHint: (id) => resumeHint(name, id),
    sessionsRoot: opts.sessionsRoot,
  });
}
