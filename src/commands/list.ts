import { resolveRoot, discoverWorkspaces, settingsPath, workspacePath } from "../core/config.js";
import { readSettings } from "../core/settings.js";
import { existsSync } from "node:fs";
import { workspaceExists } from "../core/workspace.js";
import { info } from "../utils/log.js";

export interface ListOptions { root?: string }

export async function listAction(args: string[], opts: ListOptions): Promise<void> {
  const root = resolveRoot(opts.root);
  if (args.length > 0) {
    const name = args[0];
    if (!workspaceExists(root, name)) {
      throw new Error(`workspace "${name}" does not exist`);
    }
    const dirs = readSettings(settingsPath(root, name)).permissions?.additionalDirectories ?? [];
    info(`workspace: ${name}  (${workspacePath(root, name)})`);
    for (const d of dirs) {
      process.stdout.write(existsSync(d) ? `  ✓  ${d}\n` : `  ✗  ${d}  (missing)\n`);
    }
    return;
  }
  const ws = discoverWorkspaces(root);
  if (ws.length === 0) { info("no workspaces found"); return; }
  for (const w of ws) {
    const flag = w.missing > 0 ? ` (${w.missing} missing)` : "";
    process.stdout.write(`${w.name.padEnd(20)} ${w.dirs.length} dir(s)${flag}\n`);
  }
}
