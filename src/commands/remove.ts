import { resolveRoot, detectWorkspaceFromCwd, settingsPath } from "../core/config.js";
import { readSettings, setAdditionalDirs } from "../core/settings.js";
import { toAbsolute } from "../core/paths.js";
import { workspaceExists, validateWorkspaceName } from "../core/workspace.js";
import { success } from "../utils/log.js";

export interface RemoveOptions {
  root?: string;
  workspace?: string;
}

function resolveWorkspaceName(opts: RemoveOptions, root: string): string {
  if (opts.workspace) return opts.workspace;
  const detected = detectWorkspaceFromCwd(root);
  if (detected) return detected;
  throw new Error(
    "not inside a workspace and --workspace not given — pass --workspace <name> or cd into a workspace",
  );
}

export async function removeAction(dirs: string[], opts: RemoveOptions): Promise<void> {
  const root = resolveRoot(opts.root);
  const name = resolveWorkspaceName(opts, root);
  validateWorkspaceName(name);

  if (!workspaceExists(root, name)) {
    throw new Error(`workspace "${name}" does not exist — run \`ccws init ${name}\` first`);
  }

  const current = readSettings(settingsPath(root, name)).permissions?.additionalDirectories ?? [];
  const toRemove = new Set(dirs.map(toAbsolute));
  const missing = [...toRemove].filter((d) => !current.includes(d));
  if (missing.length > 0) {
    throw new Error(`not associated with "${name}":\n${missing.map((m) => "  " + m).join("\n")}`);
  }
  const next = current.filter((d) => !toRemove.has(d));
  setAdditionalDirs(settingsPath(root, name), next);
  success(`removed ${toRemove.size} director${toRemove.size === 1 ? "y" : "ies"} from "${name}"`);
}
