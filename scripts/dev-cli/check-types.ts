/**
 * check-types.ts
 *
 * TypeScript type checking results.
 * Usage: check-types
 * Output: { passed, errorCount, errors: [{file, line, col, code, message}] }
 */

import { runWithHarness } from "./_cli-harness";
import { execSync } from "child_process";

const cwd = process.env.PROJECT_ROOT || process.cwd();
const maxBuffer = 10 * 1024 * 1024;

runWithHarness("check-types", async () => {
  let raw: string;
  let exitCode = 0;

  try {
    raw = execSync("npx tsc --noEmit 2>&1", {
      cwd,
      maxBuffer,
      encoding: "utf-8",
    });
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string; status?: number };
    raw = (execErr.stdout || "") + (execErr.stderr || "");
    exitCode = execErr.status || 1;
  }

  if (exitCode === 0) {
    return { passed: true, errorCount: 0, errors: [] };
  }

  // Parse TS error format: file(line,col): error TSXXXX: message
  const errorPattern = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/gm;
  const errors: Array<{
    file: string;
    line: number;
    col: number;
    code: string;
    message: string;
  }> = [];

  let match;
  while ((match = errorPattern.exec(raw)) !== null && errors.length < 50) {
    errors.push({
      file: match[1],
      line: parseInt(match[2], 10),
      col: parseInt(match[3], 10),
      code: match[4],
      message: match[5],
    });
  }

  return {
    passed: false,
    errorCount: errors.length,
    errors,
  };
});
