"use client";

import { useState, useEffect, useCallback } from "react";
import { useQueryState } from "nuqs";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Zap, DollarSign, TrendingUp } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ─── Types ──────────────────────────────────────────────────────────────────

interface FeedItem {
  id: string;
  signalType: string;
  companyName: string | null;
  companyDomain: string;
  workspaceSlug: string;
  title: string | null;
  isHighIntent: boolean;
  detectedAt: string;
  status: string;
}

interface WorkspaceRow {
  slug: string;
  name: string;
  signalsFired: number;
  leadsGenerated: number;
  weeklyUsd: number;
  todayUsd: number;
  dailyCapUsd: number;
}

interface SignalsData {
  feed: FeedItem[];
  typeDistribution: Array<{ name: string; count: number }>;
  summary: {
    totalSignals: number;
    totalDailyUsd: number;
    totalWeeklyUsd: number;
  };
  perWorkspace: WorkspaceRow[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

const SIGNAL_TYPE_LABELS: Record<string, string> = {
  funding: "Funding",
  job_change: "Job Change",
  hiring_spike: "Hiring Spike",
  tech_adoption: "Tech Adoption",
  news: "News",
  social_mention: "Social",
};

const SIGNAL_TYPE_COLORS: Record<string, string> = {
  funding: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  job_change: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  hiring_spike: "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  tech_adoption: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  news: "bg-stone-50 text-stone-700 dark:bg-stone-800 dark:text-stone-300",
  social_mention: "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
};

// ─── Helper functions ────────────────────────────────────────────────────────

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

function fmtPct(n: number): string {
  return `${Math.round(n)}%`;
}

function utilizationColor(pct: number): string {
  if (pct >= 100) return "text-destructive font-semibold";
  if (pct >= 80) return "text-amber-500 dark:text-amber-400 font-semibold";
  return "text-muted-foreground";
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

// ─── Skeleton components ─────────────────────────────────────────────────────

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

function SkeletonBlock({ height = 220 }: { height?: number }) {
  return (
    <div
      className="bg-muted rounded animate-pulse w-full"
      style={{ height }}
    />
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function SignalsDashboardPage() {
  const [data, setData] = useState<SignalsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const [workspace, setWorkspace] = useQueryState("workspace", {
    defaultValue: "all",
  });

  const fetchData = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      const params = new URLSearchParams();
      if (workspace !== "all") params.set("workspace", workspace);
      params.set("limit", "100");

      try {
        const res = await fetch(`/api/signals?${params.toString()}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
        }
        const json = (await res.json()) as SignalsData;
        setData(json);
        setLastUpdated(new Date());
      } catch {
        // Silently fail on auto-refresh
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [workspace]
  );

  // Initial fetch + re-fetch on workspace change
  useEffect(() => {
    void fetchData(false);
  }, [fetchData]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      void fetchData(true);
    }, 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // --- Cap utilization logic ---
  const totalTodayUsd = data?.perWorkspace.reduce((s, w) => s + w.todayUsd, 0) ?? 0;
  const totalCapUsd = data?.perWorkspace.reduce((s, w) => s + w.dailyCapUsd, 0) ?? 0;
  const capUtilPct = totalCapUsd > 0 ? (totalTodayUsd / totalCapUsd) * 100 : 0;

  const dailyCostColor =
    capUtilPct >= 100
      ? "text-destructive"
      : capUtilPct >= 80
        ? "text-amber-500"
        : "";

  // --- Sorted feed ---
  const sortedPerWorkspace = data
    ? [...data.perWorkspace].sort((a, b) => b.signalsFired - a.signalsFired)
    : [];

  return (
    <div>
      <Header
        title="Signal Intelligence"
        description={
          lastUpdated
            ? `Last updated: ${lastUpdated.toLocaleTimeString()}`
            : "Live signal monitoring across all workspaces"
        }
        actions={
          <Select value={workspace} onValueChange={(v) => void setWorkspace(v)}>
            <SelectTrigger className="h-8 text-xs w-[180px]" aria-label="Filter by workspace">
              <SelectValue placeholder="All Workspaces" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">
                All Workspaces
              </SelectItem>
              {(data?.perWorkspace ?? []).map((ws) => (
                <SelectItem key={ws.slug} value={ws.slug} className="text-xs">
                  {ws.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      <div className="p-6 space-y-6">

        {/* Summary cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {loading ? (
            <>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : (
            <>
              {/* Total Signals (7d) */}
              <Card density="compact">
                <CardContent>
                  <div className="flex items-center gap-2 mb-1">
                    <Zap className="h-3.5 w-3.5 text-muted-foreground" />
                    <p className="text-xs text-muted-foreground">
                      Total Signals (7d)
                    </p>
                  </div>
                  <p className="text-2xl font-bold">
                    {(data?.summary.totalSignals ?? 0).toLocaleString()}
                  </p>
                </CardContent>
              </Card>

              {/* Daily Cost */}
              <Card density="compact">
                <CardContent>
                  <div className="flex items-center gap-2 mb-1">
                    <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                    <p className="text-xs text-muted-foreground">
                      Daily Cost
                    </p>
                  </div>
                  <p className={`text-2xl font-bold ${dailyCostColor}`}>
                    {fmtUsd(data?.summary.totalDailyUsd ?? 0)}
                  </p>
                  {totalCapUsd > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {fmtPct(capUtilPct)} of {fmtUsd(totalCapUsd)} cap
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Weekly Cost */}
              <Card density="compact">
                <CardContent>
                  <div className="flex items-center gap-2 mb-1">
                    <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
                    <p className="text-xs text-muted-foreground">
                      Weekly Cost
                    </p>
                  </div>
                  <p className="text-2xl font-bold">
                    {fmtUsd(data?.summary.totalWeeklyUsd ?? 0)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Last 7 days</p>
                </CardContent>
              </Card>
            </>
          )}
        </div>

        {/* Signal type distribution bar chart */}
        <Card density="compact">
          <CardHeader>
            <CardTitle className="text-sm">Signal Type Distribution (7d)</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <SkeletonBlock height={220} />
            ) : data && data.typeDistribution.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={data.typeDistribution}
                  margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="oklch(0.92 0 0)" />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: "oklch(0.45 0 0)", fontSize: 11 }}
                    tickFormatter={(v: string) => SIGNAL_TYPE_LABELS[v] ?? v}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: "oklch(0.45 0 0)", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={32}
                  />
                  <Tooltip
                    formatter={(value: number | undefined) => [
                      value ?? 0,
                      "Signals",
                    ]}
                    contentStyle={{
                      backgroundColor: "white",
                      border: "1px solid oklch(0.92 0 0)",
                      borderRadius: "6px",
                      color: "oklch(0 0 0)",
                    }}
                    cursor={{ fill: "rgba(0,0,0,0.05)" }}
                  />
                  <Bar
                    dataKey="count"
                    fill="oklch(0.95 0.15 110)"
                    radius={[3, 3, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">
                No signal data in the last 7 days
              </div>
            )}
          </CardContent>
        </Card>

        {/* Per-workspace breakdown table */}
        <Card density="compact">
          <CardHeader className="border-b">
            <CardTitle className="text-sm">Workspace Breakdown (7d)</CardTitle>
          </CardHeader>
          <CardContent className="!px-0">
            {loading ? (
              <div className="p-4">
                <SkeletonBlock height={120} />
              </div>
            ) : sortedPerWorkspace.length > 0 ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="text-left px-4 py-2">Workspace</th>
                    <th className="text-right px-4 py-2">Signals</th>
                    <th className="text-right px-4 py-2">Leads</th>
                    <th className="text-right px-4 py-2">Weekly</th>
                    <th className="text-right px-4 py-2">Today</th>
                    <th className="text-right px-4 py-2">Daily Cap</th>
                    <th className="text-right px-4 py-2">Utilization</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedPerWorkspace.map((row) => {
                    const utilPct =
                      row.dailyCapUsd > 0
                        ? (row.todayUsd / row.dailyCapUsd) * 100
                        : 0;
                    return (
                      <tr
                        key={row.slug}
                        className="border-b border-border/50 hover:bg-muted/30"
                      >
                        <td className="px-4 py-3 font-medium">{row.name}</td>
                        <td className="px-4 py-3 text-right text-muted-foreground">
                          {row.signalsFired.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right text-muted-foreground">
                          {row.leadsGenerated.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right text-muted-foreground">
                          {fmtUsd(row.weeklyUsd)}
                        </td>
                        <td className="px-4 py-3 text-right text-muted-foreground">
                          {fmtUsd(row.todayUsd)}
                        </td>
                        <td className="px-4 py-3 text-right text-muted-foreground">
                          {fmtUsd(row.dailyCapUsd)}
                        </td>
                        <td className={`px-4 py-3 text-right ${utilizationColor(utilPct)}`}>
                          {fmtPct(utilPct)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No workspace data available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Signal feed table */}
        <Card density="compact">
          <CardHeader className="border-b">
            <CardTitle className="text-sm">Recent Signals</CardTitle>
          </CardHeader>
          <CardContent className="!px-0">
            {loading ? (
              <div className="p-4">
                <SkeletonBlock height={200} />
              </div>
            ) : data && data.feed.length > 0 ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="text-left px-4 py-2">Time</th>
                    <th className="text-left px-4 py-2">Company</th>
                    <th className="text-left px-4 py-2">Signal Type</th>
                    <th className="text-left px-4 py-2">Workspace</th>
                    <th className="text-left px-4 py-2">Intent</th>
                    <th className="text-left px-4 py-2">Title</th>
                  </tr>
                </thead>
                <tbody>
                  {data.feed.map((item) => {
                    const typeClass =
                      SIGNAL_TYPE_COLORS[item.signalType] ??
                      "bg-slate-50 text-slate-700";
                    const typeLabel =
                      SIGNAL_TYPE_LABELS[item.signalType] ?? item.signalType;
                    return (
                      <tr
                        key={item.id}
                        className="border-b border-border/50 hover:bg-muted/30"
                      >
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                          {formatRelativeTime(item.detectedAt)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium">
                            {item.companyName ?? item.companyDomain}
                          </div>
                          {item.companyName && (
                            <div className="text-xs text-muted-foreground">
                              {item.companyDomain}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${typeClass}`}
                          >
                            {typeLabel}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {item.workspaceSlug}
                        </td>
                        <td className="px-4 py-3">
                          {item.isHighIntent && (
                            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-brand/20 text-brand-strong">
                              High Intent
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground max-w-xs truncate">
                          {item.title ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No signals detected yet. Configure signal monitoring in workspace settings.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
