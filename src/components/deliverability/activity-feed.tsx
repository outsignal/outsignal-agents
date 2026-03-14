"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EventData {
  id: string;
  senderEmail: string;
  senderDomain: string | null;
  workspaceSlug: string;
  fromStatus: string | null;
  toStatus: string;
  reason: string;
  bouncePct: number | null;
  detail: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const diffMs = Date.now() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) return `${diffDays}d ago`;
  if (diffHours > 0) return `${diffHours}h ago`;
  if (diffMinutes > 0) return `${diffMinutes}m ago`;
  return "just now";
}

function getStatusDotClass(status: string): string {
  switch (status) {
    case "healthy":
      return "bg-emerald-500";
    case "elevated":
      return "bg-yellow-500";
    case "warning":
      return "bg-orange-500";
    case "critical":
      return "bg-red-500";
    default:
      return "bg-gray-400";
  }
}

function getStatusBorderClass(status: string): string {
  switch (status) {
    case "healthy":
      return "border-l-emerald-400";
    case "elevated":
      return "border-l-yellow-400";
    case "warning":
      return "border-l-orange-400";
    case "critical":
      return "border-l-red-400";
    default:
      return "border-l-gray-300";
  }
}

function formatReason(reason: string): string {
  return reason.replace(/_/g, " ");
}

// ---------------------------------------------------------------------------
// Event row
// ---------------------------------------------------------------------------

function EventRow({ event }: { event: EventData }) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 border-l-2 pl-3 py-2",
        getStatusBorderClass(event.toStatus),
      )}
    >
      {/* Dot */}
      <div className="mt-1 shrink-0">
        <div
          className={cn(
            "h-2 w-2 rounded-full",
            getStatusDotClass(event.toStatus),
          )}
        />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-xs font-medium truncate">{event.senderEmail}</span>
          {event.fromStatus && (
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              {event.fromStatus} → {event.toStatus}
            </span>
          )}
          <span className="rounded border border-border/50 bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground capitalize whitespace-nowrap">
            {formatReason(event.reason)}
          </span>
        </div>
        {event.detail && (
          <p className="text-[10px] text-muted-foreground truncate">{event.detail}</p>
        )}
      </div>

      {/* Timestamp */}
      <span className="shrink-0 text-[10px] text-muted-foreground whitespace-nowrap">
        {formatRelativeTime(event.createdAt)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity Feed
// ---------------------------------------------------------------------------

interface ActivityFeedProps {
  initialEvents: EventData[];
  initialHasMore: boolean;
  initialCursor?: string;
  workspaceFilter?: string;
}

export function ActivityFeed({
  initialEvents,
  initialHasMore,
  initialCursor,
  workspaceFilter,
}: ActivityFeedProps) {
  const [events, setEvents] = useState<EventData[]>(initialEvents);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [nextCursor, setNextCursor] = useState<string | undefined>(initialCursor);
  const [loading, setLoading] = useState(false);

  // Reset state when initial data changes (e.g. workspace filter changed)
  useEffect(() => {
    setEvents(initialEvents);
    setHasMore(initialHasMore);
    setNextCursor(initialCursor);
  }, [initialEvents, initialHasMore, initialCursor]);

  async function handleLoadMore() {
    if (!nextCursor || loading) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("cursor", nextCursor);
      if (workspaceFilter) params.set("workspace", workspaceFilter);

      const res = await fetch(`/api/deliverability/events?${params.toString()}`);
      if (res.ok) {
        const json = (await res.json()) as {
          events: EventData[];
          hasMore: boolean;
          nextCursor?: string;
        };
        setEvents((prev) => [...prev, ...json.events]);
        setHasMore(json.hasMore);
        setNextCursor(json.nextCursor);
      }
    } catch (err) {
      console.error("[activity-feed] Failed to load more events:", err);
    } finally {
      setLoading(false);
    }
  }

  if (events.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-muted-foreground">No health events recorded yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {events.map((event) => (
        <EventRow key={event.id} event={event} />
      ))}
      {hasMore && (
        <div className="pt-3 flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={handleLoadMore}
            disabled={loading}
          >
            {loading ? "Loading..." : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}
