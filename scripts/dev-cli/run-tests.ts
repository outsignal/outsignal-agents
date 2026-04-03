/**
 * run-tests.ts
 *
 * Vitest execution with structured results.
 * Usage: run-tests [test-path]
 * Output: { passed, failed, total, duration, failures: [{test, error}] }
 */

import { runWithHarness } from "./_cli-harness";
import { execSync } from "child_process";

const cwd = process.env.PROJECT_ROOT || process.cwd();
const maxBuffer = 10 * 1024 * 1024;

const testPath = process.argv[2] || "";

runWithHarness("run-tests [test-path]", async () => {
  let raw: string;
  let exitCode = 0;

  try {
    raw = execSync(
      `npx vitest run --reporter=json ${testPath} 2>&1`,
      { cwd, maxBuffer, encoding: "utf-8" }
    );
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string; status?: number };
    raw = (execErr.stdout || "") + (execErr.stderr || "");
    exitCode = execErr.status || 1;
  }

  // Try to parse JSON output from vitest
  try {
    // vitest JSON output may be mixed with other output, find the JSON block
    const jsonMatch = raw.match(/\{[\s\S]*"testResults"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const failures: Array<{ test: string; error: string }> = [];

      if (parsed.testResults) {
        for (const suite of parsed.testResults) {
          if (suite.assertionResults) {
            for (const test of suite.assertionResults) {
              if (test.status === "failed") {
                failures.push({
                  test: test.fullName || test.title,
                  error: (test.failureMessages || []).join("\n").substring(0, 500),
                });
              }
            }
          }
        }
      }

      return {
        passed: parsed.numFailedTests === 0,
        failed: parsed.numFailedTests || 0,
        total: parsed.numTotalTests || 0,
        duration: `${((parsed.testResults?.[0]?.endTime || 0) - (parsed.testResults?.[0]?.startTime || 0))}ms`,
        failures,
      };
    }
  } catch {
    // JSON parse failed, fall back to exit code
  }

  // Fallback: use exit code to determine pass/fail
  return {
    passed: exitCode === 0,
    failed: exitCode === 0 ? 0 : -1,
    total: -1,
    duration: "unknown",
    failures: exitCode !== 0
      ? [{ test: "vitest", error: raw.substring(0, 1000) }]
      : [],
  };
});
