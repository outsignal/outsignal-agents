"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WebhookEvent {
  id: string;
  workspace: string;
  eventType: string;
  campaignId: string | null;
  leadEmail: string | null;
  senderEmail: string | null;
  payload: string;
  receivedAt: string;
}

interface WebhookLogTableProps {
  events: WebhookEvent[];
  loading?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diff = Math.floor((now - date) / 1000);

  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function fullTimestamp(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// ─── Event type badge ─────────────────────────────────────────────────────────

const EVENT_TYPE_STYLES: Record<
  string,
  { label: string; className: string }
> = {
  EMAIL_SENT: {
    label: "Sent",
    className: "bg-zinc-100 text-zinc-600 border-zinc-200",
  },
  EMAIL_OPENED: {
    label: "Opened",
    className: "bg-blue-50 text-blue-700 border-blue-200",
  },
  LEAD_REPLIED: {
    label: "Replied",
    className: "bg-brand/20 text-brand-foreground border-brand/50",
  },
  LEAD_INTERESTED: {
    label: "Interested",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  BOUNCED: {
    label: "Bounced",
    className: "bg-red-50 text-red-700 border-red-200",
  },
  UNSUBSCRIBED: {
    label: "Unsubscribed",
    className: "bg-orange-50 text-orange-700 border-orange-200",
  },
  COMPLAINT: {
    label: "Complaint",
    className: "bg-red-100 text-red-800 border-red-300",
  },
  UNTRACKED_REPLY_RECEIVED: {
    label: "Untracked Reply",
    className: "bg-purple-50 text-purple-700 border-purple-200",
  },
};

function EventTypeBadge({ eventType }: { eventType: string }) {
  const style = EVENT_TYPE_STYLES[eventType];
  if (style) {
    return (
      <Badge
        variant="outline"
        size="xs"
        className={cn("font-medium", style.className)}
      >
        {style.label}
      </Badge>
    );
  }
  // Unknown event type — show raw value in default gray style
  return (
    <Badge
      variant="outline"
      size="xs"
      className="font-medium bg-zinc-50 text-zinc-500 border-zinc-200"
    >
      {eventType}
    </Badge>
  );
}

// ─── Skeleton rows ────────────────────────────────────────────────────────────

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <TableRow key={i} className="border-border">
          <TableCell className="py-1.5 px-2">
            <div className="h-3 bg-muted rounded animate-pulse w-16" />
          </TableCell>
          <TableCell className="py-1.5 px-2">
            <div className="h-4 bg-muted rounded animate-pulse w-20" />
          </TableCell>
          <TableCell className="py-1.5 px-2">
            <div className="h-3 bg-muted rounded animate-pulse w-32" />
          </TableCell>
          <TableCell className="py-1.5 px-2">
            <div className="h-3 bg-muted rounded animate-pulse w-28" />
          </TableCell>
          <TableCell className="py-1.5 px-2">
            <div className="h-3 bg-muted rounded animate-pulse w-16" />
          </TableCell>
          <TableCell className="py-1.5 px-2">
            <div className="h-3 bg-muted rounded animate-pulse w-20" />
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

// ─── Expandable row ───────────────────────────────────────────────────────────

function WebhookEventRow({ event }: { event: WebhookEvent }) {
  const [expanded, setExpanded] = useState(false);

  let parsedPayload: unknown = null;
  let parseError = false;
  try {
    parsedPayload = JSON.parse(event.payload);
  } catch {
    parseError = true;
  }

  return (
    <>
      <TableRow
        className={cn(
          "border-border cursor-pointer hover:bg-muted/40 transition-colors",
          expanded && "bg-muted/30",
        )}
        onClick={() => setExpanded((v) => !v)}
      >
        {/* Expand toggle */}
        <TableCell className="py-1.5 px-2 w-6">
          {expanded ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          )}
        </TableCell>

        {/* Received At */}
        <TableCell className="py-1.5 px-2 text-xs text-muted-foreground whitespace-nowrap">
          <span title={fullTimestamp(event.receivedAt)}>
            {relativeTime(event.receivedAt)}
          </span>
        </TableCell>

        {/* Event Type */}
        <TableCell className="py-1.5 px-2">
          <EventTypeBadge eventType={event.eventType} />
        </TableCell>

        {/* Lead Email */}
        <TableCell className="py-1.5 px-2 text-xs text-foreground max-w-[180px] truncate">
          {event.leadEmail ?? (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>

        {/* Sender Email */}
        <TableCell className="py-1.5 px-2 text-xs text-muted-foreground max-w-[160px] truncate">
          {event.senderEmail ?? (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>

        {/* Workspace */}
        <TableCell className="py-1.5 px-2 text-xs text-muted-foreground">
          {event.workspace}
        </TableCell>

        {/* Campaign ID */}
        <TableCell className="py-1.5 px-2 text-xs text-muted-foreground font-mono max-w-[80px] truncate">
          {event.campaignId ? (
            <span title={event.campaignId}>{event.campaignId}</span>
          ) : (
            <span>—</span>
          )}
        </TableCell>
      </TableRow>

      {/* Expanded payload row */}
      {expanded && (
        <TableRow className="border-border bg-muted/20 hover:bg-muted/20">
          <TableCell
            colSpan={7}
            className="py-3 px-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="rounded-md border border-border bg-background overflow-auto max-h-80">
              {parseError ? (
                <pre className="text-xs text-muted-foreground p-3 font-mono leading-relaxed">
                  {event.payload}
                </pre>
              ) : (
                <pre className="text-xs text-foreground p-3 font-mono leading-relaxed">
                  {JSON.stringify(parsedPayload, null, 2)}
                </pre>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// ─── Main table component ─────────────────────────────────────────────────────

export function WebhookLogTable({ events, loading = false }: WebhookLogTableProps) {
  return (
    <div className="bg-card rounded-lg border border-border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-border hover:bg-transparent">
            {/* Expand toggle column */}
            <TableHead className="w-6 py-2 px-2" />
            <TableHead className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium py-2 px-2 whitespace-nowrap">
              Time
            </TableHead>
            <TableHead className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium py-2 px-2 whitespace-nowrap">
              Event
            </TableHead>
            <TableHead className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium py-2 px-2 whitespace-nowrap">
              Lead Email
            </TableHead>
            <TableHead className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium py-2 px-2 whitespace-nowrap">
              Sender Email
            </TableHead>
            <TableHead className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium py-2 px-2 whitespace-nowrap">
              Workspace
            </TableHead>
            <TableHead className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium py-2 px-2 whitespace-nowrap">
              Campaign ID
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <SkeletonRows />
          ) : events.length === 0 ? null : (
            events.map((event) => (
              <WebhookEventRow key={event.id} event={event} />
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
