import { resolveRoot, detectWorkspaceFromCwd, claudeMdPath } from "../core/config.js";
import { workspaceExists, validateWorkspaceName } from "../core/workspace.js";
import {
  forceRewriteClaudeMd,
  readDirEntries,
  syncClaudeMd,
} from "../core/claude-md.js";
import { info, success } from "../utils/log.js";

export interface RegenOptions {
  root?: string;
  force?: boolean;
}

export async function regenAction(
  name: string | undefined,
  opts: RegenOptions,
): Promise<void> {
  const root = resolveRoot(opts.root);
  const ws = name ?? detectWorkspaceFromCwd(root);
  if (!ws) {
    throw new Error(
      "not inside a workspace and name not given — pass a workspace name or cd into a workspace",
    );
  }
  validateWorkspaceName(ws);
  if (!workspaceExists(root, ws)) {
    throw new Error(`workspace "${ws}" does not exist — run \`ccws init ${ws}\` first`);
  }

  if (opts.force) {
    forceRewriteClaudeMd(claudeMdPath(root, ws), readDirEntries(root, ws));
    success(`force-rewrote CLAUDE.md for "${ws}"`);
    return;
  }

  const outcome = syncClaudeMd(root, ws);
  if (outcome === "appended") {
    info(`appended ccws block to existing CLAUDE.md for "${ws}"`);
  } else if (outcome === "created") {
    success(`generated CLAUDE.md for "${ws}"`);
  } else {
    success(`refreshed CLAUDE.md for "${ws}"`);
  }
}
