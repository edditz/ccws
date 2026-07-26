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
