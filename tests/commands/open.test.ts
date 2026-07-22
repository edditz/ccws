import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initAction } from "../../src/commands/init.js";
import { openAction } from "../../src/commands/open.js";
import { workspacePath } from "../../src/core/config.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ccws-root-")); });

describe("openAction", () => {
  it("chdirs into workspace and runs claude", async () => {
    await initAction("demo", { root });
    let chdirArg = ""; const calls: string[] = [];
    const runner = (cmd: string, args: string[], opts: any) => {
      calls.push(cmd);
      chdirArg = opts.cwd;
    };
    await openAction("demo", { root, runner });
    expect(calls[0]).toBe("claude");
    expect(chdirArg).toBe(workspacePath(root, "demo"));
  });
  it("throws when workspace missing", async () => {
    await expect(openAction("nope", { root, runner: () => {} })).rejects.toThrow(/does not exist/i);
  });
});
