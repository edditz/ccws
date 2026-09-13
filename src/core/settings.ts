import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { ScratchMeta, SettingsJson } from "../types.js";
import { dedupe } from "./paths.js";

/**
 * Extract the scratch marker from parsed settings. Strict on the one field
 * that matters: anything but an object with `kind === "scratch"` returns
 * undefined, so a malformed marker degrades the entry to a regular workspace
 * (never treated as disposable) rather than guessing. Extra fields inside the
 * marker (e.g. a legacy createdAt) are tolerated and dropped.
 */
export function parseScratchMeta(settings: SettingsJson): ScratchMeta | undefined {
  const raw = settings?.ccws;
  if (typeof raw !== "object" || raw === null) return undefined;
  if (raw.kind !== "scratch") return undefined;
  return { kind: "scratch" };
}

export function readSettings(settingsPath: string): SettingsJson {
  if (!existsSync(settingsPath)) {
    throw new Error(`settings.json not found at ${settingsPath} — run \`ccws init\` first`);
  }
  const raw = readFileSync(settingsPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`settings.json is corrupt at ${settingsPath} — refusing to overwrite; fix or remove it manually`);
  }
  return parsed as SettingsJson;
}

export function writeAdditionalDirs(settingsPath: string, dirs: string[]): void {
  // readSettings throws on corrupt JSON (refusing to overwrite) and on missing
  // files; for the missing-file case we fall back to an empty skeleton so the
  // merge still creates the file. This aligns corrupt-JSON rejection with
  // readSettings without changing the merge semantics.
  let settings: SettingsJson = {};
  if (existsSync(settingsPath)) {
    settings = readSettings(settingsPath);
  }
  const permissions = { ...(settings.permissions ?? {}) };
  permissions.additionalDirectories = dedupe([...(permissions.additionalDirectories ?? []), ...dirs]);
  const next: SettingsJson = { ...settings, permissions };
  writeFileSync(settingsPath, JSON.stringify(next, null, 2) + "\n", "utf8");
}

export function setAdditionalDirs(settingsPath: string, dirs: string[]): void {
  // Replace semantics (vs. writeAdditionalDirs' merge). Route through
  // readSettings so a corrupt settings.json is rejected, not overwritten.
  let settings: SettingsJson = {};
  if (existsSync(settingsPath)) {
    settings = readSettings(settingsPath);
  }
  const permissions = { ...(settings.permissions ?? {}) };
  permissions.additionalDirectories = dedupe(dirs);
  const next: SettingsJson = { ...settings, permissions };
  writeFileSync(settingsPath, JSON.stringify(next, null, 2) + "\n", "utf8");
}

export const BYPASS_MODE = "bypassPermissions";

/**
 * Set the workspace's permission mode (`permissions.defaultMode`), or remove
 * the key entirely with `undefined` so Claude falls back to its default mode.
 * Routes through `readSettings` so a corrupt settings.json is rejected rather
 * than overwritten; preserves unknown fields and key order (immutable copy).
 */
export function setDefaultMode(settingsPath: string, mode: string | undefined): void {
  let settings: SettingsJson = {};
  if (existsSync(settingsPath)) {
    settings = readSettings(settingsPath);
  }
  const permissions = { ...(settings.permissions ?? {}) };
  if (mode === undefined) {
    delete permissions.defaultMode;
  } else {
    permissions.defaultMode = mode;
  }
  const next: SettingsJson = { ...settings, permissions };
  writeFileSync(settingsPath, JSON.stringify(next, null, 2) + "\n", "utf8");
}
