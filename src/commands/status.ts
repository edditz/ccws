import { resolveRoot, detectWorkspaceFromCwd, settingsPath, workspacePath } from "../core/config.js";
import { readSettings } from "../core/settings.js";
import { workspaceExists } from "../core/workspace.js";
import { existsSync } from "node:fs";
import { info, warn } from "../utils/log.js";

export interface StatusOptions { root?: string; cwd?: string }

export async function statusAction(opts: StatusOptions): Promise<void> {
  const root = resolveRoot(opts.root);
  const name = detectWorkspaceFromCwd(root, opts.cwd);
  // detectWorkspaceFromCwd returns the first path segment under root, but does
  // NOT verify that segment is actually a workspace. A user who `cd`s into a
  // plain subfolder of $ROOT would otherwise hit a misleading
  // "settings.json not found — run ccws init" error. Treat a non-workspace
  // subdir the same as "not inside any workspace": warn and return.
  if (!name || !workspaceExists(root, name)) {
    warn("not inside any workspace — cd into a workspace or use `ccws list`");
    return;
  }
  const dirs = readSettings(settingsPath(root, name)).permissions?.additionalDirectories ?? [];
  info(`workspace: ${name}  (${workspacePath(root, name)})`);
  for (const d of dirs) {
    process.stdout.write(existsSync(d) ? `  ✓  ${d}\n` : `  ✗  ${d}  (missing)\n`);
  }
}
