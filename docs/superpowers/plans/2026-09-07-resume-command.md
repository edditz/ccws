# `ccws resume` + Clean-Exit Hint Suppression — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `ccws resume <name> [session-id]` subcommand mirroring claude's native resume semantics (`--resume <id>` / `--resume` picker), and make both `open` and `resume` stay attached until claude exits: propagate its exit code, and on a clean exit erase claude's own `Resume this session with:` hint (ANSI cursor-up + erase) and print `resume this session: ccws resume <name>` instead.

**Architecture:** The shared spawn/wait/suppress logic lives in `src/utils/claude-session.ts` (terminal I/O, same layer as `log.ts` — NOT `core/`). `Runner` + `defaultRunner` move there from `open.ts` (re-exported for back-compat). `runClaudeSession({ cwd, args, runner?, exitHint?, isTTY? })` awaits the child (`once("exit")`, defensive `once("error")`), ignores SIGINT while waiting, and on code 0 + `exitHint` writes `\x1b[3A\r\x1b[J` then `log.info(hint)`; non-zero/signal exits only set `process.exitCode`. `open.ts` and the new `resume.ts` become thin orchestration over it; `src/cli.ts` registers `resume <name> [session-id]` after `open`.

**Tech Stack:** TypeScript (strict), commander v15, vitest v4, node:child_process. No new dependencies.

## Global Constraints

- Layering: spawn/ANSI/SIGINT stay in `src/utils/`; commands keep zero try/catch for spawn failures (the util converts the sync throw to the friendly "not found in PATH" error).
- Output discipline: all terminal output via `src/utils/log.ts`; failures `throw` only (`fail()` prints).
- `defaultRunner` is never unit-tested (same as before); test runners return fake `EventEmitter` children that emit `exit` on a microtask.
- Save/restore `process.exitCode` in tests (`@types/node` types it `string | number | null | undefined`).
- Coverage thresholds 80% on all four dimensions.

## Tasks (all completed)

- [x] **Task 1 — `tests/utils/claude-session.test.ts` (RED) then `src/utils/claude-session.ts` (GREEN).** 11 cases: args/cwd passthrough via injected runner; void-runner immediate resolve; pending until `exit`; exact erase sequence `\x1b[3A\r\x1b[J` before the `• ` hint; no ANSI when `isTTY: false`; no output and untouched `process.exitCode` on code 0 without `exitHint`; code 3 → `exitCode = 3`, no hint; null code (signal) → `exitCode = 1`; error-only child resolves (no hang) with `exitCode = 1`; SIGINT listener count +1 during wait and restored after; sync-throwing runner → `/not found in PATH/`. Exports: `Runner`, `defaultRunner`, `CLAUDE_EXIT_HINT_LINES = 3`, `RunClaudeSessionOptions`, `runClaudeSession`.
- [x] **Task 2 — `tests/commands/open.test.ts` (RED) then slim `open.ts` (GREEN).** New cases: hint printed on clean exit; non-zero exit propagated with no hint. Rewrote the old `{ on: () => {} }` fake-child case as a real EventEmitter emitting `exit 0` (the old fake would hang once `openAction` awaits). `open.ts` keeps only the workspace guard plus `runClaudeSession({ cwd, runner, exitHint: "resume this session: ccws resume <name>" })` and `export type { Runner }`.
- [x] **Task 3 — `tests/commands/resume.test.ts` (RED) then `src/commands/resume.ts` (GREEN).** Cases: `["--resume"]` without id; `["--resume", "abc-123"]` with id; correct cwd; missing-workspace throw; sync spawn throw; hint includes name (and id when given); non-zero propagation without hint.
- [x] **Task 4 — `src/cli.ts` registration + `tests/cli.test.ts`.** `resume <name> [session-id]` inserted after `open` with `rootOption()`; test loops for command names and the `--root` invariant gain `"resume"`; new assertion on `registeredArguments` (`name` required, `session-id` optional).
- [x] **Task 5 — Gates + calibration.** `bunx tsc --noEmit` clean; full suite green (222 tests); coverage 89.6/87.4/84.8/89.9 (only `defaultRunner` uncovered, as before). Exit-line count calibrated against real claude 2.1.231 via a pty probe: after the alternate-screen restore claude prints blank + hint + command (3 rows, cursor on the 4th) → `CLAUDE_EXIT_HINT_LINES = 3` is exact. Note: an idle session (zero user messages) prints no hint at all; child-session env markers (`CLAUDE_CODE_CHILD_SESSION` etc.) suppress transcript + hint.
- [x] **Task 6 — Docs.** README usage lines + attachment note; CHANGELOG `[Unreleased]` (Added: resume; Changed: attached wait, exit-code propagation, hint suppression); CLAUDE.md command list / utils-layer / test-convention updates; this spec + plan pair.
