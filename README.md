# ccws

Manage Claude Code workspaces. A workspace is an empty folder whose
`.claude/settings.json` `permissions.additionalDirectories` links multiple
external directories; opening it in Claude Code gives access to all of them.

## Install

**One-line install** (macOS / Linux / WSL — downloads the right binary from
GitHub Releases, verifies checksum, installs to `~/.local/bin`):

```bash
curl -fsSL https://raw.githubusercontent.com/<owner>/ccws/main/scripts/install.sh \
  | sh -s -- --repo <owner>/ccws
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
ccws add ~/projects/web ~/projects/api -w my-work
ccws list                              # list all workspaces
ccws list my-work                      # show my-work's directories
ccws status                            # current workspace + validity
ccws open my-work                      # launch claude in my-work
ccws remove ~/projects/web -w my-work
```

Convention root `$ROOT` defaults to `~/.ccws/`; override with `--root <path>`
or `CCWS_ROOT` env var.

## Development

```bash
bun install
bun run test           # vitest
bun run src/cli.ts <cmd>
bun run build          # current-platform binary
bun run build:all      # full platform matrix
```
