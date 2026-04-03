/**
 * git-log.ts
 *
 * Returns recent commit history as structured JSON.
 * Usage: git-log [--count N] (default: 20)
 * Output: { commits: [{hash, author, date, message}], count }
 */

import { runWithHarness } from "./_cli-harness";
import { execSync } from "child_process";

const cwd = process.env.PROJECT_ROOT || process.cwd();
const maxBuffer = 10 * 1024 * 1024;

let count = 20;
const countIdx = process.argv.indexOf("--count");
if (countIdx !== -1 && process.argv[countIdx + 1]) {
  count = parseInt(process.argv[countIdx + 1], 10);
  if (isNaN(count) || count < 1) count = 20;
}

runWithHarness("git-log [--count N]", async () => {
  const raw = execSync(
    `git log --format="%H|%an|%ai|%s" -n ${count}`,
    { cwd, maxBuffer, encoding: "utf-8" }
  ).trim();

  const commits = raw
    ? raw.split("\n").map((line) => {
        const [hash, author, date, ...rest] = line.split("|");
        return { hash, author, date, message: rest.join("|") };
      })
    : [];

  return { commits, count: commits.length };
});
