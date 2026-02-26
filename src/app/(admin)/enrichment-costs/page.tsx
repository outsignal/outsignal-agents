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

const CHART_COLORS = ["#F0FF7A", "#4ECDC4", "#FF6B6B", "#45B7D1", "#96E6A1", "#FFB347", "#C3A6FF"];

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
    <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
      <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{label}</p>
      <p
        className="text-2xl font-bold"
        style={accent ? { color: "#F0FF7A" } : undefined}
      >
        {value}
      </p>
      {detail && <p className="text-xs text-gray-500 mt-1">{detail}</p>}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-gray-900 rounded-lg p-4 border border-gray-800 animate-pulse">
      <div className="h-3 bg-gray-700 rounded w-24 mb-3" />
      <div className="h-7 bg-gray-700 rounded w-32" />
    </div>
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
    <div className="bg-gray-950 min-h-screen text-white">
      {/* Header */}
      <div className="border-b border-gray-800 px-6 py-5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">Enrichment Costs</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              API spend by provider and workspace
            </p>
          </div>
          {/* Date range */}
          <div className="flex items-center gap-3">
            <label className="text-xs text-gray-400 uppercase tracking-wide">From</label>
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              className="bg-gray-900 border border-gray-700 text-white text-sm rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#F0FF7A]"
            />
            <label className="text-xs text-gray-400 uppercase tracking-wide">To</label>
            <input
              type="date"
              value={to}
              min={from}
              max={todayStr()}
              onChange={(e) => setTo(e.target.value)}
              className="bg-gray-900 border border-gray-700 text-white text-sm rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#F0FF7A]"
            />
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Error state */}
        {error && (
          <div className="bg-red-900/40 border border-red-700 rounded-lg p-4 flex items-center justify-between">
            <p className="text-red-300 text-sm">Failed to load data: {error}</p>
            <button
              onClick={() => void fetchData()}
              className="text-xs bg-red-700 hover:bg-red-600 text-white px-3 py-1.5 rounded"
            >
              Retry
            </button>
          </div>
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
              <div className="bg-gray-900 rounded-lg p-4 border border-gray-800 col-span-2 lg:col-span-1">
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">
                  Today&apos;s Spend
                </p>
                <p className="text-2xl font-bold" style={{ color: data.capHit ? "#FF6B6B" : "#F0FF7A" }}>
                  {fmtShort(data.todaySpend)}
                </p>
                <p className="text-xs text-gray-500 mb-2">
                  of {fmtShort(data.dailyCap)} cap
                </p>
                {/* Progress bar */}
                <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${spendPct}%`,
                      backgroundColor: data.capHit ? "#FF6B6B" : "#F0FF7A",
                    }}
                  />
                </div>
              </div>

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
              <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">
                  Cap Status
                </p>
                <p
                  className="text-2xl font-bold"
                  style={{ color: data.capHit ? "#FF6B6B" : "#4ECDC4" }}
                >
                  {data.capHit ? "Cap Hit" : "Active"}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {fmtShort(data.dailyCap)} / day limit
                </p>
              </div>
            </>
          ) : null}
        </div>

        {/* Provider + Workspace charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Provider Breakdown — PieChart */}
          <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
            <h2 className="text-sm font-semibold text-gray-200 mb-4">
              Provider Breakdown
            </h2>
            {loading ? (
              <div className="h-64 bg-gray-800 rounded animate-pulse" />
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
                      backgroundColor: "#111827",
                      border: "1px solid #374151",
                      borderRadius: "6px",
                      color: "#fff",
                    }}
                  />
                  <Legend
                    formatter={(value) => (
                      <span style={{ color: "#9ca3af", fontSize: "12px" }}>
                        {value}
                      </span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-64 flex items-center justify-center text-gray-500 text-sm">
                No provider data in this period
              </div>
            )}
          </div>

          {/* Workspace Breakdown — Horizontal BarChart */}
          <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
            <h2 className="text-sm font-semibold text-gray-200 mb-4">
              Workspace Breakdown
            </h2>
            {loading ? (
              <div className="h-64 bg-gray-800 rounded animate-pulse" />
            ) : data && data.byWorkspace.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={data.byWorkspace}
                  layout="vertical"
                  margin={{ top: 0, right: 16, bottom: 0, left: 40 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fill: "#9ca3af", fontSize: 11 }}
                    tickFormatter={(v: number) => fmtShort(v)}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="workspace"
                    tick={{ fill: "#9ca3af", fontSize: 11 }}
                    width={70}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    formatter={(value: number | undefined) => [fmt(value ?? 0), "Spend"]}
                    contentStyle={{
                      backgroundColor: "#111827",
                      border: "1px solid #374151",
                      borderRadius: "6px",
                      color: "#fff",
                    }}
                    cursor={{ fill: "rgba(255,255,255,0.05)" }}
                  />
                  <Bar dataKey="totalUsd" fill="#F0FF7A" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-64 flex items-center justify-center text-gray-500 text-sm">
                No workspace data in this period
              </div>
            )}
          </div>
        </div>

        {/* Daily trend */}
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
          <h2 className="text-sm font-semibold text-gray-200 mb-4">
            Daily Spend Trend
          </h2>
          {loading ? (
            <div className="h-64 bg-gray-800 rounded animate-pulse" />
          ) : data && data.byDate.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={data.byDate}
                margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "#9ca3af", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: string) => v.slice(5)} // "MM-DD"
                />
                <YAxis
                  tick={{ fill: "#9ca3af", fontSize: 11 }}
                  tickFormatter={(v: number) => fmtShort(v)}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                />
                <Tooltip
                  formatter={(value: number | undefined) => [fmt(value ?? 0), "Spend"]}
                  contentStyle={{
                    backgroundColor: "#111827",
                    border: "1px solid #374151",
                    borderRadius: "6px",
                    color: "#fff",
                  }}
                  cursor={{ fill: "rgba(255,255,255,0.05)" }}
                />
                {data && (
                  <ReferenceLine
                    y={data.dailyCap}
                    stroke="#FF6B6B"
                    strokeDasharray="4 2"
                    label={{
                      value: `Cap: ${fmtShort(data.dailyCap)}`,
                      fill: "#FF6B6B",
                      fontSize: 11,
                      position: "insideTopRight",
                    }}
                  />
                )}
                <Bar dataKey="totalUsd" fill="#F0FF7A" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-64 flex items-center justify-center text-gray-500 text-sm">
              No daily data in this period
            </div>
          )}
        </div>

        {/* Provider detail table */}
        {!loading && data && data.byProvider.length > 0 && (
          <div className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800">
              <h2 className="text-sm font-semibold text-gray-200">
                Provider Detail
              </h2>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-xs text-gray-400 uppercase tracking-wide">
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
                    className="border-b border-gray-800/50 hover:bg-gray-800/30"
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
                    <td className="px-4 py-3 text-right text-gray-300">
                      {row.callCount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-300">
                      {fmt(row.totalUsd)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-400 text-xs">
                      {row.callCount > 0 ? fmt(row.totalUsd / row.callCount) : "$0.0000"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
