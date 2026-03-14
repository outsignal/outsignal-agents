"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useQueryState } from "nuqs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/layout/header";
import { MetricCard } from "@/components/dashboard/metric-card";
import {
  LinkedInQueueTable,
  QueueTableSkeleton,
  type LinkedInQueueAction,
} from "@/components/operations/linkedin-queue-table";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface QueueResponse {
  actions: LinkedInQueueAction[];
  counts: {
    pending: number;
    running: number;
    complete: number;
    failed: number;
    cancelled: number;
    expired: number;
    total: number;
  };
  total: number;
  page: number;
  totalPages: number;
}

// ─── Options ───────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "running", label: "Running" },
  { value: "complete", label: "Complete" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "expired", label: "Expired" },
];

const ACTION_TYPE_OPTIONS = [
  { value: "connect", label: "Connect" },
  { value: "message", label: "Message" },
  { value: "profile_view", label: "Profile View" },
  { value: "check_connection", label: "Check Connection" },
];

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function LinkedInQueuePage() {
  const [data, setData] = useState<QueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [senders, setSenders] = useState<Array<{ id: string; name: string }>>([]);
  const [workspaces, setWorkspaces] = useState<string[]>([]);

  // URL-persisted filters
  const [statusFilter, setStatusFilter] = useQueryState("status", {
    defaultValue: "all",
  });
  const [actionTypeFilter, setActionTypeFilter] = useQueryState("actionType", {
    defaultValue: "all",
  });
  const [workspaceFilter, setWorkspaceFilter] = useQueryState("workspace", {
    defaultValue: "all",
  });
  const [senderFilter, setSenderFilter] = useQueryState("sender", {
    defaultValue: "all",
  });

  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchQueue = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (actionTypeFilter !== "all") params.set("actionType", actionTypeFilter);
      if (workspaceFilter !== "all") params.set("workspace", workspaceFilter);
      if (senderFilter !== "all") params.set("sender", senderFilter);
      params.set("page", String(page));
      params.set("limit", "50");

      try {
        const res = await fetch(`/api/linkedin-queue?${params.toString()}`);
        const json: QueueResponse = await res.json();
        setData(json);

        // Extract unique senders from actions
        if (senders.length === 0) {
          const seen = new Map<string, string>();
          json.actions.forEach((a) => {
            if (!seen.has(a.sender.id)) seen.set(a.sender.id, a.sender.name);
          });
          setSenders(Array.from(seen.entries()).map(([id, name]) => ({ id, name })));
        }

        // Extract unique workspaces from actions
        if (workspaces.length === 0) {
          const wsSeen = new Set<string>();
          json.actions.forEach((a: LinkedInQueueAction) => {
            if (a.workspaceSlug) wsSeen.add(a.workspaceSlug);
          });
          setWorkspaces(Array.from(wsSeen).sort());
        }
      } catch {
        // Silently fail on auto-refresh
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [statusFilter, actionTypeFilter, workspaceFilter, senderFilter, page, senders.length, workspaces.length]
  );

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [statusFilter, actionTypeFilter, workspaceFilter, senderFilter]);

  // Fetch on filter/page change
  useEffect(() => {
    fetchQueue(false);
  }, [fetchQueue]);

  // Auto-refresh every 15s
  useEffect(() => {
    if (autoRefreshRef.current) {
      clearInterval(autoRefreshRef.current);
      autoRefreshRef.current = null;
    }

    autoRefreshRef.current = setInterval(() => {
      fetchQueue(true);
    }, 15_000);

    return () => {
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    };
  }, [fetchQueue]);

  const totalPages = data?.totalPages ?? 1;
  const counts = data?.counts;

  return (
    <div className="flex flex-col h-full">
      <Header
        title="LinkedIn Queue"
        description="Monitor LinkedIn action execution queue"
      />

      <div className="flex-1 p-6 space-y-6">
        {/* Status count cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard
            label="Pending"
            value={counts?.pending ?? 0}
            trend="neutral"
          />
          <MetricCard
            label="Running"
            value={counts?.running ?? 0}
            trend={counts?.running ? "warning" : "neutral"}
          />
          <MetricCard
            label="Complete"
            value={counts?.complete ?? 0}
            trend="up"
          />
          <MetricCard
            label="Failed"
            value={counts?.failed ?? 0}
            trend={counts?.failed ? "down" : "neutral"}
          />
        </div>

        {/* Filter row */}
        <div className="flex items-center gap-3 flex-wrap">
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v)}
          >
            <SelectTrigger className="h-8 text-xs w-[140px]">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All Statuses</SelectItem>
              {STATUS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={actionTypeFilter}
            onValueChange={(v) => setActionTypeFilter(v)}
          >
            <SelectTrigger className="h-8 text-xs w-[160px]">
              <SelectValue placeholder="All Actions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All Actions</SelectItem>
              {ACTION_TYPE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={workspaceFilter}
            onValueChange={(v) => setWorkspaceFilter(v)}
          >
            <SelectTrigger className="h-8 text-xs w-[160px]">
              <SelectValue placeholder="All Workspaces" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All Workspaces</SelectItem>
              {workspaces.map((ws) => (
                <SelectItem key={ws} value={ws} className="text-xs">
                  {ws}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {senders.length > 0 && (
            <Select
              value={senderFilter}
              onValueChange={(v) => setSenderFilter(v)}
            >
              <SelectTrigger className="h-8 text-xs w-[160px]">
                <SelectValue placeholder="All Senders" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All Senders</SelectItem>
                {senders.map((s) => (
                  <SelectItem key={s.id} value={s.id} className="text-xs">
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <div className="ml-auto flex items-center gap-2">
            {data && (
              <span className="text-xs text-muted-foreground">
                {data.total} action{data.total !== 1 ? "s" : ""}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground bg-muted border border-border px-2 py-0.5 rounded-full">
              Auto-refreshing every 15s
            </span>
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <QueueTableSkeleton />
        ) : (
          <LinkedInQueueTable actions={data?.actions ?? []} />
        )}

        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-between pt-1">
            <p className="text-xs text-muted-foreground">
              Page {page} of {totalPages}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
