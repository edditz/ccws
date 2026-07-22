import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { settingsPath } from "./config.js";

export function workspaceExists(root: string, name: string): boolean {
  return existsSync(settingsPath(root, name));
}

export function createWorkspace(root: string, name: string): void {
  if (workspaceExists(root, name)) {
    throw new Error(`workspace "${name}" already exists — use --force to overwrite`);
  }
  const settings = settingsPath(root, name);
  mkdirSync(dirname(settings), { recursive: true });
  const skeleton = { permissions: { additionalDirectories: [] } };
  writeFileSync(settings, JSON.stringify(skeleton, null, 2) + "\n", "utf8");
}
