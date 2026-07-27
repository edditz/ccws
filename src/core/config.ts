import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import { readdirSync, statSync, existsSync } from "node:fs";
import { readSettings } from "./settings.js";
import { assertAllExist } from "./paths.js";
import type { Workspace } from "../types.js";

export function resolveRoot(cliRoot?: string): string {
  if (cliRoot) return resolve(cliRoot);
  if (process.env.CCWS_ROOT) return resolve(process.env.CCWS_ROOT);
  return join(homedir(), ".ccws");
}

export function workspacePath(root: string, name: string): string {
  return join(root, name);
}

export function settingsPath(root: string, name: string): string {
  return join(workspacePath(root, name), ".claude", "settings.json");
}

export function claudeMdPath(root: string, name: string): string {
  return join(workspacePath(root, name), "CLAUDE.md");
}

export function detectWorkspaceFromCwd(root: string, cwd: string = process.cwd()): string | null {
  const rel = relative(root, cwd);
  if (rel.startsWith("..") || rel === "") return null;
  const first = rel.split(/[/\\]/)[0];
  return first || null;
}

export function discoverWorkspaces(root: string): Workspace[] {
  if (!existsSync(root)) return [];
  const names = readdirSync(root).filter((n) => {
    const p = join(root, n);
    return statSync(p).isDirectory() && existsSync(join(p, ".claude", "settings.json"));
  });
  return names.map((name) => {
    let dirs: string[] = [];
    try {
      const s = readSettings(settingsPath(root, name));
      dirs = s.permissions?.additionalDirectories ?? [];
    } catch { dirs = []; }
    const missing = assertAllExist(dirs).length;
    return { name, path: workspacePath(root, name), dirs, missing };
  }).sort((a, b) => a.name.localeCompare(b.name));
}
