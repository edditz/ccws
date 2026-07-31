import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { SettingsJson } from "../types.js";
import { dedupe } from "./paths.js";

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
 * Enable or disable the workspace's bypassPermissions mode.
 *
 * "bypassPermissions" is a value of `permissions.defaultMode` (a permission
 * MODE, not a rule array): enabling writes `defaultMode: "bypassPermissions"`,
 * disabling removes the key so Claude falls back to its default mode.
 * Routes through `readSettings` so a corrupt settings.json is rejected rather
 * than overwritten; preserves unknown fields and key order (immutable copy).
 */
export function setBypassPermissions(settingsPath: string, enabled: boolean): void {
  let settings: SettingsJson = {};
  if (existsSync(settingsPath)) {
    settings = readSettings(settingsPath);
  }
  const permissions = { ...(settings.permissions ?? {}) };
  if (enabled) {
    permissions.defaultMode = BYPASS_MODE;
  } else {
    delete permissions.defaultMode;
  }
  const next: SettingsJson = { ...settings, permissions };
  writeFileSync(settingsPath, JSON.stringify(next, null, 2) + "\n", "utf8");
}
