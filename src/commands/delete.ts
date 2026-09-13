import { rmSync, unlinkSync } from "node:fs";
import { sep } from "node:path";
import { resolveRoot, resolveEntry, workspacePath } from "../core/config.js";
import { removeModeSidecar } from "../core/mode.js";
import { validateWorkspaceName } from "../core/workspace.js";
import { success, info, warn } from "../utils/log.js";

export interface DeleteOptions {
  root?: string;
  force?: boolean;
  /** @internal test hook — overrides the interactive confirm prompt. */
  confirmFn?: (message: string) => Promise<boolean>;
}

/**
 * Delete a workspace directory recursively, or unregister a project by
 * removing its $ROOT symlink. Workspace deletion is destructive and
 * irreversible, so by default it asks for confirmation via `@clack/prompts`;
 * `--force` skips the prompt for scripting. Unregistering a project never
 * touches the target directory, so it needs no confirmation. A declined
 * confirmation aborts without deleting.
 */
export async function deleteAction(name: string, opts: DeleteOptions): Promise<void> {
  validateWorkspaceName(name);
  const root = resolveRoot(opts.root);

  const entry = resolveEntry(root, name);
  if (entry.kind === "missing") {
    throw new Error(`"${name}" does not exist — nothing to delete`);
  }
  if (entry.kind === "project" || entry.kind === "dangling") {
    // Only the symlink is removed: the project directory is the user's own
    // and is physically unreachable from unlinkSync on the link. The mode
    // sidecar under $ROOT is ccws's own, so it goes with the registration —
    // removed first so any failure (locked $ROOT, .ccws as a plain file)
    // leaves the registration intact and the whole delete retryable.
    removeModeSidecar(root, name);
    unlinkSync(workspacePath(root, name));
    const verb = entry.kind === "project" ? "unregistered project" : "removed dangling entry";
    success(`${verb} "${name}" — target at ${entry.target} left untouched`);
    return;
  }

  const path = workspacePath(root, name);

  // Deleting the folder your shell is standing in leaves a stale cwd — warn.
  const cwd = process.cwd();
  if (cwd === path || cwd.startsWith(path + sep)) {
    warn(`you are currently inside workspace "${name}" — it will be deleted under your cwd`);
  }

  if (!opts.force) {
    const confirm = opts.confirmFn ??
      (async (message: string) => {
        const { confirm: clackConfirm, isCancel } = await import("@clack/prompts");
        const v = await clackConfirm({ message });
        return !isCancel(v) && v === true;
      });
    const ok = await confirm(`Delete workspace "${name}" at ${path}? This cannot be undone.`);
    if (!ok) {
      info("aborted — nothing deleted");
      return;
    }
  }

  rmSync(path, { recursive: true, force: true });
  success(`deleted workspace "${name}" at ${path}`);
}
