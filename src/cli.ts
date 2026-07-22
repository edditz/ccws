import { realpathSync } from "node:fs";
import { Command, Option } from "commander";
import { initAction } from "./commands/init.js";
import { addAction } from "./commands/add.js";
import { removeAction } from "./commands/remove.js";
import { listAction } from "./commands/list.js";
import { statusAction } from "./commands/status.js";
import { openAction } from "./commands/open.js";
import { error } from "./utils/log.js";

const rootOption = (): Option =>
  new Option("-r, --root <path>", "override convention root $ROOT");

function fail(e: unknown): never {
  error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}

export function buildCli(): Command {
  const program = new Command();
  program
    .name("ccws")
    .description("Manage Claude Code workspaces")
    .version("0.1.0");

  program
    .command("init <name>")
    .description("create a new workspace")
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
    .description("list workspaces or show one workspace's directories")
    .addOption(rootOption())
    .action(async (name: string | undefined, opts) => {
      try {
        await listAction(name ? [name] : [], opts);
      } catch (e) {
        fail(e);
      }
    });

  program
    .command("status")
    .description("show the workspace for the current directory")
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
    .description("launch claude in a workspace")
    .addOption(rootOption())
    .action(async (name: string, opts) => {
      try {
        await openAction(name, opts);
      } catch (e) {
        fail(e);
      }
    });

  return program;
}

// True only when this module is the entry point (e.g. `bin/ccws`, `bun src/cli.ts`,
// or the compiled binary). Comparing the resolved real paths avoids false
// positives from symlinks, cwd-relative argv, or a bare "cli.ts" substring.
const isMain = (): boolean => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    const a = realpathSync(entry);
    const b = realpathSync(new URL(import.meta.url).pathname);
    return a === b;
  } catch {
    return false;
  }
};

if (isMain()) {
  buildCli()
    .parseAsync(process.argv)
    .catch((e) => fail(e));
}
