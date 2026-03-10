"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw, Loader2 } from "lucide-react";
import { InsightCard } from "./insight-card";
import { ObjectionClusters } from "./objection-clusters";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorBanner } from "@/components/ui/error-banner";
import type {
  InsightCategory,
  ConfidenceLevel,
  InsightStatus,
  ActionType,
} from "@/lib/insights/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InsightData {
  id: string;
  category: InsightCategory;
  observation: string;
  evidence: { metric: string; value: string; change: string | null }[];
  actionType: ActionType;
  actionDescription: string;
  actionParams: Record<string, string> | null;
  confidence: ConfidenceLevel;
  priority: number;
  status: InsightStatus;
  generatedAt: string;
  executionResult: {
    before?: string;
    after?: string;
    outcome?: string;
    error?: string;
  } | null;
}

interface InsightsTabProps {
  workspace: string | null;
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function InsightsSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-40 w-full rounded-lg" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function InsightsTab({ workspace }: InsightsTabProps) {
  const [insights, setInsights] = useState<InsightData[]>([]);
  const [dismissedInsights, setDismissedInsights] = useState<InsightData[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);

  // ─── Fetch active insights ────────────────────────────────────────────
  const fetchInsights = useCallback(async () => {
    if (!workspace) {
      setInsights([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/insights?workspace=${encodeURIComponent(workspace)}&status=active`,
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json = await res.json();
      setInsights(Array.isArray(json) ? json : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  // ─── Fetch dismissed insights ─────────────────────────────────────────
  const fetchDismissed = useCallback(async () => {
    if (!workspace) {
      setDismissedInsights([]);
      return;
    }

    try {
      const res = await fetch(
        `/api/insights?workspace=${encodeURIComponent(workspace)}&status=dismissed`,
      );
      if (!res.ok) return;
      const json = await res.json();
      setDismissedInsights(Array.isArray(json) ? json : []);
    } catch {
      // Non-critical
    }
  }, [workspace]);

  // ─── Refresh (manual generation) ─────────────────────────────────────
  async function handleRefresh() {
    if (!workspace) return;
    setRefreshing(true);
    try {
      const res = await fetch("/api/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceSlug: workspace }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      // Re-fetch after generation
      await fetchInsights();
      await fetchDismissed();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh");
    } finally {
      setRefreshing(false);
    }
  }

  // ─── Effects ──────────────────────────────────────────────────────────
  useEffect(() => {
    void fetchInsights();
    void fetchDismissed();
  }, [fetchInsights, fetchDismissed]);

  // ─── No workspace selected ───────────────────────────────────────────
  if (!workspace) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Select a workspace to view insights.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">AI Insights</h2>
        <button
          onClick={() => void handleRefresh()}
          disabled={refreshing}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 transition-colors"
        >
          {refreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Refresh Insights
        </button>
      </div>

      {/* Error */}
      {error && (
        <ErrorBanner
          message={`Failed to load insights: ${error}`}
          onRetry={() => void fetchInsights()}
        />
      )}

      {/* Active insights */}
      {loading ? (
        <InsightsSkeleton />
      ) : insights.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center space-y-3">
          <p className="text-sm text-muted-foreground">
            No insights yet. Insights are generated weekly, or click Refresh to generate now.
          </p>
          <button
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground hover:bg-brand/90 disabled:opacity-50 transition-colors"
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Generate Insights
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {insights.map((insight) => (
            <InsightCard
              key={insight.id}
              insight={insight}
              onAction={() => {
                void fetchInsights();
                void fetchDismissed();
              }}
            />
          ))}
        </div>
      )}

      {/* Objection Patterns section */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Objection Patterns</h2>
        <ObjectionClusters workspace={workspace} />
      </section>

      {/* Dismissed section */}
      {dismissedInsights.length > 0 && (
        <section className="space-y-3">
          <button
            onClick={() => setShowDismissed(!showDismissed)}
            className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <span
              className="inline-block transition-transform"
              style={{ transform: showDismissed ? "rotate(90deg)" : "rotate(0deg)" }}
            >
              &#9654;
            </span>
            Dismissed ({dismissedInsights.length})
          </button>
          {showDismissed && (
            <div className="space-y-3">
              {dismissedInsights.map((insight) => (
                <InsightCard
                  key={insight.id}
                  insight={insight}
                  onAction={() => void fetchDismissed()}
                  readOnly
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
