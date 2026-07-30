---
name: release
description: Cut and publish a new ccws release. Collects commits since the last v* tag, maps conventional-commit types to a semver bump suggestion (feat→minor, fix→patch, BREAKING→major), drafts a Keep a Changelog entry, and after confirmation runs the full release — bump package.json version, update CHANGELOG, commit, tag v<x.y.z>, push — which triggers the GitHub Actions that build 5-platform binaries and publish the Release + Pages. Use when the user asks to publish/release/发版/cut a new version of ccws, or invokes /release. Supports /release --dry-run to analyze and draft without changing anything.
---

# Release

Cut a new `ccws` version end-to-end: analyze commits → suggest semver bump → draft CHANGELOG → confirm → bump, commit, tag, push. Pushing the `v*` tag triggers `release.yml` (5-platform build → GitHub Release) and `deploy-pages.yml` (site). See `RELEASING.md` for build/release mechanics — don't duplicate that here.

## Preflight

- On `main`, working tree clean, in sync with `origin/main` (`git status` + `git rev-list --count origin/main..HEAD` should be 0).
- Suite green: `bun run test`. **Do not release on red.**

## Step 1 — Analyze

Run the analyzer (deterministic, read-only):

```
node .claude/skills/release/scripts/collect-commits.mjs
```

Outputs JSON: `lastTag`, `currentVersion`, `commitsSince`, `suggestedBump`, `suggestedNextVersion`, `groups` (commits by conventional type: `breaking`/`feat`/`fix`/`perf`/`refactor`/`docs`/`test`/`chore`/`ci`/`build`/`other`).

If `commitsSince === 0`: nothing to release — stop and tell the user.

## Step 2 — Draft CHANGELOG

From `groups`, write a `## [<version>] - <YYYY-MM-DD>` section in **Keep a Changelog** format, matching the existing `CHANGELOG.md` style. Map conventional types to sections:

- **Added** ← `feat`
- **Changed** ← `refactor` and other non-breaking behavior changes
- **Fixed** ← `fix` / `perf`
- **Removed** / **Security** ← only if present

Rules:
- Fold many commits into a few readable bullets — **do not** dump a 1:1 commit list. Group by feature (e.g. the 6 `feat(claude-md)`/`feat(init)`/… commits become one "Workspace CLAUDE.md auto-maintenance" bullet with sub-bullets).
- Omit purely-internal `chore`/`ci`/`build` unless user-facing.
- Append the version reference at the bottom (keep the link list newest-first, matching the file): `[<version>]: https://github.com/edditz/ccws/releases/tag/v<version>`.

## Step 3 — Present & confirm

Show the user, concisely:
- `currentVersion → suggestedNextVersion` (`suggestedBump`) + one-line rationale (e.g. "minor: 6 feat commits since v1.1.0").
- The CHANGELOG draft.
- The exact commands Step 4 will run (version, commit message `chore: release v<x.y.z>`, tag, push).

Ask for confirmation or edits. **If `--dry-run`**: stop here — change no files, commit/tag/push nothing.

## Step 4 — Execute (after confirm; skip entirely on --dry-run)

1. Bump `version` in `package.json` → `suggestedNextVersion`. (Single source of truth — never hardcode the version elsewhere.)
2. Insert the new CHANGELOG section above the previous `## [` entry, and the version link at the bottom of the link list.
3. `git add package.json CHANGELOG.md && git commit -m "chore: release v<x.y.z>"`
4. `git tag -a v<x.y.z> -m "v<x.y.z>"`
5. `git push && git push origin v<x.y.z>`  (push `main` and the tag)

## Step 5 — Report

Push triggers the workflows in CI. Report:
- Tag pushed; `release.yml` + `deploy-pages.yml` triggered.
- Release: https://github.com/edditz/ccws/releases/tag/v<x.y.z>
- Actions: https://github.com/edditz/ccws/actions

Binaries + `checksums.txt` land on the Release when `release.yml` finishes — that's async, don't claim it's published until the workflow goes green.

## Semver rules (recheck the script's suggestion)

- `BREAKING CHANGE` footer or `<type>!:` → **major**
- `feat:` → **minor**
- `fix:` / `perf:` → **patch**
- only `docs`/`test`/`chore`/`refactor` → **none** (suggest patch only if a change is actually user-facing; otherwise tell the user there may be nothing worth releasing)

Override the script when context warrants and **say why** when presenting (e.g. a `feat` that's purely internal → patch; a `fix` that changes published behavior → major; `0.x.y` stage where minor may be breaking — not currently applicable, on 1.x).

## Notes & gotchas

- Never force-push or re-tag without the user's explicit ask. If a tag push fails to trigger workflows, see `RELEASING.md` "Re-tagging" (delete + recreate the ref via the API).
- If `git push` is rejected (remote moved): stop and report — do not force-push.
- Confirm the fork point: this releases `main`. If the user is on another branch, stop and confirm.
