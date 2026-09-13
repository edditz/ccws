# `ccws mode` — Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax. All tasks are
> complete as of 2026-09-13.

**Goal:** Generalize `ccws bypass` into `ccws mode [name] [value]` — per-workspace
AND per-project Claude Code permission modes — and make `open`/`resume` pass the
stored mode to claude as `--permission-mode <mode>` (the only reliable channel
since claude ≥ 2.1.257 ignores project-level `defaultMode: bypassPermissions` /
`auto`). `bypass` stays as a permanent shortcut with identical behavior.

**Architecture:** New `src/core/mode.ts` owns the closed mode set, write-path
validation (`parseModeValue`), and the dual-backend unified read/write
(`resolveStoredMode` / `setStoredMode` / `removeModeSidecar`): workspaces keep
`permissions.defaultMode` in their own settings.json (via the generalized
`setDefaultMode`), projects use one sidecar file per entry under
`$ROOT/.ccws/modes/<name>`. New `src/commands/mode.ts` handles the 0/1/2-positional
disambiguation (value-first) and status-style cwd resolution. `open.ts`'s
`launchCwd` becomes `resolveLaunchTarget {entry, cwd}` + `launchModeArgs`
(best-effort: corrupt settings → warn → launch without the flag).
`delete.ts` cleans the sidecar on unregister. `.ccws` becomes a reserved name.

**Tech Stack:** TypeScript (strict), commander v15, vitest v4. No new dependencies.

## Global Constraints

- Layering: mode logic in `src/core/` (pure, no terminal I/O); commands only
  orchestrate + log via `utils/log.ts`; failures `throw` only.
- Project targets stay read-only — the `$ROOT` sidecar is the only project-side
  storage; the read-only guarantee is enforced structurally, not by convention.
- Read path never validates the mode value (claude owns the vocabulary);
  write path validates against the closed set with a friendly error.
- Coverage thresholds 80% on all four dimensions.

## Tasks (all completed)

- [x] **Task 1 — `tests/core/settings.test.ts` (RED) then `src/core/settings.ts`
  (GREEN).** `setBypassPermissions(path, enabled)` → `setDefaultMode(path,
  mode | undefined)`; same immutable write, corrupt-JSON rejection, field
  preservation. `bypass.ts` switched to it in the same step to keep the suite
  green; `BYPASS_MODE` stays exported.
- [x] **Task 2 — `types.ts` + `core/config.ts` + mechanical `list.ts`.**
  `Workspace.bypass: boolean` → `mode?: string` (raw defaultMode); new
  `NamedEntry = Exclude<Entry, {kind:"missing"}>`; `modesStoreDir` /
  `modeSidecarPath` helpers; `discoverWorkspaces` reads mode (corrupt catch →
  undefined); `bypassLabel` → `modeLabel`. Tests: mode assertions, `.ccws/modes`
  ignored by both discovers.
- [x] **Task 3 — new `tests/core/mode.test.ts` + `src/core/mode.ts`.** 19 cases:
  parse/isModeInput membership + rejection listing values; per-kind read/write
  combos; sidecar content `mode\n`, clear removes file, clear-when-absent no-op;
  junk sidecar passthrough; non-string defaultMode → undefined; corrupt
  workspace settings throws; dangling via sidecar; overwrite; removeModeSidecar
  tolerant of absence.
- [x] **Task 4 — `.ccws` reserved name.** `validateWorkspaceName` rejects the
  literal `.ccws` (message: reserved for ccws internal state); ordinary
  dot-prefixed names still allowed. Tests in core/workspace + commands/project
  (`init <dir named .ccws>` refuses, no symlink created).
- [x] **Task 5 — new `tests/commands/mode.test.ts` + `src/commands/mode.ts` +
  `cli.ts` registration.** Value-first single-positional; 2-arg escape hatch for
  keyword-named entries; cwd seam (`ModeOptions {root?, cwd?}`); getter strings
  (`mode: plan for "demo"`, dangling `  (target missing)`); guidance errors.
  `cli.test.ts` gains `mode` in both name loops, `registeredArguments`
  `[["name",false],["value",false]]`, and a parseAsync wiring test.
- [x] **Task 6 — `open.ts`/`resume.ts` flag injection.** `resolveLaunchTarget`
  (same two guided throws, verbatim) + `launchModeArgs` best-effort read
  (corrupt → stderr warn `could not read the permission mode ...` → no flag).
  Recording-runner tests assert exact args: `[]` when unset;
  `["--permission-mode","acceptEdits"]` for a workspace;
  flag + `cwd === target` for a project sidecar;
  `["--permission-mode","plan","--resume","abc-123"]` for resume.
- [x] **Task 7 — `delete.ts` sidecar cleanup.** Project/dangling branch calls
  `removeModeSidecar` after `unlinkSync`. Tests: with sidecar (both removed,
  target untouched), without sidecar, dangling.
- [x] **Task 8 — display.** `list.ts` project rows append `mode: <value>` only
  when set (grouped + single-name views); `status.ts` prints one mode line for
  workspaces and healthy projects (dangling skipped). Updated `bypass:`/`mode:`
  assertions.
- [x] **Task 9 — bypass as shortcut.** Already routed through `setDefaultMode`
  in Task 1; cli description notes it is a shortcut for
  `ccws mode bypassPermissions`. Existing bypass/project read-only tests pass
  unchanged.
- [x] **Task 10 — gates.** `bunx tsc --noEmit` clean; 329 tests green;
  coverage 92.15 / 89.74 / 88.14 / 92.39 (≥80 all dimensions). Manual E2E:
  workspace set/get/list/clear, project sidecar with byte-identical target,
  status-from-target, delete cleanup, bypass ↔ mode interop, invalid-value
  error + exit 1.
- [x] **Task 11 — docs.** README usage + security note rewrite; CLAUDE.md
  command list / architecture / conventions (sidecar store, reserved name,
  closed mode set, `--permission-mode` external contract); CHANGELOG
  `[Unreleased]`; this spec + plan pair.
