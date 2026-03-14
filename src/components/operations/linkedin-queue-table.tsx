"use client";

import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LinkedInQueueAction {
  id: string;
  senderId: string;
  personId: string;
  workspaceSlug: string;
  actionType: string;
  messageBody: string | null;
  priority: number;
  scheduledFor: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastAttemptAt: string | null;
  nextRetryAt: string | null;
  result: string | null;
  completedAt: string | null;
  campaignName: string | null;
  sender: {
    id: string;
    name: string;
    workspaceSlug: string;
    status?: string;
    healthStatus?: string;
    dailyConnectionLimit?: number;
    dailyMessageLimit?: number;
    dailyProfileViewLimit?: number;
  };
  personEmail: string | null;
  personName: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffSec = Math.round(diffMs / 1000);
  const diffMin = Math.round(diffSec / 60);
  const diffHr = Math.round(diffMin / 60);
  const absDiffMin = Math.abs(diffMin);
  const absDiffHr = Math.abs(diffHr);

  if (absDiffMin < 1) return "just now";
  if (diffMs > 0) {
    // future
    if (absDiffMin < 60) return `in ${absDiffMin}m`;
    if (absDiffHr < 24) return `in ${absDiffHr}h`;
    return `in ${Math.round(absDiffHr / 24)}d`;
  } else {
    // past
    if (absDiffMin < 60) return `${absDiffMin}m ago`;
    if (absDiffHr < 24) return `${absDiffHr}h ago`;
    return `${Math.round(absDiffHr / 24)}d ago`;
  }
}

function formatAbsoluteTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-GB", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Priority Cell ────────────────────────────────────────────────────────────

function PriorityBadge({ priority }: { priority: number }) {
  const colorMap: Record<number, string> = {
    1: "bg-red-500/15 text-red-600 border-red-300",
    2: "bg-orange-500/15 text-orange-600 border-orange-300",
    3: "bg-yellow-500/15 text-yellow-600 border-yellow-300",
    4: "bg-secondary text-foreground border-border",
    5: "bg-muted/50 text-muted-foreground border-border",
  };
  const classes = colorMap[priority] ?? colorMap[5];
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold border",
        classes,
      )}
    >
      {priority}
    </span>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "pending":
      return (
        <Badge variant="outline" size="xs" className="text-muted-foreground border-border">
          pending
        </Badge>
      );
    case "running":
      return (
        <span className="inline-flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-yellow-500 animate-pulse" />
          <Badge variant="warning" size="xs">running</Badge>
        </span>
      );
    case "complete":
      return <Badge variant="success" size="xs">complete</Badge>;
    case "failed":
      return (
        <Badge variant="destructive" size="xs">failed</Badge>
      );
    case "cancelled":
      return (
        <Badge variant="outline" size="xs" className="text-muted-foreground/60 border-border/60">
          cancelled
        </Badge>
      );
    case "expired":
      return (
        <Badge variant="outline" size="xs" className="text-muted-foreground/60 border-border/60">
          expired
        </Badge>
      );
    default:
      return <Badge variant="secondary" size="xs">{status}</Badge>;
  }
}

// ─── Action Type Badge ────────────────────────────────────────────────────────

function ActionTypeBadge({ actionType }: { actionType: string }) {
  switch (actionType) {
    case "connect":
      return (
        <Badge size="xs" className="bg-blue-500/10 text-blue-600 border-blue-200">
          connect
        </Badge>
      );
    case "message":
      return (
        <Badge size="xs" className="bg-purple-500/10 text-purple-600 border-purple-200">
          message
        </Badge>
      );
    case "profile_view":
      return (
        <Badge variant="outline" size="xs" className="text-muted-foreground border-border">
          profile_view
        </Badge>
      );
    case "check_connection":
      return (
        <Badge variant="outline" size="xs" className="text-muted-foreground border-border">
          check_conn
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary" size="xs">{actionType}</Badge>
      );
  }
}

// ─── Skeleton Rows ────────────────────────────────────────────────────────────

export function QueueTableSkeleton() {
  return (
    <div className="bg-card rounded-lg border border-border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-border hover:bg-transparent">
            <TableHead className="w-8 py-2 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">P</TableHead>
            <TableHead className="py-2 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Type</TableHead>
            <TableHead className="py-2 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Person</TableHead>
            <TableHead className="py-2 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Sender</TableHead>
            <TableHead className="py-2 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Workspace</TableHead>
            <TableHead className="py-2 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Scheduled</TableHead>
            <TableHead className="py-2 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Status</TableHead>
            <TableHead className="py-2 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Attempts</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 8 }).map((_, i) => (
            <TableRow key={i} className="border-border">
              <TableCell className="py-1.5 px-3">
                <div className="h-5 w-5 bg-muted rounded animate-pulse" />
              </TableCell>
              <TableCell className="py-1.5">
                <div className="h-4 w-16 bg-muted rounded animate-pulse" />
              </TableCell>
              <TableCell className="py-1.5">
                <div className="space-y-1">
                  <div className="h-3 w-28 bg-muted rounded animate-pulse" />
                  <div className="h-2.5 w-36 bg-muted rounded animate-pulse" />
                </div>
              </TableCell>
              <TableCell className="py-1.5">
                <div className="h-3 w-24 bg-muted rounded animate-pulse" />
              </TableCell>
              <TableCell className="py-1.5">
                <div className="h-3 w-20 bg-muted rounded animate-pulse" />
              </TableCell>
              <TableCell className="py-1.5">
                <div className="h-3 w-16 bg-muted rounded animate-pulse" />
              </TableCell>
              <TableCell className="py-1.5">
                <div className="h-4 w-16 bg-muted rounded animate-pulse" />
              </TableCell>
              <TableCell className="py-1.5">
                <div className="h-3 w-8 bg-muted rounded animate-pulse" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ─── Main Table ───────────────────────────────────────────────────────────────

interface LinkedInQueueTableProps {
  actions: LinkedInQueueAction[];
}

export function LinkedInQueueTable({ actions }: LinkedInQueueTableProps) {
  if (actions.length === 0) {
    return (
      <div className="bg-card rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="w-8 py-2 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">P</TableHead>
              <TableHead className="py-2 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Type</TableHead>
              <TableHead className="py-2 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Person</TableHead>
              <TableHead className="py-2 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Sender</TableHead>
              <TableHead className="py-2 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Workspace</TableHead>
              <TableHead className="py-2 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Scheduled</TableHead>
              <TableHead className="py-2 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Status</TableHead>
              <TableHead className="py-2 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Attempts</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow className="border-border">
              <TableCell
                colSpan={8}
                className="text-center py-12 text-muted-foreground text-sm"
              >
                No LinkedIn actions in queue.
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-lg border border-border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-border hover:bg-transparent">
            <TableHead className="w-8 py-2 px-3 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">P</TableHead>
            <TableHead className="py-2 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Type</TableHead>
            <TableHead className="py-2 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Person</TableHead>
            <TableHead className="py-2 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Sender</TableHead>
            <TableHead className="py-2 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Workspace</TableHead>
            <TableHead className="py-2 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Scheduled</TableHead>
            <TableHead className="py-2 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Status</TableHead>
            <TableHead className="py-2 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Attempts</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {actions.map((action) => (
            <TableRow
              key={action.id}
              className="border-border hover:bg-muted/30"
            >
              {/* Priority */}
              <TableCell className="py-1.5 px-3">
                <PriorityBadge priority={action.priority} />
              </TableCell>

              {/* Action Type */}
              <TableCell className="py-1.5">
                {action.actionType === "message" && action.messageBody ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-default">
                        <ActionTypeBadge actionType={action.actionType} />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent
                      side="right"
                      className="max-w-xs text-xs font-normal whitespace-pre-wrap"
                    >
                      {action.messageBody.length > 200
                        ? action.messageBody.slice(0, 200) + "…"
                        : action.messageBody}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <ActionTypeBadge actionType={action.actionType} />
                )}
              </TableCell>

              {/* Person */}
              <TableCell className="py-1.5 max-w-[180px]">
                {action.personName ? (
                  <div>
                    <p className="text-xs font-medium text-foreground truncate">
                      {action.personName}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {action.personEmail}
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground truncate">
                    {action.personEmail ?? action.personId.slice(0, 8) + "…"}
                  </p>
                )}
              </TableCell>

              {/* Sender */}
              <TableCell className="py-1.5">
                <div className="max-w-[160px]">
                  <p className="text-xs text-foreground truncate">
                    {action.sender.name}
                  </p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {action.sender.status && (
                      <Badge
                        variant={
                          action.sender.status === "active"
                            ? "success"
                            : action.sender.status === "paused"
                              ? "warning"
                              : "secondary"
                        }
                        size="xs"
                        className="text-[9px]"
                      >
                        {action.sender.status}
                      </Badge>
                    )}
                    {action.sender.dailyConnectionLimit != null && (
                      <span className="text-[9px] text-muted-foreground">
                        {action.sender.dailyConnectionLimit}c/{action.sender.dailyMessageLimit ?? 0}m/{action.sender.dailyProfileViewLimit ?? 0}pv
                      </span>
                    )}
                  </div>
                </div>
              </TableCell>

              {/* Workspace */}
              <TableCell className="py-1.5">
                <p className="text-[10px] text-muted-foreground font-mono">
                  {action.workspaceSlug}
                </p>
              </TableCell>

              {/* Scheduled For */}
              <TableCell className="py-1.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-xs text-muted-foreground cursor-default tabular-nums">
                      {formatRelativeTime(action.scheduledFor)}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    {formatAbsoluteTime(action.scheduledFor)}
                  </TooltipContent>
                </Tooltip>
                {/* For failed with retry — show retry time */}
                {action.status === "failed" && action.nextRetryAt && (
                  <p className="text-[10px] text-amber-600 mt-0.5">
                    retry {formatRelativeTime(action.nextRetryAt)}
                  </p>
                )}
              </TableCell>

              {/* Status */}
              <TableCell className="py-1.5">
                <StatusBadge status={action.status} />
              </TableCell>

              {/* Attempts */}
              <TableCell className="py-1.5">
                <span
                  className={cn(
                    "text-xs tabular-nums",
                    action.attempts > 0
                      ? "text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {action.attempts}/{action.maxAttempts}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
