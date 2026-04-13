// =============================================================================
// Starling Bank Invoice Reconciliation
//
// Matches incoming Starling transactions against sent invoices by amount.
// Conservative: only auto-matches when exactly one sent invoice matches.
// =============================================================================

import { prisma } from "@/lib/db";
import { starling } from "./client";
import type { StarlingFeedItem } from "./client";

// =============================================================================
// Types
// =============================================================================

export interface ReconciliationMatch {
  transactionUid: string;
  counterPartyName: string;
  amountMinorUnits: number;
  amountPounds: string;
  settlementTime: string;
  reference: string;
  invoiceId: string;
  invoiceNumber: string;
  workspaceSlug: string;
  clientCompanyName: string;
}

export interface UnmatchedTransaction {
  transactionUid: string;
  counterPartyName: string;
  amountMinorUnits: number;
  amountPounds: string;
  settlementTime: string;
  reference: string;
  reason: "no_matching_invoice" | "multiple_matching_invoices";
  matchingInvoiceCount: number;
}

export interface ReconciliationResult {
  matched: ReconciliationMatch[];
  unmatched: UnmatchedTransaction[];
  balancePounds: string | null;
  periodStart: string;
  periodEnd: string;
}

// =============================================================================
// Reconcile function
// =============================================================================

/**
 * Fetch recent incoming transactions and match against sent invoices.
 *
 * @param daysBack - Number of days to look back (default: 7)
 * @param dryRun - If true, do not update invoice status (default: false)
 */
export async function reconcileIncomingPayments(
  daysBack = 7,
  dryRun = false,
): Promise<ReconciliationResult> {
  // Get accounts
  const accounts = await starling.getAccounts();
  if (accounts.length === 0) {
    throw new Error("No Starling accounts found");
  }

  const account = accounts[0];
  const since = new Date();
  since.setDate(since.getDate() - daysBack);

  // Fetch transactions
  const feedItems = await starling.getTransactions(
    account.accountUid,
    account.defaultCategory,
    since,
  );

  // Filter to incoming, settled transactions only
  const incoming = feedItems.filter(
    (item) => item.direction === "IN" && item.status === "SETTLED",
  );

  // Fetch all sent invoices (candidates for matching)
  const sentInvoices = await prisma.invoice.findMany({
    where: { status: "sent" },
    select: {
      id: true,
      invoiceNumber: true,
      totalPence: true,
      workspaceSlug: true,
      clientCompanyName: true,
    },
  });

  // Pre-fetch workspace billing company names for secondary matching
  const workspaceSlugs = [...new Set(sentInvoices.map((inv) => inv.workspaceSlug))];
  const workspaceBillingMap = new Map<string, string>();
  if (workspaceSlugs.length > 0) {
    const workspaces = await prisma.workspace.findMany({
      where: { slug: { in: workspaceSlugs } },
      select: { slug: true, name: true },
    });
    for (const ws of workspaces) {
      workspaceBillingMap.set(ws.slug, ws.name);
    }
  }

  // Fetch balance
  let balancePounds: string | null = null;
  try {
    const balance = await starling.getBalance(account.accountUid);
    balancePounds = (balance.effectiveBalance.minorUnits / 100).toFixed(2);
  } catch {
    // Balance fetch is non-critical
  }

  const matched: ReconciliationMatch[] = [];
  const unmatched: UnmatchedTransaction[] = [];

  for (const tx of incoming) {
    const txAmount = tx.amount.minorUnits;

    // Find sent invoices that match this amount exactly
    const matchingInvoices = sentInvoices.filter(
      (inv) => inv.totalPence === txAmount,
    );

    let resolvedInvoice: typeof matchingInvoices[0] | null = null;

    if (matchingInvoices.length === 1) {
      resolvedInvoice = matchingInvoices[0];
    } else if (matchingInvoices.length > 1) {
      // Secondary matching: disambiguate by reference containing invoice number
      const refMatches = matchingInvoices.filter(
        (inv) => tx.reference && tx.reference.toLowerCase().includes(inv.invoiceNumber.toLowerCase()),
      );
      if (refMatches.length === 1) {
        resolvedInvoice = refMatches[0];
      } else {
        // Secondary matching: disambiguate by counterPartyName matching workspace billing company
        const nameMatches = matchingInvoices.filter((inv) => {
          const billingName = workspaceBillingMap.get(inv.workspaceSlug) ?? inv.clientCompanyName;
          return tx.counterPartyName.toLowerCase().includes(billingName.toLowerCase()) ||
            billingName.toLowerCase().includes(tx.counterPartyName.toLowerCase());
        });
        if (nameMatches.length === 1) {
          resolvedInvoice = nameMatches[0];
        }
      }
    }

    if (resolvedInvoice) {
      const invoice = resolvedInvoice;

      // Mark invoice as paid (unless dry run)
      if (!dryRun) {
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: {
            status: "paid",
            paidAt: new Date(tx.settlementTime),
          },
        });
      }

      matched.push({
        transactionUid: tx.feedItemUid,
        counterPartyName: tx.counterPartyName,
        amountMinorUnits: txAmount,
        amountPounds: (txAmount / 100).toFixed(2),
        settlementTime: tx.settlementTime,
        reference: tx.reference,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        workspaceSlug: invoice.workspaceSlug,
        clientCompanyName: invoice.clientCompanyName,
      });

      // Remove from candidates so it cannot match again
      const idx = sentInvoices.findIndex((inv) => inv.id === invoice.id);
      if (idx !== -1) sentInvoices.splice(idx, 1);
    } else {
      unmatched.push({
        transactionUid: tx.feedItemUid,
        counterPartyName: tx.counterPartyName,
        amountMinorUnits: txAmount,
        amountPounds: (txAmount / 100).toFixed(2),
        settlementTime: tx.settlementTime,
        reference: tx.reference,
        reason:
          matchingInvoices.length === 0
            ? "no_matching_invoice"
            : "multiple_matching_invoices",
        matchingInvoiceCount: matchingInvoices.length,
      });
    }
  }

  return {
    matched,
    unmatched,
    balancePounds,
    periodStart: since.toISOString(),
    periodEnd: new Date().toISOString(),
  };
}
