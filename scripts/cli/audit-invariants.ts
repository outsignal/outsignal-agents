/**
 * audit-invariants.ts
 *
 * CLI wrapper around src/lib/audit/invariants.ts.
 *
 * Runs the three system invariants audit and prints a pass/fail table per
 * workspace to stderr, plus the structured JSON envelope to stdout.
 *
 * Usage:
 *   npx tsx scripts/cli/audit-invariants.ts
 *
 * Exit code is informational (always 0 on successful query — does NOT exit
 * 1 on invariant failures, because that's expected during migration work).
 * Inspect the `allPass` field in the JSON envelope or the stderr table.
 *
 * READ-ONLY. No writes. Safe to run against prod DB.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { runInvariantAudit, renderAuditTable } from "@/lib/audit/invariants";

async function main() {
  const audit = await runInvariantAudit();
  process.stderr.write(renderAuditTable(audit) + "\n");
  return audit;
}

runWithHarness("audit-invariants", main);
