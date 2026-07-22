import { resolveRoot, detectWorkspaceFromCwd, settingsPath, workspacePath } from "../core/config.js";
import { readSettings } from "../core/settings.js";
import { existsSync } from "node:fs";
import { info, warn } from "../utils/log.js";

export interface StatusOptions { root?: string; cwd?: string }

export async function statusAction(opts: StatusOptions): Promise<void> {
  const root = resolveRoot(opts.root);
  const name = detectWorkspaceFromCwd(root, opts.cwd);
  if (!name) {
    warn("not inside any workspace — cd into a workspace or use `ccws list`");
    return;
  }
  const dirs = readSettings(settingsPath(root, name)).permissions?.additionalDirectories ?? [];
  info(`workspace: ${name}  (${workspacePath(root, name)})`);
  for (const d of dirs) {
    process.stdout.write(existsSync(d) ? `  ✓  ${d}\n` : `  ✗  ${d}  (missing)\n`);
  }
}
