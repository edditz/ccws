#!/usr/bin/env node
// collect-commits.mjs — analyze commits since the last v* tag and suggest a
// semver bump. Deterministic, read-only, no side effects. Run from anywhere in
// the repo. Outputs JSON for the release skill to format and act on.
//
// Bump rules (conventional commits → semver):
//   BREAKING CHANGE / `<type>!:` → major
//   feat:                          → minor
//   fix: / perf:                   → patch
//   everything else                → none (suggest patch only if you judge it user-facing)
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();

// Last v* tag (if any)
let lastTag = "";
try {
  lastTag = execSync("git describe --tags --abbrev=0 --match 'v*'", {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "ignore"],
  }).trim();
} catch {
  lastTag = "";
}

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const current = pkg.version;

const range = lastTag ? `${lastTag}..HEAD` : "HEAD";
// hash|subject; --no-merges keeps the conventional-commit trail clean
const log = execSync(`git log ${range} --pretty=format:'%h|%s' --no-merges`, {
  encoding: "utf8",
});

const commits = log.trim()
  ? log.trim().split("\n").map((line) => {
      const idx = line.indexOf("|");
      return { hash: line.slice(0, idx), subject: line.slice(idx + 1) };
    })
  : [];

const TYPE_OF = /^\s*(\w+)(\([^)]+\))?(!)?:/;
const groups = {
  breaking: [],
  feat: [],
  fix: [],
  perf: [],
  refactor: [],
  docs: [],
  test: [],
  chore: [],
  ci: [],
  build: [],
  other: [],
};

for (const c of commits) {
  const breaking = /BREAKING CHANGE|!:\s/.test(c.subject);
  const m = c.subject.match(TYPE_OF);
  const type = m ? m[1].toLowerCase() : null;
  if (breaking) groups.breaking.push(c);
  else if (type && groups[type]) groups[type].push(c);
  else groups.other.push(c);
}

let bump;
if (groups.breaking.length > 0) bump = "major";
else if (groups.feat.length > 0) bump = "minor";
else if (groups.fix.length > 0 || groups.perf.length > 0) bump = "patch";
else bump = "none";

const nextVersion = (v, b) => {
  const parts = v.split(".").map((n) => parseInt(n, 10) || 0);
  const [maj = 0, min = 0, pat = 0] = parts;
  if (b === "major") return `${maj + 1}.0.0`;
  if (b === "minor") return `${maj}.${min + 1}.0`;
  if (b === "patch") return `${maj}.${min}.${pat + 1}`;
  return v;
};

const out = {
  lastTag: lastTag || null,
  currentVersion: current,
  commitsSince: commits.length,
  suggestedBump: bump,
  suggestedNextVersion: nextVersion(current, bump),
  groups,
};

console.log(JSON.stringify(out, null, 2));
