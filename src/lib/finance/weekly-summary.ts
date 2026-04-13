// =============================================================================
// Weekly Finance Summary
//
// Combines Starling incoming (revenue), Monzo outgoing (costs), and
// invoice status from DB into a single structured summary.
// =============================================================================

import { prisma } from "@/lib/db";
import { reconcileIncomingPayments } from "@/lib/starling/reconcile";
import { getCostSummary } from "@/lib/monzo/costs";

// =============================================================================
// Types
// =============================================================================

export interface FinanceSummary {
  revenue: {
    received: number; // pence
    outstanding: number; // pence (sent but unpaid)
    overdue: number; // pence
  };
  costs: {
    total: number; // pence
    byCategory: Record<string, number>; // pence
  };
  margin: number; // pence (revenue.received - costs.total)
  invoices: {
    draft: number;
    sent: number;
    paid: number;
    overdue: number;
  };
  alerts: string[];
}

// =============================================================================
// Summary function
// =============================================================================

/**
 * Generate a weekly finance summary pulling from Starling, Monzo, and the DB.
 *
 * @param daysBack - Number of days to look back for transactions (default: 7)
 */
export async function getWeeklyFinanceSummary(
  daysBack = 7,
): Promise<FinanceSummary> {
  const alerts: string[] = [];

  // -------------------------------------------------------------------------
  // 1. Starling incoming (revenue received this period)
  // -------------------------------------------------------------------------
  let revenueReceived = 0;
  try {
    const reconciliation = await reconcileIncomingPayments(daysBack, true);
    // Sum all incoming transactions (matched + unmatched)
    for (const m of reconciliation.matched) {
      revenueReceived += m.amountMinorUnits;
    }
    for (const u of reconciliation.unmatched) {
      revenueReceived += u.amountMinorUnits;
    }

    if (reconciliation.unmatched.length > 0) {
      const unmatchedCount = reconciliation.unmatched.length;
      const unmatchedTotal = reconciliation.unmatched.reduce(
        (sum, u) => sum + u.amountMinorUnits,
        0,
      );
      alerts.push(
        `${unmatchedCount} unmatched incoming payment(s) totalling ${"\u00A3"}${(unmatchedTotal / 100).toFixed(2)}`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    alerts.push(`Starling unavailable: ${msg}`);
  }

  // -------------------------------------------------------------------------
  // 2. Monzo outgoing (costs this period)
  // -------------------------------------------------------------------------
  let costsTotal = 0;
  let costsByCategory: Record<string, number> = {};
  try {
    const since = new Date();
    since.setDate(since.getDate() - daysBack);
    const costs = await getCostSummary(since);
    costsTotal = costs.grandTotalMinorUnits;
    costsByCategory = { ...costs.byCategory };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    alerts.push(`Monzo unavailable: ${msg}`);
  }

  // -------------------------------------------------------------------------
  // 3. Invoice status from DB
  // -------------------------------------------------------------------------
  const invoiceCounts = { draft: 0, sent: 0, paid: 0, overdue: 0 };
  let outstandingPence = 0;
  let overduePence = 0;

  const allInvoices = await prisma.invoice.findMany({
    select: {
      status: true,
      totalPence: true,
      createdAt: true,
      dueDate: true,
    },
  });

  const now = new Date();
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

  let oldDraftCount = 0;

  for (const inv of allInvoices) {
    const status = inv.status as "draft" | "sent" | "paid" | "overdue";
    if (status in invoiceCounts) {
      invoiceCounts[status]++;
    }

    if (status === "sent") {
      outstandingPence += inv.totalPence;
      // Check if overdue (past due date)
      if (inv.dueDate < now) {
        overduePence += inv.totalPence;
      }
    }

    if (status === "overdue") {
      overduePence += inv.totalPence;
    }

    if (status === "draft" && inv.createdAt < threeDaysAgo) {
      oldDraftCount++;
    }
  }

  // -------------------------------------------------------------------------
  // 4. Generate alerts
  // -------------------------------------------------------------------------
  if (oldDraftCount > 0) {
    alerts.push(`${oldDraftCount} draft invoice(s) older than 3 days`);
  }

  if (overduePence > 0) {
    alerts.push(
      `${"\u00A3"}${(overduePence / 100).toFixed(2)} in overdue invoices`,
    );
  }

  if (invoiceCounts.overdue > 0) {
    alerts.push(
      `${invoiceCounts.overdue} invoice(s) marked as overdue`,
    );
  }

  return {
    revenue: {
      received: revenueReceived,
      outstanding: outstandingPence,
      overdue: overduePence,
    },
    costs: {
      total: costsTotal,
      byCategory: costsByCategory,
    },
    margin: revenueReceived - costsTotal,
    invoices: invoiceCounts,
    alerts,
  };
}
