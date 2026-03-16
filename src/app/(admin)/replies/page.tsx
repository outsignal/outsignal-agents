"use client";

import { useState, useEffect, useCallback } from "react";
import { useQueryStates, parseAsString, parseAsInteger } from "nuqs";
import { useDebouncedCallback } from "use-debounce";
import { Search, MessageSquare } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/ui/error-banner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { INTENTS, INTENT_LABELS, type Intent } from "@/lib/classification/types";
import { ReplyTable, type Reply } from "@/components/replies/reply-table";
import { ReplySidePanel } from "@/components/replies/reply-side-panel";
import { ReplyStats, type StatsResponse } from "@/components/replies/reply-stats";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RepliesResponse {
  replies: Reply[];
  total: number;
  page: number;
  totalPages: number;
  limit: number;
}

// ---------------------------------------------------------------------------
// Toggle chip (reused pattern from webhook-log)
// ---------------------------------------------------------------------------

interface ToggleChipProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

function ToggleChip({ label, active, onClick }: ToggleChipProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors focus:outline-none",
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
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
      <MessageSquare className="h-10 w-10 mb-3 text-muted-foreground/40" />
      <p className="text-sm">
        {hasFilters
          ? "No replies match the current filters"
          : "No replies recorded yet"}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Fetched dynamically in the component via /api/workspaces
// (was previously hardcoded with stale slugs)

const DATE_RANGES = [
  { label: "24h", value: "24h" },
  { label: "7d", value: "7d" },
  { label: "30d", value: "30d" },
  { label: "All", value: "all" },
];

const SENTIMENTS = ["positive", "neutral", "negative"] as const;

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function RepliesPage() {
  // URL-persisted filter state via nuqs
  const [params, setParams] = useQueryStates({
    workspace: parseAsString.withDefault(""),
    campaignId: parseAsString.withDefault(""),
    intent: parseAsString.withDefault(""),
    sentiment: parseAsString.withDefault(""),
    search: parseAsString.withDefault(""),
    range: parseAsString.withDefault("all"),
    page: parseAsInteger.withDefault(1),
  });

  // Dynamic workspace list for filter dropdown
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  useEffect(() => {
    fetch("/api/workspaces")
      .then((r) => r.ok ? r.json() : Promise.resolve([]))
      .then((data: Array<{ slug: string }>) => setWorkspaces(data.map((w) => w.slug)))
      .catch(() => setWorkspaces([]));
  }, []);

  // Distinct campaigns for filter dropdown (filtered by workspace when selected)
  const [campaigns, setCampaigns] = useState<{ campaignId: string; campaignName: string }[]>([]);
  useEffect(() => {
    const sp = new URLSearchParams();
    if (params.workspace) sp.set("workspace", params.workspace);
    fetch(`/api/replies/campaigns?${sp.toString()}`)
      .then((r) => r.ok ? r.json() : Promise.resolve({ campaigns: [] }))
      .then((d: { campaigns: { campaignId: string; campaignName: string }[] }) => setCampaigns(d.campaigns))
      .catch(() => setCampaigns([]));
  }, [params.workspace]);

  const [data, setData] = useState<RepliesResponse | null>(null);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedReply, setSelectedReply] = useState<Reply | null>(null);

  // ─── Parse multi-select intent filter ─────────────────────────────────────
  const activeIntents = params.intent
    ? params.intent.split(",").filter(Boolean)
    : [];

  function toggleIntent(intent: string) {
    const current = new Set(activeIntents);
    if (current.has(intent)) {
      current.delete(intent);
    } else {
      current.add(intent);
    }
    void setParams({
      intent: Array.from(current).join(",") || "",
      page: 1,
    });
  }

  // ─── Fetch replies ────────────────────────────────────────────────────────
  const fetchReplies = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      if (params.workspace) sp.set("workspace", params.workspace);
      if (params.campaignId) sp.set("campaignId", params.campaignId);
      if (params.intent) sp.set("intent", params.intent);
      if (params.sentiment) sp.set("sentiment", params.sentiment);
      if (params.search) sp.set("search", params.search);
      if (params.range && params.range !== "all") sp.set("range", params.range);
      sp.set("page", String(params.page));

      const res = await fetch(`/api/replies?${sp.toString()}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as RepliesResponse;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [params.workspace, params.campaignId, params.intent, params.sentiment, params.search, params.range, params.page]);

  // ─── Fetch stats ──────────────────────────────────────────────────────────
  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const sp = new URLSearchParams();
      if (params.workspace) sp.set("workspace", params.workspace);
      if (params.campaignId) sp.set("campaignId", params.campaignId);
      if (params.range && params.range !== "all") sp.set("range", params.range);

      const res = await fetch(`/api/replies/stats?${sp.toString()}`);
      if (!res.ok) return;
      const json = (await res.json()) as StatsResponse;
      setStats(json);
    } catch {
      // Stats are non-critical
    } finally {
      setStatsLoading(false);
    }
  }, [params.workspace, params.campaignId, params.range]);

  useEffect(() => {
    void fetchReplies();
  }, [fetchReplies]);

  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  // Debounced search
  const debouncedSetSearch = useDebouncedCallback((value: string) => {
    void setParams({ search: value, page: 1 });
  }, 300);

  // ─── Override handler ─────────────────────────────────────────────────────
  function handleOverrideSuccess(updatedReply: Reply) {
    // Update in local list
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        replies: prev.replies.map((r) =>
          r.id === updatedReply.id ? updatedReply : r,
        ),
      };
    });
    // Update selected reply
    setSelectedReply(updatedReply);
    // Refetch stats since distributions changed
    void fetchStats();
  }

  const totalPages = data?.totalPages ?? 0;
  const hasFilters =
    params.search ||
    params.workspace ||
    params.campaignId ||
    params.intent ||
    params.sentiment ||
    params.range !== "all";

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Replies"
        description={
          data && !loading
            ? `${data.total.toLocaleString()} total replies`
            : "Reply storage and classification"
        }
      />

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Search + workspace filter row */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input
              type="text"
              placeholder="Search by email or subject..."
              defaultValue={params.search}
              onChange={(e) => debouncedSetSearch(e.target.value)}
              className="pl-8"
            />
          </div>

          <Select
            value={params.workspace || "all"}
            onValueChange={(val) => {
              void setParams({
                workspace: val === "all" ? "" : val,
                campaignId: "", // reset campaign when workspace changes
                page: 1,
              });
            }}
          >
            <SelectTrigger size="sm" className="w-44">
              <SelectValue placeholder="All workspaces" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All workspaces</SelectItem>
              {workspaces.map((slug) => (
                <SelectItem key={slug} value={slug}>
                  {slug}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {campaigns.length > 0 && (
            <Select
              value={params.campaignId || "all"}
              onValueChange={(val) => {
                void setParams({
                  campaignId: val === "all" ? "" : val,
                  page: 1,
                });
              }}
            >
              <SelectTrigger size="sm" className="w-52">
                <SelectValue placeholder="All campaigns" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All campaigns</SelectItem>
                {campaigns.map((c) => (
                  <SelectItem key={c.campaignId} value={c.campaignId}>
                    {c.campaignName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Intent filter chips */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-stone-500 mr-1">Intent:</span>
          {INTENTS.map((i) => (
            <ToggleChip
              key={i}
              label={INTENT_LABELS[i]}
              active={activeIntents.includes(i)}
              onClick={() => toggleIntent(i)}
            />
          ))}
        </div>

        {/* Sentiment + date range row */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xs text-stone-500 mr-1">
              Sentiment:
            </span>
            {SENTIMENTS.map((s) => (
              <ToggleChip
                key={s}
                label={s.charAt(0).toUpperCase() + s.slice(1)}
                active={params.sentiment === s}
                onClick={() =>
                  void setParams({
                    sentiment: params.sentiment === s ? "" : s,
                    page: 1,
                  })
                }
              />
            ))}
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-stone-500 mr-1">Range:</span>
            {DATE_RANGES.map((r) => (
              <ToggleChip
                key={r.value}
                label={r.label}
                active={params.range === r.value}
                onClick={() =>
                  void setParams({ range: r.value, page: 1 })
                }
              />
            ))}
          </div>

          {hasFilters && (
            <Button
              variant="link"
              size="xs"
              onClick={() =>
                void setParams({
                  search: "",
                  workspace: "",
                  campaignId: "",
                  intent: "",
                  sentiment: "",
                  range: "all",
                  page: 1,
                })
              }
              className="text-muted-foreground hover:text-foreground"
            >
              Clear all
            </Button>
          )}
        </div>

        {/* Stats strip */}
        <ReplyStats stats={stats} loading={statsLoading} />

        {/* Error state */}
        {error && (
          <ErrorBanner
            message={`Failed to load replies: ${error}`}
            onRetry={() => void fetchReplies()}
          />
        )}

        {/* Table */}
        {!loading && data && data.replies.length === 0 ? (
          <EmptyState hasFilters={!!hasFilters} />
        ) : (
          <ReplyTable
            replies={data?.replies ?? []}
            onSelect={setSelectedReply}
            selectedId={selectedReply?.id ?? null}
            loading={loading}
          />
        )}

        {/* Pagination */}
        {!loading && data && totalPages > 1 && (
          <div className="flex items-center justify-between text-sm">
            <p className="text-xs text-stone-500">
              Page <span className="font-mono">{params.page}</span> of <span className="font-mono">{totalPages}</span> &middot;{" "}
              <span className="font-mono">{data.total.toLocaleString()}</span> total
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void setParams({ page: params.page - 1 })}
                disabled={params.page <= 1}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void setParams({ page: params.page + 1 })}
                disabled={params.page >= totalPages}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Side panel */}
      <ReplySidePanel
        reply={selectedReply}
        onClose={() => setSelectedReply(null)}
        onOverrideSuccess={handleOverrideSuccess}
      />
    </div>
  );
}
