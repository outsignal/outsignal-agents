"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Search, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageShell } from "@/components/layout/page-shell";
import { ReplyFeedCard } from "@/components/replies/reply-feed-card";
import { WorkspaceReplyStatsStrip } from "@/components/replies/workspace-reply-stats";
import { ReplySidePanel } from "@/components/replies/reply-side-panel";
import type { Reply } from "@/components/replies/reply-table";
import type { FeedReply, WorkspaceReplyStats } from "@/components/replies/types";
import {
  INTENTS,
  INTENT_LABELS,
  INTENT_COLORS,
  type Intent,
} from "@/lib/classification/types";

const ACTIVE_INTERVAL = 15_000;
const BACKGROUND_INTERVAL = 60_000;

const SENTIMENTS = ["positive", "neutral", "negative"] as const;
const SENTIMENT_LABELS_MAP: Record<string, string> = {
  positive: "Positive",
  neutral: "Neutral",
  negative: "Negative",
};
const SENTIMENT_CHIP_COLORS: Record<string, string> = {
  positive: "bg-green-100 text-green-700",
  neutral: "bg-gray-100 text-gray-600",
  negative: "bg-red-100 text-red-700",
};

const DATE_RANGES = [
  { value: "all", label: "All time" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
] as const;

/** Convert FeedReply to the Reply type expected by ReplySidePanel */
function feedReplyToSidePanelReply(r: FeedReply): Reply {
  return {
    id: r.id,
    workspaceSlug: r.workspaceSlug,
    senderEmail: r.senderEmail,
    senderName: r.senderName,
    subject: r.subject,
    bodyText: r.bodyText,
    receivedAt: r.receivedAt,
    campaignName: r.campaignName,
    campaignId: r.campaignId,
    sequenceStep: r.sequenceStep,
    intent: r.intent,
    sentiment: r.sentiment,
    objectionSubtype: r.objectionSubtype,
    classificationSummary: r.classificationSummary,
    classifiedAt: r.classifiedAt,
    overrideIntent: r.overrideIntent,
    overrideSentiment: r.overrideSentiment,
    overrideObjSubtype: r.overrideObjSubtype ?? null,
    overriddenAt: r.overriddenAt,
    outboundSubject: r.outboundSubject,
    outboundBody: r.outboundBody,
    source: r.source,
    personId: r.personId,
    effectiveIntent: r.effectiveIntent,
    effectiveSentiment: r.effectiveSentiment,
  };
}

export default function RepliesFeedPage() {
  const [replies, setReplies] = useState<FeedReply[]>([]);
  const [workspaceStats, setWorkspaceStats] = useState<WorkspaceReplyStats[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [workspaceFilter, setWorkspaceFilter] = useState<string | null>(null);
  const [intentFilters, setIntentFilters] = useState<Set<string>>(new Set());
  const [sentimentFilters, setSentimentFilters] = useState<Set<string>>(
    new Set(),
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [dateRange, setDateRange] = useState<string>("all");

  // Side panel
  const [selectedReply, setSelectedReply] = useState<FeedReply | null>(null);

  // Polling refs
  const latestReceivedAt = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const buildQueryString = useCallback(
    (sinceParam?: string) => {
      const params = new URLSearchParams();
      if (workspaceFilter) params.set("workspace", workspaceFilter);
      if (sinceParam) params.set("since", sinceParam);
      if (intentFilters.size > 0)
        params.set("intent", [...intentFilters].join(","));
      if (sentimentFilters.size > 0)
        params.set("sentiment", [...sentimentFilters].join(","));
      if (searchQuery.trim()) params.set("search", searchQuery.trim());
      if (dateRange !== "all") params.set("range", dateRange);
      params.set("limit", "50");
      return params.toString();
    },
    [workspaceFilter, intentFilters, sentimentFilters, searchQuery, dateRange],
  );

  const fetchReplies = useCallback(
    async (isPoll = false) => {
      try {
        const qs = buildQueryString(
          isPoll && latestReceivedAt.current
            ? latestReceivedAt.current
            : undefined,
        );
        const res = await fetch(`/api/replies/feed?${qs}`);
        if (!res.ok) throw new Error("Failed to load");
        const data = (await res.json()) as {
          replies: FeedReply[];
          workspaceStats: WorkspaceReplyStats[];
        };

        if (isPoll && latestReceivedAt.current && data.replies.length > 0) {
          // Prepend new replies
          setReplies((prev) => {
            const existingIds = new Set(prev.map((r) => r.id));
            const newReplies = data.replies.filter(
              (r) => !existingIds.has(r.id),
            );
            return [...newReplies, ...prev];
          });
        } else {
          setReplies(data.replies);
        }

        // Always update workspace stats
        setWorkspaceStats(data.workspaceStats);

        // Track latest timestamp for polling
        if (data.replies.length > 0) {
          latestReceivedAt.current = data.replies[0].receivedAt;
        }
      } catch (err) {
        console.error("Failed to fetch reply feed:", err);
      } finally {
        setLoading(false);
      }
    },
    [buildQueryString],
  );

  // Full refresh (reset and reload)
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    latestReceivedAt.current = null;
    await fetchReplies(false);
    setRefreshing(false);
  }, [fetchReplies]);

  // Initial load + polling
  useEffect(() => {
    setLoading(true);
    latestReceivedAt.current = null;
    fetchReplies(false);

    const getInterval = () =>
      document.visibilityState === "visible"
        ? ACTIVE_INTERVAL
        : BACKGROUND_INTERVAL;

    timerRef.current = setInterval(() => {
      fetchReplies(true);
    }, getInterval());

    const handleVisibility = () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        fetchReplies(true);
      }, getInterval());
      // Immediate poll on tab focus
      if (document.visibilityState === "visible") {
        fetchReplies(true);
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchReplies]);

  // Toggle intent filter chip
  const toggleIntent = (intent: string) => {
    setIntentFilters((prev) => {
      const next = new Set(prev);
      if (next.has(intent)) next.delete(intent);
      else next.add(intent);
      return next;
    });
  };

  // Toggle sentiment filter chip
  const toggleSentiment = (sentiment: string) => {
    setSentimentFilters((prev) => {
      const next = new Set(prev);
      if (next.has(sentiment)) next.delete(sentiment);
      else next.add(sentiment);
      return next;
    });
  };

  // Handle override success from side panel
  const handleOverrideSuccess = (updatedReply: Reply) => {
    setReplies((prev) =>
      prev.map((r) =>
        r.id === updatedReply.id
          ? {
              ...r,
              overrideIntent: updatedReply.overrideIntent,
              overrideSentiment: updatedReply.overrideSentiment,
              overrideObjSubtype: updatedReply.overrideObjSubtype,
              effectiveIntent:
                updatedReply.overrideIntent ?? updatedReply.intent,
              effectiveSentiment:
                updatedReply.overrideSentiment ?? updatedReply.sentiment,
            }
          : r,
      ),
    );
    if (selectedReply?.id === updatedReply.id) {
      setSelectedReply((prev) =>
        prev
          ? {
              ...prev,
              overrideIntent: updatedReply.overrideIntent,
              overrideSentiment: updatedReply.overrideSentiment,
              overrideObjSubtype: updatedReply.overrideObjSubtype ?? null,
              effectiveIntent:
                updatedReply.overrideIntent ?? updatedReply.intent,
              effectiveSentiment:
                updatedReply.overrideSentiment ?? updatedReply.sentiment,
            }
          : prev,
      );
    }
  };

  const hasActiveFilters =
    workspaceFilter ||
    intentFilters.size > 0 ||
    sentimentFilters.size > 0 ||
    searchQuery.trim() ||
    dateRange !== "all";

  const clearAllFilters = () => {
    setWorkspaceFilter(null);
    setIntentFilters(new Set());
    setSentimentFilters(new Set());
    setSearchQuery("");
    setDateRange("all");
  };

  return (
    <PageShell
      title="Replies"
      description="Live feed of campaign replies across all workspaces"
      actions={
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors duration-150 disabled:opacity-50"
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}
          />
          Refresh
        </button>
      }
    >
      {/* Workspace stats strip */}
      <WorkspaceReplyStatsStrip
        stats={workspaceStats}
        activeWorkspace={workspaceFilter}
        onSelect={setWorkspaceFilter}
      />

      {/* Filters bar */}
      <div className="space-y-3">
        {/* Search + date range */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search replies..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#635BFF]/20 focus:border-[#635BFF]"
            />
          </div>
          <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
            {DATE_RANGES.map((dr) => (
              <button
                key={dr.value}
                onClick={() => setDateRange(dr.value)}
                className={cn(
                  "px-3 py-1 text-xs font-medium rounded-md transition-all duration-150",
                  dateRange === dr.value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {dr.label}
              </button>
            ))}
          </div>
          {hasActiveFilters && (
            <button
              onClick={clearAllFilters}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3 w-3" />
              Clear filters
            </button>
          )}
        </div>

        {/* Intent chips */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-muted-foreground mr-1">Intent:</span>
          {INTENTS.map((intent) => {
            const isActive = intentFilters.has(intent);
            const colorClasses =
              INTENT_COLORS[intent] ?? "bg-gray-100 text-gray-600";
            return (
              <button
                key={intent}
                onClick={() => toggleIntent(intent)}
                className={cn(
                  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-all duration-150",
                  isActive
                    ? cn(colorClasses, "ring-2 ring-[#635BFF]/30")
                    : "bg-muted text-muted-foreground hover:bg-muted/80",
                )}
              >
                {INTENT_LABELS[intent as Intent] ?? intent}
              </button>
            );
          })}
        </div>

        {/* Sentiment chips */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-muted-foreground mr-1">Sentiment:</span>
          {SENTIMENTS.map((sentiment) => {
            const isActive = sentimentFilters.has(sentiment);
            const chipColor =
              SENTIMENT_CHIP_COLORS[sentiment] ?? "bg-gray-100 text-gray-600";
            return (
              <button
                key={sentiment}
                onClick={() => toggleSentiment(sentiment)}
                className={cn(
                  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-all duration-150",
                  isActive
                    ? cn(chipColor, "ring-2 ring-[#635BFF]/30")
                    : "bg-muted text-muted-foreground hover:bg-muted/80",
                )}
              >
                {SENTIMENT_LABELS_MAP[sentiment]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Reply feed */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className="rounded-lg border border-border bg-card p-4 animate-pulse space-y-3"
            >
              <div className="flex items-center gap-2">
                <div className="h-5 w-20 rounded-full bg-muted" />
                <div className="h-4 w-32 rounded bg-muted" />
              </div>
              <div className="h-4 w-48 rounded bg-muted" />
              <div className="h-4 w-full rounded bg-muted" />
              <div className="h-4 w-3/4 rounded bg-muted" />
              <div className="flex gap-2">
                <div className="h-5 w-16 rounded-full bg-muted" />
                <div className="h-5 w-16 rounded-full bg-muted" />
              </div>
            </div>
          ))}
        </div>
      ) : replies.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
            <Search className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-foreground">No replies found</p>
          <p className="text-xs text-muted-foreground mt-1">
            {hasActiveFilters
              ? "Try adjusting your filters"
              : "Replies will appear here as they come in"}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {replies.map((reply) => (
            <ReplyFeedCard
              key={reply.id}
              reply={reply}
              onClick={() => setSelectedReply(reply)}
            />
          ))}
        </div>
      )}

      {/* Side panel for reply details */}
      <ReplySidePanel
        reply={selectedReply ? feedReplyToSidePanelReply(selectedReply) : null}
        onClose={() => setSelectedReply(null)}
        onOverrideSuccess={handleOverrideSuccess}
      />
    </PageShell>
  );
}
