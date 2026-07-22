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
  let settings: SettingsJson = {};
  if (existsSync(settingsPath)) {
    settings = JSON.parse(readFileSync(settingsPath, "utf8")) as SettingsJson;
  }
  const permissions = { ...(settings.permissions ?? {}) };
  permissions.additionalDirectories = dedupe([...(permissions.additionalDirectories ?? []), ...dirs]);
  const next: SettingsJson = { ...settings, permissions };
  writeFileSync(settingsPath, JSON.stringify(next, null, 2) + "\n", "utf8");
}
