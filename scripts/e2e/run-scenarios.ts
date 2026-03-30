#!/usr/bin/env npx tsx
/**
 * E2E Regression Runner
 *
 * Runs all E2E scenario tests and produces a structured failure report.
 *
 * Usage:
 *   npx tsx scripts/e2e/run-scenarios.ts                      # Run all scenarios
 *   npx tsx scripts/e2e/run-scenarios.ts --scenario happy-path # Run single scenario
 */

import { execSync } from "child_process";
import { writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScenarioResult {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
  failedGate?: string;
  reproSteps: string[];
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Scenario registry
// ---------------------------------------------------------------------------

const SCENARIOS = [
  {
    name: "happy-path",
    description: "Full pipeline happy path",
    testFile: "src/__tests__/e2e/scenarios/happy-path.test.ts",
  },
  {
    name: "violation-rewrite",
    description: "Violation detection + rewrite loop",
    testFile: "src/__tests__/e2e/scenarios/violation-rewrite.test.ts",
  },
  {
    name: "linkedin-channel",
    description: "LinkedIn-only channel routing",
    testFile: "src/__tests__/e2e/scenarios/linkedin-channel.test.ts",
  },
  {
    name: "portal-422",
    description: "Portal 422 hard-block",
    testFile: "src/__tests__/e2e/scenarios/portal-422.test.ts",
  },
  {
    name: "edge-cases",
    description: "Budget, domain resolution, overlap",
    testFile: "src/__tests__/e2e/scenarios/edge-cases.test.ts",
  },
];

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

function parseArgs(): { scenario?: string } {
  const args = process.argv.slice(2);
  const scenarioIdx = args.indexOf("--scenario");
  if (scenarioIdx !== -1 && args[scenarioIdx + 1]) {
    return { scenario: args[scenarioIdx + 1] };
  }
  return {};
}

// ---------------------------------------------------------------------------
// Run a single scenario via vitest
// ---------------------------------------------------------------------------

function runScenario(scenario: (typeof SCENARIOS)[number]): ScenarioResult {
  const start = Date.now();
  try {
    const output = execSync(
      `npx vitest run --reporter=json ${scenario.testFile} 2>/dev/null`,
      {
        cwd: resolve(__dirname, "../.."),
        encoding: "utf-8",
        timeout: 60_000,
      },
    );

    let durationMs = Date.now() - start;

    // Try to extract duration from vitest JSON output
    try {
      const json = JSON.parse(output);
      if (json.testResults?.[0]?.startTime && json.testResults?.[0]?.endTime) {
        durationMs =
          json.testResults[0].endTime - json.testResults[0].startTime;
      }
    } catch {
      // JSON parsing failed — use wall-clock time
    }

    return {
      name: scenario.name,
      passed: true,
      expected: "all tests pass",
      actual: "all tests pass",
      reproSteps: [
        `npx vitest run ${scenario.testFile}`,
        `npx tsx scripts/e2e/run-scenarios.ts --scenario ${scenario.name}`,
      ],
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - start;
    let actual = "test execution failed";

    if (error && typeof error === "object" && "stdout" in error) {
      const stdout = (error as { stdout: string }).stdout;
      // Try to extract failure message from vitest JSON
      try {
        const json = JSON.parse(stdout);
        const firstFailure = json.testResults?.[0]?.assertionResults?.find(
          (r: { status: string }) => r.status === "failed",
        );
        if (firstFailure) {
          actual = firstFailure.failureMessages?.[0]?.split("\n")[0] || actual;
        }
      } catch {
        // Not JSON — extract first error line
        const lines = stdout.split("\n");
        const errorLine = lines.find(
          (l: string) => l.includes("FAIL") || l.includes("AssertionError"),
        );
        if (errorLine) actual = errorLine.trim();
      }
    }

    return {
      name: scenario.name,
      passed: false,
      expected: "all tests pass",
      actual,
      reproSteps: [
        `npx vitest run ${scenario.testFile}`,
        `npx tsx scripts/e2e/run-scenarios.ts --scenario ${scenario.name}`,
      ],
      durationMs,
    };
  }
}

// ---------------------------------------------------------------------------
// Report formatting
// ---------------------------------------------------------------------------

function formatReport(results: ScenarioResult[]): string {
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
    lines.push(`- **Reproduction:**`);
    for (const step of r.reproSteps) {
      lines.push(`  - \`${step}\``);
    }
    lines.push(`- **Duration:** ${r.durationMs}ms`);
    lines.push(``);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const { scenario: scenarioFilter } = parseArgs();

  const scenariosToRun = scenarioFilter
    ? SCENARIOS.filter((s) => s.name === scenarioFilter)
    : SCENARIOS;

  if (scenariosToRun.length === 0) {
    console.error(
      `Unknown scenario: ${scenarioFilter}. Available: ${SCENARIOS.map((s) => s.name).join(", ")}`,
    );
    process.exit(1);
  }

  console.log(`\n=== E2E Regression Results ===\n`);

  const results: ScenarioResult[] = [];

  for (const scenario of scenariosToRun) {
    const result = runScenario(scenario);
    results.push(result);

    const status = result.passed ? "[PASS]" : "[FAIL]";
    const duration = (result.durationMs / 1000).toFixed(1);
    const extra = result.passed ? "" : ` — ${result.actual.slice(0, 60)}`;
    console.log(`${status} ${result.name} (${duration}s)${extra}`);
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log(`\nResults: ${passed}/${results.length} passed, ${failed} failed\n`);

  if (failed > 0) {
    const reportPath = resolve(
      __dirname,
      "../../.planning/phases/58-end-to-end-validation/failure-report.md",
    );
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, formatReport(results), "utf-8");
    console.log(`Failure report: ${reportPath}\n`);
    process.exit(1);
  }

  process.exit(0);
}

main();
