import { resolveRoot, resolveEntry, workspacePath } from "../core/config.js";
import { resolveStoredMode } from "../core/mode.js";
import type { NamedEntry } from "../types.js";
import { runClaudeSession, resumeHint, type Runner } from "../utils/claude-session.js";
import { warn } from "../utils/log.js";

export type { Runner };

export interface OpenOptions { root?: string; runner?: Runner; sessionsRoot?: string }

/**
 * Resolve what `ccws open/resume <name>` should launch into: the entry itself
 * plus the directory claude should run in — the workspace for workspaces, the
 * symlink target (already a realpath) for projects. Shared by open and resume
 * so both stay consistent. Throws with next-step guidance for unknown names
 * and dangling projects.
 */
export function resolveLaunchTarget(root: string, name: string): { entry: NamedEntry; cwd: string } {
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
  return { entry, cwd: entry.kind === "project" ? entry.target : workspacePath(root, name) };
}

/**
 * Best-effort mode read for launch: report commands stay strict about corrupt
 * settings, but a launch must not be blocked by incidental metadata — degrade
 * to launching without the flag (which only ever means MORE permission
 * prompting, never less) and warn on stderr.
 */
export function launchModeArgs(root: string, name: string, entry: NamedEntry): string[] {
  try {
    const mode = resolveStoredMode(root, entry);
    return mode ? ["--permission-mode", mode] : [];
  } catch {
    warn(`could not read the permission mode for "${name}" — launching claude without --permission-mode`);
    return [];
  }
}

export async function openAction(name: string, opts: OpenOptions): Promise<void> {
  const root = resolveRoot(opts.root);
  const { entry, cwd } = resolveLaunchTarget(root, name);
  await runClaudeSession({
    cwd,
    args: launchModeArgs(root, name, entry),
    runner: opts.runner,
    exitHint: (id) => resumeHint(name, id),
    sessionsRoot: opts.sessionsRoot,
  });
}
