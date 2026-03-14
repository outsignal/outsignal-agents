"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorBanner } from "@/components/ui/error-banner";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatGBP } from "@/lib/format";
import type { RevenueResponse } from "@/app/api/revenue/route";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";

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
    billingDay: number | null;
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

  // Chart: cumulative cash timeline
  const todayDay = new Date().getDate();
  const daysInMonth = new Date(
    new Date().getFullYear(),
    new Date().getMonth() + 1,
    0,
  ).getDate();

  const chartData = useMemo(() => {
    if (!costs || !revenue) return [];
    const mrrVal = revenue.mrrPence / 100;

    // Group costs by billing day
    const costsByDay: Record<number, number> = {};
    for (const s of costs.services) {
      if (s.billingDay != null) {
        costsByDay[s.billingDay] = (costsByDay[s.billingDay] ?? 0) + s.monthlyCost;
      }
    }

    // Costs without a billing day: spread evenly across the month
    const unscheduledCost = costs.services
      .filter((s) => s.billingDay == null)
      .reduce((sum, s) => sum + s.monthlyCost, 0);
    if (unscheduledCost > 0) {
      const dailyShare = unscheduledCost / daysInMonth;
      for (let d = 1; d <= daysInMonth; d++) {
        costsByDay[d] = (costsByDay[d] ?? 0) + dailyShare;
      }
    }

    let cumCosts = 0;
    const days = [];
    for (let day = 1; day <= daysInMonth; day++) {
      cumCosts += costsByDay[day] ?? 0;
      // Prorate MRR: only show confirmed revenue up to today, full MRR for future days
      const proratedRevenue = day <= todayDay
        ? Math.round((mrrVal * day / daysInMonth) * 100) / 100
        : null;
      const balance = mrrVal - cumCosts;
      days.push({
        day,
        cumulativeCosts: Math.round(cumCosts * 100) / 100,
        revenue: Math.round(mrrVal * 100) / 100,
        proratedRevenue,
        balance: Math.round(balance * 100) / 100,
        balancePositive: balance >= 0 ? Math.round(balance * 100) / 100 : 0,
        balanceNegative: balance < 0 ? Math.round(balance * 100) / 100 : 0,
      });
    }
    return days;
  }, [costs, revenue, daysInMonth]);

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
                value={formatGBP(mrrGbp)}
                trend={mrrGbp > 0 ? "up" : "neutral"}
                detail="3-month average"
                density="compact"
              />
              <MetricCard
                label="Monthly Costs"
                value={formatGBP(totalCostsGbp)}
                trend="neutral"
                detail={`${costs?.services.length ?? 0} services`}
                density="compact"
              />
              <MetricCard
                label="Net Monthly Cashflow"
                value={formatGBP(netMonthly)}
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

        {/* Monthly Cash Timeline Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Monthly Cash Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-[300px] w-full rounded-lg" />
            ) : chartData.length === 0 ? (
              <div className="flex items-center justify-center h-[300px] text-sm text-muted-foreground">
                No data available
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart
                  data={chartData}
                  margin={{ top: 10, right: 10, left: 10, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="oklch(0.3 0 0)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="day"
                    tick={{ fontSize: 11, fill: "oklch(0.55 0 0)" }}
                    tickLine={false}
                    axisLine={{ stroke: "oklch(0.3 0 0)" }}
                    tickFormatter={(d: number) => (d % 5 === 1 ? String(d) : "")}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "oklch(0.55 0 0)" }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) =>
                      v >= 1000
                        ? `£${(v / 1000).toFixed(1)}k`
                        : `£${v.toFixed(0)}`
                    }
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "oklch(0.18 0 0)",
                      border: "1px solid oklch(0.3 0 0)",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                    labelFormatter={(day) => `Day ${day}`}
                    formatter={(value, name) => [
                      formatGBP(Number(value)),
                      name === "cumulativeCosts"
                        ? "Cumulative Costs"
                        : name === "revenue"
                        ? "MRR"
                        : name === "balancePositive"
                        ? "Balance"
                        : name === "balanceNegative"
                        ? "Balance (deficit)"
                        : String(name),
                    ]}
                  />

                  {/* Cumulative costs stepped area */}
                  <Area
                    type="stepAfter"
                    dataKey="cumulativeCosts"
                    stroke="oklch(0.65 0.15 25)"
                    fill="oklch(0.65 0.15 25)"
                    fillOpacity={0.15}
                    strokeWidth={2}
                    name="cumulativeCosts"
                    dot={false}
                    activeDot={false}
                  />

                  {/* Balance area — positive (green) */}
                  <Area
                    type="stepAfter"
                    dataKey="balancePositive"
                    stroke="none"
                    fill="oklch(0.75 0.15 155)"
                    fillOpacity={0.12}
                    name="balancePositive"
                    dot={false}
                    activeDot={false}
                  />

                  {/* Balance area — negative (red) */}
                  <Area
                    type="stepAfter"
                    dataKey="balanceNegative"
                    stroke="none"
                    fill="oklch(0.65 0.15 25)"
                    fillOpacity={0.12}
                    name="balanceNegative"
                    dot={false}
                    activeDot={false}
                  />

                  {/* MRR flat reference line */}
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke="oklch(0.75 0.15 155)"
                    strokeWidth={2}
                    strokeDasharray="6 3"
                    dot={false}
                    activeDot={false}
                    name="revenue"
                  />

                  {/* Today marker */}
                  <ReferenceLine
                    x={todayDay}
                    stroke="oklch(0.6 0 0)"
                    strokeDasharray="4 4"
                    label={{
                      value: "Today",
                      position: "insideTopRight",
                      fontSize: 11,
                      fill: "oklch(0.55 0 0)",
                    }}
                  />

                  {/* Zero line */}
                  <ReferenceLine
                    y={0}
                    stroke="oklch(0.35 0 0)"
                    strokeWidth={1}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

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
                      <th className="text-right px-4 py-3">Avg Invoice Value</th>
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
                          {formatGBP(row.monthlyRevenue)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                          {formatGBP(row.monthlyCosts)}
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
                          {formatGBP(row.net)}
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
                        {formatGBP(mrrGbp)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {formatGBP(totalCostsGbp)}
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
                        {formatGBP(netMonthly)}
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
                      {formatGBP(mrrGbp * 12)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Annual Costs</span>
                    <span className="text-lg font-semibold tabular-nums text-muted-foreground">
                      {formatGBP(totalCostsGbp * 12)}
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
                      {formatGBP(netMonthly * 12)}
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
                              {formatGBP(amount)}
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
                                {formatGBP(amount)}
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
