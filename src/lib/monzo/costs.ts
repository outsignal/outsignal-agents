// =============================================================================
// Monzo Cost Summary
//
// Categorises outgoing transactions by merchant into business cost categories:
// API costs, infrastructure, tools, and other.
// =============================================================================

import { monzo } from "./client";
import type { MonzoTransaction } from "./client";

// =============================================================================
// Types
// =============================================================================

export type CostCategory = "api" | "infrastructure" | "tools" | "other";

export interface CostEntry {
  merchantName: string;
  category: CostCategory;
  totalMinorUnits: number;
  totalPounds: string;
  transactionCount: number;
}

export interface CostSummary {
  period: { start: string; end: string };
  byCategory: Record<CostCategory, number>; // minor units
  byCategoryPounds: Record<CostCategory, string>;
  grandTotalMinorUnits: number;
  grandTotalPounds: string;
  topMerchants: CostEntry[];
  allMerchants: CostEntry[];
  balanceMinorUnits: number | null;
  balancePounds: string | null;
}

// =============================================================================
// Merchant categorisation
// =============================================================================

/**
 * Known merchant name patterns mapped to categories.
 * Matched case-insensitively against merchant name or transaction description.
 */
const CATEGORY_PATTERNS: { pattern: RegExp; category: CostCategory }[] = [
  // API costs
  { pattern: /prospeo/i, category: "api" },
  { pattern: /ai\s*ark/i, category: "api" },
  { pattern: /apify/i, category: "api" },
  { pattern: /findymail/i, category: "api" },
  { pattern: /bounceban/i, category: "api" },
  { pattern: /kitt/i, category: "api" },
  { pattern: /leadmagic/i, category: "api" },
  { pattern: /openai/i, category: "api" },
  { pattern: /anthropic/i, category: "api" },
  { pattern: /serper/i, category: "api" },
  { pattern: /firecrawl/i, category: "api" },
  { pattern: /adyntel/i, category: "api" },
  { pattern: /clay/i, category: "api" },

  // Infrastructure
  { pattern: /vercel/i, category: "infrastructure" },
  { pattern: /railway/i, category: "infrastructure" },
  { pattern: /trigger\.dev/i, category: "infrastructure" },
  { pattern: /triggerdev/i, category: "infrastructure" },
  { pattern: /supabase/i, category: "infrastructure" },
  { pattern: /neon/i, category: "infrastructure" },
  { pattern: /aws/i, category: "infrastructure" },
  { pattern: /google\s*cloud/i, category: "infrastructure" },
  { pattern: /cloudflare/i, category: "infrastructure" },
  { pattern: /digital\s*ocean/i, category: "infrastructure" },

  // Tools
  { pattern: /cheapinboxes/i, category: "tools" },
  { pattern: /porkbun/i, category: "tools" },
  { pattern: /emailguard/i, category: "tools" },
  { pattern: /emailbison/i, category: "tools" },
  { pattern: /dynadot/i, category: "tools" },
  { pattern: /iproyal/i, category: "tools" },
  { pattern: /notion/i, category: "tools" },
  { pattern: /linear/i, category: "tools" },
  { pattern: /github/i, category: "tools" },
  { pattern: /slack/i, category: "tools" },
  { pattern: /zapier/i, category: "tools" },
];

function categoriseMerchant(
  merchantName: string | null,
  description: string,
): { name: string; category: CostCategory } {
  const searchStr = merchantName || description;
  const name = merchantName || description || "Unknown";

  for (const { pattern, category } of CATEGORY_PATTERNS) {
    if (pattern.test(searchStr)) {
      return { name, category };
    }
  }

  return { name, category: "other" };
}

// =============================================================================
// Cost summary function
// =============================================================================

/**
 * Generate a cost summary for a given period.
 *
 * @param since - Start date (default: first day of current month)
 */
export async function getCostSummary(since?: Date): Promise<CostSummary> {
  // Default to start of current month
  const periodStart =
    since ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const periodEnd = new Date();

  // Get accounts
  const accounts = await monzo.getAccounts();
  const activeAccounts = accounts.filter((a) => !a.closed);
  if (activeAccounts.length === 0) {
    throw new Error("No active Monzo accounts found");
  }

  const account = activeAccounts[0];

  // Fetch transactions
  const transactions = await monzo.getTransactions(account.id, periodStart);

  // Filter to outgoing only (amount < 0)
  const outgoing = transactions.filter((tx) => tx.amount < 0);

  // Group by merchant and categorise
  const merchantMap = new Map<
    string,
    { category: CostCategory; totalMinorUnits: number; count: number }
  >();

  for (const tx of outgoing) {
    const { name, category } = categoriseMerchant(
      tx.merchant?.name ?? null,
      tx.description,
    );

    const existing = merchantMap.get(name);
    if (existing) {
      existing.totalMinorUnits += Math.abs(tx.amount);
      existing.count += 1;
    } else {
      merchantMap.set(name, {
        category,
        totalMinorUnits: Math.abs(tx.amount),
        count: 1,
      });
    }
  }

  // Build cost entries sorted by total descending
  const allMerchants: CostEntry[] = Array.from(merchantMap.entries())
    .map(([merchantName, data]) => ({
      merchantName,
      category: data.category,
      totalMinorUnits: data.totalMinorUnits,
      totalPounds: (data.totalMinorUnits / 100).toFixed(2),
      transactionCount: data.count,
    }))
    .sort((a, b) => b.totalMinorUnits - a.totalMinorUnits);

  // Category totals
  const byCategory: Record<CostCategory, number> = {
    api: 0,
    infrastructure: 0,
    tools: 0,
    other: 0,
  };

  for (const entry of allMerchants) {
    byCategory[entry.category] += entry.totalMinorUnits;
  }

  const byCategoryPounds: Record<CostCategory, string> = {
    api: (byCategory.api / 100).toFixed(2),
    infrastructure: (byCategory.infrastructure / 100).toFixed(2),
    tools: (byCategory.tools / 100).toFixed(2),
    other: (byCategory.other / 100).toFixed(2),
  };

  const grandTotal = Object.values(byCategory).reduce((a, b) => a + b, 0);

  // Get balance
  let balanceMinorUnits: number | null = null;
  let balancePounds: string | null = null;
  try {
    const balance = await monzo.getBalance(account.id);
    balanceMinorUnits = balance.balance;
    balancePounds = (balance.balance / 100).toFixed(2);
  } catch {
    // Balance fetch is non-critical
  }

  return {
    period: {
      start: periodStart.toISOString(),
      end: periodEnd.toISOString(),
    },
    byCategory,
    byCategoryPounds,
    grandTotalMinorUnits: grandTotal,
    grandTotalPounds: (grandTotal / 100).toFixed(2),
    topMerchants: allMerchants.slice(0, 10),
    allMerchants,
    balanceMinorUnits,
    balancePounds,
  };
}
