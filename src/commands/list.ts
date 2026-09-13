import {
  resolveRoot,
  discoverWorkspaces,
  discoverProjects,
  resolveEntry,
  settingsPath,
  workspacePath,
} from "../core/config.js";
import type { Project } from "../types.js";
import { readSettings, BYPASS_MODE } from "../core/settings.js";
import { existsSync } from "node:fs";
import { info } from "../utils/log.js";

export interface ListOptions { root?: string; long?: boolean }

const bypassLabel = (bypass: boolean): string => bypass ? "bypass: ON" : "bypass: off";

// Type label is part of the contract the user asked for: mixed listings must
// always make clear which entries are workspaces and which are projects.
const projectRow = (p: Project): string => {
  const flag = p.targetExists ? "" : "  (target missing)";
  const target = p.target || "?";
  return `${p.name.padEnd(20)} → ${target}${flag}`;
};

export async function listAction(args: string[], opts: ListOptions): Promise<void> {
  const root = resolveRoot(opts.root);
  const long = opts.long ?? false;
  if (args.length > 0) {
    const name = args[0];
    const entry = resolveEntry(root, name);
    if (entry.kind === "missing") {
      throw new Error(`"${name}" does not exist — nothing registered under this name`);
    }
    if (entry.kind === "project" || entry.kind === "dangling") {
      const flag = entry.kind === "dangling" ? "  (target missing)" : "";
      info(`project: ${name}  →  ${entry.target}${flag}`);
      info(`this entry is a project — ccws never writes into ${entry.target}`);
      return;
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
  const projects = discoverProjects(root);
  if (ws.length === 0 && projects.length === 0) {
    info("no workspaces or projects found");
    return;
  }
  if (ws.length > 0) {
    info("workspaces:");
    for (const w of ws) {
      const flag = w.missing > 0 ? ` (${w.missing} missing)` : "";
      const row = `${w.name.padEnd(20)} ${w.dirs.length} dir(s)${flag}`;
      process.stdout.write(long ? `${row}  ${bypassLabel(w.bypass)}  ${w.path}\n` : `${row}\n`);
    }
  }
  if (projects.length > 0) {
    info("projects:");
    for (const p of projects) {
      process.stdout.write(`${projectRow(p)}\n`);
    }
  }
}
