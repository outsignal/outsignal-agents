"use client";

import { useState, useEffect, useCallback } from "react";
import { useQueryStates, parseAsString } from "nuqs";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { AnalyticsFilters } from "@/components/analytics/analytics-filters";
import {
  StrategyComparisonCards,
  type StrategyData,
} from "@/components/analytics/strategy-comparison-cards";
import {
  CampaignRankingsTable,
  type CampaignData,
} from "@/components/analytics/campaign-rankings-table";
import { CopyTab } from "@/components/analytics/copy-tab";
import { BenchmarksTab } from "@/components/analytics/benchmarks-tab";
import { InsightsTab } from "@/components/analytics/insights-tab";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CampaignsResponse {
  campaigns: CampaignData[];
  total: number;
  period: string;
  filters: { workspace: string | null; sort: string; order: string };
}

interface StrategiesResponse {
  strategies: StrategyData[];
  period: string;
  filters: { workspace: string | null };
}

// ---------------------------------------------------------------------------
// Loading skeletons
// ---------------------------------------------------------------------------

function TableSkeleton() {
  return (
    <div className="rounded-lg border p-4 space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

function CardsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-48 w-full rounded-lg" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab chip
// ---------------------------------------------------------------------------

function TabChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center rounded-full border px-4 py-1.5 text-sm font-medium transition-colors focus:outline-none",
        active
          ? "bg-brand text-brand-foreground border-brand-strong"
          : "bg-secondary text-muted-foreground border-border hover:bg-muted hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// AnalyticsTab
// ---------------------------------------------------------------------------

export default function AnalyticsTab() {
  const [params, setParams] = useQueryStates({
    workspace: parseAsString.withDefault(""),
    period: parseAsString.withDefault("30d"),
    sort: parseAsString.withDefault("replyRate"),
    order: parseAsString.withDefault("desc"),
    tab: parseAsString.withDefault("performance"),
    vertical: parseAsString.withDefault(""),
  });

  // Data states
  const [campaignsData, setCampaignsData] =
    useState<CampaignsResponse | null>(null);
  const [strategiesData, setStrategiesData] =
    useState<StrategiesResponse | null>(null);
  const [campaignsLoading, setCampaignsLoading] = useState(true);
  const [strategiesLoading, setStrategiesLoading] = useState(true);
  const [campaignsError, setCampaignsError] = useState<string | null>(null);
  const [strategiesError, setStrategiesError] = useState<string | null>(null);

  const activeTab = params.tab || "performance";
  const isPerformanceTab = activeTab === "performance";
  const isCopyTab = activeTab === "copy";
  const isBenchmarksTab = activeTab === "benchmarks";
  const isInsightsTab = activeTab === "insights";

  // ─── Fetch campaigns ────────────────────────────────────────────────────
  const fetchCampaigns = useCallback(async () => {
    setCampaignsLoading(true);
    setCampaignsError(null);
    try {
      const sp = new URLSearchParams();
      if (params.workspace) sp.set("workspace", params.workspace);
      if (params.period && params.period !== "all")
        sp.set("period", params.period);
      sp.set("sort", params.sort);
      sp.set("order", params.order);

      const res = await fetch(`/api/analytics/campaigns?${sp.toString()}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as CampaignsResponse;
      setCampaignsData(json);
    } catch (err) {
      setCampaignsError(
        err instanceof Error ? err.message : "Unknown error",
      );
    } finally {
      setCampaignsLoading(false);
    }
  }, [params.workspace, params.period, params.sort, params.order]);

  // ─── Fetch strategies ──────────────────────────────────────────────────
  const fetchStrategies = useCallback(async () => {
    setStrategiesLoading(true);
    setStrategiesError(null);
    try {
      const sp = new URLSearchParams();
      if (params.workspace) sp.set("workspace", params.workspace);
      if (params.period && params.period !== "all")
        sp.set("period", params.period);

      const res = await fetch(`/api/analytics/strategies?${sp.toString()}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as StrategiesResponse;
      setStrategiesData(json);
    } catch (err) {
      setStrategiesError(
        err instanceof Error ? err.message : "Unknown error",
      );
    } finally {
      setStrategiesLoading(false);
    }
  }, [params.workspace, params.period]);

  useEffect(() => {
    if (isPerformanceTab) {
      void fetchCampaigns();
    }
  }, [fetchCampaigns, isPerformanceTab]);

  useEffect(() => {
    if (isPerformanceTab) {
      void fetchStrategies();
    }
  }, [fetchStrategies, isPerformanceTab]);

  // ─── Handlers ──────────────────────────────────────────────────────────
  function handleWorkspaceChange(w: string | null) {
    void setParams({ workspace: w ?? "", sort: "replyRate", order: "desc" });
  }

  function handlePeriodChange(p: string) {
    void setParams({ period: p, sort: "replyRate", order: "desc" });
  }

  function handleSortChange(sort: string, order: string) {
    void setParams({ sort, order });
  }

  function handleVerticalChange(v: string | null) {
    void setParams({ vertical: v ?? "" });
  }

  function handleTabChange(tab: string) {
    void setParams({ tab });
  }

  return (
    <div className="space-y-6">
        {/* Filters */}
        <AnalyticsFilters
          workspace={params.workspace || null}
          period={params.period}
          onWorkspaceChange={handleWorkspaceChange}
          onPeriodChange={handlePeriodChange}
          vertical={params.vertical || null}
          onVerticalChange={handleVerticalChange}
          showVertical={isCopyTab}
        />

        {/* Tab toggle */}
        <div className="flex items-center gap-2">
          <TabChip
            label="Performance"
            active={isPerformanceTab}
            onClick={() => handleTabChange("performance")}
          />
          <TabChip
            label="Copy"
            active={isCopyTab}
            onClick={() => handleTabChange("copy")}
          />
          <TabChip
            label="Benchmarks"
            active={isBenchmarksTab}
            onClick={() => handleTabChange("benchmarks")}
          />
          <TabChip
            label="Insights"
            active={isInsightsTab}
            onClick={() => handleTabChange("insights")}
          />
        </div>

        {/* Performance tab content */}
        {isPerformanceTab && (
          <>
            {/* Strategy comparison section */}
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">
                Copy Strategy Comparison
              </h2>
              {strategiesError && (
                <ErrorBanner
                  message={`Failed to load strategies: ${strategiesError}`}
                  onRetry={() => void fetchStrategies()}
                />
              )}
              {strategiesLoading ? (
                <CardsSkeleton />
              ) : (
                strategiesData && (
                  <StrategyComparisonCards
                    strategies={strategiesData.strategies}
                  />
                )
              )}
            </section>

            {/* Campaign rankings section */}
            <section className="space-y-3">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold">Campaign Rankings</h2>
                {campaignsData && !campaignsLoading && (
                  <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                    {campaignsData.total} campaign
                    {campaignsData.total !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
              {campaignsError && (
                <ErrorBanner
                  message={`Failed to load campaigns: ${campaignsError}`}
                  onRetry={() => void fetchCampaigns()}
                />
              )}
              {campaignsLoading ? (
                <TableSkeleton />
              ) : (
                campaignsData && (
                  <CampaignRankingsTable
                    campaigns={campaignsData.campaigns}
                    sort={params.sort}
                    order={params.order}
                    onSortChange={handleSortChange}
                  />
                )
              )}
            </section>
          </>
        )}

        {/* Copy tab content */}
        {isCopyTab && (
          <CopyTab
            workspace={params.workspace || null}
            period={params.period}
            vertical={params.vertical || null}
          />
        )}

        {/* Benchmarks tab content */}
        {isBenchmarksTab && (
          <BenchmarksTab workspace={params.workspace || null} />
        )}

        {/* Insights tab content */}
        {isInsightsTab && (
          <InsightsTab workspace={params.workspace || null} />
        )}
    </div>
  );
}
