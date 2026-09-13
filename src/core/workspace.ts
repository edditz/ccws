import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { settingsPath, workspacePath, resolveEntry } from "./config.js";
import { isSymlink } from "./paths.js";

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
  // A symlink under $ROOT is a registered project, never a workspace — even
  // when its target directory happens to contain .claude/settings.json of the
  // user's own. lstat (not stat/existsSync) keeps the two kinds disjoint.
  if (isSymlink(workspacePath(root, name))) return false;
  return existsSync(settingsPath(root, name));
}

/**
 * Guard for workspace-only commands (add/remove/regen/bypass): name must
 * resolve to a real workspace. Projects are read-only — reject them with a
 * message that explains the boundary instead of a misleading "run ccws init".
 */
export function requireWorkspace(root: string, name: string): void {
  const entry = resolveEntry(root, name);
  if (entry.kind === "project" || entry.kind === "dangling") {
    throw new Error(
      `"${name}" is a registered project, not a workspace — projects are read-only (no additional directories to manage)`,
    );
  }
  if (entry.kind === "missing") {
    throw new Error(`workspace "${name}" does not exist — run \`ccws init ${name}\` first`);
  }
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
