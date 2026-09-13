export interface SettingsJson {
  permissions?: {
    additionalDirectories?: string[];
    defaultMode?: string;
    [key: string]: unknown;
  };
  /**
   * ccws-private metadata. `kind === "scratch"` marks a throwaway workspace
   * (discarded when its claude session exits). Published field: every settings
   * writer must keep preserving it like any other unknown top-level key.
   */
  ccws?: ScratchMeta;
  [key: string]: unknown;
}

/** Marker stored under `SettingsJson.ccws`; presence of kind "scratch" is the
 *  ONLY thing that makes a workspace a scratch session (name prefixes are
 *  readability only). Extra fields (e.g. a legacy createdAt) are tolerated. */
export interface ScratchMeta {
  kind: "scratch";
}

export interface Workspace {
  name: string;
  path: string;
  dirs: string[];
  missing: number;
  /** Raw `permissions.defaultMode` when set (undefined = Claude's default). */
  mode?: string;
  /** Parsed `ccws` marker — set only for scratch workspaces with intact settings. */
  scratch?: ScratchMeta;
}

/**
 * A single project registered under $ROOT as a symlink to an existing project
 * directory living anywhere on disk. Unlike workspaces, ccws never writes into
 * a project's target directory — the symlink is the only thing ccws owns.
 */
export interface Project {
  name: string;
  /** Absolute real path of the registered project directory. */
  target: string;
  /** False when the target has been moved/deleted (dangling symlink). */
  targetExists: boolean;
  /** Target directory mtime in ms — sorts projects by recent activity. */
  targetMtimeMs: number;
}

/**
 * What `$ROOT/<name>` resolves to. A single namespace shared by workspaces
 * (real directories) and projects (symlinks), so names can never collide.
 */
export type Entry =
  | { kind: "workspace"; name: string }
  | { kind: "project"; name: string; target: string }
  | { kind: "dangling"; name: string; target: string }
  | { kind: "missing" };

/** Any Entry that names something registered under $ROOT (not "missing"). */
export type NamedEntry = Exclude<Entry, { kind: "missing" }>;
