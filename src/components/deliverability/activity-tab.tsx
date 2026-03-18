"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ActivityFeed,
  type EventData,
} from "@/components/deliverability/activity-feed";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { SenderData } from "@/components/deliverability/sender-health-table";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EventsResponse {
  events: EventData[];
  hasMore: boolean;
  nextCursor?: string;
}

// ---------------------------------------------------------------------------
// ActivityTab
// ---------------------------------------------------------------------------

export function ActivityTab() {
  const [workspace, setWorkspace] = useState<string>("");
  const [workspaceOptions, setWorkspaceOptions] = useState<string[]>([]);
  const [events, setEvents] = useState<EventsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async (ws: string) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (ws) params.set("workspace", ws);
    const qs = params.toString() ? `?${params.toString()}` : "";

    const [eventsRes, sendersRes] = await Promise.allSettled([
      fetch(`/api/deliverability/events${qs}`),
      fetch(`/api/deliverability/senders${qs}`),
    ]);

    if (eventsRes.status === "fulfilled" && eventsRes.value.ok) {
      const json = (await eventsRes.value.json()) as EventsResponse;
      setEvents(json);
    } else {
      setEvents({ events: [], hasMore: false });
    }

    // Extract workspace options from senders for filter
    if (sendersRes.status === "fulfilled" && sendersRes.value.ok) {
      const json = (await sendersRes.value.json()) as SenderData[];
      const slugs = [...new Set(json.map((s) => s.workspaceSlug))].sort();
      setWorkspaceOptions(slugs);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchData(workspace);
  }, [fetchData, workspace]);

  function handleWorkspaceChange(val: string) {
    setWorkspace(val === "all" ? "" : val);
  }

  return (
    <div className="space-y-6">
      {/* Workspace filter */}
      <div className="flex items-center justify-end gap-2">
        <span className="text-xs text-muted-foreground">Workspace:</span>
        <Select
          value={workspace || "all"}
          onValueChange={handleWorkspaceChange}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All workspaces" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All workspaces</SelectItem>
            {workspaceOptions.map((slug) => (
              <SelectItem key={slug} value={slug}>
                {slug}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Activity Feed */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : (
        <ActivityFeed
          initialEvents={events?.events ?? []}
          initialHasMore={events?.hasMore ?? false}
          initialCursor={events?.nextCursor}
          workspaceFilter={workspace || undefined}
        />
      )}
    </div>
  );
}
