"use client";

import { useState, useEffect, useCallback } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Input } from "@/components/ui/input";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CostData {
  period: { from: string; to: string };
  dailyCap: number;
  todaySpend: number;
  capHit: boolean;
  totalSpend: number;
  byProvider: Array<{ provider: string; totalUsd: number; callCount: number }>;
  byWorkspace: Array<{ workspace: string; totalUsd: number; callCount: number }>;
  byDate: Array<{ date: string; totalUsd: number }>;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CHART_COLORS = [
  "oklch(0.95 0.15 110)",
  "oklch(0.777 0.152 181.912)",
  "oklch(0.577 0.245 27.325)",
  "oklch(0.714 0.143 215.221)",
  "oklch(0.845 0.143 155)",
  "oklch(0.82 0.148 68)",
  "oklch(0.735 0.18 295)",
];

function fmt(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

function fmtShort(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

function defaultFrom(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 30);
  return d.toISOString().slice(0, 10);
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  detail,
  accent,
}: {
  label: string;
  value: string;
  detail?: string;
  accent?: boolean;
}) {
  return (
    <Card density="compact">
      <CardContent>
        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
        <p
          className={`text-2xl font-bold ${accent ? "text-brand-strong" : ""}`}
        >
          {value}
        </p>
        {detail && <p className="text-xs text-muted-foreground mt-1">{detail}</p>}
      </CardContent>
    </Card>
  );
}

function SkeletonCard() {
  return (
    <Card density="compact" className="animate-pulse">
      <CardContent>
        <div className="h-3 bg-muted rounded w-24 mb-3" />
        <div className="h-7 bg-muted rounded w-32" />
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function EnrichmentCostsPage() {
  const [data, setData] = useState<CostData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(todayStr());

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from, to });
      const res = await fetch(`/api/enrichment/costs?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as CostData;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const totalCalls =
    data?.byProvider.reduce((sum, p) => sum + p.callCount, 0) ?? 0;

  const spendPct = data
    ? Math.min(100, (data.todaySpend / data.dailyCap) * 100)
    : 0;

  return (
    <div>
      <Header
        title="Enrichment Costs"
        description="API spend by provider and workspace"
        actions={
          <div className="flex items-center gap-3">
            <label className="text-xs text-muted-foreground uppercase tracking-wide">From</label>
            <Input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              className="w-auto"
            />
            <label className="text-xs text-muted-foreground uppercase tracking-wide">To</label>
            <Input
              type="date"
              value={to}
              min={from}
              max={todayStr()}
              onChange={(e) => setTo(e.target.value)}
              className="w-auto"
            />
          </div>
        }
      />

      <div className="p-6 space-y-6">
        {/* Error state */}
        {error && (
          <ErrorBanner message={`Failed to load data: ${error}`} onRetry={() => void fetchData()} />
        )}

        {/* Summary cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {loading ? (
            <>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : data ? (
            <>
              {/* Today's spend with cap */}
              <Card density="compact" className="col-span-2 lg:col-span-1">
                <CardContent>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                    Today&apos;s Spend
                  </p>
                  <p className={`text-2xl font-bold ${data.capHit ? "text-destructive" : "text-brand-strong"}`}>
                    {fmtShort(data.todaySpend)}
                  </p>
                  <p className="text-xs text-muted-foreground mb-2">
                    of {fmtShort(data.dailyCap)} cap
                  </p>
                  {/* Progress bar */}
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${data.capHit ? "bg-destructive" : "bg-brand"}`}
                      style={{ width: `${spendPct}%` }}
                    />
                  </div>
                </CardContent>
              </Card>

              <SummaryCard
                label="Total Spend"
                value={fmtShort(data.totalSpend)}
                detail={`${data.period.from} to ${data.period.to}`}
                accent
              />
              <SummaryCard
                label="API Calls"
                value={totalCalls.toLocaleString()}
                detail={`${data.byProvider.length} providers`}
              />
              <Card density="compact">
                <CardContent>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                    Cap Status
                  </p>
                  <p
                    className={`text-2xl font-bold ${data.capHit ? "text-destructive" : "text-emerald-500"}`}
                  >
                    {data.capHit ? "Cap Hit" : "Active"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {fmtShort(data.dailyCap)} / day limit
                  </p>
                </CardContent>
              </Card>
            </>
          ) : null}
        </div>

        {/* Provider + Workspace charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Provider Breakdown — PieChart */}
          <Card density="compact">
            <CardHeader>
              <CardTitle className="text-sm">Provider Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="h-64 bg-muted rounded animate-pulse" />
              ) : data && data.byProvider.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={data.byProvider}
                      dataKey="totalUsd"
                      nameKey="provider"
                      cx="50%"
                      cy="50%"
                      outerRadius={90}
                      label={(props: { name?: string; percent?: number }) =>
                        `${props.name ?? ""} (${((props.percent ?? 0) * 100).toFixed(1)}%)`
                      }
                      labelLine={false}
                    >
                      {data.byProvider.map((entry, i) => (
                        <Cell
                          key={entry.provider}
                          fill={CHART_COLORS[i % CHART_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number | undefined) => [fmt(value ?? 0), "Spend"]}
                      contentStyle={{
                        backgroundColor: "white",
                        border: "1px solid oklch(0.92 0 0)",
                        borderRadius: "6px",
                        color: "oklch(0 0 0)",
                      }}
                    />
                    <Legend
                      formatter={(value) => (
                        <span style={{ color: "oklch(0.45 0 0)", fontSize: "12px" }}>
                          {value}
                        </span>
                      )}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                  No provider data in this period
                </div>
              )}
            </CardContent>
          </Card>

          {/* Workspace Breakdown — Horizontal BarChart */}
          <Card density="compact">
            <CardHeader>
              <CardTitle className="text-sm">Workspace Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="h-64 bg-muted rounded animate-pulse" />
              ) : data && data.byWorkspace.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart
                    data={data.byWorkspace}
                    layout="vertical"
                    margin={{ top: 0, right: 16, bottom: 0, left: 40 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0 0)" horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ fill: "oklch(0.45 0 0)", fontSize: 11 }}
                      tickFormatter={(v: number) => fmtShort(v)}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="workspace"
                      tick={{ fill: "oklch(0.45 0 0)", fontSize: 11 }}
                      width={70}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      formatter={(value: number | undefined) => [fmt(value ?? 0), "Spend"]}
                      contentStyle={{
                        backgroundColor: "white",
                        border: "1px solid oklch(0.92 0 0)",
                        borderRadius: "6px",
                        color: "oklch(0 0 0)",
                      }}
                      cursor={{ fill: "rgba(0,0,0,0.05)" }}
                    />
                    <Bar dataKey="totalUsd" fill="oklch(0.95 0.15 110)" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                  No workspace data in this period
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Daily trend */}
        <Card density="compact">
          <CardHeader>
            <CardTitle className="text-sm">Daily Spend Trend</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="h-64 bg-muted rounded animate-pulse" />
            ) : data && data.byDate.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={data.byDate}
                  margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0 0)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: "oklch(0.45 0 0)", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: string) => v.slice(5)} // "MM-DD"
                  />
                  <YAxis
                    tick={{ fill: "oklch(0.45 0 0)", fontSize: 11 }}
                    tickFormatter={(v: number) => fmtShort(v)}
                    axisLine={false}
                    tickLine={false}
                    width={48}
                  />
                  <Tooltip
                    formatter={(value: number | undefined) => [fmt(value ?? 0), "Spend"]}
                    contentStyle={{
                      backgroundColor: "white",
                      border: "1px solid oklch(0.92 0 0)",
                      borderRadius: "6px",
                      color: "oklch(0 0 0)",
                    }}
                    cursor={{ fill: "rgba(0,0,0,0.05)" }}
                  />
                  {data && (
                    <ReferenceLine
                      y={data.dailyCap}
                      stroke="oklch(0.577 0.245 27.325)"
                      strokeDasharray="4 2"
                      label={{
                        value: `Cap: ${fmtShort(data.dailyCap)}`,
                        fill: "oklch(0.577 0.245 27.325)",
                        fontSize: 11,
                        position: "insideTopRight",
                      }}
                    />
                  )}
                  <Bar dataKey="totalUsd" fill="oklch(0.95 0.15 110)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                No daily data in this period
              </div>
            )}
          </CardContent>
        </Card>

        {/* Provider detail table */}
        {!loading && data && data.byProvider.length > 0 && (
          <Card density="compact">
            <CardHeader className="border-b">
              <CardTitle className="text-sm">Provider Detail</CardTitle>
            </CardHeader>
            <CardContent className="!px-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="text-left px-4 py-2">Provider</th>
                    <th className="text-right px-4 py-2">Calls</th>
                    <th className="text-right px-4 py-2">Total Spend</th>
                    <th className="text-right px-4 py-2">Per Call</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byProvider.map((row, i) => (
                    <tr
                      key={row.provider}
                      className="border-b border-border/50 hover:bg-muted/30"
                    >
                      <td className="px-4 py-3 flex items-center gap-2">
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full"
                          style={{
                            backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
                          }}
                        />
                        <span className="capitalize">{row.provider}</span>
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">
                        {row.callCount.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">
                        {fmt(row.totalUsd)}
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground text-xs">
                        {row.callCount > 0 ? fmt(row.totalUsd / row.callCount) : "$0.0000"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
