/**
 * _cli-harness.ts
 *
 * Shared utility for all Monty dev-cli wrapper scripts.
 * Handles error catching, JSON envelope formatting, output sanitization, and exit codes.
 *
 * Mirrors scripts/cli/_cli-harness.ts (Nova's harness) with identical behavior.
 * Separate file maintains dev-cli/ vs cli/ namespace separation — Monty tools vs Nova tools.
 *
 * Underscore prefix = not a script itself; imported by all dev-cli wrapper scripts.
 * Gets inlined into each compiled bundle by tsup (not emitted as its own dist/dev-cli/_cli-harness.js).
 */

// Set PROJECT_ROOT before any imports that use __dirname-based resolution (e.g. load-rules.ts)
// When compiled to dist/dev-cli/, __dirname resolves to dist/dev-cli/, not project root.
// load-rules.ts has a PROJECT_ROOT env var override for exactly this scenario.
if (!process.env.PROJECT_ROOT) {
  process.env.PROJECT_ROOT = process.cwd();
}

import { sanitizeOutput } from "@/lib/sanitize-output";

/**
 * Wraps a dev-cli script's main function with standardized error handling,
 * JSON envelope output, secret sanitization, and exit code management.
 *
 * @param usage - Usage hint displayed on error (e.g. "git-status --format json")
 * @param fn - The async function to execute; return value becomes `data` in the envelope
 */
export async function runWithHarness(
  usage: string,
  fn: () => Promise<unknown>
): Promise<void> {
  try {
    const data = await fn();
    const raw = JSON.stringify({ ok: true, data }, null, 2);
    process.stdout.write(sanitizeOutput(raw) + "\n");
    process.exit(0);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const raw = JSON.stringify({ ok: false, error, usage }, null, 2);
    process.stdout.write(sanitizeOutput(raw) + "\n");
    process.exit(1);
  }
}
