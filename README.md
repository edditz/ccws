# ccws

Manage Claude Code workspaces. A workspace is an empty folder whose
`.claude/settings.json` `permissions.additionalDirectories` links multiple
external directories; opening it in Claude Code gives access to all of them.

## Install (single-file binary)

Download the matching binary from `dist/` (or build: `bun run build:all`).

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
