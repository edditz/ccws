import { resolve } from "node:path";
import { existsSync, lstatSync } from "node:fs";

export function toAbsolute(input: string): string {
  return resolve(input);
}

/** True when p exists and is itself a symlink (never following the link). */
export function isSymlink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

export function dedupe(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

export function assertAllExist(paths: string[]): string[] {
  return paths.filter((p) => !existsSync(p));
}
