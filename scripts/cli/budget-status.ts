/**
 * budget-status.ts
 *
 * Quick CLI to check Claude Code token budget usage.
 *
 * Usage:
 *   npx tsx scripts/cli/budget-status.ts
 */

import { printBudgetStatus } from "../../src/lib/rate-limits/budget-gate";

printBudgetStatus()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Failed to get budget status:", err);
    process.exit(1);
  });
