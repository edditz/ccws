import { realpathSync } from "node:fs";
import { Command, Option } from "commander";
import { initAction } from "./commands/init.js";
import { addAction } from "./commands/add.js";
import { removeAction } from "./commands/remove.js";
import { listAction } from "./commands/list.js";
import { statusAction } from "./commands/status.js";
import { openAction } from "./commands/open.js";
import { resumeAction } from "./commands/resume.js";
import { updateAction } from "./commands/update.js";
import { regenAction } from "./commands/regen.js";
import { bypassAction } from "./commands/bypass.js";
import { modeAction } from "./commands/mode.js";
import { deleteAction } from "./commands/delete.js";
import { error } from "./utils/log.js";
import pkg from "../package.json" with { type: "json" };

const rootOption = (): Option =>
  new Option("-r, --root <path>", "override convention root $ROOT");

const isBypassState = (s: string | undefined): s is "on" | "off" | undefined =>
  s === undefined || s === "on" || s === "off";

function fail(e: unknown): never {
  error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}

export function buildCli(): Command {
  const program = new Command();
  program
    .name("ccws")
    .description("Manage Claude Code workspaces")
    .version(pkg.version);

  program
    .command("init <name>")
    .description("create a new workspace, or register an existing project directory (pass its path)")
    .addOption(rootOption())
    .option("-f, --force", "overwrite existing workspace")
    .option("-i, --interactive", "pick directories interactively")
    .action(async (name: string, opts) => {
      try {
        await initAction(name, opts);
      } catch (e) {
        fail(e);
      }
    });

  program
    .command("add [dirs...]")
    .description("associate directories with a workspace")
    .addOption(rootOption())
    .option("-w, --workspace <name>", "target workspace")
    .action(async (dirs: string[], opts) => {
      try {
        await addAction(dirs, opts);
      } catch (e) {
        fail(e);
      }
    });

  program
    .command("remove [dirs...]")
    .description("remove directories from a workspace")
    .addOption(rootOption())
    .option("-w, --workspace <name>", "target workspace")
    .action(async (dirs: string[], opts) => {
      try {
        await removeAction(dirs, opts);
      } catch (e) {
        fail(e);
      }
    });

  program
    .command("list [name]")
    .alias("ls")
    .description("list workspaces and registered projects, or show one entry's detail")
    .addOption(rootOption())
    .option("-l, --long", "show each workspace's path and permission mode")
    .action(async (name: string | undefined, opts) => {
      try {
        await listAction(name ? [name] : [], opts);
      } catch (e) {
        fail(e);
      }
    });

  program
    .command("status")
    .description("show the workspace or project for the current directory")
    .addOption(rootOption())
    .action(async (opts) => {
      try {
        await statusAction(opts);
      } catch (e) {
        fail(e);
      }
    });

  program
    .command("open <name>")
    .description("launch claude in a workspace or registered project")
    .addOption(rootOption())
    .action(async (name: string, opts) => {
      try {
        await openAction(name, opts);
      } catch (e) {
        fail(e);
      }
    });

  program
    .command("resume <name> [session-id]")
    .description("resume a claude session in a workspace or project (session picker without session-id)")
    .addOption(rootOption())
    .action(async (name: string, sessionId: string | undefined, opts) => {
      try {
        await resumeAction(name, sessionId, opts);
      } catch (e) {
        fail(e);
      }
    });

  program
    .command("update")
    .description("self-update the ccws binary from GitHub Releases")
    .option("--check", "only check for a newer version; exit 1 if available")
    .option("--force", "reinstall even if already on the latest version")
    .option("--repo <owner/repo>", "source repo (default edditz/ccws, or CCWS_REPO)")
    .action(async (opts) => {
      try {
        const { exitCode } = await updateAction(opts);
        if (exitCode !== 0) process.exit(exitCode);
      } catch (e) {
        fail(e);
      }
    });

  program
    .command("regen [name]")
    .description("regenerate the workspace's CLAUDE.md from its associated directories")
    .addOption(rootOption())
    .option("-f, --force", "overwrite the entire CLAUDE.md (discards content outside the markers)")
    .action(async (name: string | undefined, opts) => {
      try {
        await regenAction(name, opts);
      } catch (e) {
        fail(e);
      }
    });

  program
    .command("bypass [state]")
    .description("enable or disable the bypassPermissions mode for a workspace (shortcut for ccws mode bypassPermissions)")
    .addOption(rootOption())
    .option("-w, --workspace <name>", "target workspace")
    .action(async (state: string | undefined, opts) => {
      try {
        if (!isBypassState(state)) {
          throw new Error(`invalid state "${state}" — expected "on" or "off"`);
        }
        await bypassAction(state, opts);
      } catch (e) {
        fail(e);
      }
    });

  program
    .command("mode [name] [value]")
    .description("get or set the permission mode for a workspace or project (acceptEdits, auto, bypassPermissions, manual, dontAsk, plan; off clears)")
    .addOption(rootOption())
    .action(async (name: string | undefined, value: string | undefined, opts) => {
      try {
        await modeAction(name, value, opts);
      } catch (e) {
        fail(e);
      }
    });

  program
    .command("delete <name>")
    .alias("rm")
    .description("delete a workspace directory recursively, or unregister a project (removes only the symlink)")
    .addOption(rootOption())
    .option("-f, --force", "delete without confirmation")
    .action(async (name: string, opts) => {
      try {
        await deleteAction(name, opts);
      } catch (e) {
        fail(e);
      }
    });

  return program;
}

// True only when this module is the entry point (e.g. `bin/ccws`, `bun src/cli.ts`,
// or the compiled binary). Comparing the resolved real paths avoids false
// positives from symlinks, cwd-relative argv, or a bare "cli.ts" substring.
//
// In a `bun build --compile` binary, argv[1] and import.meta.url both point at
// a virtual bunfs path (e.g. "/$bunfs/root/cli") that does not exist on disk,
// so realpathSync throws. When that happens we fall back to a direct string
// comparison — the virtual path is stable for a given entry, so equality there
// reliably indicates "this module is the binary's entry point".
const isMain = (): boolean => {
  const entry = process.argv[1];
  if (!entry) return false;
  const metaPath = new URL(import.meta.url).pathname;
  try {
    const a = realpathSync(entry);
    const b = realpathSync(metaPath);
    return a === b;
  } catch {
    // realpath failed — virtual (compiled) or otherwise. Compare raw paths so
    // the compiled binary still parses argv.
    return entry === metaPath;
  }
};

if (isMain()) {
  buildCli()
    .parseAsync(process.argv)
    .catch((e) => fail(e));
}
