import {
  resolveRoot,
  discoverWorkspaces,
  discoverProjects,
  resolveEntry,
  settingsPath,
  workspacePath,
} from "../core/config.js";
import type { Project } from "../types.js";
import { readSettings } from "../core/settings.js";
import { resolveStoredMode } from "../core/mode.js";
import { existsSync } from "node:fs";
import { info } from "../utils/log.js";

export interface ListOptions { root?: string; long?: boolean }

const modeLabel = (mode: string | undefined): string => `mode: ${mode ?? "default"}`;

// Type label is part of the contract the user asked for: mixed listings must
// always make clear which entries are workspaces and which are projects.
// Project rows are target-path oriented, so a mode is shown only when set.
const projectRow = (p: Project, mode?: string): string => {
  const flag = p.targetExists ? "" : "  (target missing)";
  const target = p.target || "?";
  const modeTag = mode ? `  mode: ${mode}` : "";
  return `${p.name.padEnd(20)} → ${target}${flag}${modeTag}`;
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
      const mode = resolveStoredMode(root, entry);
      const flag = entry.kind === "dangling" ? "  (target missing)" : "";
      const modeTag = mode ? `  mode: ${mode}` : "";
      info(`project: ${name}  →  ${entry.target}${flag}${modeTag}`);
      info(`this entry is a project — ccws never writes into ${entry.target}`);
      return;
    }
    const settings = readSettings(settingsPath(root, name));
    const dirs = settings.permissions?.additionalDirectories ?? [];
    const header = `workspace: ${name}  (${workspacePath(root, name)})`;
    const detail = long ? `  ${modeLabel(settings.permissions?.defaultMode)}` : "";
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
      process.stdout.write(long ? `${row}  ${modeLabel(w.mode)}  ${w.path}\n` : `${row}\n`);
    }
  }
  if (projects.length > 0) {
    info("projects:");
    for (const p of projects) {
      // resolveStoredMode on a project only reads the $ROOT sidecar; it never
      // throws, so no lenient wrapper is needed here.
      const mode = resolveStoredMode(root, { kind: "project", name: p.name, target: p.target });
      process.stdout.write(`${projectRow(p, mode)}\n`);
    }
  }
}
