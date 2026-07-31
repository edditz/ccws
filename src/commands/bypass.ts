import { resolveRoot, detectWorkspaceFromCwd, settingsPath } from "../core/config.js";
import { readSettings, setBypassPermissions, BYPASS_MODE } from "../core/settings.js";
import { workspaceExists, validateWorkspaceName } from "../core/workspace.js";
import { success, info } from "../utils/log.js";

export interface BypassOptions {
  root?: string;
  workspace?: string;
}

function resolveWorkspaceName(opts: BypassOptions, root: string): string {
  if (opts.workspace) return opts.workspace;
  const detected = detectWorkspaceFromCwd(root);
  if (detected) return detected;
  throw new Error(
    "not inside a workspace and --workspace not given — pass --workspace <name> or cd into a workspace",
  );
}

/**
 * Toggle a workspace's permission mode.
 *
 * - `"on"` sets `permissions.defaultMode` to `"bypassPermissions"` (skips
 *   permission prompts — only for trusted workspaces).
 * - `"off"` removes `permissions.defaultMode`, restoring Claude's default mode.
 * - `undefined` prints the current mode without changing anything.
 */
export async function bypassAction(
  state: "on" | "off" | undefined,
  opts: BypassOptions,
): Promise<void> {
  const root = resolveRoot(opts.root);
  const name = resolveWorkspaceName(opts, root);
  validateWorkspaceName(name);

  if (!workspaceExists(root, name)) {
    throw new Error(`workspace "${name}" does not exist — run \`ccws init ${name}\` first`);
  }

  const path = settingsPath(root, name);

  if (state === "on") {
    setBypassPermissions(path, true);
    success(`bypass permissions enabled for "${name}"`);
    return;
  }
  if (state === "off") {
    setBypassPermissions(path, false);
    success(`bypass permissions disabled for "${name}"`);
    return;
  }

  // No state given — getter: report the current mode.
  const mode = readSettings(path).permissions?.defaultMode;
  if (mode === BYPASS_MODE) {
    info(`bypass permissions: ON for "${name}"`);
  } else {
    const detail = mode === undefined ? "(using default mode)" : `(defaultMode: ${mode})`;
    info(`bypass permissions: off for "${name}" ${detail}`);
  }
}
