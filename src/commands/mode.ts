import {
  resolveRoot,
  detectWorkspaceFromCwd,
  detectProjectFromCwd,
  resolveEntry,
} from "../core/config.js";
import { validateWorkspaceName } from "../core/workspace.js";
import {
  isModeInput,
  parseModeValue,
  resolveStoredMode,
  setStoredMode,
} from "../core/mode.js";
import type { NamedEntry } from "../types.js";
import { info, success, warn } from "../utils/log.js";

export interface ModeOptions { root?: string; cwd?: string }

/**
 * Resolve the entry for the current directory, workspace-first (lexical
 * containment under $ROOT) then project (realpath containment in a target),
 * mirroring statusAction. Null when cwd belongs to no entry at all.
 */
function resolveCwdEntry(root: string, cwd?: string): NamedEntry | null {
  const name = detectWorkspaceFromCwd(root, cwd);
  if (!name) {
    const proj = detectProjectFromCwd(root, cwd);
    return proj ? { kind: "project", name: proj.name, target: proj.target } : null;
  }
  const entry = resolveEntry(root, name);
  // A plain subdirectory of $ROOT is not an entry — treat as "not inside".
  return entry.kind === "missing" ? null : entry;
}

const requireEntry = (root: string, name: string): NamedEntry => {
  validateWorkspaceName(name);
  const entry = resolveEntry(root, name);
  if (entry.kind === "missing") {
    throw new Error(`"${name}" does not exist — nothing registered under this name`);
  }
  return entry;
};

function applyMode(root: string, entry: NamedEntry, raw: string): void {
  const parsed = parseModeValue(raw);
  if (parsed === "off" || parsed === "default") {
    setStoredMode(root, entry, undefined);
    success(`mode cleared for "${entry.name}"`);
    return;
  }
  setStoredMode(root, entry, parsed);
  success(`mode set to "${parsed}" for "${entry.name}"`);
}

function printMode(root: string, entry: NamedEntry): void {
  const mode = resolveStoredMode(root, entry);
  const flag = entry.kind === "dangling" ? "  (target missing)" : "";
  info(`mode: ${mode ?? "default"} for "${entry.name}"${flag}`);
}

/**
 * When a single argument parses as a mode keyword but an entry with that
 * literal name also exists, point the user at it — value-first resolution
 * would otherwise hide the entry behind the keyword.
 */
function keywordNameHint(root: string, value: string): string {
  if (resolveEntry(root, value).kind === "missing") return "";
  return `\nnote: an entry named "${value}" exists — inspect it with \`ccws list ${value} -l\``;
}

/**
 * Get or set the permission mode of a workspace or project.
 *
 * - `mode <name> <value>` — set (or clear with off/default) on a named entry.
 * - `mode <value>` — set on the cwd-resolved entry when the argument is a
 *   mode keyword (parity with `bypass on`); a workspace named like a keyword
 *   stays reachable through the two-argument form.
 * - `mode <name>` — getter for a named entry.
 * - `mode` — getter for the cwd-resolved entry.
 */
export async function modeAction(
  name: string | undefined,
  value: string | undefined,
  opts: ModeOptions,
): Promise<void> {
  const root = resolveRoot(opts.root);

  if (name !== undefined && value !== undefined) {
    applyMode(root, requireEntry(root, name), value);
    return;
  }

  if (name !== undefined) {
    if (isModeInput(name)) {
      const entry = resolveCwdEntry(root, opts.cwd);
      if (!entry) {
        throw new Error(
          `not inside a workspace or project — cd into one, or use: ccws mode <name> <value>${keywordNameHint(root, name)}`,
        );
      }
      applyMode(root, entry, name);
      return;
    }
    printMode(root, requireEntry(root, name));
    return;
  }

  const entry = resolveCwdEntry(root, opts.cwd);
  if (!entry) {
    warn("not inside any workspace or project — cd into one, or pass a name: ccws mode <name>");
    return;
  }
  printMode(root, entry);
}
