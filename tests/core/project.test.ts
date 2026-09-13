import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, realpathSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject } from "../../src/core/project.js";
import { resolveEntry, discoverProjects, discoverWorkspaces, detectProjectFromCwd } from "../../src/core/config.js";
import { workspaceExists, requireWorkspace } from "../../src/core/workspace.js";

let root: string;
let projectsHome: string;
beforeEach(() => {
  // realpathSync: keep root in the same namespace as the realpaths returned
  // by createProject (macOS /tmp -> /private/tmp).
  root = realpathSync(mkdtempSync(join(tmpdir(), "ccws-root-")));
  projectsHome = realpathSync(mkdtempSync(join(tmpdir(), "ccws-projects-")));
});

// A project dir with a controlled basename, living outside $ROOT like the
// real scattered projects this feature targets.
const makeProjectDir = (name: string): string => {
  const dir = join(projectsHome, name);
  mkdirSync(dir);
  return dir;
};

const makeWorkspace = (name: string): void => {
  mkdirSync(join(root, name, ".claude"), { recursive: true });
  writeFileSync(join(root, name, ".claude", "settings.json"), "{}");
};

describe("createProject", () => {
  it("registers a project as a symlink named after the target's basename", () => {
    const target = makeProjectDir("myproj");
    const registered = createProject(root, target);
    expect(registered).toEqual({ name: "myproj", target });
    expect(lstatSync(join(root, "myproj")).isSymbolicLink()).toBe(true);
  });

  it("rejects a target that does not exist", () => {
    expect(() => createProject(root, join(projectsHome, "ghost"))).toThrow(/does not exist/i);
  });

  it("rejects a target that is not a directory", () => {
    const file = join(projectsHome, "plain-file");
    writeFileSync(file, "x");
    expect(() => createProject(root, file)).toThrow(/not a directory/i);
  });

  it("rejects a name already taken by a workspace", () => {
    makeWorkspace("clash");
    const target = makeProjectDir("clash");
    try {
      expect(() => createProject(root, target)).toThrow(/already exists under \$ROOT/i);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it("rejects a name already taken by another project", () => {
    const target = makeProjectDir("dup");
    createProject(root, target);
    expect(() => createProject(root, target)).toThrow(/already exists under \$ROOT/i);
  });

  it("never writes anything into the target directory", () => {
    const target = makeProjectDir("clean");
    createProject(root, target);
    expect(existsSync(join(target, ".claude"))).toBe(false);
    expect(existsSync(join(target, "CLAUDE.md"))).toBe(false);
    expect(existsSync(target)).toBe(true); // untouched
  });
});

describe("resolveEntry", () => {
  it("returns workspace for a real dir with settings.json", () => {
    makeWorkspace("demo");
    expect(resolveEntry(root, "demo")).toEqual({ kind: "workspace", name: "demo" });
  });

  it("returns project for a symlink to an existing directory", () => {
    const target = makeProjectDir("alive");
    createProject(root, target);
    expect(resolveEntry(root, "alive")).toEqual({ kind: "project", name: "alive", target });
  });

  it("returns dangling when the target directory is gone", () => {
    const target = makeProjectDir("gone");
    const { name } = createProject(root, target);
    rmSync(target, { recursive: true });
    expect(resolveEntry(root, name)).toEqual({ kind: "dangling", name, target });
  });

  it("returns missing for an unknown name", () => {
    expect(resolveEntry(root, "nope")).toEqual({ kind: "missing" });
  });

  it("classifies a project whose target contains .claude/settings.json as project, not workspace", () => {
    const target = makeProjectDir("has-own-claude");
    mkdirSync(join(target, ".claude"), { recursive: true });
    writeFileSync(
      join(target, ".claude", "settings.json"),
      JSON.stringify({ permissions: { additionalDirectories: [] } }),
    );
    const { name } = createProject(root, target);
    expect(resolveEntry(root, name).kind).toBe("project");
    expect(workspaceExists(root, name)).toBe(false);
    expect(discoverWorkspaces(root)).toEqual([]);
  });
});

describe("discoverProjects", () => {
  it("lists registered projects and skips workspaces", () => {
    makeWorkspace("ws");
    const target = makeProjectDir("solo");
    createProject(root, target);
    const projects = discoverProjects(root);
    expect(projects.map((p) => p.name)).toEqual(["solo"]);
    expect(projects[0].target).toBe(target);
    expect(projects[0].targetExists).toBe(true);
    expect(projects[0].targetMtimeMs).toBeGreaterThan(0);
  });

  it("marks dangling entries and sorts them last", () => {
    const gone = makeProjectDir("gone");
    const alive = makeProjectDir("alive");
    createProject(root, gone);
    createProject(root, alive);
    rmSync(gone, { recursive: true });
    const projects = discoverProjects(root);
    const byName = Object.fromEntries(projects.map((p) => [p.name, p.targetExists]));
    expect(byName).toEqual({ alive: true, gone: false });
    expect(projects[0].name).toBe("alive"); // dangling (mtime 0) sorts last
  });
});

describe("detectProjectFromCwd", () => {
  it("finds the project containing the cwd", () => {
    const target = makeProjectDir("outer");
    mkdirSync(join(target, "src"));
    const { name } = createProject(root, target);
    expect(detectProjectFromCwd(root, join(target, "src"))?.name).toBe(name);
  });

  it("finds the project when cwd is the target itself", () => {
    const target = makeProjectDir("self");
    const { name } = createProject(root, target);
    expect(detectProjectFromCwd(root, target)?.name).toBe(name);
  });

  it("returns null when cwd is outside every project", () => {
    makeProjectDir("far");
    createProject(root, join(projectsHome, "far"));
    expect(detectProjectFromCwd(root, root)).toBeNull();
  });

  it("returns null for a dangling project", () => {
    const target = makeProjectDir("vanished");
    createProject(root, target);
    rmSync(target, { recursive: true });
    expect(detectProjectFromCwd(root, target)).toBeNull();
  });
});

describe("requireWorkspace", () => {
  it("passes for a workspace", () => {
    makeWorkspace("demo");
    expect(() => requireWorkspace(root, "demo")).not.toThrow();
  });

  it("rejects a project as read-only", () => {
    const target = makeProjectDir("readonly");
    const { name } = createProject(root, target);
    expect(() => requireWorkspace(root, name)).toThrow(/project.*read-only|not a workspace/i);
  });

  it("rejects an unknown name with init guidance", () => {
    expect(() => requireWorkspace(root, "nope")).toThrow(/does not exist.*ccws init/i);
  });
});
