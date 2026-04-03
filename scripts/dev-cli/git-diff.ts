/**
 * git-diff.ts
 *
 * Returns Git diff summary with file-level stats.
 * Usage: git-diff [target]
 * Output: { target, summary, files: [{file, added, removed}], totalAdded, totalRemoved }
 */

import { runWithHarness } from "./_cli-harness";
import { execSync } from "child_process";

const cwd = process.env.PROJECT_ROOT || process.cwd();
const maxBuffer = 10 * 1024 * 1024;

const target = process.argv[2] || "HEAD";

runWithHarness(`git-diff [target] (default: HEAD)`, async () => {
  const summary = execSync(`git diff ${target} --stat`, {
    cwd,
    maxBuffer,
    encoding: "utf-8",
  }).trim();

  const numstat = execSync(`git diff ${target} --numstat`, {
    cwd,
    maxBuffer,
    encoding: "utf-8",
  }).trim();

  let totalAdded = 0;
  let totalRemoved = 0;

  const files = numstat
    ? numstat.split("\n").map((line) => {
        const [added, removed, file] = line.split("\t");
        const a = added === "-" ? 0 : parseInt(added, 10);
        const r = removed === "-" ? 0 : parseInt(removed, 10);
        totalAdded += a;
        totalRemoved += r;
        return { file, added: a, removed: r };
      })
    : [];

  return { target, summary, files, totalAdded, totalRemoved };
});
