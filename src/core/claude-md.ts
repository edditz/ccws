import { existsSync, readFileSync, writeFileSync } from "node:fs";

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

export type WriteOutcome = "created" | "rewrote-block" | "appended";

/**
 * Sync the dirs block of a CLAUDE.md file. Three states + an error state:
 *
 * - file absent                                   → write renderFull, return "created"
 * - exactly one BEGIN..END pair (BEGIN before END) → replace between markers, return "rewrote-block"
 * - no markers at all                              → append a pair, return "appended"
 * - anything else (orphan marker, multiple pairs, END before BEGIN)
 *                                                  → THROW, leave the file untouched
 *
 * The error state refuses to write because appending onto a malformed file can
 * produce multiple BEGINs, and the next "replace between markers" pass would
 * then span and destroy user content between them.
 */
export function writeClaudeMd(path: string, entries: DirEntry[]): WriteOutcome {
  if (!existsSync(path)) {
    writeFileSync(path, renderFull(entries), "utf8");
    return "created";
  }
  const content = readFileSync(path, "utf8");
  const beginIdx = content.indexOf(BEGIN);
  const endIdx = content.indexOf(END);
  const countBegin = countOccurrences(content, BEGIN);
  const countEnd = countOccurrences(content, END);

  if (countBegin === 1 && countEnd === 1 && beginIdx < endIdx) {
    const next =
      content.slice(0, beginIdx + BEGIN.length) +
      "\n" +
      renderDirsBlock(entries) +
      "\n" +
      content.slice(endIdx);
    writeFileSync(path, next, "utf8");
    return "rewrote-block";
  }

  if (countBegin === 0 && countEnd === 0) {
    const next =
      content.replace(/\n*$/, "") +
      "\n\n" +
      BEGIN +
      "\n" +
      renderDirsBlock(entries) +
      "\n" +
      END +
      "\n";
    writeFileSync(path, next, "utf8");
    return "appended";
  }

  throw new Error(
    `ccws maintenance markers in ${path} are incomplete/malformed — sync skipped to avoid damage. Fix the markers (ensure exactly one begin…end pair) or run \`ccws regen --force\` to rewrite the whole file.`,
  );
}
