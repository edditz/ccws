import { rmSync } from "node:fs";
import { resolveRoot, workspacePath } from "../core/config.js";
import { createWorkspace, workspaceExists } from "../core/workspace.js";
import { error, success } from "../utils/log.js";

export interface InitOptions {
  root?: string;
  force?: boolean;
  interactive?: boolean;
}

const NAME_PATTERN = /[\\/]|^\.{1,2}$|\/\.{1,2}\//;

function validateName(name: string): void {
  if (!name || name.trim() === "") {
    throw new Error('invalid workspace name: must be non-empty');
  }
  if (NAME_PATTERN.test(name) || name.includes("..")) {
    throw new Error(
      `invalid workspace name "${name}": must not contain path separators (/ or \\) or parent-dir segments (..)`,
    );
  }
}

export async function initAction(name: string, opts: InitOptions): Promise<void> {
  validateName(name);

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

  // --interactive is wired in Task 13 (needs @clack/prompts + dir picker); no-op here.
  if (opts.interactive) {
    // reserved for interactive onboarding wizard
  }
}
