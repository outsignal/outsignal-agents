"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorBanner } from "@/components/ui/error-banner";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Skeleton } from "@/components/ui/skeleton";
import type { RevenueResponse } from "@/app/api/revenue/route";

// ---- Types ------------------------------------------------------------------

interface CostData {
  services: Array<{
    id: string;
    service: string;
    label: string;
    monthlyCost: number;
    notes: string | null;
    category: string;
    client: string | null;
    url: string | null;
  }>;
  totalMonthly: number;
  byCategory: Record<string, number>;
  byClient: Record<string, number>;
}

interface ClientRow {
  name: string;
  slug: string;
  monthlyRevenue: number; // in GBP (pounds)
  monthlyCosts: number; // in GBP (pounds)
  net: number;
  margin: number; // percentage
}

// ---- Helpers ----------------------------------------------------------------

function fmtGbp(amount: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(amount);
}

function fmtPct(value: number): string {
  if (!isFinite(value)) return "-";
  return `${value.toFixed(1)}%`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const CATEGORY_COLORS: Record<string, string> = {
  infrastructure: "oklch(0.714 0.143 215.221)",
  api: "oklch(0.82 0.148 68)",
  email: "oklch(0.845 0.143 155)",
  tools: "oklch(0.714 0.143 310)",
};

const CATEGORY_ORDER = ["tools", "api", "email", "infrastructure"];

// ---- Main Page --------------------------------------------------------------

export default function CashflowPage() {
  const [revenue, setRevenue] = useState<RevenueResponse | null>(null);
  const [costs, setCosts] = useState<CostData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [revRes, costRes] = await Promise.all([
        fetch("/api/revenue?months=12"),
        fetch("/api/platform-costs"),
      ]);
      if (!revRes.ok) throw new Error(`Revenue API: HTTP ${revRes.status}`);
      if (!costRes.ok) throw new Error(`Costs API: HTTP ${costRes.status}`);

      const [revJson, costJson] = await Promise.all([
        revRes.json() as Promise<RevenueResponse>,
        costRes.json() as Promise<CostData>,
      ]);

      setRevenue(revJson);
      setCosts(costJson);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Derived values (all in GBP / pounds)
  const mrrGbp = revenue ? revenue.mrrPence / 100 : 0;
  const totalCostsGbp = costs?.totalMonthly ?? 0;
  const netMonthly = mrrGbp - totalCostsGbp;
  const profitMargin = mrrGbp > 0 ? (netMonthly / mrrGbp) * 100 : 0;

  // Per-client P&L rows
  const clientRows = useMemo((): ClientRow[] => {
    if (!revenue || !costs) return [];

    // Build a set of all client slugs from both sources
    const allSlugs = new Set<string>();

    // Revenue clients
    const revenueBySlug = new Map<string, { name: string; totalPaidPence: number; invoiceCount: number }>();
    for (const c of revenue.clientBreakdown) {
      allSlugs.add(c.workspaceSlug);
      revenueBySlug.set(c.workspaceSlug, {
        name: c.workspaceName,
        totalPaidPence: c.totalPaidPence,
        invoiceCount: c.invoiceCount,
      });
    }

    // Cost clients (exclude "shared")
    const costsBySlug = costs.byClient;
    for (const slug of Object.keys(costsBySlug)) {
      if (slug !== "shared") allSlugs.add(slug);
    }

    const rows: ClientRow[] = [];
    for (const slug of allSlugs) {
      const rev = revenueBySlug.get(slug);
      // Approximate monthly revenue: use MRR spread across clients by their share of total revenue
      // Or simpler: totalPaid / invoiceCount as avg per invoice (monthly proxy)
      const monthlyRev = rev && rev.invoiceCount > 0
        ? (rev.totalPaidPence / rev.invoiceCount) / 100
        : 0;
      const clientCost = costsBySlug[slug] ?? 0;
      const net = monthlyRev - clientCost;
      const margin = monthlyRev > 0 ? (net / monthlyRev) * 100 : clientCost > 0 ? -100 : 0;

      rows.push({
        name: rev?.name ?? capitalize(slug),
        slug,
        monthlyRevenue: monthlyRev,
        monthlyCosts: clientCost,
        net,
        margin,
      });
    }

    // Add shared/overhead row
    const sharedCosts = costsBySlug["shared"] ?? 0;
    if (sharedCosts > 0) {
      rows.push({
        name: "Shared / Overhead",
        slug: "shared",
        monthlyRevenue: 0,
        monthlyCosts: sharedCosts,
        net: -sharedCosts,
        margin: -100,
      });
    }

    // Sort by net descending (most profitable first), shared always last
    rows.sort((a, b) => {
      if (a.slug === "shared") return 1;
      if (b.slug === "shared") return -1;
      return b.net - a.net;
    });

    return rows;
  }, [revenue, costs]);

  return (
    <div>
      <Header
        title="Cashflow"
        description="Revenue vs costs -- monthly profitability overview"
      />

      <div className="p-6 space-y-6">
        {error && (
          <ErrorBanner
            message={`Failed to load data: ${error}`}
            onRetry={() => void fetchData()}
          />
        )}

        {/* Summary KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[88px] rounded-lg" />
            ))
          ) : (
            <>
              <MetricCard
                label="Monthly Revenue (MRR)"
                value={fmtGbp(mrrGbp)}
                trend={mrrGbp > 0 ? "up" : "neutral"}
                detail="3-month average"
                density="compact"
              />
              <MetricCard
                label="Monthly Costs"
                value={fmtGbp(totalCostsGbp)}
                trend="neutral"
                detail={`${costs?.services.length ?? 0} services`}
                density="compact"
              />
              <MetricCard
                label="Net Monthly Cashflow"
                value={fmtGbp(netMonthly)}
                trend={netMonthly > 0 ? "up" : netMonthly < 0 ? "down" : "neutral"}
                detail={netMonthly >= 0 ? "Profitable" : "Loss-making"}
                density="compact"
              />
              <MetricCard
                label="Profit Margin"
                value={fmtPct(profitMargin)}
                trend={profitMargin > 0 ? "up" : profitMargin < 0 ? "down" : "neutral"}
                detail="Net / MRR"
                density="compact"
              />
            </>
          )}
        </div>

        {/* Per-Client P&L Table */}
        <Card>
          <CardHeader>
            <CardTitle>Per-Client Profitability</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-6 space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : clientRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <p className="text-sm text-muted-foreground">
                  No client data available yet.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                      <th className="text-left px-4 py-3">Client</th>
                      <th className="text-right px-4 py-3">Monthly Revenue</th>
                      <th className="text-right px-4 py-3">Monthly Costs</th>
                      <th className="text-right px-4 py-3">Net</th>
                      <th className="text-right px-4 py-3">Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clientRows.map((row) => (
                      <tr
                        key={row.slug}
                        className={`border-b border-border/50 hover:bg-muted/30 ${
                          row.slug === "shared" ? "bg-muted/20" : ""
                        }`}
                      >
                        <td className="px-4 py-3">
                          <div>
                            <p className="text-sm font-medium">{row.name}</p>
                            {row.slug !== "shared" && (
                              <p className="text-xs text-muted-foreground">{row.slug}</p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-medium tabular-nums">
                          {fmtGbp(row.monthlyRevenue)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                          {fmtGbp(row.monthlyCosts)}
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-medium tabular-nums ${
                            row.net > 0
                              ? "text-emerald-600"
                              : row.net < 0
                              ? "text-red-600"
                              : ""
                          }`}
                        >
                          {fmtGbp(row.net)}
                        </td>
                        <td
                          className={`px-4 py-3 text-right tabular-nums ${
                            row.margin > 0
                              ? "text-emerald-600"
                              : row.margin < 0
                              ? "text-red-600"
                              : "text-muted-foreground"
                          }`}
                        >
                          {fmtPct(row.margin)}
                        </td>
                      </tr>
                    ))}
                    {/* Totals row */}
                    <tr className="border-t-2 border-border font-medium bg-muted/30">
                      <td className="px-4 py-3 text-sm font-semibold">Total</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {fmtGbp(mrrGbp)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {fmtGbp(totalCostsGbp)}
                      </td>
                      <td
                        className={`px-4 py-3 text-right tabular-nums ${
                          netMonthly > 0
                            ? "text-emerald-600"
                            : netMonthly < 0
                            ? "text-red-600"
                            : ""
                        }`}
                      >
                        {fmtGbp(netMonthly)}
                      </td>
                      <td
                        className={`px-4 py-3 text-right tabular-nums ${
                          profitMargin > 0
                            ? "text-emerald-600"
                            : profitMargin < 0
                            ? "text-red-600"
                            : "text-muted-foreground"
                        }`}
                      >
                        {fmtPct(profitMargin)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Bottom Summary Section */}
        {!loading && costs && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Annual Projection */}
            <Card>
              <CardHeader>
                <CardTitle>Annual Projection</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Annual Revenue</span>
                    <span className="text-lg font-semibold tabular-nums">
                      {fmtGbp(mrrGbp * 12)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Annual Costs</span>
                    <span className="text-lg font-semibold tabular-nums text-muted-foreground">
                      {fmtGbp(totalCostsGbp * 12)}
                    </span>
                  </div>
                  <div className="border-t border-border pt-4 flex items-center justify-between">
                    <span className="text-sm font-medium">Projected Annual Profit</span>
                    <span
                      className={`text-xl font-bold tabular-nums ${
                        netMonthly > 0
                          ? "text-emerald-600"
                          : netMonthly < 0
                          ? "text-red-600"
                          : ""
                      }`}
                    >
                      {fmtGbp(netMonthly * 12)}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Cost Breakdown by Category */}
            <Card>
              <CardHeader>
                <CardTitle>Cost Breakdown by Category</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {CATEGORY_ORDER.map((cat) => {
                    const amount = costs.byCategory[cat] ?? 0;
                    const pct = totalCostsGbp > 0 ? (amount / totalCostsGbp) * 100 : 0;
                    return (
                      <div key={cat}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span
                              className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                              style={{
                                backgroundColor: CATEGORY_COLORS[cat] ?? "oklch(0.5 0 0)",
                              }}
                            />
                            <span className="text-sm">{capitalize(cat)}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {fmtPct(pct)}
                            </span>
                            <span className="text-sm font-medium tabular-nums w-20 text-right">
                              {fmtGbp(amount)}
                            </span>
                          </div>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${Math.min(pct, 100)}%`,
                              backgroundColor: CATEGORY_COLORS[cat] ?? "oklch(0.5 0 0)",
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                  {/* Other categories not in CATEGORY_ORDER */}
                  {Object.entries(costs.byCategory)
                    .filter(([cat]) => !CATEGORY_ORDER.includes(cat))
                    .map(([cat, amount]) => {
                      const pct = totalCostsGbp > 0 ? (amount / totalCostsGbp) * 100 : 0;
                      return (
                        <div key={cat}>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0 bg-muted-foreground" />
                              <span className="text-sm">{capitalize(cat)}</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-muted-foreground tabular-nums">
                                {fmtPct(pct)}
                              </span>
                              <span className="text-sm font-medium tabular-nums w-20 text-right">
                                {fmtGbp(amount)}
                              </span>
                            </div>
                          </div>
                          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full bg-muted-foreground transition-all duration-500"
                              style={{ width: `${Math.min(pct, 100)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
