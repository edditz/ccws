import { rmSync } from "node:fs";
import { sep } from "node:path";
import { resolveRoot, workspacePath } from "../core/config.js";
import { workspaceExists, validateWorkspaceName } from "../core/workspace.js";
import { success, info, warn } from "../utils/log.js";

export interface DeleteOptions {
  root?: string;
  force?: boolean;
  /** @internal test hook — overrides the interactive confirm prompt. */
  confirmFn?: (message: string) => Promise<boolean>;
}

/**
 * Recursively delete a workspace directory. Destructive and irreversible, so
 * by default it asks for confirmation via `@clack/prompts`; `--force` skips
 * the prompt for scripting. A declined confirmation aborts without deleting.
 */
export async function deleteAction(name: string, opts: DeleteOptions): Promise<void> {
  validateWorkspaceName(name);
  const root = resolveRoot(opts.root);

  if (!workspaceExists(root, name)) {
    throw new Error(`workspace "${name}" does not exist — nothing to delete`);
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
