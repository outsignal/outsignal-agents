/**
 * credit-tracker.ts
 *
 * Per-platform credit balance tracking with API + memory fallback,
 * pre/post cost reporting, and over-budget warnings.
 *
 * Purpose: Prevent overspend by estimating costs before execution
 * and reporting actual costs after each search run.
 */

import { prisma } from "@/lib/db";
import { PROVIDER_COSTS } from "@/lib/enrichment/costs";

// ---------------------------------------------------------------------------
// Exported interfaces
// ---------------------------------------------------------------------------

export interface PlatformBalance {
  platform: string;
  creditsRemaining: number | null; // null = unknown
  monthlyBudget: number;
  monthlySpent: number;
  source: "api" | "memory" | "estimate";
}

export interface CostReport {
  totalCostUsd: number;
  costPerVerifiedLead: number | null;
  platformBreakdown: Array<{ platform: string; costUsd: number; creditsUsed: number }>;
  creditsRemaining: Record<string, PlatformBalance>;
}

// ---------------------------------------------------------------------------
// Monthly budget defaults per platform (USD)
// ---------------------------------------------------------------------------

const PLATFORM_MONTHLY_BUDGETS: Record<string, number> = {
  prospeo: 25,
  aiark: 15,
  "prospeo-search": 25,
  "aiark-search": 15,
  "serper-web": 10,
  "serper-maps": 10,
  firecrawl: 10,
  "firecrawl-extract": 10,
  leadmagic: 30,
  "leadmagic-verify": 30,
  findymail: 10,
  "apify-leads-finder": 29,
  "google-maps": 10,
  "ecommerce-stores": 15,
  builtwith: 10,
};

// ---------------------------------------------------------------------------
// Source name to provider cost key mapping (matches leads.ts)
// ---------------------------------------------------------------------------

const SOURCE_COST_MAP: Record<string, string> = {
  apollo: "apollo-search",
  prospeo: "prospeo-search",
  aiark: "aiark-search",
  "leads-finder": "apify-leads-finder",
  "serper-web": "serper-web",
  "serper-maps": "serper-maps",
  firecrawl: "firecrawl-extract",
  "google-maps": "google-maps",
  "ecommerce-stores": "ecommerce-stores",
};

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/**
 * Get current credit balance and monthly spend for a platform.
 * Queries EnrichmentLog for actual spend this month.
 * Falls back to spend-based estimate (budget - spent).
 */
export async function getPlatformBalance(platform: string): Promise<PlatformBalance> {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const logs = await prisma.enrichmentLog.aggregate({
    where: {
      provider: platform,
      runAt: { gte: monthStart },
      status: "success",
    },
    _sum: { costUsd: true },
  });

  const monthlySpent = logs._sum.costUsd ?? 0;
  const monthlyBudget = PLATFORM_MONTHLY_BUDGETS[platform] ?? 50;
  const creditsRemaining = Math.max(0, monthlyBudget - monthlySpent);

  return {
    platform,
    creditsRemaining,
    monthlyBudget,
    monthlySpent: Math.round(monthlySpent * 1000) / 1000,
    source: "estimate",
  };
}

/**
 * Report actual search cost after execution.
 * Pure function — aggregates cost across runs, computes cost-per-verified-lead.
 */
export function reportSearchCost(
  runs: Array<{ platform: string; costUsd: number; resultCount: number }>,
  verifiedCount: number,
): CostReport {
  const totalCostUsd = Math.round(runs.reduce((sum, r) => sum + r.costUsd, 0) * 1000) / 1000;

  const platformBreakdown = runs.map((r) => ({
    platform: r.platform,
    costUsd: Math.round(r.costUsd * 1000) / 1000,
    creditsUsed: r.resultCount,
  }));

  const costPerVerifiedLead =
    verifiedCount > 0 ? Math.round((totalCostUsd / verifiedCount) * 1000) / 1000 : null;

  return {
    totalCostUsd,
    costPerVerifiedLead,
    platformBreakdown,
    creditsRemaining: {}, // populated by caller if needed
  };
}

/**
 * Estimate search cost before execution using PROVIDER_COSTS map.
 * Pure function — no API calls.
 */
export function estimateSearchCost(
  sources: Array<{ name: string; estimatedVolume: number }>,
): { totalEstimatedUsd: number; breakdown: Array<{ platform: string; estimatedUsd: number }> } {
  const breakdown = sources.map((s) => {
    const costKey = SOURCE_COST_MAP[s.name] ?? s.name;
    const costPerCall = PROVIDER_COSTS[costKey] ?? 0;

    let estimatedUsd: number;
    if (s.name === "apollo") {
      estimatedUsd = 0; // free
    } else if (s.name === "leads-finder" || s.name === "ecommerce-stores") {
      // Charged per lead
      const perLead = s.name === "leads-finder" ? 0.002 : 0.004;
      estimatedUsd = s.estimatedVolume * perLead;
    } else {
      // Other sources: ~1 API call per 25 results
      const estimatedCalls = Math.max(1, Math.ceil(s.estimatedVolume / 25));
      estimatedUsd = costPerCall * estimatedCalls;
    }

    return {
      platform: s.name,
      estimatedUsd: Math.round(estimatedUsd * 1000) / 1000,
    };
  });

  const totalEstimatedUsd = Math.round(
    breakdown.reduce((sum, b) => sum + b.estimatedUsd, 0) * 1000,
  ) / 1000;

  return { totalEstimatedUsd, breakdown };
}
