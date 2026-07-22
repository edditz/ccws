import { rmSync } from "node:fs";
import { resolveRoot, settingsPath, workspacePath } from "../core/config.js";
import { createWorkspace, workspaceExists, validateWorkspaceName } from "../core/workspace.js";
import { assertAllExist, toAbsolute } from "../core/paths.js";
import { writeAdditionalDirs } from "../core/settings.js";
import { success } from "../utils/log.js";

export interface InitOptions {
  root?: string;
  force?: boolean;
  /**
   * When true, prompt for additional directories one-by-one via `@clack/prompts`
   * after the workspace is created. Directories are validated to exist before
   * being written into settings.json. A `text` function may be injected for
   * testing (non-TTY); when omitted the real `@clack/prompts` text is used.
   */
  interactive?: boolean;
  /** @internal test hook — overrides the interactive text prompt. */
  promptText?: (message: string) => Promise<string>;
}

/**
 * Collect directory paths interactively until an empty value is given, then
 * validate them and write into the workspace's settings.json. Returns the list
 * of absolute paths written (empty if none collected). Throws if any path does
 * not exist.
 */
async function collectAndWriteDirs(
  root: string,
  name: string,
  prompt: (message: string) => Promise<string>,
): Promise<string[]> {
  const collected: string[] = [];
  for (;;) {
    const val = (await prompt(`dir #${collected.length + 1} (empty to finish):`)).trim();
    if (!val) break;
    collected.push(toAbsolute(val));
  }
  if (collected.length === 0) return [];
  const missing = assertAllExist(collected);
  if (missing.length > 0) {
    throw new Error(`directories do not exist:\n${missing.map((m) => "  " + m).join("\n")}`);
  }
  writeAdditionalDirs(settingsPath(root, name), collected);
  return collected;
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
    throw new Error((err as Error).message);
  }

  if (opts.interactive) {
    // Inject the real @clack/prompts text lazily so non-interactive code paths
    // (and tests) never touch the TTY. isCancel(ctrl+c) yields an empty string,
    // treating cancellation as "no more dirs".
    const { text, isCancel } = await import("@clack/prompts");
    const prompt = opts.promptText ??
      (async (message: string) => {
        const v = await text({ message });
        return isCancel(v) ? "" : (v as string);
      });
    try {
      await collectAndWriteDirs(root, name, prompt);
    } catch (err) {
      throw new Error((err as Error).message);
    }
  }

  success(`created workspace "${name}" at ${workspacePath(root, name)}`);
}
