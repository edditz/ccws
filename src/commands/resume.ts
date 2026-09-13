import { resolveRoot, workspacePath } from "../core/config.js";
import { workspaceExists } from "../core/workspace.js";
import { runClaudeSession, resumeHint, type Runner } from "../utils/claude-session.js";

export interface ResumeOptions { root?: string; runner?: Runner; sessionsRoot?: string }

export async function resumeAction(
  name: string,
  sessionId: string | undefined,
  opts: ResumeOptions,
): Promise<void> {
  const root = resolveRoot(opts.root);
  if (!workspaceExists(root, name)) {
    throw new Error(`workspace "${name}" does not exist — run \`ccws init ${name}\` first`);
  }
  // Pass-through, mirroring claude's own semantics: an id resumes that exact
  // session, no id opens claude's interactive session picker. claude resolves
  // ids/names and prints its own errors, so nothing is validated here.
  // Normalize "" to undefined so both branches below agree it means "picker".
  const explicitId = sessionId || undefined;
  const args = explicitId ? ["--resume", explicitId] : ["--resume"];
  await runClaudeSession({
    cwd: workspacePath(root, name),
    args,
    runner: opts.runner,
    // An explicit id is exact, so it wins over the disk scan; the scanned id
    // covers the picker path, where claude knows the choice but ccws doesn't.
    exitHint: (found) => resumeHint(name, explicitId ?? found),
    sessionsRoot: opts.sessionsRoot,
  });
}
