/**
 * finance-summary.ts
 *
 * CLI: Weekly finance summary combining Starling revenue,
 * Monzo costs, and invoice status.
 *
 * Usage:
 *   npx tsx scripts/cli/finance-summary.ts [--days 7]
 *
 * Options:
 *   --days N   Number of days to look back (default: 7)
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { getWeeklyFinanceSummary } from "../../src/lib/finance/weekly-summary";

const args = process.argv.slice(2);

function getArg(name: string, defaultValue: string): string {
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return defaultValue;
}

const daysBack = parseInt(getArg("days", "7"), 10);

runWithHarness("finance-summary [--days 7]", async () => {
  const summary = await getWeeklyFinanceSummary(daysBack);

  const fmt = (pence: number) => `\u00A3${(pence / 100).toFixed(2)}`;

  return {
    period: `Last ${daysBack} days`,
    revenue: {
      received: fmt(summary.revenue.received),
      outstanding: fmt(summary.revenue.outstanding),
      overdue: fmt(summary.revenue.overdue),
    },
    costs: {
      total: fmt(summary.costs.total),
      byCategory: Object.fromEntries(
        Object.entries(summary.costs.byCategory).map(([k, v]) => [k, fmt(v)]),
      ),
    },
    margin: fmt(summary.margin),
    invoices: summary.invoices,
    alerts: summary.alerts.length > 0 ? summary.alerts : ["No alerts"],
  };
});
