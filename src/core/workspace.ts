import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { settingsPath } from "./config.js";

/**
 * Validate a workspace name.
 *
 * Rules (brief: reject path traversal, not adjacent literal dots):
 *   - must be non-empty after trimming
 *   - must not contain path separators (`/` or `\`)
 *   - must not equal `.` or `..` as a single segment
 *
 * Note: `a..b`, `foo..bar`, `v1..0` are LEGAL — the two adjacent dots are
 * literal characters, not the `..` parent-directory segment. Only `..` as a
 * complete path segment (e.g. `../x`, `a/..`, bare `..`) is rejected, and any
 * presence of a separator already disqualifies the name above, so we simply
 * check the whole trimmed string against `.` / `..`.
 */
export function validateWorkspaceName(name: string): void {
  const trimmed = name?.trim();
  if (!trimmed) {
    throw new Error("invalid workspace name: must be non-empty");
  }
  if (/[\\/]/.test(trimmed)) {
    throw new Error(
      `invalid workspace name "${name}": must not contain path separators (/ or \\)`,
    );
  }
  if (trimmed === "." || trimmed === "..") {
    throw new Error(
      `invalid workspace name "${name}": must not be a parent-dir segment (.) or (..)`,
    );
  }
}

export function workspaceExists(root: string, name: string): boolean {
  return existsSync(settingsPath(root, name));
}

export function createWorkspace(root: string, name: string): void {
  validateWorkspaceName(name);
  if (workspaceExists(root, name)) {
    throw new Error(`workspace "${name}" already exists — use --force to overwrite`);
  }
  const settings = settingsPath(root, name);
  mkdirSync(dirname(settings), { recursive: true });
  const skeleton = { permissions: { additionalDirectories: [] } };
  writeFileSync(settings, JSON.stringify(skeleton, null, 2) + "\n", "utf8");
}
