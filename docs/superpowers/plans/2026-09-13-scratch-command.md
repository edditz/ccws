# `ccws scratch` — Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax. All tasks are
> complete as of 2026-09-13. The feature first shipped with a 7-day retention
> + auto-GC + `scratch clean` lifecycle; the user then converged it to true
> use-and-discard (delete on exit, no retention machinery), and the plan below
> reflects the final shape.

**Goal:** Make ccws a launcher for use-and-discard sessions: `ccws scratch`
creates a throwaway scratch workspace under `$ROOT`, launches claude in it
(default mode `bypassPermissions`), and deletes the workspace the moment
claude exits — nothing survives the session.

**Architecture:** A scratch is a regular `$ROOT/<name>` workspace carrying a
`ccws.kind = "scratch"` marker in its settings.json (the only thing that makes
it a scratch — the random name carries no meaning). All existing machinery
(`resolveEntry`, launch chain, cwd detection, mode read/write, `delete`)
works unchanged. New `src/core/scratch.ts` owns naming/creation/marker reads
and the `requireNonScratchWorkspace` guard. New `src/commands/scratch.ts` is
a single `scratchAction`: create → resolveLaunchTarget → runClaudeSession
(exit hint replaced by a discard notice, since resume is dead once the
workspace is gone) wrapped in try/finally that rmSync's the workspace on
every exit path, including launch failures.

**Tech Stack:** TypeScript (strict), commander v15, vitest v4. No new dependencies.

## Global Constraints

- Layering: scratch logic in `src/core/` (pure, no terminal I/O); commands
  only orchestrate + log via `utils/log.ts`; failures `throw` only.
- Discard removes only `$ROOT/<name>` — never `~/.claude/projects` transcripts.
- The `ccws` settings.json field is a published contract: every writer keeps
  preserving unknown fields.
- Marker is the only scratch test; malformed markers degrade to regular
  workspace (delete keeps its confirmation). Extra fields inside the marker
  (legacy createdAt) are tolerated.
- Coverage thresholds 80% on all four dimensions.

## Tasks (all completed)

- [x] **Task 1 — marker plumbing.** `types.ts`: `ScratchMeta {kind:"scratch"}`,
  `SettingsJson.ccws?`, `Workspace.scratch?`. `core/settings.ts`:
  `parseScratchMeta` (kind-only, tolerant of extra fields). `core/config.ts`:
  `discoverWorkspaces` fills `scratch` in its existing settings read
  (corrupt → undefined).
- [x] **Task 2 — `core/scratch.ts`.** `generateScratchName`
  (1-3 random lowercase-letter words joined by "-", 4-8 letters each),
  `createScratchWorkspace`
  (conflict check `!existsSync && !isSymlink` — a plain dir is also
  resolveEntry "missing" and must not be mkdir'd into; random-suffix retries;
  skeleton + `setDefaultMode(BYPASS_MODE)` + marker; no CLAUDE.md),
  `readScratchMeta`/`isScratchWorkspace`, `requireNonScratchWorkspace`.
- [x] **Task 3 — guard wiring.** `add.ts`/`remove.ts`/`regen.ts` switch to
  `requireNonScratchWorkspace` (bypass/mode untouched); rejection tests in
  each command's test file.
- [x] **Task 4 — `commands/scratch.ts` + `cli.ts`.** `scratchAction` with the
  try/finally discard and the static exit hint; plain (non-nested)
  `scratch` command registration with `allowExcessArguments(false)`.
  Tests: launches with `--permission-mode bypassPermissions`, workspace gone
  on clean and non-zero exits, skeleton cleaned on launch failure.
- [x] **Task 5 — presentation.** `list.ts`: scratch fully hidden from the
  listing (two-way empty state), single-name static annotation. `status.ts`:
  static annotation. `delete.ts`: marker → skip confirmation, distinct
  success message (the cleanup path for orphaned scratch dirs).
- [x] **Task 6 — verification + docs.** `bunx tsc --noEmit`; full suite +
  coverage above thresholds; CLAUDE.md, README, CHANGELOG, and this spec/plan
  pair updated. (An intermediate build with retention/auto-GC/`scratch clean`
  and a `core/claude-dirs.ts` extraction was fully reverted per the final
  requirement — `utils/claude-session.ts` is byte-identical to its
  pre-feature state.)
