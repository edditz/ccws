import { spawn, type ChildProcess } from "node:child_process";
import { resolveRoot, workspacePath } from "../core/config.js";
import { workspaceExists } from "../core/workspace.js";
import * as log from "../utils/log.js";

// Injected runners may return void (tests) or a ChildProcess (production defaultRunner)
// so the default runner can attach an async "error" listener for spawn failures that
// try/catch cannot reach (ENOENT after spawn is synchronous, but EPERM/EACCES/crash
// arrive as an asynchronous "error" event).
export type Runner = (
  cmd: string,
  args: string[],
  opts: { cwd: string; stdio: "inherit" },
) => ChildProcess | void;

const defaultRunner: Runner = (cmd, args, opts) => {
  const child = spawn(cmd, args, opts);
  child.on("error", () => {
    log.error("`claude` failed to start — not found in PATH or crashed; install Claude Code first");
    process.exit(1);
  });
  return child;
};

export interface OpenOptions { root?: string; runner?: Runner }

export async function openAction(name: string, opts: OpenOptions): Promise<void> {
  const root = resolveRoot(opts.root);
  if (!workspaceExists(root, name)) {
    throw new Error(`workspace "${name}" does not exist — run \`ccws init ${name}\` first`);
  }
  const runner = opts.runner ?? defaultRunner;
  try {
    runner("claude", [], { cwd: workspacePath(root, name), stdio: "inherit" });
  } catch {
    throw new Error("`claude` not found in PATH — install Claude Code first");
  }
}
