"use client";

import { useState, useEffect, useCallback } from "react";
import { useQueryStates, parseAsString } from "nuqs";
import { Header } from "@/components/layout/header";
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
// Main page
// ---------------------------------------------------------------------------

export default function AnalyticsPage() {
  const [params, setParams] = useQueryStates({
    workspace: parseAsString.withDefault(""),
    period: parseAsString.withDefault("30d"),
    sort: parseAsString.withDefault("replyRate"),
    order: parseAsString.withDefault("desc"),
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
    void fetchCampaigns();
  }, [fetchCampaigns]);

  useEffect(() => {
    void fetchStrategies();
  }, [fetchStrategies]);

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

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Campaign Analytics"
        description="Performance rankings, sequence analysis, and copy strategy comparison"
      />

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Filters */}
        <AnalyticsFilters
          workspace={params.workspace || null}
          period={params.period}
          onWorkspaceChange={handleWorkspaceChange}
          onPeriodChange={handlePeriodChange}
        />

        {/* Strategy comparison section */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Copy Strategy Comparison</h2>
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
      </div>
    </div>
  );
}
