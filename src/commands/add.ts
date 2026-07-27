import { resolveRoot, detectWorkspaceFromCwd, settingsPath } from "../core/config.js";
import { writeAdditionalDirs } from "../core/settings.js";
import { toAbsolute, assertAllExist } from "../core/paths.js";
import { workspaceExists, validateWorkspaceName } from "../core/workspace.js";
import { syncClaudeMd } from "../core/claude-md.js";
import { success } from "../utils/log.js";

export interface AddOptions {
  root?: string;
  workspace?: string;
}

function resolveWorkspaceName(opts: AddOptions, root: string): string {
  if (opts.workspace) return opts.workspace;
  const detected = detectWorkspaceFromCwd(root);
  if (detected) return detected;
  throw new Error(
    "not inside a workspace and --workspace not given — pass --workspace <name> or cd into a workspace",
  );
}

export async function addAction(dirs: string[], opts: AddOptions): Promise<void> {
  const root = resolveRoot(opts.root);
  const name = resolveWorkspaceName(opts, root);
  validateWorkspaceName(name);

  if (!workspaceExists(root, name)) {
    throw new Error(`workspace "${name}" does not exist — run \`ccws init ${name}\` first`);
  }

  const abs = dirs.map(toAbsolute);
  const missing = assertAllExist(abs);
  if (missing.length > 0) {
    throw new Error(`directories do not exist:\n${missing.map((m) => "  " + m).join("\n")}`);
  }

  writeAdditionalDirs(settingsPath(root, name), abs);
  syncClaudeMd(root, name);
  success(`added ${abs.length} director${abs.length === 1 ? "y" : "ies"} to "${name}"`);
}
