/**
 * Budget Gate
 *
 * Enforces token budget thresholds before expensive operations.
 * Calls getBudgetSnapshot() and applies threshold logic:
 *   < 60%:    allow
 *   60-85%:   allow with warning
 *   85-100%:  block (queued)
 *   >= 100%:  hard block (unless FORCE_BYPASS_BUDGET=1)
 */

import { getBudgetSnapshot, type BudgetSnapshot } from "./tracker";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BudgetCheckResult {
  allow: boolean;
  queued: boolean;
  percentOfBudget: number;
  reason: string;
  snapshot: BudgetSnapshot;
}

// ---------------------------------------------------------------------------
// Gate logic
// ---------------------------------------------------------------------------

export async function checkBudget(taskType: string): Promise<BudgetCheckResult> {
  const snapshot = await getBudgetSnapshot();
  const pct = snapshot.percentageUsed;

  if (pct < 60) {
    return {
      allow: true,
      queued: false,
      percentOfBudget: pct,
      reason: `Budget OK (${pct.toFixed(1)}% used)`,
      snapshot,
    };
  }

  if (pct < 85) {
    console.warn(
      `[budget-gate] WARNING: ${taskType} running at ${pct.toFixed(1)}% of 5h budget`,
    );
    return {
      allow: true,
      queued: false,
      percentOfBudget: pct,
      reason: `Budget warning (${pct.toFixed(1)}% used)`,
      snapshot,
    };
  }

  if (pct < 100) {
    console.error(
      `[budget-gate] BLOCKED: ${taskType} blocked at ${pct.toFixed(1)}% of 5h budget. Queued for retry.`,
    );
    return {
      allow: false,
      queued: true,
      percentOfBudget: pct,
      reason: `Budget near limit (${pct.toFixed(1)}% used). Task queued.`,
      snapshot,
    };
  }

  // >= 100%
  const forceBypass = process.env.FORCE_BYPASS_BUDGET === "1";
  if (forceBypass) {
    console.warn(
      `[budget-gate] FORCE BYPASS: ${taskType} at ${pct.toFixed(1)}% — FORCE_BYPASS_BUDGET=1 set`,
    );
    return {
      allow: true,
      queued: false,
      percentOfBudget: pct,
      reason: `Budget exceeded (${pct.toFixed(1)}%) but FORCE_BYPASS_BUDGET=1`,
      snapshot,
    };
  }

  console.error(
    `[budget-gate] HARD BLOCK: ${taskType} at ${pct.toFixed(1)}% of 5h budget. Set FORCE_BYPASS_BUDGET=1 to override.`,
  );
  return {
    allow: false,
    queued: false,
    percentOfBudget: pct,
    reason: `Budget exceeded (${pct.toFixed(1)}% used). Hard block.`,
    snapshot,
  };
}

// ---------------------------------------------------------------------------
// CLI-friendly status printer
// ---------------------------------------------------------------------------

export async function printBudgetStatus(): Promise<void> {
  const snapshot = await getBudgetSnapshot();
  const pct = snapshot.percentageUsed;
  const sessionCount = Object.keys(snapshot.bySession).length;

  const bar = buildProgressBar(pct);

  console.log("\n=== Claude Code Budget Status ===\n");
  console.log(`  Window:     ${snapshot.windowHours}h rolling`);
  console.log(
    `  Usage:      ${formatTokens(snapshot.totalWeight)} tokens (${pct.toFixed(1)}%)`,
  );
  console.log(`  Progress:   ${bar}`);
  console.log(`  Records:    ${snapshot.recordCount} assistant responses`);
  console.log(`  Sessions:   ${sessionCount}`);
  console.log(
    `  Oldest:     ${snapshot.oldestRecord?.toISOString() ?? "none"}`,
  );
  console.log(
    `  Newest:     ${snapshot.newestRecord?.toISOString() ?? "none"}`,
  );

  if (pct >= 100) {
    console.log("\n  Status:     EXCEEDED -- operations will be blocked");
  } else if (pct >= 85) {
    console.log("\n  Status:     CRITICAL -- new operations blocked");
  } else if (pct >= 60) {
    console.log("\n  Status:     WARNING -- approaching limit");
  } else {
    console.log("\n  Status:     OK");
  }

  // Top sessions by usage
  const sorted = Object.entries(snapshot.bySession)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  if (sorted.length > 0) {
    console.log("\n  Top sessions:");
    for (const [sid, weight] of sorted) {
      const short = sid.substring(0, 8);
      const sPct = ((weight / snapshot.totalWeight) * 100).toFixed(1);
      console.log(`    ${short}...  ${formatTokens(weight)} (${sPct}%)`);
    }
  }

  console.log("");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function buildProgressBar(pct: number): string {
  const width = 30;
  const filled = Math.min(width, Math.round((pct / 100) * width));
  const empty = width - filled;
  const char = pct >= 85 ? "!" : pct >= 60 ? "#" : "=";
  return `[${char.repeat(filled)}${".".repeat(empty)}] ${pct.toFixed(1)}%`;
}
