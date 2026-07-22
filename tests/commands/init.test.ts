import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initAction } from "../../src/commands/init.js";
import { workspaceExists } from "../../src/core/workspace.js";
import { settingsPath } from "../../src/core/config.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ccws-root-")); });

describe("initAction", () => {
  it("creates a new workspace", async () => {
    await initAction("demo", { root });
    expect(workspaceExists(root, "demo")).toBe(true);
    expect(JSON.parse(readFileSync(settingsPath(root, "demo"), "utf8")).permissions.additionalDirectories).toEqual([]);
  });

  it("fails when workspace exists without --force", async () => {
    await initAction("demo", { root });
    await expect(initAction("demo", { root })).rejects.toThrow(/exists|force/i);
  });

  it("overwrites with --force (resets settings.json back to skeleton)", async () => {
    await initAction("demo", { root });
    // Corrupt the settings.json so we can prove --force resets it.
    const settings = settingsPath(root, "demo");
    writeFileSync(settings, JSON.stringify({ permissions: { additionalDirectories: ["/sneaky/path"] } }, null, 2), "utf8");
    expect(JSON.parse(readFileSync(settings, "utf8")).permissions.additionalDirectories).toEqual(["/sneaky/path"]);

    await initAction("demo", { root, force: true });

    const after = JSON.parse(readFileSync(settings, "utf8"));
    expect(after.permissions.additionalDirectories).toEqual([]);
  });

  it("rejects names containing a path separator (path traversal guard)", async () => {
    await expect(initAction("evil/child", { root })).rejects.toThrow(/invalid.*name|name.*invalid/i);
    expect(workspaceExists(root, "evil")).toBe(false);
    expect(existsSync(join(root, "evil"))).toBe(false);
  });

  it("rejects names containing a backslash separator", async () => {
    await expect(initAction("evil\\child", { root })).rejects.toThrow(/invalid.*name|name.*invalid/i);
    expect(existsSync(join(root, "evil"))).toBe(false);
  });

  it("rejects names containing a parent-dir segment (..)", async () => {
    await expect(initAction("../evil", { root })).rejects.toThrow(/invalid.*name|name.*invalid/i);
    expect(existsSync(join(root, "evil"))).toBe(false);
    expect(existsSync(join(tmpdir(), "evil"))).toBe(false);
  });

  it("accepts the literal name 'a..b' (regression: adjacent dots are not path traversal)", async () => {
    await initAction("a..b", { root });
    expect(workspaceExists(root, "a..b")).toBe(true);
    const raw = JSON.parse(readFileSync(settingsPath(root, "a..b"), "utf8"));
    expect(raw.permissions.additionalDirectories).toEqual([]);
  });

  it("rejects empty / whitespace-only names", async () => {
    await expect(initAction("", { root })).rejects.toThrow(/invalid.*name|non-empty/i);
    await expect(initAction("   ", { root })).rejects.toThrow(/invalid.*name|non-empty/i);
  });

  it("does not create any files when name is rejected", async () => {
    const before = JSON.stringify(existsSync(root));
    await expect(initAction("../pwn", { root })).rejects.toThrow();
    expect(existsSync(root)).toBe(before === "true");
  });

  it("--interactive with no dirs entered still creates the workspace", async () => {
    // Inject a prompt that immediately finishes (empty input) so the test never
    // touches the TTY. The real @clack/prompts text is wired in cli.ts.
    const promptText = async () => "";
    await initAction("demo", { root, interactive: true, promptText });
    expect(workspaceExists(root, "demo")).toBe(true);
    expect(
      JSON.parse(readFileSync(settingsPath(root, "demo"), "utf8")).permissions.additionalDirectories,
    ).toEqual([]);
  });

  it("--interactive collects, validates, and writes entered dirs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "real-"));
    const answers = [dir, ""];
    let i = 0;
    const promptText = async () => answers[i++] ?? "";
    await initAction("demo", { root, interactive: true, promptText });
    const written = JSON.parse(readFileSync(settingsPath(root, "demo"), "utf8"))
      .permissions.additionalDirectories as string[];
    expect(written).toEqual([resolve(dir)]);
  });

  it("--interactive rejects dirs that do not exist (atomic — nothing written)", async () => {
    const answers = ["/does/not/exist/one", ""];
    let i = 0;
    const promptText = async () => answers[i++] ?? "";
    await expect(initAction("demo", { root, interactive: true, promptText }))
      .rejects.toThrow(/not exist/i);
    const written = JSON.parse(readFileSync(settingsPath(root, "demo"), "utf8"))
      .permissions.additionalDirectories as string[];
    expect(written).toEqual([]);
  });
});
