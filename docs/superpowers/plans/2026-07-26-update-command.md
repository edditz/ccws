# `ccws update` Self-Update Command — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `ccws update` subcommand that self-updates the compiled binary from GitHub Releases (check → download matching asset → verify SHA-256 → atomically replace the running binary), with a `--check` mode for scripts/CI.

**Architecture:** Pure version/asset/checksum helpers live in `src/core/updater.ts` (no I/O). The command `src/commands/update.ts` composes them with **injectable seams** (`fetch`, `sha256`, `replaceBinary`, `execPath`, `platform`, `arch`) — mirroring the `open` command's `opts.runner` injection pattern — so all network/fs behavior is unit-testable with fake deps. `src/cli.ts` registers the subcommand and propagates a non-zero exit code for `--check`. The real network download and on-disk replace are the only untested paths (same principle as `open`'s `defaultRunner`).

**Tech Stack:** TypeScript (strict, `"types": ["node"]`), commander v15, vitest v4, node:crypto, node:fs/promises. Global `fetch` (Bun runtime + @types/node undici globals). No new dependencies.

## Global Constraints

- **Version source of truth:** current version is `pkg.version` from `package.json`, read via `import pkg from "../../package.json" with { type: "json" }` (the file is at `src/commands/`, so `../../`). Never hardcode a version string.
- **Layering:** `src/core/updater.ts` is pure — no `process.*`, no fs, no network. All I/O stays in `src/commands/update.ts` behind injectable seams.
- **Output discipline:** all terminal output goes through `src/utils/log.ts` (`info`/`success`→stdout, `error`/`warn`→stderr). No `console.log`. Command failures `throw` only — `cli.ts`'s `fail()` prints them (no double logging).
- **Immutability:** never mutate arguments; construct new objects.
- **Atomic failure:** a checksum mismatch or any post-download error must not replace the target file (same philosophy as `add`'s `assertAllExist`).
- **Test conventions:** `mkdtempSync(tmpdir())` for temp dirs; spy on `process.stdout.write`/`process.stderr.write` to assert log output; inject fake deps (see `tests/commands/open.test.ts` for the runner-injection precedent). Coverage threshold is 80% on all four dimensions (global, across `src/**/*.ts`).
- **TypeStrict caveat:** `tsconfig` has `"types": ["node"]`. Use `typeof globalThis.fetch` for the fetch seam type and `Record<string, string>` for the headers helper — do not reference `HeadersInit`.
- **Supported platforms:** `darwin/arm64`, `darwin/x64`, `linux/x64`, `linux/arm64`, `win32/x64` (mirrors `scripts/install.sh`).

---

## File Structure

- **Create** `src/core/updater.ts` — pure helpers: `stripLeadingV`, `compareVersions`, `platformToAsset`, `pickChecksum`, `isInterpreterExecPath`.
- **Create** `tests/core/updater.test.ts` — unit tests for all five helpers.
- **Create** `src/commands/update.ts` — `UpdateOptions`, `UpdateDeps`, `UpdateResult` types; `defaultSha256`, `replaceBinaryFor`, `defaultDeps`; `updateAction`.
- **Create** `tests/commands/update.test.ts` — injection-based tests for decision/check/install/error paths + default-helper unit tests.
- **Modify** `src/cli.ts` — import `updateAction`, register the `update` subcommand, propagate `exitCode`.
- **Modify** `tests/cli.test.ts` — add `update` to the subcommand list, restrict the `--root` invariant to workspace commands, add a flag-registration test.
- **Modify** `CLAUDE.md` — add `update` to the CLI subcommand list.

---

## Task 1: Pure updater helpers (`src/core/updater.ts`)

**Files:**
- Create: `src/core/updater.ts`
- Test: `tests/core/updater.test.ts`

**Interfaces:**
- Produces: `stripLeadingV(tag: string): string`, `compareVersions(a: string, b: string): -1 | 0 | 1`, `platformToAsset(platform: string, arch: string): string`, `pickChecksum(checksumsText: string, asset: string): string | null`, `isInterpreterExecPath(execPath: string): boolean`. Task 2 consumes all five.

- [ ] **Step 1: Write the failing test**

Create `tests/core/updater.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  stripLeadingV,
  compareVersions,
  platformToAsset,
  pickChecksum,
  isInterpreterExecPath,
} from "../../src/core/updater.js";

describe("stripLeadingV", () => {
  it("strips a single leading v", () => {
    expect(stripLeadingV("v1.2.3")).toBe("1.2.3");
    expect(stripLeadingV("1.2.3")).toBe("1.2.3");
  });
  it("strips only one v prefix", () => {
    expect(stripLeadingV("vv1.0.0")).toBe("v1.0.0");
  });
});

describe("compareVersions", () => {
  it("returns 0 for equal versions", () => {
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });
  it("returns 1 when a > b at major, minor, or patch", () => {
    expect(compareVersions("2.0.0", "1.0.0")).toBe(1);
    expect(compareVersions("1.2.0", "1.1.0")).toBe(1);
    expect(compareVersions("1.0.1", "1.0.0")).toBe(1);
  });
  it("returns -1 when a < b", () => {
    expect(compareVersions("1.0.0", "2.0.0")).toBe(-1);
    expect(compareVersions("1.1.0", "1.2.0")).toBe(-1);
  });
  it("treats missing components as 0", () => {
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
    expect(compareVersions("1", "1.0.0")).toBe(0);
  });
  it("ignores pre-release suffixes", () => {
    expect(compareVersions("1.0.0-beta", "1.0.0")).toBe(0);
    expect(compareVersions("1.2.0-rc.1", "1.1.0")).toBe(1);
  });
  it("treats non-numeric components as 0", () => {
    expect(compareVersions("x.y.z", "0.0.0")).toBe(0);
  });
});

describe("platformToAsset", () => {
  it("maps every supported target", () => {
    expect(platformToAsset("darwin", "arm64")).toBe("ccws-darwin-arm64");
    expect(platformToAsset("darwin", "x64")).toBe("ccws-darwin-x64");
    expect(platformToAsset("linux", "x64")).toBe("ccws-linux-x64");
    expect(platformToAsset("linux", "arm64")).toBe("ccws-linux-arm64");
    expect(platformToAsset("win32", "x64")).toBe("ccws-windows-x64.exe");
  });
  it("throws on unsupported platform", () => {
    expect(() => platformToAsset("freebsd", "x64")).toThrow(/unsupported platform/i);
  });
  it("throws on unsupported arch", () => {
    expect(() => platformToAsset("darwin", "ia32")).toThrow(/unsupported arch/i);
  });
});

describe("pickChecksum", () => {
  const mkText = (hash: string, name = "ccws-darwin-arm64") =>
    `${hash}  ${name}\n${"9".repeat(64)}  ccws-linux-x64\n`;
  it("finds the matching asset hash (two-space format)", () => {
    const h = "a".repeat(64);
    expect(pickChecksum(mkText(h), "ccws-darwin-arm64")).toBe(h);
  });
  it("finds the matching asset hash (binary * format)", () => {
    const h = "b".repeat(64);
    expect(pickChecksum(`${h} *ccws-darwin-arm64\n`, "ccws-darwin-arm64")).toBe(h);
  });
  it("lowercases an uppercase hex hash", () => {
    const h = "A".repeat(64);
    expect(pickChecksum(mkText(h), "ccws-darwin-arm64")).toBe(h.toLowerCase());
  });
  it("returns null when the asset is absent", () => {
    expect(pickChecksum(mkText("c".repeat(64)), "ccws-windows-x64.exe")).toBeNull();
  });
});

describe("isInterpreterExecPath", () => {
  it("flags JS runtimes and package managers (unix and windows)", () => {
    expect(isInterpreterExecPath("/usr/local/bin/bun")).toBe(true);
    expect(isInterpreterExecPath("/usr/bin/node")).toBe(true);
    expect(isInterpreterExecPath("/foo/npm")).toBe(true);
    expect(isInterpreterExecPath("C:\\Program Files\\nodejs\\node.exe")).toBe(true);
  });
  it("does not flag the ccws binary", () => {
    expect(isInterpreterExecPath("/home/u/.local/bin/ccws")).toBe(false);
    expect(isInterpreterExecPath("C:\\Users\\u\\bin\\ccws.exe")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test tests/core/updater.test.ts`
Expected: FAIL — `Cannot find module '../../src/core/updater.js'` (or individual import errors).

- [ ] **Step 3: Implement the helpers**

Create `src/core/updater.ts`:

```typescript
// Pure helpers for the self-update (`ccws update`) command. No I/O, no network,
// no `process.*` — fully unit-testable. The command layer composes these with
// injectable fetch/fs seams (see src/commands/update.ts).

/**
 * Strip a single leading "v" from a version tag.
 * "v1.2.3" -> "1.2.3"; "1.2.3" -> "1.2.3"; "vv1.0.0" -> "v1.0.0" (one prefix only).
 */
export function stripLeadingV(tag: string): string {
  return tag.startsWith("v") ? tag.slice(1) : tag;
}

/**
 * Compare two "x.y.z" version strings. Returns -1 if a < b, 0 if equal, 1 if a > b.
 * Components compare numerically; missing or non-numeric components count as 0.
 * Any pre-release suffix (after "-") is ignored, so "1.0.0" and "1.0.0-beta" are equal.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

function parseSemver(v: string): number[] {
  const core = v.split("-")[0];
  return core.split(".").map((part) => {
    const n = Number.parseInt(part, 10);
    return Number.isNaN(n) ? 0 : n;
  });
}

const ASSET_MAP: Record<string, Record<string, string>> = {
  darwin: { arm64: "ccws-darwin-arm64", x64: "ccws-darwin-x64" },
  linux: { x64: "ccws-linux-x64", arm64: "ccws-linux-arm64" },
  win32: { x64: "ccws-windows-x64.exe" },
};

/**
 * Map a (platform, arch) pair — as reported by process.platform/process.arch —
 * to the matching Release asset name. Throws on unsupported combinations.
 * Mirrors the table in scripts/install.sh.
 */
export function platformToAsset(platform: string, arch: string): string {
  const archMap = ASSET_MAP[platform];
  if (!archMap) {
    throw new Error(`unsupported platform "${platform}"; supported: darwin, linux, win32`);
  }
  const asset = archMap[arch];
  if (!asset) {
    throw new Error(
      `unsupported arch "${arch}" for ${platform}; supported: ${Object.keys(archMap).join("/")}`,
    );
  }
  return asset;
}

/**
 * From a sha256sum-format file (lines like "<hex>  <name>" or "<hex> *<name>"),
 * return the lowercase sha256 hex for the given asset, or null if absent.
 */
export function pickChecksum(checksumsText: string, asset: string): string | null {
  for (const line of checksumsText.split(/\r?\n/)) {
    const m = line.match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
    if (m && m[2].trim() === asset) {
      return m[1].toLowerCase();
    }
  }
  return null;
}

const INTERPRETER_STEMS = new Set(["bun", "bunx", "node", "npm", "npx", "yarn", "pnpm", "deno"]);

/**
 * True if execPath looks like a JS runtime / package manager (bun, node, npm, ...)
 * rather than the compiled ccws binary. Used by `update` to refuse clobbering the
 * interpreter when ccws is run from source or via bun/npm.
 */
export function isInterpreterExecPath(execPath: string): boolean {
  const base = execPath.split(/[\\/]/).pop() ?? "";
  const stem = base.replace(/\.exe$/i, "");
  return INTERPRETER_STEMS.has(stem);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test tests/core/updater.test.ts`
Expected: PASS — all describe blocks green.

- [ ] **Step 5: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/core/updater.ts tests/core/updater.test.ts
git commit -m "feat(core): add updater helpers (version/asset/checksum)"
```

---

## Task 2: The `update` command (`src/commands/update.ts`)

**Files:**
- Create: `src/commands/update.ts`
- Test: `tests/commands/update.test.ts`

**Interfaces:**
- Consumes (from Task 1): `compareVersions(latest, current): -1|0|1` (`>0` means latest is newer), `stripLeadingV(tag): string`, `platformToAsset(platform, arch): string`, `pickChecksum(checksumsText, asset): string | null`, `isInterpreterExecPath(execPath): boolean`. Consumes `pkg.version` via `import pkg from "../../package.json" with { type: "json" }`. Consumes `log` from `../utils/log.js`.
- Produces: `updateAction(opts: UpdateOptions, deps?: UpdateDeps): Promise<UpdateResult>` where `UpdateResult = { exitCode: number }`. Also exports `UpdateOptions`, `UpdateDeps`, `defaultDeps`, `defaultSha256`, `replaceBinaryFor`. Task 3 imports `updateAction` and `UpdateOptions`.

**`UpdateOptions`** (Task 3 sets these from commander flags):
```typescript
interface UpdateOptions {
  check?: boolean;   // report only; exit 1 if newer
  force?: boolean;   // reinstall even on latest
  repo?: string;     // owner/name override
  env?: NodeJS.ProcessEnv; // @internal test hook
}
```

**`UpdateDeps`** (injection seams; default from live process):
```typescript
interface UpdateDeps {
  fetch: typeof globalThis.fetch;
  sha256: (bytes: Uint8Array) => string;
  replaceBinary: (target: string, bytes: Uint8Array) => Promise<void>;
  execPath: string;
  platform: string;
  arch: string;
}
```

**Repo resolution:** `opts.repo ?? env.CCWS_REPO ?? "edditz/ccws"`.

**Decision logic:** fetch `releases/latest` → `tag_name` → `stripLeadingV` → `latest`; `newer = compareVersions(latest, current) > 0`. Then: `--check` → exit 1 if newer else 0 (no install); else if `!newer && !force` → "up to date", exit 0; else install path (guard interpreter → resolve asset → download asset + checksums.txt → verify → replace).

- [ ] **Step 1: Write the failing test**

Create `tests/commands/update.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  updateAction,
  defaultDeps,
  defaultSha256,
  replaceBinaryFor,
  type UpdateDeps,
} from "../../src/commands/update.js";

const jsonRes = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const bytesRes = (status: number, bytes: Uint8Array) => new Response(bytes as BodyInit, { status });
const textRes = (status: number, text: string) => new Response(text, { status });

interface MakeArgs {
  tag: string;
  bytes?: Uint8Array;
  checksumOverride?: string; // put this hash in checksums.txt instead of the real one
  omitChecksum?: boolean;    // checksums.txt has no line for the asset
  assetName?: string;
  platform?: string;
  arch?: string;
  execPath?: string;
  apiStatus?: number;        // explicit status for /releases/latest
  assetStatus?: number;      // explicit status for the asset download
  checksumsStatus?: number;  // explicit status for checksums.txt
}

function makeDeps(args: MakeArgs) {
  const asset = args.assetName ?? "ccws-darwin-arm64";
  const bytes = args.bytes ?? new Uint8Array([1, 2, 3, 4]);
  const realHash = defaultSha256(bytes);
  const checksums = args.omitChecksum
    ? `${"9".repeat(64)}  ccws-linux-x64\n`
    : `${args.checksumOverride ?? realHash}  ${asset}\n${"9".repeat(64)}  ccws-linux-x64\n`;
  const replaceCalls: { target: string; bytes: Uint8Array }[] = [];
  const visited: string[] = [];
  const deps: UpdateDeps = {
    fetch: (async (url: string | URL | Request) => {
      const u = String(url);
      visited.push(u);
      if (u.includes("/releases/latest")) {
        const status = args.apiStatus ?? 200;
        const body = args.apiStatus === undefined ? { tag_name: args.tag } : {};
        return jsonRes(status, body);
      }
      if (u.includes("/releases/download/") && u.endsWith(`/${asset}`)) {
        return bytesRes(args.assetStatus ?? 200, bytes);
      }
      if (u.endsWith("/checksums.txt")) {
        return textRes(args.checksumsStatus ?? 200, checksums);
      }
      return jsonRes(404, {});
    }) as UpdateDeps["fetch"],
    sha256: defaultSha256,
    replaceBinary: async (target, b) => {
      replaceCalls.push({ target, bytes: b });
    },
    execPath: args.execPath ?? "/home/u/.local/bin/ccws",
    platform: args.platform ?? "darwin",
    arch: args.arch ?? "arm64",
  };
  return { deps, replaceCalls, visited, bytes };
}

function captureStdout() {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((c) => {
    chunks.push(String(c));
    return true;
  });
  return { text: () => chunks.join(""), restore: () => spy.mockRestore() };
}

describe("updateAction — decision & check", () => {
  it("--check: newer → exitCode 1, no replace, announces versions", async () => {
    const { deps, replaceCalls } = makeDeps({ tag: "v1.2.0" });
    const out = captureStdout();
    const res = await updateAction({ check: true, env: {} }, deps);
    out.restore();
    expect(res.exitCode).toBe(1);
    expect(replaceCalls).toHaveLength(0);
    expect(out.text()).toMatch(/update available.*1\.0\.0.*1\.2\.0/i);
  });

  it("--check: up-to-date → exitCode 0", async () => {
    const { deps } = makeDeps({ tag: "v1.0.0" });
    const out = captureStdout();
    const res = await updateAction({ check: true, env: {} }, deps);
    out.restore();
    expect(res.exitCode).toBe(0);
    expect(out.text()).toMatch(/up to date/i);
  });

  it("up-to-date, no force → exitCode 0, no replace", async () => {
    const { deps, replaceCalls } = makeDeps({ tag: "v1.0.0" });
    const res = await updateAction({ env: {} }, deps);
    expect(res.exitCode).toBe(0);
    expect(replaceCalls).toHaveLength(0);
  });
});

describe("updateAction — install", () => {
  it("newer → downloads, verifies, replaces, exitCode 0", async () => {
    const { deps, replaceCalls, bytes } = makeDeps({ tag: "v1.2.0" });
    const out = captureStdout();
    const res = await updateAction({ env: {} }, deps);
    out.restore();
    expect(res.exitCode).toBe(0);
    expect(replaceCalls).toHaveLength(1);
    expect(replaceCalls[0].bytes).toStrictEqual(bytes);
    expect(out.text()).toMatch(/updated ccws/i);
  });

  it("--force on same version → reinstalls", async () => {
    const { deps, replaceCalls } = makeDeps({ tag: "v1.0.0" });
    const res = await updateAction({ force: true, env: {} }, deps);
    expect(res.exitCode).toBe(0);
    expect(replaceCalls).toHaveLength(1);
  });

  it("checksum mismatch → throws, no replace", async () => {
    const { deps, replaceCalls } = makeDeps({ tag: "v1.2.0", checksumOverride: "0".repeat(64) });
    await expect(updateAction({ env: {} }, deps)).rejects.toThrow(/checksum mismatch|aborted/i);
    expect(replaceCalls).toHaveLength(0);
  });

  it("missing checksum entry → throws, no replace", async () => {
    const { deps, replaceCalls } = makeDeps({ tag: "v1.2.0", omitChecksum: true });
    await expect(updateAction({ env: {} }, deps)).rejects.toThrow(/no checksum.*aborted/i);
    expect(replaceCalls).toHaveLength(0);
  });

  it("interpreter execPath → throws, no replace", async () => {
    const { deps, replaceCalls } = makeDeps({ tag: "v1.2.0", execPath: "/usr/local/bin/bun" });
    await expect(updateAction({ env: {} }, deps)).rejects.toThrow(/JS runtime|install.*compiled/i);
    expect(replaceCalls).toHaveLength(0);
  });

  it("unsupported platform → throws", async () => {
    const { deps } = makeDeps({ tag: "v1.2.0", platform: "freebsd" });
    await expect(updateAction({ env: {} }, deps)).rejects.toThrow(/unsupported platform/i);
  });

  it("asset download failure → throws", async () => {
    const { deps } = makeDeps({ tag: "v1.2.0", assetStatus: 404 });
    await expect(updateAction({ env: {} }, deps)).rejects.toThrow(/failed to download/i);
  });

  it("checksums download failure → throws", async () => {
    const { deps } = makeDeps({ tag: "v1.2.0", checksumsStatus: 404 });
    await expect(updateAction({ env: {} }, deps)).rejects.toThrow(/checksums\.txt/i);
  });

  it("EACCES from replaceBinary → friendly sudo guidance", async () => {
    const { deps } = makeDeps({ tag: "v1.2.0" });
    deps.replaceBinary = async () => {
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    };
    await expect(updateAction({ env: {} }, deps)).rejects.toThrow(/permission denied|sudo/i);
  });
});

describe("updateAction — repo resolution", () => {
  it("uses --repo when provided", async () => {
    const { deps, visited } = makeDeps({ tag: "v1.0.0" });
    await updateAction({ repo: "fork/ccws", env: {} }, deps);
    expect(visited.some((u) => u.includes("fork/ccws/releases/latest"))).toBe(true);
  });
  it("falls back to CCWS_REPO env", async () => {
    const { deps, visited } = makeDeps({ tag: "v1.0.0" });
    await updateAction({ env: { CCWS_REPO: "envr/ccws" } }, deps);
    expect(visited.some((u) => u.includes("envr/ccws/releases/latest"))).toBe(true);
  });
  it("defaults to edditz/ccws", async () => {
    const { deps, visited } = makeDeps({ tag: "v1.0.0" });
    await updateAction({ env: {} }, deps);
    expect(visited.some((u) => u.includes("edditz/ccws/releases/latest"))).toBe(true);
  });
  it("--repo beats CCWS_REPO", async () => {
    const { deps, visited } = makeDeps({ tag: "v1.0.0" });
    await updateAction({ repo: "cli/repo", env: { CCWS_REPO: "env/repo" } }, deps);
    expect(visited.some((u) => u.includes("cli/repo/releases/latest"))).toBe(true);
  });
});

describe("updateAction — API errors", () => {
  it("403 → rate-limit message", async () => {
    const { deps } = makeDeps({ tag: "v1.0.0", apiStatus: 403 });
    await expect(updateAction({ env: {} }, deps)).rejects.toThrow(/rate limit/i);
  });
  it("500 → generic fetch-failure message", async () => {
    const { deps } = makeDeps({ tag: "v1.0.0", apiStatus: 500 });
    await expect(updateAction({ env: {} }, deps)).rejects.toThrow(/failed to fetch latest release/i);
  });
  it("missing tag_name → throws", async () => {
    const base = makeDeps({ tag: "v1.0.0" });
    const deps: UpdateDeps = {
      ...base.deps,
      fetch: (async () => jsonRes(200, { assets: [] })) as UpdateDeps["fetch"],
    };
    await expect(updateAction({ env: {} }, deps)).rejects.toThrow(/no tag_name/i);
  });
});

describe("default helpers", () => {
  it("defaultSha256 matches known vector (sha256 of 'abc')", () => {
    expect(defaultSha256(new Uint8Array([97, 98, 99]))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("defaultDeps exposes the expected seams", () => {
    const d = defaultDeps();
    expect(typeof d.fetch).toBe("function");
    expect(typeof d.sha256).toBe("function");
    expect(typeof d.replaceBinary).toBe("function");
    expect(typeof d.execPath).toBe("string");
    expect(typeof d.platform).toBe("string");
    expect(typeof d.arch).toBe("string");
  });

  it("replaceBinaryFor (unix): atomically replaces content and sets the exec bit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ccws-repl-"));
    const target = join(dir, "ccws");
    writeFileSync(target, "old");
    const bytes = new Uint8Array([10, 20, 30]);
    await replaceBinaryFor("linux", target, bytes);
    expect(Array.from(readFileSync(target))).toEqual([10, 20, 30]);
    expect(statSync(target).mode & 0o111).not.toBe(0);
    expect(existsSync(join(dir, `.ccws-update.${process.pid}.tmp`))).toBe(false);
  });

  it("replaceBinaryFor (win32): renames old, writes new, cleans up .old", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ccws-repl-win-"));
    const target = join(dir, "ccws.exe");
    writeFileSync(target, "old");
    const bytes = new Uint8Array([40, 50]);
    await replaceBinaryFor("win32", target, bytes);
    expect(Array.from(readFileSync(target))).toEqual([40, 50]);
    expect(existsSync(`${target}.old`)).toBe(false);
  });
});
```

> **Note on coverage:** the rollback `catch` inside the win32 branch of `replaceBinaryFor` (rename `<target>.old` back if writing the new file fails) is a defensive path that cannot be reliably triggered portably in a unit test (you would need `rename` to succeed but the subsequent `writeFile` to fail on the same writable directory). It is verified by code review. Global branch coverage across `src/**/*.ts` remains well above the 80% threshold.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test tests/commands/update.test.ts`
Expected: FAIL — `Cannot find module '../../src/commands/update.js'`.

- [ ] **Step 3: Implement the command**

Create `src/commands/update.ts`:

```typescript
import { createHash } from "node:crypto";
import { chmod, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import {
  compareVersions,
  isInterpreterExecPath,
  pickChecksum,
  platformToAsset,
  stripLeadingV,
} from "../core/updater.js";
import * as log from "../utils/log.js";

const DEFAULT_REPO = "edditz/ccws";

export interface UpdateOptions {
  /** Only report whether a newer version exists; never install. Exit 1 if newer. */
  check?: boolean;
  /** Reinstall even when already on the latest version. */
  force?: boolean;
  /** Override the source repo (owner/name). Defaults to CCWS_REPO env, then edditz/ccws. */
  repo?: string;
  /** @internal test hook — overrides process.env for CCWS_REPO resolution. */
  env?: NodeJS.ProcessEnv;
}

/** Injectable seams so the command's network/fs behavior is fully testable. */
export interface UpdateDeps {
  fetch: typeof globalThis.fetch;
  sha256: (bytes: Uint8Array) => string;
  replaceBinary: (target: string, bytes: Uint8Array) => Promise<void>;
  execPath: string;
  platform: string;
  arch: string;
}

export interface UpdateResult {
  /** Process exit code to propagate (--check exits 1 when an update exists). */
  exitCode: number;
}

/** sha256 over raw bytes (node:crypto). Exported for unit testing. */
export function defaultSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const safeUnlink = async (p: string): Promise<void> => {
  try {
    await unlink(p);
  } catch {
    // ignore — file may not exist, or (Windows) be locked while still running
  }
};

/**
 * Replace the binary at `target` with `bytes`, atomically.
 *
 * Unix: write a temp file in the same directory, chmod +x, then rename over the
 * target (same-filesystem rename is atomic).
 *
 * Windows: a running .exe cannot be overwritten or deleted, but it CAN be
 * renamed. So rename the running binary to `<target>.old`, write the new one
 * (rolling back if that fails), then best-effort delete `<target>.old` (may fail
 * while the old process is still running — not an error).
 *
 * Exported with a `platform` parameter so both branches are unit-testable on any OS.
 */
export async function replaceBinaryFor(
  platform: string,
  target: string,
  bytes: Uint8Array,
): Promise<void> {
  if (platform === "win32") {
    const old = `${target}.old`;
    await safeUnlink(old); // clear a stale .old from a previous run
    await rename(target, old);
    try {
      await writeFile(target, bytes);
    } catch (err) {
      await rename(old, target); // never leave target missing
      throw err;
    }
    await safeUnlink(old);
  } else {
    const tmp = join(dirname(target), `.ccws-update.${process.pid}.tmp`);
    await writeFile(tmp, bytes);
    await chmod(tmp, 0o755);
    await rename(tmp, target);
  }
}

/** Build the production deps from the live process. */
export function defaultDeps(): UpdateDeps {
  const platform = process.platform;
  return {
    fetch: globalThis.fetch,
    sha256: defaultSha256,
    replaceBinary: (target, bytes) => replaceBinaryFor(platform, target, bytes),
    execPath: process.execPath,
    platform,
    arch: process.arch,
  };
}

const ghHeaders = (current: string): Record<string, string> => ({
  Accept: "application/vnd.github+json",
  "User-Agent": `ccws/${current}`,
});

export async function updateAction(
  opts: UpdateOptions,
  deps: UpdateDeps = defaultDeps(),
): Promise<UpdateResult> {
  const env = opts.env ?? process.env;
  const repo = opts.repo ?? env.CCWS_REPO ?? DEFAULT_REPO;
  const current = stripLeadingV(pkg.version);

  // 1. Resolve the latest release tag.
  const apiUrl = `https://api.github.com/repos/${repo}/releases/latest`;
  const apiRes = await deps.fetch(apiUrl, { headers: ghHeaders(current) });
  if (apiRes.status === 403) {
    throw new Error("GitHub API rate limit hit — wait and retry, or run from a different IP");
  }
  if (!apiRes.ok) {
    throw new Error(`failed to fetch latest release: ${apiRes.status} ${apiRes.statusText}`);
  }
  const release = (await apiRes.json()) as { tag_name?: string };
  if (!release.tag_name) {
    throw new Error("latest release has no tag_name");
  }
  const tag = release.tag_name;
  const latest = stripLeadingV(tag);
  const newer = compareVersions(latest, current) > 0;

  // 2. Report-only mode (--check never installs).
  if (opts.check) {
    if (newer) {
      log.info(`update available: ccws ${current} → ${latest}`);
      return { exitCode: 1 };
    }
    log.info(`ccws is up to date (${current})`);
    return { exitCode: 0 };
  }

  // 3. Nothing to do (and not forced).
  if (!newer && !opts.force) {
    log.info(`ccws is up to date (${current})`);
    return { exitCode: 0 };
  }

  // 4. Install path: guard, resolve asset, then download/verify/replace.
  if (isInterpreterExecPath(deps.execPath)) {
    throw new Error(
      `refusing to replace JS runtime "${deps.execPath}"; install the compiled binary (curl ... install.sh | bash) and run \`ccws update\` from it`,
    );
  }
  const asset = platformToAsset(deps.platform, deps.arch);
  log.info(`updating ccws ${current} → ${latest} from ${repo}`);

  const base = `https://github.com/${repo}/releases/download/${tag}`;
  const assetRes = await deps.fetch(`${base}/${asset}`, { headers: ghHeaders(current) });
  if (!assetRes.ok) {
    throw new Error(`failed to download ${asset}: ${assetRes.status} ${assetRes.statusText}`);
  }
  const assetBytes = new Uint8Array(await assetRes.arrayBuffer());

  const checksumRes = await deps.fetch(`${base}/checksums.txt`, { headers: ghHeaders(current) });
  if (!checksumRes.ok) {
    throw new Error(`failed to download checksums.txt: ${checksumRes.status}`);
  }
  const checksumsText = await checksumRes.text();

  const expected = pickChecksum(checksumsText, asset);
  if (!expected) {
    throw new Error(`no checksum for "${asset}" in checksums.txt — update aborted, no files changed`);
  }
  const actual = deps.sha256(assetBytes);
  if (actual !== expected) {
    throw new Error(
      `checksum mismatch for ${asset} (expected ${expected.slice(0, 8)}…, got ${actual.slice(0, 8)}…) — update aborted, no files changed`,
    );
  }

  await replaceOrThrowPermission(deps, assetBytes);
  log.success(`updated ccws ${current} → ${latest} (open a new shell to use it)`);
  return { exitCode: 0 };
}

/** Wrap replaceBinary so a permission failure (EACCES/EPERM) gives sudo guidance. */
async function replaceOrThrowPermission(deps: UpdateDeps, bytes: Uint8Array): Promise<void> {
  try {
    await deps.replaceBinary(deps.execPath, bytes);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null | undefined)?.code;
    if (code === "EACCES" || code === "EPERM") {
      throw new Error(
        `permission denied replacing "${deps.execPath}" — retry with sudo or check the install dir is writable`,
      );
    }
    throw err;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test tests/commands/update.test.ts`
Expected: PASS — all describe blocks green.

- [ ] **Step 5: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/commands/update.ts tests/commands/update.test.ts
git commit -m "feat(commands): add update command for binary self-update"
```

---

## Task 3: Wire the `update` subcommand into the CLI

**Files:**
- Modify: `src/cli.ts` (import + register command)
- Modify: `tests/cli.test.ts` (subcommand list, `--root` invariant, flag test)
- Modify: `CLAUDE.md` (command list)

**Interfaces:**
- Consumes (from Task 2): `updateAction(opts: UpdateOptions): Promise<{ exitCode: number }>`. Commander passes `{ check, force, repo }` from the registered options.

**Context:** the existing `tests/cli.test.ts` asserts every subcommand has `-r/--root`. The `update` command operates on the binary, not workspaces, so it intentionally omits `--root`; that test must be narrowed to the workspace commands and a new assertion added that `update` lacks `--root`.

- [ ] **Step 1: Write the failing test additions**

In `tests/cli.test.ts`:

1. In the `"builds with version and all subcommands"` test (around the `for (const n of [...])` loop), add `"update"` to the array:
```typescript
for (const n of ["init", "add", "remove", "list", "status", "open", "update"]) {
  expect(names).toContain(n);
}
```

2. Replace the entire `"registers a global -r/--root option on every subcommand"` test with:
```typescript
it("registers -r/--root on every workspace subcommand (update intentionally excluded)", () => {
  const program = buildCli();
  for (const n of ["init", "add", "remove", "list", "status", "open"]) {
    const cmd = program.commands.find((c) => c.name() === n);
    expect(cmd).toBeDefined();
    expect(cmd!.options.map((o) => o.long)).toContain("--root");
  }
  const update = program.commands.find((c) => c.name() === "update");
  expect(update).toBeDefined();
  expect(update!.options.map((o) => o.long)).not.toContain("--root");
});

it("registers the update command with --check/--force/--repo flags", () => {
  const program = buildCli();
  const update = program.commands.find((c) => c.name() === "update");
  expect(update).toBeDefined();
  const flags = update!.options.map((o) => o.long);
  expect(flags).toContain("--check");
  expect(flags).toContain("--force");
  expect(flags).toContain("--repo");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test tests/cli.test.ts`
Expected: FAIL — `update` not in `program.commands`; flag assertions fail.

- [ ] **Step 3: Register the command in `src/cli.ts`**

Add the import near the other command imports (after `import { openAction } from "./commands/open.js";`):
```typescript
import { updateAction } from "./commands/update.js";
```

Register the subcommand. Insert this block immediately before the `return program;` line (i.e., right after the `open` command's `.action(...)` block):
```typescript
  program
    .command("update")
    .description("self-update the ccws binary from GitHub Releases")
    .option("--check", "only check for a newer version; exit 1 if available")
    .option("--force", "reinstall even if already on the latest version")
    .option("--repo <owner/repo>", "source repo (default edditz/ccws, or CCWS_REPO)")
    .action(async (opts) => {
      try {
        const { exitCode } = await updateAction(opts);
        if (exitCode !== 0) process.exit(exitCode);
      } catch (e) {
        fail(e);
      }
    });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test tests/cli.test.ts`
Expected: PASS — including the new registration and flag tests.

- [ ] **Step 5: Update `CLAUDE.md` command list**

In `CLAUDE.md`, find the line:
```
CLI 子命令:`init`(含 `-i/--interactive`、`-f/--force`)、`add`、`remove`、`list`(别名 `ls`)、`status`、`open`。
```
Append `update` so it reads:
```
CLI 子命令:`init`(含 `-i/--interactive`、`-f/--force`)、`add`、`remove`、`list`(别名 `ls`)、`status`、`open`、`update`(自更新二进制,带 `--check`/`--force`/`--repo`)。
```

- [ ] **Step 6: Full verification**

Run: `bun run test` (full suite)
Expected: all tests PASS.
Run: `bunx tsc --noEmit`
Expected: no errors.
Run (optional sanity, no network needed): `bun run src/cli.ts update --help`
Expected: prints the `update` command help with the three flags.

- [ ] **Step 7: Commit**

```bash
git add src/cli.ts tests/cli.test.ts CLAUDE.md
git commit -m "feat(cli): wire update subcommand"
```

---

## Post-implementation verification (runtime risk from the spec)

After all three tasks land, before the next release, manually verify the spec's open risk — **`process.execPath` points at the real ccws binary under `bun build --compile`**:

```bash
bun run build
./dist/ccws update --check   # should print "up to date (1.0.0)" or "update available" — proving execPath/network resolve
# If it errors about a JS runtime or wrong path, inspect:
./dist/ccws update --check 2>&1 | head
```

If `process.execPath` does NOT resolve to the real binary in the compiled build, fall back to `realpathSync(process.argv[0])` in `defaultDeps().execPath`. Record the finding in `CHANGELOG.md` / `RELEASING.md` when cutting the release that ships `update`.
