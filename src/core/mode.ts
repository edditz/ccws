import { mkdirSync, readFileSync, writeFileSync, rmSync, lstatSync, existsSync } from "node:fs";
import { join } from "node:path";
import { modesStoreDir, modeSidecarPath, settingsPath } from "./config.js";
import { readSettings, setDefaultMode } from "./settings.js";
import type { NamedEntry } from "../types.js";

/**
 * Permission modes ccws accepts, mirroring the choices of claude's
 * `--permission-mode` flag (an external contract — re-verify on claude
 * upgrades). "off"/"default" are clear aliases, not stored modes.
 */
export const PERMISSION_MODES = [
  "acceptEdits",
  "auto",
  "bypassPermissions",
  "manual",
  "dontAsk",
  "plan",
] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];

export const MODE_CLEAR_VALUES = ["off", "default"] as const;

export type ModeInput = PermissionMode | (typeof MODE_CLEAR_VALUES)[number];

const MODE_INPUTS: readonly string[] = [...PERMISSION_MODES, ...MODE_CLEAR_VALUES];

/** Membership check without throwing — used to disambiguate positional args. */
export function isModeInput(v: string): v is ModeInput {
  return MODE_INPUTS.includes(v);
}

/** Parse a user-supplied mode value; throws listing valid values on junk. */
export function parseModeValue(v: string): ModeInput {
  if (!isModeInput(v)) {
    throw new Error(
      `invalid mode "${v}" — expected one of: ${[...PERMISSION_MODES, `${MODE_CLEAR_VALUES.join("/")} (clears)`].join(", ")}`,
    );
  }
  return v;
}

/**
 * Read an entry's stored permission mode. Workspaces keep theirs in
 * `permissions.defaultMode` of their own settings.json; projects (and dangling
 * entries) keep theirs in a sidecar under `$ROOT/.ccws/modes/<name>` — the
 * only place ccws owns for them, since project targets are read-only.
 *
 * The value is returned verbatim without validation: claude owns the mode
 * vocabulary and adds values over time, so a stored future mode must not
 * block reads. Non-string or absent values yield `undefined`. Workspace
 * reads route through `readSettings` (throws on corrupt JSON).
 */
export function resolveStoredMode(root: string, entry: NamedEntry): string | undefined {
  if (entry.kind === "workspace") {
    const mode = readSettings(settingsPath(root, entry.name)).permissions?.defaultMode;
    return typeof mode === "string" ? mode : undefined;
  }
  const sidecar = modeSidecarPath(root, entry.name);
  try {
    const raw = readFileSync(sidecar, "utf8").trim();
    return raw === "" ? undefined : raw;
  } catch {
    return undefined; // missing sidecar = no stored mode
  }
}

/**
 * Set (or clear with `undefined`) an entry's stored permission mode via the
 * backend appropriate for its kind. Idempotent: re-setting writes identical
 * content, clearing an unset mode is a no-op.
 */
export function setStoredMode(
  root: string,
  entry: NamedEntry,
  mode: PermissionMode | undefined,
): void {
  if (entry.kind === "workspace") {
    setDefaultMode(settingsPath(root, entry.name), mode);
    return;
  }
  const sidecar = modeSidecarPath(root, entry.name);
  if (mode === undefined) {
    rmSync(sidecar, { force: true });
    return;
  }
  // Guard the internal state dir structurally: a legacy registration (or a
  // stray file) named `.ccws` under $ROOT must not be followed into —
  // mkdirSync would pierce a symlink and write into the user's directory.
  // lstat (not stat): a symlink to a directory is rejected too.
  const stateDir = join(root, ".ccws");
  if (existsSync(stateDir) && !lstatSync(stateDir).isDirectory()) {
    throw new Error(
      `"${stateDir}" exists but is not a directory — it is reserved for ccws internal state; remove or rename it`,
    );
  }
  mkdirSync(modesStoreDir(root), { recursive: true });
  writeFileSync(sidecar, `${mode}\n`, "utf8");
}

/** Drop a project's mode sidecar if present; never throws. */
export function removeModeSidecar(root: string, name: string): void {
  rmSync(modeSidecarPath(root, name), { force: true });
}
