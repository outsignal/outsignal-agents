"use client";

import { useState, useEffect, useCallback } from "react";
import {
  DomainHealthCards,
  type DomainData,
} from "@/components/deliverability/domain-health-cards";
import {
  SenderHealthTable,
  type SenderData,
} from "@/components/deliverability/sender-health-table";
import {
  ActivityFeed,
  type EventData,
} from "@/components/deliverability/activity-feed";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EventsResponse {
  events: EventData[];
  hasMore: boolean;
  nextCursor?: string;
}

// ---------------------------------------------------------------------------
// Loading skeletons
// ---------------------------------------------------------------------------

function CardSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <Skeleton className="h-4 w-32" />
      </CardHeader>
      <CardContent className="space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </CardContent>
    </Card>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-9 w-full" />
      {[...Array(5)].map((_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DeliverabilityTab
// ---------------------------------------------------------------------------

export function DeliverabilityTab() {
  const [workspace, setWorkspace] = useState<string>("");
  const [workspaceOptions, setWorkspaceOptions] = useState<string[]>([]);

  const [domains, setDomains] = useState<DomainData[] | null>(null);
  const [senders, setSenders] = useState<SenderData[] | null>(null);
  const [events, setEvents] = useState<EventsResponse | null>(null);

  const [domainsLoading, setDomainsLoading] = useState(true);
  const [sendersLoading, setSendersLoading] = useState(true);
  const [eventsLoading, setEventsLoading] = useState(true);

  // ─── Fetch data ──────────────────────────────────────────────────────────

  const fetchAll = useCallback(async (ws: string) => {
    const params = new URLSearchParams();
    if (ws) params.set("workspace", ws);
    const qs = params.toString() ? `?${params.toString()}` : "";

    setDomainsLoading(true);
    setSendersLoading(true);
    setEventsLoading(true);

    const [domainsRes, sendersRes, eventsRes] = await Promise.allSettled([
      fetch(`/api/deliverability/domains${qs}`),
      fetch(`/api/deliverability/senders${qs}`),
      fetch(`/api/deliverability/events${qs}`),
    ]);

    if (domainsRes.status === "fulfilled" && domainsRes.value.ok) {
      const json = (await domainsRes.value.json()) as DomainData[];
      setDomains(json);
    } else {
      setDomains([]);
    }
    setDomainsLoading(false);

    if (sendersRes.status === "fulfilled" && sendersRes.value.ok) {
      const json = (await sendersRes.value.json()) as SenderData[];
      setSenders(json);
      // Extract unique workspace slugs for filter dropdown
      const slugs = [...new Set(json.map((s) => s.workspaceSlug))].sort();
      setWorkspaceOptions(slugs);
    } else {
      setSenders([]);
    }
    setSendersLoading(false);

    if (eventsRes.status === "fulfilled" && eventsRes.value.ok) {
      const json = (await eventsRes.value.json()) as EventsResponse;
      setEvents(json);
    } else {
      setEvents({ events: [], hasMore: false });
    }
    setEventsLoading(false);
  }, []);

  useEffect(() => {
    void fetchAll(workspace);
  }, [fetchAll, workspace]);

  // ─── Workspace filter handler ─────────────────────────────────────────

  function handleWorkspaceChange(val: string) {
    setWorkspace(val === "all" ? "" : val);
  }

  // ─── Render ───────────────────────────────────────────────────────────

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

      {/* Section 1: Domain Health */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Domain Health</CardTitle>
        </CardHeader>
        <CardContent>
          {domainsLoading ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {[...Array(3)].map((_, i) => (
                <CardSkeleton key={i} />
              ))}
            </div>
          ) : (
            <DomainHealthCards domains={domains ?? []} />
          )}
        </CardContent>
      </Card>

      {/* Section 2: Sender Health */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sender Status</CardTitle>
        </CardHeader>
        <CardContent>
          {sendersLoading ? (
            <TableSkeleton />
          ) : (
            <SenderHealthTable senders={senders ?? []} />
          )}
        </CardContent>
      </Card>

      {/* Section 3: Activity Feed */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Health Events</CardTitle>
        </CardHeader>
        <CardContent>
          {eventsLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
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
        </CardContent>
      </Card>
    </div>
  );
}
