import { rmSync } from "node:fs";
import { resolveRoot, workspacePath } from "../core/config.js";
import { createWorkspace, workspaceExists, validateWorkspaceName } from "../core/workspace.js";
import { error, success } from "../utils/log.js";

export interface InitOptions {
  root?: string;
  force?: boolean;
  /**
   * `--interactive` is a no-op here and is wired in Task 13 (needs
   * @clack/prompts + dir picker). The option is declared so the CLI can accept
   * the flag today; this command performs no interactive onboarding yet.
   */
  interactive?: boolean;
}

export async function initAction(name: string, opts: InitOptions): Promise<void> {
  validateWorkspaceName(name);

  const root = resolveRoot(opts.root);

  if (opts.force && workspaceExists(root, name)) {
    rmSync(workspacePath(root, name), { recursive: true, force: true });
  }

  try {
    createWorkspace(root, name);
  } catch (err) {
    error((err as Error).message);
    throw err;
  }

  success(`created workspace "${name}" at ${workspacePath(root, name)}`);
}
