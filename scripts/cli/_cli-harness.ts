/**
 * _cli-harness.ts
 *
 * Shared utility for all CLI wrapper scripts.
 * Handles error catching, JSON envelope formatting, output sanitization, and exit codes.
 *
 * Underscore prefix = not a script itself; imported by all wrapper scripts.
 * Gets inlined into each compiled bundle by tsup (not emitted as its own dist/cli/_cli-harness.js).
 */

// Set PROJECT_ROOT before any imports that use __dirname-based resolution (e.g. load-rules.ts)
// When compiled to dist/cli/, __dirname resolves to dist/cli/, not project root.
// load-rules.ts has a PROJECT_ROOT env var override for exactly this scenario.
if (!process.env.PROJECT_ROOT) {
  process.env.PROJECT_ROOT = process.cwd();
}

import { sanitizeOutput } from "@/lib/sanitize-output";

/**
 * Wraps a CLI script's main function with standardized error handling,
 * JSON envelope output, secret sanitization, and exit code management.
 *
 * @param usage - Usage hint displayed on error (e.g. "workspace-get <slug>")
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
