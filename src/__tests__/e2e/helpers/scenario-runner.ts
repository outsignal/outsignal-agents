/**
 * Scenario execution wrapper with structured failure reporting.
 *
 * Used by E2E tests and the CLI regression runner.
 */

import { writeFileSync } from "fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScenarioResult {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
  failedGate?: string;
  reproSteps: string[];
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Scenario runner
// ---------------------------------------------------------------------------

/**
 * Wrap a scenario function — catches errors, measures duration, returns structured result.
 */
export async function runScenario(
  name: string,
  fn: () => Promise<void>,
): Promise<ScenarioResult> {
  const start = Date.now();
  try {
    await fn();
    return {
      name,
      passed: true,
      expected: "all tests pass",
      actual: "all tests pass",
      reproSteps: [],
      durationMs: Date.now() - start,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Try to extract a gate name from the error message
    const gateMatch = message.match(/gate "([^"]+)"/);
    return {
      name,
      passed: false,
      expected: "all tests pass",
      actual: message,
      failedGate: gateMatch?.[1],
      reproSteps: [
        `npx vitest run src/__tests__/e2e/scenarios/${name}.test.ts`,
        `npx tsx scripts/e2e/run-scenarios.ts --scenario ${name}`,
      ],
      durationMs: Date.now() - start,
    };
  }
}

// ---------------------------------------------------------------------------
// Failure report formatting
// ---------------------------------------------------------------------------

/**
 * Generate a markdown-formatted failure report.
 */
export function formatFailureReport(results: ScenarioResult[]): string {
  const timestamp = new Date().toISOString();
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  const lines: string[] = [
    `# E2E Regression Failure Report`,
    ``,
    `**Run:** ${timestamp}`,
    `**Results:** ${passed}/${results.length} passed, ${failed} failed`,
    ``,
  ];

  if (failed === 0) {
    lines.push(`All scenarios passed.`);
    return lines.join("\n");
  }

  lines.push(`## Failures`);
  lines.push(``);

  for (const r of results.filter((r) => !r.passed)) {
    lines.push(`### ${r.name}`);
    lines.push(``);
    lines.push(`- **Expected:** ${r.expected}`);
    lines.push(`- **Actual:** ${r.actual}`);
    if (r.failedGate) {
      lines.push(`- **Failed gate:** ${r.failedGate}`);
    }
    if (r.reproSteps.length > 0) {
      lines.push(`- **Reproduction:**`);
      for (const step of r.reproSteps) {
        lines.push(`  - \`${step}\``);
      }
    }
    lines.push(`- **Duration:** ${r.durationMs}ms`);
    lines.push(``);
  }

  return lines.join("\n");
}

/**
 * Write the formatted report to a file.
 */
export function writeFailureReport(
  results: ScenarioResult[],
  outputPath = ".planning/phases/58-end-to-end-validation/failure-report.md",
): void {
  const report = formatFailureReport(results);
  writeFileSync(outputPath, report, "utf-8");
}
