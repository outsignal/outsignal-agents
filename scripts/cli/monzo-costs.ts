/**
 * monzo-costs.ts
 *
 * CLI: Generate a cost summary from Monzo transactions.
 *
 * Usage:
 *   npx tsx scripts/cli/monzo-costs.ts [--since YYYY-MM-DD]
 *
 * Options:
 *   --since DATE   Start date (default: first of current month)
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { getCostSummary } from "../../src/lib/monzo/costs";

const args = process.argv.slice(2);

function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return undefined;
}

const sinceStr = getArg("since");
const since = sinceStr ? new Date(sinceStr) : undefined;

runWithHarness("monzo-costs [--since YYYY-MM-DD]", async () => {
  const summary = await getCostSummary(since);

  return {
    period: summary.period,
    costs: {
      api: `\u00A3${summary.byCategoryPounds.api}`,
      infrastructure: `\u00A3${summary.byCategoryPounds.infrastructure}`,
      tools: `\u00A3${summary.byCategoryPounds.tools}`,
      other: `\u00A3${summary.byCategoryPounds.other}`,
      total: `\u00A3${summary.grandTotalPounds}`,
    },
    topMerchants: summary.topMerchants.map((m) => ({
      merchant: m.merchantName,
      category: m.category,
      total: `\u00A3${m.totalPounds}`,
      transactions: m.transactionCount,
    })),
    balance: summary.balancePounds
      ? `\u00A3${summary.balancePounds}`
      : "unavailable",
  };
});
