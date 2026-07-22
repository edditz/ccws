import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildCli } from "../src/cli.js";
import { settingsPath } from "../src/core/config.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ccws-cli-root-"));
});

const readDirs = (name: string) =>
  JSON.parse(readFileSync(settingsPath(root, name), "utf8")).permissions.additionalDirectories as string[];

describe("cli", () => {
  it("builds with version and all subcommands", () => {
    const program = buildCli();
    const names = program.commands.map((c) => c.name());
    for (const n of ["init", "add", "remove", "list", "status", "open"]) {
      expect(names).toContain(n);
    }
  });

  it("exposes the `ls` alias on the list command", () => {
    const program = buildCli();
    const list = program.commands.find((c) => c.name() === "list");
    expect(list).toBeDefined();
    expect(list!.alias()).toBe("ls");
  });

  it("registers a global -r/--root option on every subcommand", () => {
    const program = buildCli();
    for (const cmd of program.commands) {
      const flags = cmd.options.map((o) => o.long);
      expect(flags).toContain("--root");
    }
  });

  it("reports a version", () => {
    const program = buildCli();
    expect(program.version()).toBe("0.1.0");
  });

  it("wires `init <name>` through commander and forwards --root", async () => {
    const program = buildCli();
    await program.parseAsync(["node", "ccws", "init", "demo", "--root", root]);
    expect(existsSync(settingsPath(root, "demo"))).toBe(true);
  });

  it("wires `add` with the -w shortcut and forwards dirs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "real-"));
    const program = buildCli();
    await program.parseAsync(["node", "ccws", "init", "demo", "-r", root]);
    await program.parseAsync(["node", "ccws", "add", dir, "-r", root, "-w", "demo"]);
    expect(readDirs("demo")).toEqual([resolve(dir)]);
  });

  it("accepts the `ls` alias and lists discovered workspaces without error", async () => {
    const program = buildCli();
    await program.parseAsync(["node", "ccws", "init", "demo", "-r", root]);
    // Should not throw; ls alias resolves to the list command.
    await program.parseAsync(["node", "ccws", "ls", "-r", root]);
  });

  it("wraps action failures: prints a SINGLE error line to stderr and exits non-zero", async () => {
    const program = buildCli();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("__cli_exit__");
    }) as never);
    const errChunks: string[] = [];
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation((c) => {
      errChunks.push(String(c));
      return true;
    });
    await expect(
      program.parseAsync(["node", "ccws", "init", "bad/name", "-r", root]),
    ).rejects.toThrow("__cli_exit__");
    const errText = errChunks.join("");
    // Exactly one ✗ error line (no duplicate from the action calling error() before throw).
    expect(errText.split("✗").length - 1).toBe(1);
    // The single line carries the real failure message, not a generic label.
    expect(errText).toMatch(/invalid.*name|name.*invalid/i);
    // process.exit was invoked with code 1.
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });
});
