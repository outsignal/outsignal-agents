"use client";

import { useState, useEffect, useCallback } from "react";
import { useQueryStates, parseAsString, parseAsBoolean, parseAsInteger } from "nuqs";
import { useDebouncedCallback } from "use-debounce";
import { Search, Webhook } from "lucide-react";
import { Header } from "@/components/layout/header";
import {
  WebhookLogTable,
  type WebhookEvent,
} from "@/components/operations/webhook-log-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface WebhookLogResponse {
  events: WebhookEvent[];
  total: number;
  page: number;
  totalPages: number;
}

// ─── Toggle chip ──────────────────────────────────────────────────────────────

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
          ? "bg-[#F0FF7A] text-[#3a4000] border-[#c8d900]"
          : "bg-secondary text-muted-foreground border-border hover:bg-muted hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

interface EmptyStateProps {
  search: string;
  errors: boolean;
  replies: boolean;
  hours: number | null;
}

function EmptyState({ search, errors, replies, hours }: EmptyStateProps) {
  let message = "No webhook events found";

  if (search) {
    message = `No matching events for "${search}"`;
  } else if (errors && hours) {
    message = `No errors in the last ${hours}h`;
  } else if (errors) {
    message = "No error events recorded";
  } else if (replies && hours) {
    message = `No replies in the last ${hours}h`;
  } else if (replies) {
    message = "No reply events recorded";
  } else if (hours) {
    message = `No events in the last ${hours}h`;
  }

  return (
    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
      <Webhook className="h-10 w-10 mb-3 text-muted-foreground/40" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const WORKSPACES = [
  "rise",
  "lime-recruitment",
  "yoopknows",
  "outsignal",
  "myacq",
  "1210-solutions",
];

export default function WebhookLogPage() {
  // URL-persisted filter state via nuqs
  const [params, setParams] = useQueryStates({
    search: parseAsString.withDefault(""),
    workspace: parseAsString.withDefault(""),
    errors: parseAsBoolean.withDefault(false),
    replies: parseAsBoolean.withDefault(false),
    hours: parseAsInteger.withDefault(0), // 0 means no time filter
    page: parseAsInteger.withDefault(1),
  });

  const [data, setData] = useState<WebhookLogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ─── Fetch ──────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      if (params.search) sp.set("search", params.search);
      if (params.workspace) sp.set("workspace", params.workspace);
      if (params.errors) sp.set("errors", "true");
      if (params.replies) sp.set("replies", "true");
      if (params.hours) sp.set("hours", String(params.hours));
      sp.set("page", String(params.page));

      const res = await fetch(`/api/webhook-log?${sp.toString()}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as WebhookLogResponse;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    void fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    params.search,
    params.workspace,
    params.errors,
    params.replies,
    params.hours,
    params.page,
  ]);

  // Debounced search input — updates URL after 300ms pause
  const debouncedSetSearch = useDebouncedCallback((value: string) => {
    void setParams({ search: value, page: 1 });
  }, 300);

  // ─── Chip toggle helpers ───────────────────────────────────────────────────

  const toggleErrors = () =>
    void setParams({ errors: !params.errors, page: 1 });
  const toggleReplies = () =>
    void setParams({ replies: !params.replies, page: 1 });
  const toggleHours = (h: number) =>
    void setParams({ hours: params.hours === h ? 0 : h, page: 1 });

  const totalPages = data?.totalPages ?? 0;
  const hasFilters =
    params.search || params.workspace || params.errors || params.replies || params.hours;

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Webhook Log"
        description="EmailBison webhook events — search, filter, and inspect payloads"
      />

      <div className="flex-1 overflow-auto p-6 space-y-4">
        {/* Search + workspace filter row */}
        <div className="flex items-center gap-3">
          {/* Search box */}
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Search by email address…"
              defaultValue={params.search}
              onChange={(e) => debouncedSetSearch(e.target.value)}
              className="w-full border border-border bg-background text-sm text-foreground placeholder-muted-foreground rounded-md pl-8 pr-4 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>

          {/* Workspace dropdown */}
          <Select
            value={params.workspace || "all"}
            onValueChange={(val) => {
              void setParams({
                workspace: val === "all" ? "" : val,
                page: 1,
              });
            }}
          >
            <SelectTrigger size="sm" className="w-44">
              <SelectValue placeholder="All workspaces" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All workspaces</SelectItem>
              {WORKSPACES.map((slug) => (
                <SelectItem key={slug} value={slug}>
                  {slug}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Total count */}
          {data && !loading && (
            <span className="text-xs text-muted-foreground ml-auto">
              {data.total.toLocaleString()} event{data.total !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* Filter chip row */}
        <div className="flex items-center gap-2 flex-wrap">
          <ToggleChip
            label="Errors only"
            active={params.errors}
            onClick={toggleErrors}
          />
          <ToggleChip
            label="Replies only"
            active={params.replies}
            onClick={toggleReplies}
          />
          <ToggleChip
            label="Last 24h"
            active={params.hours === 24}
            onClick={() => toggleHours(24)}
          />
          <ToggleChip
            label="Last 7 days"
            active={params.hours === 168}
            onClick={() => toggleHours(168)}
          />

          {/* Clear all filters */}
          {hasFilters ? (
            <button
              onClick={() =>
                void setParams({
                  search: "",
                  workspace: "",
                  errors: false,
                  replies: false,
                  hours: 0,
                  page: 1,
                })
              }
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 ml-2"
            >
              Clear all
            </button>
          ) : null}
        </div>

        {/* Error state */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center justify-between">
            <p className="text-red-800 text-sm">
              Failed to load events: {error}
            </p>
            <button
              onClick={() => void fetchData()}
              className="text-xs bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded"
            >
              Retry
            </button>
          </div>
        )}

        {/* Table */}
        {!loading && data && data.events.length === 0 ? (
          <EmptyState
            search={params.search}
            errors={params.errors}
            replies={params.replies}
            hours={params.hours || null}
          />
        ) : (
          <WebhookLogTable events={data?.events ?? []} loading={loading} />
        )}

        {/* Pagination */}
        {!loading && data && totalPages > 1 && (
          <div className="flex items-center justify-between text-sm">
            <p className="text-xs text-muted-foreground">
              Page {params.page} of {totalPages} &middot;{" "}
              {data.total.toLocaleString()} total
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void setParams({ page: params.page - 1 })}
                disabled={params.page <= 1}
                className="px-3 py-1.5 text-xs rounded border border-border bg-secondary text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <button
                onClick={() => void setParams({ page: params.page + 1 })}
                disabled={params.page >= totalPages}
                className="px-3 py-1.5 text-xs rounded border border-border bg-secondary text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
