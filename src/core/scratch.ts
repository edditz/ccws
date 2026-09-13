import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { workspacePath, settingsPath } from "./config.js";
import { readSettings, parseScratchMeta, setDefaultMode, BYPASS_MODE } from "./settings.js";
import { createWorkspace, requireWorkspace } from "./workspace.js";
import { isSymlink } from "./paths.js";
import type { ScratchMeta } from "../types.js";

const NAME_ATTEMPTS = 5;

/**
 * A random scratch name: 1-3 lowercase-letter words joined by "-", each word
 * 4-8 letters (e.g. "kztmqw-bxare"). The name carries no meaning — scratch
 * detection is the settings.json marker, never the name.
 */
export function generateScratchName(random: () => number = Math.random): string {
  const word = (): string => {
    const len = 4 + Math.floor(random() * 5); // 4..8 letters
    let s = "";
    for (let i = 0; i < len; i++) {
      s += String.fromCharCode(97 + Math.floor(random() * 26)); // a-z
    }
    return s;
  };
  const count = 1 + Math.floor(random() * 3); // 1..3 words
  return Array.from({ length: count }, word).join("-");
}

// A name is free only when NOTHING exists under it: a plain directory is not
// free (createWorkspace would mkdir `.claude` inside a user's dir even though
// resolveEntry calls it "missing"), and a symlink — project or dangling — must
// never be written through.
const nameIsFree = (root: string, name: string): boolean => {
  const p = workspacePath(root, name);
  return !existsSync(p) && !isSymlink(p);
};

/**
 * Create a throwaway scratch workspace under $ROOT: a real workspace directory
 * carrying the `ccws.kind = "scratch"` marker (the ONLY thing that makes it a
 * scratch — the name prefix is readability) and the bypassPermissions default
 * mode. No CLAUDE.md: scratch sessions never manage directories. The caller
 * owns its lifetime — scratchAction deletes it when claude exits.
 */
export function createScratchWorkspace(root: string, opts?: { nameGenerator?: () => string }): { name: string; path: string } {
  const nextName = opts?.nameGenerator ?? (() => generateScratchName());
  let name = nextName();
  let free = nameIsFree(root, name);
  for (let attempts = 0; !free && attempts < NAME_ATTEMPTS; attempts++) {
    name = nextName();
    free = nameIsFree(root, name);
  }
  if (!free) {
    throw new Error(`could not find a free scratch name under ${root} — try again`);
  }
  createWorkspace(root, name);
  const path = workspacePath(root, name);
  setDefaultMode(settingsPath(root, name), BYPASS_MODE);
  markScratch(settingsPath(root, name));
  return { name, path };
}

const markScratch = (file: string): void => {
  // Routes through readSettings so the corrupt-JSON refusal is shared; the
  // file was written moments ago by createWorkspace, so this cannot trip.
  const settings = readSettings(file);
  writeFileSync(file, JSON.stringify({ ...settings, ccws: { kind: "scratch" } }, null, 2) + "\n", "utf8");
};

/** The scratch marker, or undefined for regular/corrupt/missing entries. */
export function readScratchMeta(root: string, name: string): ScratchMeta | undefined {
  try {
    return parseScratchMeta(readSettings(settingsPath(root, name)));
  } catch {
    return undefined; // missing, or corrupt — degrade to "not a scratch"
  }
}

export function isScratchWorkspace(root: string, name: string): boolean {
  return readScratchMeta(root, name) !== undefined;
}

/**
 * Guard for directory-managing commands (add/remove/regen): the entry must be
 * a regular workspace. Scratch sessions are deliberately blank — redirect to
 * the regular-workspace flow instead of letting one quietly accumulate dirs
 * that would be discarded with the session.
 */
export function requireNonScratchWorkspace(root: string, name: string): void {
  requireWorkspace(root, name);
  if (isScratchWorkspace(root, name)) {
    throw new Error(
      `"${name}" is a scratch workspace — scratch sessions don't manage directories; create a regular workspace with \`ccws init <name>\` and \`ccws add\` to it`,
    );
  }
}

// Claude Code remembers folder trust per exact cwd string in ~/.claude.json's
// `projects[cwd].hasTrustDialogAccepted` (verified against claude 2.1.236 —
// "Quick safety check" is that trust dialog, shown for every untrusted cwd).
// A fresh scratch dir would trigger it on every launch, so ccws pre-trusts the
// cwd it just created and fully owns, and drops the entry again on discard.
// Same contract class as CLAUDE_EXIT_HINT_LINES / mungeProjectDir: re-verify
// against the installed claude when upgrading.

type ClaudeConfig = { projects?: Record<string, Record<string, unknown>> };

const readClaudeConfig = (claudeJsonPath: string): ClaudeConfig | undefined => {
  let raw: string;
  try {
    raw = readFileSync(claudeJsonPath, "utf8");
  } catch {
    return {}; // missing file — a fresh minimal one is safe to create
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as ClaudeConfig;
  } catch {
    return undefined; // corrupt — never overwrite claude's config
  }
};

const writeClaudeConfig = (claudeJsonPath: string, config: ClaudeConfig): void => {
  // No trailing newline: byte-match claude's own serialization of this file,
  // so a mark+remove round-trip leaves it untouched.
  writeFileSync(claudeJsonPath, JSON.stringify(config, null, 2), "utf8");
};

/**
 * Best-effort: pre-trust `cwd` in claude's config so the scratch session
 * launches without the folder-trust dialog. Silent on any failure — the worst
 * case is the dialog showing once, exactly as before.
 */
export function markCwdTrusted(claudeJsonPath: string, cwd: string): void {
  const config = readClaudeConfig(claudeJsonPath);
  if (config === undefined) return;
  const projects = { ...(config.projects ?? {}) };
  const entry = { ...(projects[cwd] ?? {}), hasTrustDialogAccepted: true };
  try {
    writeClaudeConfig(claudeJsonPath, { ...config, projects: { ...projects, [cwd]: entry } });
  } catch {
    // unreadable/locked config — leave it; claude will just ask once
  }
}

/**
 * Best-effort: drop the scratch cwd's entry from claude's config once the
 * directory is discarded, so trust memory does not accumulate orphans.
 * Silent on any failure.
 */
export function removeCwdEntry(claudeJsonPath: string, cwd: string): void {
  const config = readClaudeConfig(claudeJsonPath);
  if (config === undefined || config.projects === undefined || !(cwd in config.projects)) return;
  const { [cwd]: _drop, ...rest } = config.projects;
  try {
    writeClaudeConfig(claudeJsonPath, { ...config, projects: rest });
  } catch {
    // best-effort only
  }
}
