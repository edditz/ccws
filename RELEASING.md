# Releasing ccws

How ccws is built, published, and installed. Read this before touching
`.github/workflows/`, `scripts/install.sh`, or cutting a release.

## Overview

Two GitHub Actions workflows, both triggered by pushing a `v*` tag:

| Workflow | Produces | Lives at |
|---|---|---|
| `release.yml` | GitHub Release: 5 single-file binaries + `checksums.txt` | https://github.com/edditz/ccws/releases |
| `deploy-pages.yml` | The project site | https://edditz.github.io/ccws/ |

`scripts/install.sh` downloads the right binary from the Release.

## Cutting a release

1. Bump `version` in `package.json` (the single source of truth — `cli.ts` and
   the tests read it via import attributes; never hardcode a version string).
2. Commit on `main`.
3. `git tag -a v<x.y.z> -m "v<x.y.z>" && git push origin v<x.y.z>`.
4. Both workflows run. When `release` finishes, the Release is published.

Re-tagging the same name (e.g. to fix a workflow): delete and recreate the ref
with the API — this re-triggers the workflows without a `git push`:

```bash
gh api --method DELETE repos/edditz/ccws/git/refs/tags/v<x.y.z>
gh api --method POST repos/edditz/ccws/git/refs \
  -f ref=refs/tags/v<x.y.z> -f sha="$(gh api repos/edditz/ccws/commits/main --jq .sha)"
```

## release.yml

- **Trigger**: push tag `v*` (also `workflow_dispatch`, but the publish step is
  gated on a tag, so dispatch only builds — useful for testing the matrix).
- **Matrix** — 5 targets, each built with an explicit `--target`:
  - `darwin-arm64`, `linux-x64`, `linux-arm64`, `windows-x64` → native
    (host arch == target).
  - **`darwin-x64` → cross-compiled on `macos-14`** (`--target=bun-darwin-x64`).
    `macos-13` (Intel) runners are scarce on the free tier and sat queued 40+
    minutes; Apple-Silicon runners are plentiful.
- **`can-run` gate on the smoke test**: the cross-compiled `darwin-x64` binary
  SIGILLs under Rosetta on the arm64 build host, so it is built and uploaded
  but **not executed** (`can-run: false`). It runs fine on real Intel Macs.
- **`bun install` runs before `bun build`** — easy to forget; a fresh runner
  has no `node_modules` and `bun build` can't resolve `commander`.
- **Publish job**: downloads all 5 build artifacts, writes `checksums.txt`
  (`sha256sum`), uploads everything to the Release via
  `softprops/action-gh-release`.

## deploy-pages.yml

- **Trigger**: push tag `v*`, or `workflow_dispatch` (to redeploy `main`
  without a new tag — useful for site-only fixes).
- **Version injection**: the site's `index.html` carries the placeholder
  `__VERSION__`. The workflow resolves the version (tag name on a tag push,
  `package.json` version on dispatch) and `sed`-substitutes it into the page
  at build time. The placeholder receives the **full** string including the
  `v` prefix — do **not** add another `v` in the HTML (that produced
  `vv1.0.0`).
- Pages source is `GitHub Actions` (`build_type: workflow`); the workflow
  uploads `site/` and deploys via `actions/deploy-pages`.

## GitHub Pages environment (gotcha)

The `github-pages` environment has a deployment-branch policy. By default it
only lists `main` (branch), which **rejects tag deployments**:

> "Tag v1.0.0 is not allowed to deploy to github-pages due to environment
> protection rules."

A `tag: v*` policy must be added (one-time):

```bash
gh api --method POST repos/edditz/ccws/environments/github-pages/deployment-branch-policies \
  -f name='v*' -f type='tag'
```

Current policies: `branch: main`, `tag: v*`.

## scripts/install.sh

- Detects os/arch via `uname` → asset name `ccws-<os>-<arch>`.
- Downloads from `https://github.com/<repo>/releases/download/<tag>/<asset>`.
- Verifies SHA-256 against `checksums.txt` (falls back to `shasum` on macOS;
  silent skip if checksums are unavailable).
- Installs to `~/.local/bin` (override `--bin` / `CCWS_INSTALL_DIR`).
- `--repo` (or `CCWS_REPO`) is required — the script holds no hardcoded owner.

### Platform → asset map

| `uname -s` / `uname -m` | asset |
|---|---|
| Darwin / arm64 | `ccws-darwin-arm64` |
| Darwin / x86_64 | `ccws-darwin-x64` |
| Linux / x86_64 | `ccws-linux-x64` |
| Linux / aarch64 | `ccws-linux-arm64` |
| MINGW* / x86_64 | `ccws-windows-x64.exe` |

## Lessons from the v1.0.0 release

Four things broke on the way to the first Release; each is now encoded in the
workflow above so they shouldn't recur:

1. **Missing `bun install`** → every platform failed to resolve `commander`.
2. **`macos-13` runner scarcity** → `darwin-x64` queued 40+ min; switched to
   cross-compile on `macos-14`.
3. **Rosetta SIGILL** → the x64 smoke test crashed on arm64; added the
   `can-run` gate.
4. **Double `v` (`vv1.0.0`)** → HTML added a `v` prefix on top of the tag name
   the workflow already injects; removed the HTML-side prefix.

## `ccws update` (self-update)

Shipped in v1.1.0. `ccws update` queries
`https://api.github.com/repos/edditz/ccws/releases/latest`, compares the tag to
`package.json`'s version, and on update downloads the platform asset +
`checksums.txt`, verifies SHA-256, and atomically replaces the running binary.
Default repo is `edditz/ccws`; `CCWS_REPO` / `--repo` overrides (for forks).

**`process.execPath` under `bun build --compile`** resolves to the real binary
on disk (e.g. `/private/tmp/ccws`), NOT the virtual `$bunfs` path that
`process.argv[1]` / `import.meta.url` point at (see the `isMain()` comment in
`src/cli.ts`). `update` relies on this to locate the binary to replace, and it
was verified for v1.1.0 with a compiled probe. If a future Bun release changes
this, the fallback is `realpathSync(process.argv[0])` in `defaultDeps()`
(`src/commands/update.ts`).
