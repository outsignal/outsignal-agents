"use client";

import { useState } from "react";
import { LineChart, Line, ResponsiveContainer } from "recharts";
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SparklinePoint {
  date: string;
  bounceRate: number;
}

export interface SenderData {
  id: string;
  emailAddress: string;
  workspaceSlug: string;
  emailBounceStatus: string;
  emailBounceStatusAt: string | null;
  warmupDay: number;
  warmupStartedAt: string | null;
  currentBounceRate: number | null;
  sparklineData: SparklinePoint[];
  consecutiveHealthyChecks: number;
}

type SortKey = "emailAddress" | "workspaceSlug" | "emailBounceStatus" | "currentBounceRate" | "warmupDay" | "emailBounceStatusAt";
type SortDir = "asc" | "desc";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return "—";
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

function getStatusColors(status: string): { chip: string; sparkline: string } {
  switch (status) {
    case "healthy":
      return {
        chip: "bg-emerald-100 text-emerald-800 border-emerald-200",
        sparkline: "#10b981",
      };
    case "elevated":
      return {
        chip: "bg-yellow-100 text-yellow-800 border-yellow-200",
        sparkline: "#eab308",
      };
    case "warning":
      return {
        chip: "bg-orange-100 text-orange-800 border-orange-200",
        sparkline: "#f97316",
      };
    case "critical":
      return {
        chip: "bg-red-100 text-red-800 border-red-200",
        sparkline: "#ef4444",
      };
    default:
      return {
        chip: "bg-gray-100 text-gray-600 border-gray-200",
        sparkline: "#9ca3af",
      };
  }
}

// ---------------------------------------------------------------------------
// Sparkline cell
// ---------------------------------------------------------------------------

function SparklineCell({
  data,
  status,
}: {
  data: SparklinePoint[];
  status: string;
}) {
  const { sparkline: color } = getStatusColors(status);

  if (data.length === 0) {
    return <span className="text-xs text-muted-foreground">No data</span>;
  }

  return (
    <ResponsiveContainer width={120} height={32}>
      <LineChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
        <Line
          type="monotone"
          dataKey="bounceRate"
          stroke={color}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Warmup progress bar
// ---------------------------------------------------------------------------

function WarmupBar({ warmupDay }: { warmupDay: number }) {
  if (warmupDay === 0) {
    return <span className="text-xs text-muted-foreground">Not started</span>;
  }

  const pct = Math.min((warmupDay / 28) * 100, 100);

  return (
    <div className="flex flex-col gap-0.5">
      <div className="h-2 w-24 rounded-full bg-muted">
        <div
          className="h-2 rounded-full bg-brand"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] text-muted-foreground">
        Day {warmupDay}/28
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sort indicator
// ---------------------------------------------------------------------------

function SortIndicator({
  column,
  activeKey,
  direction,
}: {
  column: SortKey;
  activeKey: SortKey;
  direction: SortDir;
}) {
  if (column !== activeKey) {
    return <span className="ml-1 text-muted-foreground/40">⇅</span>;
  }
  return (
    <span className="ml-1 text-muted-foreground">
      {direction === "asc" ? "↑" : "↓"}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Sender Health Table
// ---------------------------------------------------------------------------

interface SenderHealthTableProps {
  senders: SenderData[];
}

export function SenderHealthTable({ senders }: SenderHealthTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("emailBounceStatus");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  // Severity order for bounce status sorting (lower = more severe)
  const SEVERITY_ORDER: Record<string, number> = {
    critical: 0,
    warning: 1,
    elevated: 2,
    healthy: 3,
  };

  const sorted = [...senders].sort((a, b) => {
    let aVal: string | number | null = a[sortKey] ?? null;
    let bVal: string | number | null = b[sortKey] ?? null;

    // Treat null as -1 for numeric sorts so they sort to the bottom
    if (aVal === null) aVal = sortDir === "asc" ? Infinity : -Infinity;
    if (bVal === null) bVal = sortDir === "asc" ? Infinity : -Infinity;

    // Use severity order for bounce status column
    if (sortKey === "emailBounceStatus" && typeof aVal === "string" && typeof bVal === "string") {
      const aOrder = SEVERITY_ORDER[aVal] ?? 99;
      const bOrder = SEVERITY_ORDER[bVal] ?? 99;
      return sortDir === "asc" ? aOrder - bOrder : bOrder - aOrder;
    }

    if (typeof aVal === "string" && typeof bVal === "string") {
      return sortDir === "asc"
        ? aVal.localeCompare(bVal)
        : bVal.localeCompare(aVal);
    }

    const numA = Number(aVal);
    const numB = Number(bVal);
    return sortDir === "asc" ? numA - numB : numB - numA;
  });

  if (senders.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-muted-foreground">No senders found</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead
              className="cursor-pointer select-none whitespace-nowrap"
              onClick={() => handleSort("emailAddress")}
            >
              Email Address
              <SortIndicator column="emailAddress" activeKey={sortKey} direction={sortDir} />
            </TableHead>
            <TableHead
              className="cursor-pointer select-none whitespace-nowrap"
              onClick={() => handleSort("workspaceSlug")}
            >
              Workspace
              <SortIndicator column="workspaceSlug" activeKey={sortKey} direction={sortDir} />
            </TableHead>
            <TableHead
              className="cursor-pointer select-none whitespace-nowrap"
              onClick={() => handleSort("emailBounceStatus")}
            >
              Health
              <SortIndicator column="emailBounceStatus" activeKey={sortKey} direction={sortDir} />
            </TableHead>
            <TableHead className="whitespace-nowrap">30-day Trend</TableHead>
            <TableHead
              className="cursor-pointer select-none whitespace-nowrap"
              onClick={() => handleSort("currentBounceRate")}
            >
              Bounce %
              <SortIndicator column="currentBounceRate" activeKey={sortKey} direction={sortDir} />
            </TableHead>
            <TableHead
              className="cursor-pointer select-none whitespace-nowrap"
              onClick={() => handleSort("warmupDay")}
            >
              Warmup
              <SortIndicator column="warmupDay" activeKey={sortKey} direction={sortDir} />
            </TableHead>
            <TableHead
              className="cursor-pointer select-none whitespace-nowrap"
              onClick={() => handleSort("emailBounceStatusAt")}
            >
              Last Checked
              <SortIndicator column="emailBounceStatusAt" activeKey={sortKey} direction={sortDir} />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((sender) => {
            const { chip } = getStatusColors(sender.emailBounceStatus);
            return (
              <TableRow key={sender.id}>
                <TableCell className="font-mono text-xs">
                  {sender.emailAddress}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-[10px]">
                    {sender.workspaceSlug}
                  </Badge>
                </TableCell>
                <TableCell>
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize",
                      chip,
                    )}
                  >
                    {sender.emailBounceStatus}
                  </span>
                </TableCell>
                <TableCell>
                  <SparklineCell
                    data={sender.sparklineData}
                    status={sender.emailBounceStatus}
                  />
                </TableCell>
                <TableCell className="text-xs">
                  {sender.currentBounceRate !== null
                    ? `${sender.currentBounceRate.toFixed(1)}%`
                    : "—"}
                </TableCell>
                <TableCell>
                  <WarmupBar warmupDay={sender.warmupDay} />
                </TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {formatRelativeTime(sender.emailBounceStatusAt)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
