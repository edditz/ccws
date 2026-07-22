export interface SettingsJson {
  permissions?: {
    additionalDirectories?: string[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface Workspace {
  name: string;
  path: string;
  dirs: string[];
  missing: number;
}
