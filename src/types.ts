export interface SettingsJson {
  permissions?: {
    additionalDirectories?: string[];
    defaultMode?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface Workspace {
  name: string;
  path: string;
  dirs: string[];
  missing: number;
  bypass: boolean;
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
