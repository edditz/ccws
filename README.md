# ccws

Manage Claude Code workspaces. A workspace is an empty folder whose
`.claude/settings.json` `permissions.additionalDirectories` links multiple
external directories; opening it in Claude Code gives access to all of them.

## Install

**One-line install** (macOS / Linux / WSL — downloads the right binary from
GitHub Releases, verifies checksum, installs to `~/.local/bin`):

```bash
curl -fsSL https://raw.githubusercontent.com/edditz/ccws/main/scripts/install.sh \
  | sh -s -- --repo edditz/ccws
```

Override the install dir, version, or repo with `--bin` / `--version` / `--repo`,
or the `CCWS_INSTALL_DIR` / `CCWS_VERSION` / `CCWS_REPO` env vars.

**Manual download**: grab the matching `ccws-<os>-<arch>` binary from the latest
[Release](../../releases/latest), `chmod +x`, put it on your `PATH`.

**Build from source**:

```bash
bun install
bun run build          # current-platform binary → dist/ccws
bun run build:all      # all 5 targets → dist/
```

## Usage

```bash
ccws init my-work                      # create workspace under ~/.ccws/
ccws init ~/projects/web               # or register an existing dir as a read-only project
ccws add ~/projects/web ~/projects/api -w my-work
ccws list                              # list all workspaces + projects (concise)
ccws list -l                           # also show each workspace's path + permission mode
ccws list my-work                      # show my-work's directories
ccws list my-work -l                   # also show my-work's permission mode
ccws status                            # current workspace/project + validity
ccws open my-work                      # launch claude in my-work
ccws resume my-work                    # relaunch claude, pick a past session
ccws resume my-work <session-id>       # continue that exact session
ccws remove ~/projects/web -w my-work
ccws mode auto                         # set the permission mode for the cwd entry
ccws mode my-work plan                 # or target it by name (workspaces AND projects)
ccws mode                              # show the current mode (from inside the entry)
ccws mode my-work off                  # clear the stored mode (back to claude's default)
ccws bypass on -w my-work              # shortcut: mode my-work bypassPermissions
ccws bypass off -w my-work             # shortcut: clear the mode
ccws delete my-work                    # delete the workspace (asks for confirmation)
ccws delete my-work --force            # delete without confirmation
ccws delete my-proj                    # unregister a project (removes only the symlink)
```

Convention root `$ROOT` defaults to `~/.ccws/`; override with `--root <path>`
or `CCWS_ROOT` env var.

`open` and `resume` stay attached until claude exits and propagate its exit
code. On a clean exit ccws erases claude's own `Resume this session with:`
hint and prints a copy-pastable equivalent with the session id recovered from
`~/.claude/projects/`: `resume this session: ccws resume <name> <session-id>`
(id-less when no session matches the run).

> **Security note**: `ccws mode` sets Claude Code's permission mode per entry.
> Claude Code ≥ 2.1.257 ignores `bypassPermissions`/`auto` set in a
> project-level `settings.json`, so ccws passes the stored mode to claude as
> `--permission-mode <mode>` at launch (highest precedence, works everywhere).
> Workspaces keep the mode in their own `.claude/settings.json`
> (`permissions.defaultMode`); projects store it in a sidecar under
> `$ROOT/.ccws/modes/<name>` — ccws never writes into a project's target
> directory. `bypassPermissions` skips permission confirmation prompts — only
> enable it for entries you fully trust; Claude Code still asks for
> confirmation the first time a session enters bypass mode.

## Development

```bash
bun install
bun run test           # vitest
bun run src/cli.ts <cmd>
bun run build          # current-platform binary
bun run build:all      # full platform matrix
```

## License

MIT — see [LICENSE](./LICENSE). © Eddie
