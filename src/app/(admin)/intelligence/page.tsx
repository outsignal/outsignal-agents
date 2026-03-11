"use client";

import { useState, useEffect, useCallback } from "react";
import { useQueryStates, parseAsString } from "nuqs";
import { Header } from "@/components/layout/header";
import { AnalyticsFilters } from "@/components/analytics/analytics-filters";
import { KpiRow } from "@/components/intelligence/kpi-row";
import { InsightsSummary, type InsightData } from "@/components/intelligence/insights-summary";
import { CampaignSummary } from "@/components/intelligence/campaign-summary";
import { ClassificationDonuts } from "@/components/intelligence/classification-donuts";
import { BenchmarksSummary } from "@/components/intelligence/benchmarks-summary";
import { IcpSummary } from "@/components/intelligence/icp-summary";
import { DeliverabilityBentoCard, type DeliverabilityData } from "@/components/intelligence/deliverability-summary";
import type { CampaignData } from "@/components/analytics/campaign-rankings-table";
import type { IndustryBenchmark } from "@/lib/analytics/industry-benchmarks";

// ---------------------------------------------------------------------------
// API response types
// ---------------------------------------------------------------------------

interface CampaignsResponse {
  campaigns: CampaignData[];
}

interface ReplyStatsResponse {
  totalReplies: number;
  intentDistribution: { intent: string; count: number }[];
  sentimentDistribution: { sentiment: string; count: number }[];
}

interface BenchmarksResponse {
  workspace: string;
  metrics: Record<string, number>;
  globalAvg: Record<string, number>;
  industry: Record<string, IndustryBenchmark>;
}

interface IcpResponse {
  buckets: { bucket: string; totalSent: number; replyRate: number; interestedRate: number }[];
  recommendation: { current: number; suggested: number; confidence: string; reason: string } | null;
}

interface DeliverabilityResponse {
  domains: {
    total: number;
    healthy: number;
    atRisk: number;
    worst: { domain: string; overallHealth: string } | null;
  };
  senders: {
    total: number;
    healthy: number;
    elevated: number;
    warning: number;
    critical: number;
  };
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function IntelligenceHubPage() {
  const [params, setParams] = useQueryStates({
    workspace: parseAsString.withDefault(""),
    period: parseAsString.withDefault("7d"),
  });

  // KPI state
  const [repliesCount, setRepliesCount] = useState<number | null>(null);
  const [avgReplyRate, setAvgReplyRate] = useState<number | null>(null);
  const [activeInsightsCount, setActiveInsightsCount] = useState<number | null>(null);
  const [topWorkspace, setTopWorkspace] = useState<string | null>(null);
  const [interestedRate, setInterestedRate] = useState<number | null>(null);

  // Section data state
  const [campaigns, setCampaigns] = useState<CampaignData[] | null>(null);
  const [intentData, setIntentData] = useState<{ intent: string; count: number }[] | null>(null);
  const [sentimentData, setSentimentData] = useState<{ sentiment: string; count: number }[] | null>(null);
  const [benchmarksData, setBenchmarksData] = useState<BenchmarksResponse | null>(null);
  const [icpBuckets, setIcpBuckets] = useState<IcpResponse["buckets"] | null>(null);
  const [icpRecommendation, setIcpRecommendation] = useState<IcpResponse["recommendation"]>(null);
  const [insights, setInsights] = useState<InsightData[] | null>(null);
  const [deliverabilityData, setDeliverabilityData] = useState<DeliverabilityData | null>(null);

  // Loading states
  const [loading, setLoading] = useState(true);
  const [benchmarksLoading, setBenchmarksLoading] = useState(false);
  const [icpLoading, setIcpLoading] = useState(false);
  const [deliverabilityLoading, setDeliverabilityLoading] = useState(false);

  // ─── Fetch all data ────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Build params for campaigns
      const campaignParams = new URLSearchParams();
      campaignParams.set("sort", "replyRate");
      campaignParams.set("order", "desc");
      if (params.workspace) campaignParams.set("workspace", params.workspace);
      if (params.period && params.period !== "all")
        campaignParams.set("period", params.period);

      // Build params for reply stats
      const replyParams = new URLSearchParams();
      if (params.workspace) replyParams.set("workspace", params.workspace);
      if (params.period) replyParams.set("range", params.period);

      // Build params for insights
      const insightParams = new URLSearchParams();
      insightParams.set("status", "active");
      if (params.workspace) insightParams.set("workspace", params.workspace);

      const [campaignsRes, repliesRes, insightsRes] = await Promise.all([
        fetch(`/api/analytics/campaigns?${campaignParams.toString()}`),
        fetch(`/api/replies/stats?${replyParams.toString()}`),
        fetch(`/api/insights?${insightParams.toString()}`),
      ]);

      // Process campaigns data
      if (campaignsRes.ok) {
        const campaignsJson = (await campaignsRes.json()) as CampaignsResponse;
        const campaignList = campaignsJson.campaigns ?? [];
        setCampaigns(campaignList);

        if (campaignList.length > 0) {
          const totalRate = campaignList.reduce(
            (sum, c) => sum + (c.replyRate ?? 0),
            0,
          );
          setAvgReplyRate(totalRate / campaignList.length);

          // Find top workspace by reply rate
          const byWorkspace = new Map<string, { totalRate: number; count: number }>();
          for (const c of campaignList) {
            const existing = byWorkspace.get(c.workspace) ?? { totalRate: 0, count: 0 };
            existing.totalRate += c.replyRate ?? 0;
            existing.count += 1;
            byWorkspace.set(c.workspace, existing);
          }
          let bestWorkspace = "";
          let bestRate = -1;
          for (const [slug, data] of byWorkspace) {
            const avg = data.totalRate / data.count;
            if (avg > bestRate) {
              bestRate = avg;
              bestWorkspace = slug;
            }
          }
          setTopWorkspace(bestWorkspace);

          // Interested rate from campaigns
          const withInterested = campaignList.filter((c) => c.interestedRate != null);
          if (withInterested.length > 0) {
            const totalInterested = withInterested.reduce(
              (sum, c) => sum + (c.interestedRate ?? 0),
              0,
            );
            setInterestedRate(totalInterested / withInterested.length);
          } else {
            setInterestedRate(null);
          }
        } else {
          setAvgReplyRate(null);
          setTopWorkspace(null);
          setInterestedRate(null);
        }
      }

      // Process replies data
      if (repliesRes.ok) {
        const repliesJson = (await repliesRes.json()) as ReplyStatsResponse;
        setRepliesCount(repliesJson.totalReplies ?? 0);
        setIntentData(repliesJson.intentDistribution ?? null);
        setSentimentData(repliesJson.sentimentDistribution ?? null);
      } else {
        setRepliesCount(null);
        setIntentData(null);
        setSentimentData(null);
      }

      // Process insights data
      if (insightsRes.ok) {
        const insightsJson = (await insightsRes.json()) as InsightData[];
        if (Array.isArray(insightsJson)) {
          setInsights(insightsJson);
          setActiveInsightsCount(insightsJson.length);
        } else {
          setInsights(null);
          setActiveInsightsCount(0);
        }
      } else {
        setInsights(null);
        setActiveInsightsCount(null);
      }
    } catch (err) {
      console.error("[intelligence] Failed to fetch data:", err);
    } finally {
      setLoading(false);
    }
  }, [params.workspace, params.period]);

  // ─── Fetch benchmarks (workspace-specific, all-time) ───────────────────
  const fetchBenchmarks = useCallback(async () => {
    if (!params.workspace) {
      setBenchmarksData(null);
      return;
    }
    setBenchmarksLoading(true);
    try {
      const res = await fetch(
        `/api/analytics/benchmarks/reference-bands?workspace=${encodeURIComponent(params.workspace)}`,
      );
      if (res.ok) {
        const json = (await res.json()) as BenchmarksResponse;
        setBenchmarksData(json);
      } else {
        setBenchmarksData(null);
      }
    } catch {
      setBenchmarksData(null);
    } finally {
      setBenchmarksLoading(false);
    }
  }, [params.workspace]);

  // ─── Fetch ICP calibration ─────────────────────────────────────────────
  const fetchIcp = useCallback(async () => {
    setIcpLoading(true);
    try {
      const icpParams = new URLSearchParams();
      if (params.workspace) {
        icpParams.set("workspace", params.workspace);
      } else {
        icpParams.set("global", "true");
      }
      const res = await fetch(
        `/api/analytics/benchmarks/icp-calibration?${icpParams.toString()}`,
      );
      if (res.ok) {
        const json = (await res.json()) as IcpResponse;
        setIcpBuckets(json.buckets ?? null);
        setIcpRecommendation(json.recommendation ?? null);
      } else {
        setIcpBuckets(null);
        setIcpRecommendation(null);
      }
    } catch {
      setIcpBuckets(null);
      setIcpRecommendation(null);
    } finally {
      setIcpLoading(false);
    }
  }, [params.workspace]);

  // ─── Fetch deliverability summary ─────────────────────────────────────
  const fetchDeliverability = useCallback(async () => {
    setDeliverabilityLoading(true);
    try {
      const delivParams = new URLSearchParams();
      if (params.workspace) delivParams.set("workspace", params.workspace);
      const res = await fetch(`/api/deliverability/summary?${delivParams.toString()}`);
      if (res.ok) {
        const json = (await res.json()) as DeliverabilityResponse;
        setDeliverabilityData({
          domainsHealthy: json.domains.healthy,
          domainsAtRisk: json.domains.atRisk,
          worstDomain: json.domains.worst?.domain ?? null,
          worstDomainHealth: json.domains.worst?.overallHealth ?? null,
          sendersWarning: json.senders.warning,
          sendersCritical: json.senders.critical,
        });
      } else {
        setDeliverabilityData(null);
      }
    } catch {
      setDeliverabilityData(null);
    } finally {
      setDeliverabilityLoading(false);
    }
  }, [params.workspace]);

  // ─── Effects ───────────────────────────────────────────────────────────
  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    void fetchBenchmarks();
  }, [fetchBenchmarks]);

  useEffect(() => {
    void fetchIcp();
  }, [fetchIcp]);

  useEffect(() => {
    void fetchDeliverability();
  }, [fetchDeliverability]);

  // ─── Handlers ──────────────────────────────────────────────────────────
  function handleWorkspaceChange(w: string | null) {
    void setParams({ workspace: w ?? "" });
  }

  function handlePeriodChange(p: string) {
    void setParams({ period: p });
  }

  function handleInsightRefresh() {
    void fetchData();
  }

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Intelligence Hub"
        description="Executive overview of campaign performance, reply intelligence, and AI insights"
      />

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Filters */}
        <AnalyticsFilters
          workspace={params.workspace || null}
          period={params.period}
          onWorkspaceChange={handleWorkspaceChange}
          onPeriodChange={handlePeriodChange}
        />

        {/* KPI Row */}
        <KpiRow
          repliesCount={repliesCount}
          avgReplyRate={avgReplyRate}
          activeInsights={activeInsightsCount}
          topWorkspace={topWorkspace}
          interestedRate={interestedRate}
          loading={loading}
        />

        {/* Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Active Insights — hero span */}
          <div className="md:col-span-2">
            <InsightsSummary
              insights={insights}
              loading={loading}
              onRefresh={handleInsightRefresh}
            />
          </div>

          {/* Campaign Rankings — hero span */}
          <div className="md:col-span-2">
            <CampaignSummary campaigns={campaigns} loading={loading} />
          </div>

          {/* Reply Classification — wider */}
          <div className="md:col-span-1 lg:col-span-2">
            <ClassificationDonuts
              intentData={intentData}
              sentimentData={sentimentData}
              loading={loading}
            />
          </div>

          {/* Benchmarks */}
          <div className="md:col-span-1">
            <BenchmarksSummary
              data={benchmarksData}
              loading={benchmarksLoading}
              hasWorkspace={!!params.workspace}
            />
          </div>

          {/* ICP Calibration */}
          <div className="md:col-span-1">
            <IcpSummary
              buckets={icpBuckets}
              recommendation={icpRecommendation}
              loading={icpLoading}
            />
          </div>

          {/* Deliverability Summary */}
          <div className="md:col-span-2">
            <DeliverabilityBentoCard
              data={deliverabilityData ?? { domainsHealthy: 0, domainsAtRisk: 0, worstDomain: null, worstDomainHealth: null, sendersWarning: 0, sendersCritical: 0 }}
              loading={deliverabilityLoading}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
