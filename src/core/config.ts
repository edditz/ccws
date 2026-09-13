import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { readdirSync, statSync, lstatSync, readlinkSync, realpathSync, existsSync } from "node:fs";
import { readSettings, BYPASS_MODE } from "./settings.js";
import { assertAllExist, isSymlink } from "./paths.js";
import type { Workspace, Project, Entry } from "../types.js";

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
    // lstat (not stat): a symlink must never pass isDirectory() here, or a
    // registered project whose target happens to contain .claude/settings.json
    // would masquerade as a workspace.
    return lstatSync(p).isDirectory() && existsSync(join(p, ".claude", "settings.json"));
  });
  return names.map((name) => {
    let dirs: string[] = [];
    let bypass = false;
    try {
      const s = readSettings(settingsPath(root, name));
      dirs = s.permissions?.additionalDirectories ?? [];
      bypass = s.permissions?.defaultMode === BYPASS_MODE;
    } catch { dirs = []; }
    const missing = assertAllExist(dirs).length;
    return { name, path: workspacePath(root, name), dirs, missing, bypass };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Resolve what `$ROOT/<name>` is: a workspace (real dir + settings), a project
 * (symlink to an existing directory), a dangling symlink, or nothing. The one
 * lookup every name-taking command routes through — names are a single shared
 * namespace, so no search order is needed.
 */
export function resolveEntry(root: string, name: string): Entry {
  const p = workspacePath(root, name);
  if (isSymlink(p)) {
    // isSymlink already lstat'd the link; a readlink failure here is a rare
    // race and may propagate — cli.ts's fail() turns it into a clean error.
    const target = resolve(readlinkSync(p));
    // existsSync (follows the link): dangling when the target is gone.
    return existsSync(target)
      ? { kind: "project", name, target }
      : { kind: "dangling", name, target };
  }
  if (existsSync(settingsPath(root, name))) return { kind: "workspace", name };
  return { kind: "missing" };
}

/** Discover registered projects: symlinks directly under $ROOT. */
export function discoverProjects(root: string): Project[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((n) => isSymlink(join(root, n)))
    .flatMap((name) => {
      try {
        const target = resolve(readlinkSync(join(root, name)));
        const st = statSync(target); // follows the link; throws when dangling
        return [{ name, target, targetExists: true, targetMtimeMs: st.mtimeMs }];
      } catch {
        // Dangling (or unreadable) target: keep the entry visible in listings
        // so the user can clean it up, with a zero mtime sorting it last.
        let target = "";
        try {
          target = resolve(readlinkSync(join(root, name)));
        } catch { /* unreadable link — leave target empty */ }
        return [{ name, target, targetExists: false, targetMtimeMs: 0 }];
      }
    })
    .sort((a, b) => b.targetMtimeMs - a.targetMtimeMs || a.name.localeCompare(b.name));
}

/**
 * Find the registered project whose target directory contains `cwd` (the
 * project itself or a subdir). Compares realpaths: cwd may carry a symlinked
 * prefix (/tmp vs /private/tmp) while targets are stored realpath'd.
 */
export function detectProjectFromCwd(root: string, cwd: string = process.cwd()): Project | null {
  let real: string;
  try {
    real = realpathSync(cwd);
  } catch {
    return null;
  }
  return (
    discoverProjects(root).find(
      (p) => p.targetExists && (real === p.target || real.startsWith(p.target + sep)),
    ) ?? null
  );
}
