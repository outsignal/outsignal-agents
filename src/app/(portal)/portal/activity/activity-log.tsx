"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Mail,
  LinkedinIcon,
  Send,
  MessageSquare,
  UserPlus,
  UserCheck,
  Reply,
  Clock,
  Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

interface ActivityItem {
  id: string;
  channel: "email" | "linkedin";
  actionType: "send" | "reply" | "connect" | "message" | "connected";
  status: "queued" | "in_progress" | "complete";
  personName: string | null;
  personCompany: string | null;
  personLinkedinUrl: string | null;
  personEmail: string | null;
  campaignName: string | null;
  preview: string | null;
  timestamp: string;
}

interface ActivityResponse {
  items: ActivityItem[];
  total: number;
  page: number;
  totalPages: number;
}

type ChannelFilter = "all" | "email" | "linkedin";
type StatusFilter = "all" | "queued" | "complete";
type DateRange = "7" | "14" | "30";

function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

const ACTION_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  send: Send,
  reply: Reply,
  connect: UserPlus,
  connected: UserCheck,
  message: MessageSquare,
};

const ACTION_BADGE_VARIANT: Record<string, "info" | "success" | "purple"> = {
  send: "info",
  reply: "success",
  connect: "purple",
  connected: "success",
  message: "purple",
};

const ACTION_LABELS: Record<string, string> = {
  send: "Sent",
  reply: "Reply",
  connect: "Connection",
  connected: "Connected",
  message: "Message",
};

const STATUS_BADGE_VARIANT: Record<string, "warning" | "info" | "success"> = {
  queued: "warning",
  in_progress: "info",
  complete: "success",
};

const STATUS_LABELS: Record<string, string> = {
  queued: "Queued",
  in_progress: "In Progress",
  complete: "Complete",
};

function getDateGroup(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86_400_000);
  const weekAgo = new Date(today.getTime() - 6 * 86_400_000);

  if (date >= today) return "Today";
  if (date >= yesterday) return "Yesterday";
  if (date >= weekAgo) return "This Week";
  return "Earlier";
}

interface ActivityLogProps {
  workspaceSlug: string;
}

export function ActivityLog({ workspaceSlug }: ActivityLogProps) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [channel, setChannel] = useState<ChannelFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [dateRange, setDateRange] = useState<DateRange>("7");

  const fetchActivity = useCallback(
    async (pageNum: number, append = false) => {
      setError(null);
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      try {
        const params = new URLSearchParams({ page: String(pageNum) });
        if (channel !== "all") params.set("channel", channel);
        if (status !== "all") params.set("status", status);
        // Calculate "from" date based on dateRange
        const from = new Date();
        from.setDate(from.getDate() - Number(dateRange));
        params.set("from", from.toISOString());

        const res = await fetch(`/api/portal/activity?${params}`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error("Failed to fetch activity");
        const data: ActivityResponse = await res.json();

        if (append) {
          setItems((prev) => [...prev, ...data.items]);
        } else {
          setItems(data.items);
        }
        setTotal(data.total);
        setPage(data.page);
        setTotalPages(data.totalPages);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load activity");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [channel, status, dateRange]
  );

  // Refetch when filters change
  useEffect(() => {
    setPage(1);
    fetchActivity(1);
  }, [fetchActivity]);

  const handleLoadMore = () => {
    if (page < totalPages) {
      fetchActivity(page + 1, true);
    }
  };

  const channelTabs: { value: ChannelFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "email", label: "Email" },
    { value: "linkedin", label: "LinkedIn" },
  ];

  return (
    <div className="flex flex-col h-full p-6 gap-6">
      {/* Header */}
      <div className="flex items-start justify-between shrink-0">
        <div>
          <h1 className="text-xl font-medium text-foreground">
            Activity
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Outreach actions taken on your behalf
          </p>
        </div>
        {!loading && total > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {total.toLocaleString()} action{total !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 shrink-0">
        {/* Channel tabs */}
        <div className="inline-flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
          {channelTabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setChannel(tab.value)}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-all duration-150",
                channel === tab.value
                  ? "bg-background text-foreground shadow-sm font-medium"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.value === "email" && <Mail className="h-3.5 w-3.5" />}
              {tab.value === "linkedin" && <LinkedinIcon className="h-3.5 w-3.5" />}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Status filter */}
        <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
          <SelectTrigger className="w-[130px] h-8 text-sm">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="queued">Queued</SelectItem>
            <SelectItem value="complete">Completed</SelectItem>
          </SelectContent>
        </Select>

        {/* Date range */}
        <Select value={dateRange} onValueChange={(v) => setDateRange(v as DateRange)}>
          <SelectTrigger className="w-[140px] h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="14">Last 14 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Activity list */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading ? (
          <div className="space-y-1">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-4 px-4 py-3 border-b border-border"
              >
                <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-32" />
                </div>
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <p className="text-sm text-muted-foreground">{error}</p>
            <button
              onClick={() => fetchActivity(1)}
              className="text-sm text-brand hover:underline font-medium"
            >
              Try again
            </button>
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Clock}
            title="No activity yet"
            description="Your outreach activity will appear here once campaigns are running."
          />
        ) : (
          <div>
            {(() => {
              let lastGroup = "";
              return items.map((item) => {
                const group = getDateGroup(item.timestamp);
                const showHeader = group !== lastGroup;
                lastGroup = group;
                return (
                  <div key={item.id}>
                    {showHeader && (
                      <div className="sticky top-0 z-10 px-4 py-2 bg-muted/60 backdrop-blur-sm border-b border-border/50">
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          {group}
                        </span>
                      </div>
                    )}
                    <ActivityRow item={item} />
                  </div>
                );
              });
            })()}
          </div>
        )}

        {/* Load more */}
        {!loading && page < totalPages && (
          <div className="flex justify-center py-4">
            <Button
              variant="outline"
              size="sm"
              onClick={handleLoadMore}
              disabled={loadingMore}
            >
              {loadingMore ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  Loading...
                </>
              ) : (
                "Load more"
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const [expanded, setExpanded] = useState(false);
  const ChannelIcon = item.channel === "email" ? Mail : LinkedinIcon;
  const ActionIcon = ACTION_ICONS[item.actionType] ?? Send;

  const personLink = item.personLinkedinUrl
    ? item.personLinkedinUrl
    : item.personEmail
      ? `mailto:${item.personEmail}`
      : null;

  const displayName = item.personName ?? item.personEmail ?? "Unknown";

  return (
    <div
      className="flex items-start gap-4 px-4 py-3 hover:bg-muted/50 transition-colors border-b border-border/50 cursor-pointer"
      onClick={() => item.preview && setExpanded((v) => !v)}
    >
      {/* Channel icon */}
      <div
        className={cn(
          "flex items-center justify-center h-8 w-8 rounded-full shrink-0 mt-0.5",
          item.channel === "email"
            ? "bg-brand/10 text-brand"
            : "bg-[#0A66C2]/10 text-[#0A66C2]"
        )}
      >
        <ChannelIcon className="h-4 w-4" />
      </div>

      {/* Person info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {personLink ? (
            <a
              href={personLink}
              target={item.personLinkedinUrl ? "_blank" : undefined}
              rel={item.personLinkedinUrl ? "noopener noreferrer" : undefined}
              className="text-sm font-medium text-foreground hover:text-brand transition-colors truncate"
              onClick={(e) => e.stopPropagation()}
            >
              {displayName}
            </a>
          ) : (
            <span className="text-sm font-medium text-foreground truncate">
              {displayName}
            </span>
          )}
          {item.personCompany && (
            <span className="text-xs text-muted-foreground truncate hidden sm:inline">
              {item.personCompany}
            </span>
          )}
        </div>
        {item.campaignName && (
          <span className="text-xs text-muted-foreground truncate block mt-0.5 max-w-[300px]">
            {item.campaignName}
          </span>
        )}
        {item.preview && expanded && (
          <p className="text-xs text-muted-foreground/80 mt-1.5 leading-relaxed whitespace-pre-wrap">
            {item.preview}
          </p>
        )}
      </div>

      {/* Action badge */}
      <Badge variant={ACTION_BADGE_VARIANT[item.actionType] ?? "info"} size="xs" className="shrink-0 mt-0.5">
        <ActionIcon className="h-3 w-3" />
        {ACTION_LABELS[item.actionType] ?? item.actionType}
      </Badge>

      {/* Status badge */}
      <Badge
        variant={STATUS_BADGE_VARIANT[item.status] ?? "secondary"}
        size="xs"
        dot
        className={cn(
          "shrink-0 mt-0.5",
          item.status === "in_progress" && "animate-pulse"
        )}
      >
        {STATUS_LABELS[item.status] ?? item.status}
      </Badge>

      {/* Timestamp */}
      <span className="text-xs text-muted-foreground tabular-nums shrink-0 w-16 text-right mt-0.5">
        {formatRelativeTime(item.timestamp)}
      </span>
    </div>
  );
}
