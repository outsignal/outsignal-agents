"use client";

import { useState } from "react";
import { TrendingUp, TrendingDown, Loader2, Clock, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  CONFIDENCE_COLORS,
  ACTION_TYPE_LABELS,
  type InsightCategory,
  type ConfidenceLevel,
  type InsightStatus,
  type ActionType,
} from "@/lib/insights/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EvidenceItem {
  metric: string;
  value: string;
  change: string | null;
}

interface InsightData {
  id: string;
  category: InsightCategory;
  observation: string;
  evidence: EvidenceItem[];
  actionType: ActionType;
  actionDescription: string;
  actionParams: Record<string, string> | null;
  confidence: ConfidenceLevel;
  priority: number;
  status: InsightStatus;
  generatedAt: string;
  executionResult: { before?: string; after?: string; outcome?: string; error?: string } | null;
}

interface InsightCardProps {
  insight: InsightData;
  onAction: () => void;
  readOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function parseChange(change: string | null): { value: number; text: string } | null {
  if (!change) return null;
  // Extract numeric value from strings like "-40% vs last week" or "+15%"
  const match = change.match(/([+-]?\d+(?:\.\d+)?)/);
  if (!match) return { value: 0, text: change };
  return { value: parseFloat(match[1]), text: change };
}

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  executed: { label: "Executed", className: "bg-green-100 text-green-800" },
  failed: { label: "Failed", className: "bg-red-100 text-red-800" },
  dismissed: { label: "Dismissed", className: "bg-gray-100 text-gray-600" },
  snoozed: { label: "Snoozed", className: "bg-yellow-100 text-yellow-800" },
  approved: { label: "Approved", className: "bg-blue-100 text-blue-800" },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function InsightCard({ insight, onAction, readOnly = false }: InsightCardProps) {
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmingPause, setConfirmingPause] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);

  const isActive = insight.status === "active";
  const showActions = isActive && !readOnly;
  const borderColor = CATEGORY_COLORS[insight.category];

  async function handleAction(action: "approve" | "dismiss" | "snooze", snoozeDays?: number) {
    setActionLoading(action);
    try {
      const res = await fetch(`/api/insights/${insight.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(snoozeDays ? { snoozeDays } : {}) }),
      });
      if (!res.ok) throw new Error("Failed");
      onAction();
    } catch {
      // Silently fail -- the parent will re-fetch and show current state
    } finally {
      setActionLoading(null);
      setConfirmingPause(false);
      setSnoozeOpen(false);
    }
  }

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card p-4 border-l-4 space-y-3",
        borderColor,
        readOnly && "opacity-60",
      )}
    >
      {/* Top row: Category + Confidence + Date */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
          {CATEGORY_LABELS[insight.category]}
        </span>
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
            CONFIDENCE_COLORS[insight.confidence],
          )}
        >
          {insight.confidence}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {timeAgo(insight.generatedAt)}
        </span>
      </div>

      {/* Observation */}
      <p className="text-sm font-semibold text-foreground leading-snug">
        {insight.observation}
      </p>

      {/* Evidence */}
      {insight.evidence.length > 0 && (
        <div className="space-y-1">
          {insight.evidence.map((ev, idx) => {
            const parsed = parseChange(ev.change);
            const isNegative = parsed && parsed.value < 0;
            const isPositive = parsed && parsed.value > 0;

            return (
              <div
                key={idx}
                className="flex items-center gap-2 text-xs text-muted-foreground"
              >
                <span className="font-medium text-foreground">{ev.metric}:</span>
                <span>{ev.value}</span>
                {parsed && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-0.5",
                      isNegative && "text-red-600",
                      isPositive && "text-green-600",
                      !isNegative && !isPositive && "text-muted-foreground",
                    )}
                  >
                    {isPositive ? (
                      <TrendingUp className="h-3 w-3" />
                    ) : isNegative ? (
                      <TrendingDown className="h-3 w-3" />
                    ) : null}
                    {parsed.text}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Suggested action */}
      <div className="rounded-md bg-muted/50 px-3 py-2">
        <p className="text-xs text-muted-foreground">
          <span className="font-medium">Suggested:</span> {insight.actionDescription}
        </p>
      </div>

      {/* Status badge for non-active insights */}
      {!isActive && (
        <div className="flex items-center gap-2">
          {STATUS_BADGES[insight.status] && (
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
                STATUS_BADGES[insight.status].className,
              )}
            >
              {STATUS_BADGES[insight.status].label}
            </span>
          )}
          {insight.executionResult && (insight.executionResult.before || insight.executionResult.after) && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer hover:text-foreground">Execution details</summary>
              <div className="mt-1 space-y-0.5 pl-2 border-l border-border">
                {insight.executionResult.before && (
                  <p><span className="font-medium">Before:</span> {insight.executionResult.before}</p>
                )}
                {insight.executionResult.after && (
                  <p><span className="font-medium">After:</span> {insight.executionResult.after}</p>
                )}
                {insight.executionResult.outcome && (
                  <p><span className="font-medium">Outcome:</span> {insight.executionResult.outcome}</p>
                )}
              </div>
            </details>
          )}
          {insight.executionResult?.error && (
            <span className="text-xs text-red-600">{insight.executionResult.error}</span>
          )}
        </div>
      )}

      {/* Action buttons */}
      {showActions && (
        <div className="flex items-center gap-2 pt-1">
          {/* Approve button */}
          {!confirmingPause ? (
            <button
              onClick={() => {
                if (insight.actionType === "pause_campaign") {
                  setConfirmingPause(true);
                } else {
                  void handleAction("approve");
                }
              }}
              disabled={actionLoading !== null}
              className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {actionLoading === "approve" && <Loader2 className="h-3 w-3 animate-spin" />}
              Approve
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => void handleAction("approve")}
                disabled={actionLoading !== null}
                className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {actionLoading === "approve" && <Loader2 className="h-3 w-3 animate-spin" />}
                Confirm pause?
              </button>
              <button
                onClick={() => setConfirmingPause(false)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Snooze dropdown */}
          <div className="relative">
            <button
              onClick={() => setSnoozeOpen(!snoozeOpen)}
              disabled={actionLoading !== null}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 transition-colors"
            >
              {actionLoading === "snooze" && <Loader2 className="h-3 w-3 animate-spin" />}
              <Clock className="h-3 w-3" />
              Snooze
              <ChevronDown className="h-3 w-3" />
            </button>
            {snoozeOpen && (
              <div className="absolute top-full left-0 mt-1 z-10 rounded-md border border-border bg-popover shadow-md py-1 min-w-[120px]">
                {[
                  { days: 3, label: "3 days" },
                  { days: 7, label: "1 week" },
                  { days: 14, label: "2 weeks" },
                ].map((opt) => (
                  <button
                    key={opt.days}
                    onClick={() => void handleAction("snooze", opt.days)}
                    className="block w-full text-left px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Dismiss button */}
          <button
            onClick={() => void handleAction("dismiss")}
            disabled={actionLoading !== null}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 transition-colors"
          >
            {actionLoading === "dismiss" && <Loader2 className="h-3 w-3 animate-spin" />}
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
