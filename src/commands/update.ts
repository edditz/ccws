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
      try {
        await rename(old, target); // never leave target missing
      } catch {
        // best-effort recovery — don't mask the original error
      }
      throw err;
    }
    await safeUnlink(old);
  } else {
    const tmp = join(dirname(target), `.ccws-update.${process.pid}.tmp`);
    try {
      await writeFile(tmp, bytes);
      await chmod(tmp, 0o755);
      await rename(tmp, target);
    } catch (err) {
      await safeUnlink(tmp); // don't leak the temp file on failure
      throw err;
    }
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
    const remaining = apiRes.headers.get("x-ratelimit-remaining");
    if (remaining === "0") {
      throw new Error("GitHub API rate limit hit — wait and retry, or run from a different IP");
    }
    throw new Error(
      `GitHub API returned 403 for ${repo} — access restricted (private repo or org policy); check --repo and repo visibility`,
    );
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
