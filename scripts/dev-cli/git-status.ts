/**
 * git-status.ts
 *
 * Returns Git working tree status as structured JSON.
 * Output: { branch, clean, files: [{status, path}] }
 */

import { runWithHarness } from "./_cli-harness";
import { execSync } from "child_process";

const cwd = process.env.PROJECT_ROOT || process.cwd();
const maxBuffer = 10 * 1024 * 1024;

runWithHarness("git-status", async () => {
  const branch = execSync("git branch --show-current", {
    cwd,
    maxBuffer,
    encoding: "utf-8",
  }).trim();

  const porcelain = execSync("git status --porcelain", {
    cwd,
    maxBuffer,
    encoding: "utf-8",
  }).trim();

  const files = porcelain
    ? porcelain.split("\n").map((line) => ({
        status: line.substring(0, 2).trim(),
        path: line.substring(3),
      }))
    : [];

  return {
    branch,
    clean: files.length === 0,
    files,
  };
});
