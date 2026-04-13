/**
 * starling-reconcile.ts
 *
 * CLI: Reconcile Starling incoming payments against sent invoices.
 *
 * Usage:
 *   npx tsx scripts/cli/starling-reconcile.ts [--days 7] [--dry-run]
 *
 * Options:
 *   --days N      Number of days to look back (default: 7)
 *   --dry-run     Preview matches without updating invoices
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { reconcileIncomingPayments } from "../../src/lib/starling/reconcile";
import { starling } from "../../src/lib/starling/client";

const args = process.argv.slice(2);

function getArg(name: string, defaultValue: string): string {
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return defaultValue;
}

const daysBack = parseInt(getArg("days", "7"), 10);
const dryRun = args.includes("--dry-run");

runWithHarness(
  "starling-reconcile [--days 7] [--dry-run]",
  async () => {
    const result = await reconcileIncomingPayments(daysBack, dryRun);

    // Also fetch balance for the report
    let balancePounds: string | null = result.balancePounds;
    if (!balancePounds) {
      try {
        const accounts = await starling.getAccounts();
        if (accounts.length > 0) {
          const balance = await starling.getBalance(accounts[0].accountUid);
          balancePounds = (balance.effectiveBalance.minorUnits / 100).toFixed(2);
        }
      } catch {
        // Non-critical
      }
    }

    return {
      dryRun,
      daysBack,
      matched: result.matched.map((m) => ({
        transaction: m.transactionUid,
        from: m.counterPartyName,
        amount: `\u00A3${m.amountPounds}`,
        date: m.settlementTime,
        reference: m.reference,
        invoice: m.invoiceNumber,
        workspace: m.workspaceSlug,
        client: m.clientCompanyName,
      })),
      unmatched: result.unmatched.map((u) => ({
        transaction: u.transactionUid,
        from: u.counterPartyName,
        amount: `\u00A3${u.amountPounds}`,
        date: u.settlementTime,
        reference: u.reference,
        reason: u.reason,
        matchingInvoiceCount: u.matchingInvoiceCount,
      })),
      summary: {
        matchedCount: result.matched.length,
        unmatchedCount: result.unmatched.length,
        balance: balancePounds ? `\u00A3${balancePounds}` : "unavailable",
        period: `${result.periodStart} to ${result.periodEnd}`,
      },
    };
  },
);
