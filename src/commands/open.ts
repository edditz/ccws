import { spawn } from "node:child_process";
import { resolveRoot, workspacePath } from "../core/config.js";
import { workspaceExists } from "../core/workspace.js";

export type Runner = (cmd: string, args: string[], opts: { cwd: string; stdio: "inherit" }) => void;

const defaultRunner: Runner = (cmd, args, opts) => {
  spawn(cmd, args, opts);
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
