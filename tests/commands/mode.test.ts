import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, symlinkSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { modeAction } from "../../src/commands/mode.js";
import { initAction } from "../../src/commands/init.js";
import { settingsPath, modeSidecarPath } from "../../src/core/config.js";

let root: string;
let projectsHome: string;
beforeEach(() => {
  // realpathSync both: on macOS /tmp -> /private/tmp and cwd detection below
  // compares lexically / by realpath containment, so all must share a namespace.
  root = realpathSync(mkdtempSync(join(tmpdir(), "ccws-root-")));
  projectsHome = realpathSync(mkdtempSync(join(tmpdir(), "ccws-projects-")));
});
afterEach(() => vi.restoreAllMocks());

const capture = (): (() => string) => {
  const buf: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((c) => { buf.push(String(c)); return true; });
  vi.spyOn(process.stderr, "write").mockImplementation((c) => { buf.push(String(c)); return true; });
  return () => buf.join("");
};

const registerProject = (name: string): string => {
  const target = join(projectsHome, name);
  mkdirSync(target);
  symlinkSync(target, join(root, name));
  return target;
};

describe("modeAction: named set/clear", () => {
  it("sets a workspace's mode in settings.json, preserving other fields", async () => {
    await initAction("demo", { root });
    writeFileSync(settingsPath(root, "demo"),
      JSON.stringify({ model: "opus", permissions: { additionalDirectories: ["/a"] } }));
    const out = capture();
    await modeAction("demo", "plan", { root });
    const raw = JSON.parse(readFileSync(settingsPath(root, "demo"), "utf8"));
    expect(raw.permissions.defaultMode).toBe("plan");
    expect(raw.model).toBe("opus");
    expect(out()).toContain('mode set to "plan" for "demo"');
  });

  it("clears via off and via default", async () => {
    await initAction("demo", { root });
    writeFileSync(settingsPath(root, "demo"),
      JSON.stringify({ permissions: { defaultMode: "plan" } }));
    await modeAction("demo", "off", { root });
    expect(JSON.parse(readFileSync(settingsPath(root, "demo"), "utf8")).permissions.defaultMode).toBeUndefined();
    writeFileSync(settingsPath(root, "demo"),
      JSON.stringify({ permissions: { defaultMode: "plan" } }));
    const out = capture();
    await modeAction("demo", "default", { root });
    expect(JSON.parse(readFileSync(settingsPath(root, "demo"), "utf8")).permissions.defaultMode).toBeUndefined();
    expect(out()).toContain('mode cleared for "demo"');
  });

  it("sets a project's mode in the sidecar without touching the target", async () => {
    const target = registerProject("myproj");
    const before = readdirSync(target).sort();
    const out = capture();
    await modeAction("myproj", "auto", { root });
    expect(readFileSync(modeSidecarPath(root, "myproj"), "utf8")).toBe("auto\n");
    expect(readdirSync(target).sort()).toEqual(before);
    expect(out()).toContain('mode set to "auto" for "myproj"');
  });

  it("clearing a project mode removes the sidecar", async () => {
    registerProject("myproj");
    await modeAction("myproj", "auto", { root });
    await modeAction("myproj", "off", { root });
    expect(existsSync(modeSidecarPath(root, "myproj"))).toBe(false);
  });

  it("supports dangling entries via the sidecar", async () => {
    const gone = join(projectsHome, "gone");
    mkdirSync(gone);
    symlinkSync(gone, join(root, "gone"));
    rmSync(gone, { recursive: true });
    await modeAction("gone", "plan", { root });
    expect(readFileSync(modeSidecarPath(root, "gone"), "utf8")).toBe("plan\n");
  });

  it("rejects an invalid value listing the valid ones", async () => {
    await initAction("demo", { root });
    await expect(modeAction("demo", "yolo", { root })).rejects.toThrow(
      /invalid mode "yolo" — expected one of/,
    );
    await expect(modeAction("demo", "on", { root })).rejects.toThrow(/invalid mode "on"/);
  });

  it("rejects an unknown name", async () => {
    await expect(modeAction("nope", "plan", { root })).rejects.toThrow(
      /"nope" does not exist — nothing registered under this name/,
    );
  });

  it("rejects path-separator and reserved names", async () => {
    await expect(modeAction("a/b", "plan", { root })).rejects.toThrow(/invalid workspace name/);
    await expect(modeAction(".ccws", "plan", { root })).rejects.toThrow(/reserved for ccws internal state/);
  });

  it("sets a workspace whose name collides with a mode keyword via the 2-arg form", async () => {
    await initAction("auto", { root });
    await modeAction("auto", "plan", { root });
    expect(JSON.parse(readFileSync(settingsPath(root, "auto"), "utf8")).permissions.defaultMode).toBe("plan");
  });

  it("is idempotent when setting twice", async () => {
    await initAction("demo", { root });
    await modeAction("demo", "plan", { root });
    await modeAction("demo", "plan", { root });
    expect(JSON.parse(readFileSync(settingsPath(root, "demo"), "utf8")).permissions.defaultMode).toBe("plan");
  });

  it("throws on corrupt workspace settings for both set and get", async () => {
    await initAction("demo", { root });
    writeFileSync(settingsPath(root, "demo"), "{ not json");
    await expect(modeAction("demo", "plan", { root })).rejects.toThrow(/corrupt/);
    await expect(modeAction("demo", undefined, { root })).rejects.toThrow(/corrupt/);
    await expect(modeAction(undefined, undefined, { root, cwd: join(root, "demo") })).rejects.toThrow(/corrupt/);
  });
});

describe("modeAction: getter", () => {
  it("reads a named workspace's mode, defaulting to default", async () => {
    await initAction("demo", { root });
    const out = capture();
    await modeAction("demo", undefined, { root });
    expect(out()).toContain('mode: default for "demo"');
    writeFileSync(settingsPath(root, "demo"),
      JSON.stringify({ permissions: { defaultMode: "plan" } }));
    const out2 = capture();
    await modeAction("demo", undefined, { root });
    expect(out2()).toContain('mode: plan for "demo"');
  });

  it("reads a named project's mode from the sidecar", async () => {
    registerProject("myproj");
    await modeAction("myproj", "dontAsk", { root });
    const out = capture();
    await modeAction("myproj", undefined, { root });
    expect(out()).toContain('mode: dontAsk for "myproj"');
  });

  it("marks dangling entries", async () => {
    const gone = join(projectsHome, "gone");
    mkdirSync(gone);
    symlinkSync(gone, join(root, "gone"));
    rmSync(gone, { recursive: true });
    await modeAction("gone", "plan", { root });
    const out = capture();
    await modeAction("gone", undefined, { root });
    expect(out()).toContain('mode: plan for "gone"  (target missing)');
  });
});

describe("modeAction: cwd resolution", () => {
  it("single value positional sets the cwd workspace (subdirs count)", async () => {
    await initAction("demo", { root });
    const sub = join(root, "demo", "sub");
    mkdirSync(sub, { recursive: true });
    const out = capture();
    await modeAction("plan", undefined, { root, cwd: sub });
    expect(JSON.parse(readFileSync(settingsPath(root, "demo"), "utf8")).permissions.defaultMode).toBe("plan");
    expect(out()).toContain('mode set to "plan" for "demo"');
  });

  it("single off positional clears the cwd workspace", async () => {
    await initAction("demo", { root });
    writeFileSync(settingsPath(root, "demo"),
      JSON.stringify({ permissions: { defaultMode: "plan" } }));
    await modeAction("off", undefined, { root, cwd: join(root, "demo") });
    expect(JSON.parse(readFileSync(settingsPath(root, "demo"), "utf8")).permissions.defaultMode).toBeUndefined();
  });

  it("single value positional sets the cwd project target", async () => {
    registerProject("myproj");
    await modeAction("auto", undefined, { root, cwd: join(projectsHome, "myproj") });
    expect(readFileSync(modeSidecarPath(root, "myproj"), "utf8")).toBe("auto\n");
  });

  it("a value positional outside any entry throws with guidance", async () => {
    await expect(modeAction("plan", undefined, { root, cwd: projectsHome }))
      .rejects.toThrow(/not inside a workspace or project — cd into one, or use: ccws mode <name> <value>/);
  });

  it("a value positional outside any entry hints when a keyword-named entry exists", async () => {
    await initAction("plan", { root });
    await expect(modeAction("plan", undefined, { root, cwd: projectsHome }))
      .rejects.toThrow(/note: an entry named "plan" exists — inspect it with `ccws list plan -l`/);
  });

  it("no args prints the cwd workspace's mode", async () => {
    await initAction("demo", { root });
    writeFileSync(settingsPath(root, "demo"),
      JSON.stringify({ permissions: { defaultMode: "acceptEdits" } }));
    const out = capture();
    await modeAction(undefined, undefined, { root, cwd: join(root, "demo") });
    expect(out()).toContain('mode: acceptEdits for "demo"');
  });

  it("no args prints the cwd project's mode", async () => {
    registerProject("myproj");
    await modeAction("myproj", "manual", { root });
    const out = capture();
    await modeAction(undefined, undefined, { root, cwd: join(projectsHome, "myproj") });
    expect(out()).toContain('mode: manual for "myproj"');
  });

  it("no args outside any entry warns without throwing", async () => {
    const out = capture();
    await modeAction(undefined, undefined, { root, cwd: projectsHome });
    expect(out()).toContain("not inside any workspace or project");
  });
});
