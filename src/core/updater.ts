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
