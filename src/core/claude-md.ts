/**
 * Maintenance markers wrapping the auto-managed directory list. These are a
 * published contract: once a workspace ships with them, later ccws versions
 * must keep recognizing the exact text. Do NOT edit.
 */
export const BEGIN = "<!-- ccws:additional-directories:begin -->";
export const END = "<!-- ccws:additional-directories:end -->";

export interface DirEntry {
  path: string;
  missing: boolean;
}

const EMPTY_HINT =
  "<!-- (none yet — use `ccws add <dir>` to associate directories) -->";

const HEADER = `# Workspace

This is a **ccws workspace**. The current directory (your \`cwd\`) is the workspace
itself and is usually empty — the actual project code lives in the **Associated
Directories** listed below.

> **Before running any shell command, check your current directory.** \`cd\` into
> the correct associated directory before operating on it.

## Associated Directories
`;

const FOOTER = `
> The list above is auto-maintained by \`ccws\` (\`init\` / \`add\` / \`remove\` / \`regen\`).
> Edit anything outside the \`begin…end\` markers freely; do not edit the list
> between them — it will be overwritten.
`;

/** Count non-overlapping occurrences of `needle` in `haystack`. Empty needle → 0. */
export function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

export function renderDirsBlock(entries: DirEntry[]): string {
  if (entries.length === 0) return EMPTY_HINT;
  return entries
    .map((e) => `- ${e.path}${e.missing ? "  ⚠️ missing" : ""}`)
    .join("\n");
}

export function renderFull(entries: DirEntry[]): string {
  return `${HEADER}\n${BEGIN}\n${renderDirsBlock(entries)}\n${END}\n${FOOTER}`;
}
