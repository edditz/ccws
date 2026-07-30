# Changelog

All notable changes to ccws are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.2.0] - 2026-07-30

### Added
- Workspace `CLAUDE.md` auto-maintenance: every workspace now ships a `CLAUDE.md`
  that lists its associated directories (absolute paths, with a `⚠️ missing`
  marker for any that don't currently exist) and reminds Claude Code to `cd`
  into the correct one before running shell commands.
  - Auto-synced on `init`, and after `add` / `remove` change the directory set.
  - `regen [name]` subcommand rebuilds or repairs it for existing workspaces;
    `--force` does a full reset (overwrites content outside the markers too).
  - A three-state `<!-- ccws:additional-directories:begin/end -->` marker block
    protects user-edited content outside the auto-managed list; malformed markers
    are left untouched with an error rather than risk clobbering user content.
- Core helpers in `src/core/claude-md.ts` (`claudeMdPath`, `renderDirsBlock`,
  `renderFull`, `writeClaudeMd`, `syncClaudeMd`, `forceRewriteClaudeMd`).

## [1.1.0] - 2026-07-26

### Added
- `update` command: self-update the compiled binary from GitHub Releases.
  Checks the latest release, downloads the matching platform asset, verifies
  SHA-256 against `checksums.txt`, and atomically replaces the running binary
  (Unix: temp-file + `rename`; Windows: running-`.exe` rename trick).
  - `--check`: report only; exits 1 if a newer version exists (CI/script-friendly).
  - `--force`: reinstall even when already on the latest version.
  - `--repo <owner/repo>` (or `CCWS_REPO`): override the source repo for forks;
    defaults to `edditz/ccws`.
- Pure self-update helpers in `src/core/updater.ts` (`compareVersions`,
  `platformToAsset`, `pickChecksum`, `stripLeadingV`, `isInterpreterExecPath`).
- Injectable I/O seams in `src/commands/update.ts` (`fetch`/`sha256`/
  `replaceBinary`/`execPath`/`platform`/`arch`) so all network/fs behavior is
  unit-testable with fakes (mirrors the `open` command's `runner` pattern).

### Changed
- `src/cli.ts` registers the `update` subcommand — the only subcommand without
  `-r/--root`, since it operates on the binary rather than workspaces.

## [1.0.0] - 2026-07-26

First public release.

### Added
- Workspace management CLI: `init`, `add`, `remove`, `list` (`ls`), `status`, `open`.
- Convention-root scanning (`~/.ccws/`, overridable via `--root` / `CCWS_ROOT`).
- Atomic `add` (fails without writing if any path is missing); `settings.json`
  field + key-order preservation; corrupt-JSON refusal to overwrite.
- Path-traversal guard (`validateWorkspaceName`).
- Single-file binaries via `bun build --compile`: `darwin-arm64`, `darwin-x64`,
  `linux-x64`, `linux-arm64`, `windows-x64`.
- One-line installer (`scripts/install.sh`) with SHA-256 checksum verification.
- GitHub Actions: `release.yml` (tag-triggered 5-platform build + Release),
  `deploy-pages.yml` (GitHub Pages).
- Project site at https://edditz.github.io/ccws/.
- MIT license.

[1.2.0]: https://github.com/edditz/ccws/releases/tag/v1.2.0
[1.1.0]: https://github.com/edditz/ccws/releases/tag/v1.1.0
[1.0.0]: https://github.com/edditz/ccws/releases/tag/v1.0.0
