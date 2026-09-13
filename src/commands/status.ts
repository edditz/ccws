import {
  resolveRoot,
  detectWorkspaceFromCwd,
  detectProjectFromCwd,
  resolveEntry,
  settingsPath,
  workspacePath,
} from "../core/config.js";
import type { Entry } from "../types.js";
import { readSettings, parseScratchMeta } from "../core/settings.js";
import { resolveStoredMode } from "../core/mode.js";
import { existsSync } from "node:fs";
import { info, warn } from "../utils/log.js";

export interface StatusOptions { root?: string; cwd?: string }

const printProject = (root: string, entry: Extract<Entry, { kind: "project" | "dangling" }>): void => {
  if (entry.kind === "dangling") {
    warn(`project: ${entry.name}  (target missing: ${entry.target})`);
    warn(`run \`ccws delete ${entry.name}\` to clean up the registration`);
    return;
  }
  info(`project: ${entry.name}  (${entry.target})`);
  info(`mode: ${resolveStoredMode(root, entry) ?? "default"}`);
  info(`open it with: ccws open ${entry.name}`);
};

export async function statusAction(opts: StatusOptions): Promise<void> {
  const root = resolveRoot(opts.root);
  const name = detectWorkspaceFromCwd(root, opts.cwd);
  if (!name) {
    // Not under $ROOT lexically — but cwd may sit inside a registered
    // project's target directory, anywhere on disk.
    const proj = detectProjectFromCwd(root, opts.cwd);
    if (proj) {
      printProject(root, { kind: "project", name: proj.name, target: proj.target });
      return;
    }
    warn("not inside any workspace — cd into a workspace or use `ccws list`");
    return;
  }
  const entry = resolveEntry(root, name);
  if (entry.kind === "project" || entry.kind === "dangling") {
    printProject(root, entry);
    return;
  }
  if (entry.kind === "missing") {
    // detectWorkspaceFromCwd returns the first path segment under root, but
    // does NOT verify that segment is actually a workspace. A user who `cd`s
    // into a plain subfolder of $ROOT would otherwise hit a misleading
    // "settings.json not found — run ccws init" error. Treat a non-workspace
    // subdir the same as "not inside any workspace": warn and return.
    warn("not inside any workspace — cd into a workspace or use `ccws list`");
    return;
  }
  const settings = readSettings(settingsPath(root, name));
  const dirs = settings.permissions?.additionalDirectories ?? [];
  // Reuse the already-parsed settings for the mode line (same string-only
  // filter as resolveStoredMode) instead of re-reading the file.
  const rawMode = settings.permissions?.defaultMode;
  info(`workspace: ${name}  (${workspacePath(root, name)})`);
  info(`mode: ${typeof rawMode === "string" ? rawMode : "default"}`);
  if (parseScratchMeta(settings)) {
    info("scratch session — discarded when claude exits");
  }
  for (const d of dirs) {
    process.stdout.write(existsSync(d) ? `  ✓  ${d}\n` : `  ✗  ${d}  (missing)\n`);
  }
}
