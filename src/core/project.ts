import { symlinkSync, existsSync, statSync, realpathSync } from "node:fs";
import { basename } from "node:path";
import { workspacePath } from "./config.js";
import { validateWorkspaceName } from "./workspace.js";
import { isSymlink } from "./paths.js";

export interface RegisteredProject {
  name: string;
  /** Absolute real path of the registered project directory. */
  target: string;
}

/**
 * Register an existing project directory as a ccws project: a symlink
 * `$ROOT/<basename>` pointing at the target's realpath. The target directory
 * itself is never read or written — the symlink is the only thing ccws owns,
 * which is what makes unregistering (`ccws delete`) incapable of touching the
 * real project.
 */
export function createProject(root: string, targetPath: string): RegisteredProject {
  if (!existsSync(targetPath)) {
    throw new Error(`"${targetPath}" does not exist`);
  }
  const target = realpathSync(targetPath);
  if (!statSync(target).isDirectory()) {
    throw new Error(`"${targetPath}" is not a directory — projects are registered by directory`);
  }
  const name = basename(target);
  validateWorkspaceName(name);
  const link = workspacePath(root, name);
  // Names share one namespace with workspaces: anything already occupying
  // $ROOT/<name> (workspace, project, or plain dir) blocks registration.
  if (existsSync(link) || isSymlink(link)) {
    throw new Error(
      `"${name}" already exists under $ROOT — run \`ccws delete ${name}\` first, or rename the project directory`,
    );
  }
  symlinkSync(target, link);
  return { name, target };
}
