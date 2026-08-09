import { resolveRoot, discoverWorkspaces, settingsPath, workspacePath } from "../core/config.js";
import { readSettings, BYPASS_MODE } from "../core/settings.js";
import { existsSync } from "node:fs";
import { workspaceExists } from "../core/workspace.js";
import { info } from "../utils/log.js";

export interface ListOptions { root?: string; long?: boolean }

const bypassLabel = (bypass: boolean): string => bypass ? "bypass: ON" : "bypass: off";

export async function listAction(args: string[], opts: ListOptions): Promise<void> {
  const root = resolveRoot(opts.root);
  const long = opts.long ?? false;
  if (args.length > 0) {
    const name = args[0];
    if (!workspaceExists(root, name)) {
      throw new Error(`workspace "${name}" does not exist`);
    }
    const settings = readSettings(settingsPath(root, name));
    const dirs = settings.permissions?.additionalDirectories ?? [];
    const header = `workspace: ${name}  (${workspacePath(root, name)})`;
    const detail = long ? `  ${bypassLabel(settings.permissions?.defaultMode === BYPASS_MODE)}` : "";
    info(`${header}${detail}`);
    for (const d of dirs) {
      process.stdout.write(existsSync(d) ? `  ✓  ${d}\n` : `  ✗  ${d}  (missing)\n`);
    }
    return;
  }
  const ws = discoverWorkspaces(root);
  if (ws.length === 0) { info("no workspaces found"); return; }
  for (const w of ws) {
    const flag = w.missing > 0 ? ` (${w.missing} missing)` : "";
    const row = `${w.name.padEnd(20)} ${w.dirs.length} dir(s)${flag}`;
    process.stdout.write(long ? `${row}  ${bypassLabel(w.bypass)}  ${w.path}\n` : `${row}\n`);
  }
}
