# Changelog

All notable changes to ccws are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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

[1.1.0]: https://github.com/edditz/ccws/releases/tag/v1.1.0
[1.0.0]: https://github.com/edditz/ccws/releases/tag/v1.0.0
