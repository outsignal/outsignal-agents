"use client";

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentRun {
  id: string;
  agent: string;
  workspaceSlug: string | null;
  input: string;
  output: string | null;
  status: string;
  steps: string | null;
  durationMs: number | null;
  error: string | null;
  triggeredBy: string | null;
  createdAt: string;
}

interface AgentRunTableProps {
  runs: AgentRun[];
  loading: boolean;
}

// ─── Badge helpers ─────────────────────────────────────────────────────────────

const agentBadgeClass: Record<string, string> = {
  leads: "bg-blue-50 text-blue-700 border-blue-200",
  writer: "bg-purple-50 text-purple-700 border-purple-200",
  campaign: "bg-green-50 text-green-700 border-green-200",
  research: "bg-amber-50 text-amber-700 border-amber-200",
};

function AgentBadge({ agent }: { agent: string }) {
  return (
    <Badge
      variant="outline"
      size="xs"
      className={cn(
        "font-medium",
        agentBadgeClass[agent] ?? "bg-muted text-muted-foreground border-border"
      )}
    >
      {agent}
    </Badge>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "running") {
    return (
      <Badge
        variant="outline"
        size="xs"
        className="font-medium bg-yellow-50 text-yellow-700 border-yellow-200"
      >
        <span className="relative flex h-1.5 w-1.5 mr-1">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-yellow-500" />
        </span>
        running
      </Badge>
    );
  }
  if (status === "complete") {
    return (
      <Badge
        variant="outline"
        size="xs"
        className="font-medium bg-green-50 text-green-700 border-green-200"
      >
        complete
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge
        variant="outline"
        size="xs"
        className="font-medium bg-red-50 text-red-700 border-red-200"
      >
        failed
      </Badge>
    );
  }
  return (
    <Badge variant="outline" size="xs" className="font-medium">
      {status}
    </Badge>
  );
}

// ─── Duration formatter ────────────────────────────────────────────────────────

function formatDuration(ms: number | null, status: string): string {
  if (status === "running" || ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

// ─── Relative time ─────────────────────────────────────────────────────────────

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diff = now - date;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

// ─── Expanded row detail ───────────────────────────────────────────────────────

function safeParseJson(str: string | null): unknown {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

function JsonBlock({ value }: { value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <pre className="text-[11px] font-mono bg-muted/50 border border-border rounded p-2 overflow-auto max-h-48 whitespace-pre-wrap break-all">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

interface StepEntry {
  name?: string;
  tool?: string;
  args?: unknown;
  result?: unknown;
  [key: string]: unknown;
}

function StepsList({ stepsJson }: { stepsJson: string | null }) {
  if (!stepsJson) return <p className="text-xs text-muted-foreground">No steps recorded.</p>;
  const parsed = safeParseJson(stepsJson);
  if (!Array.isArray(parsed)) {
    return <JsonBlock value={parsed} />;
  }
  return (
    <ol className="space-y-1">
      {parsed.map((step: StepEntry, i: number) => {
        const name = step.name ?? step.tool ?? `Step ${i + 1}`;
        const args = step.args ?? step.input ?? null;
        return (
          <li key={i} className="text-[11px] font-mono border border-border/60 rounded px-2 py-1 bg-muted/30">
            <span className="text-muted-foreground mr-1">{i + 1}.</span>
            <span className="font-semibold text-foreground">{String(name)}</span>
            {args !== null && (
              <span className="text-muted-foreground ml-2 truncate max-w-xs inline-block align-bottom">
                {JSON.stringify(args).slice(0, 120)}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function ExpandedDetail({ run }: { run: AgentRun }) {
  const input = safeParseJson(run.input);
  const output = safeParseJson(run.output);

  return (
    <div className="px-4 py-3 bg-muted/20 border-t border-border/50 grid grid-cols-2 gap-4">
      {/* Input */}
      <div>
        <h4 className="text-xs font-medium text-muted-foreground mb-1.5">
          Input
        </h4>
        <JsonBlock value={input} />
      </div>

      {/* Output */}
      <div>
        <h4 className="text-xs font-medium text-muted-foreground mb-1.5">
          Output
        </h4>
        {output !== null ? (
          <JsonBlock value={output} />
        ) : (
          <p className="text-xs text-muted-foreground">No output.</p>
        )}
      </div>

      {/* Steps */}
      <div className="col-span-2">
        <h4 className="text-xs font-medium text-muted-foreground mb-1.5">
          Steps
        </h4>
        <StepsList stepsJson={run.steps} />
      </div>

      {/* Error */}
      {run.error && (
        <div className="col-span-2">
          <h4 className="text-xs font-medium text-red-500 mb-1.5">
            Error
          </h4>
          <pre className="text-[11px] font-mono bg-red-50 border border-red-200 text-red-800 rounded p-2 overflow-auto max-h-32 whitespace-pre-wrap break-all">
            {run.error}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <TableRow key={i} className="border-border">
          <TableCell className="py-1.5 px-2 w-6" />
          <TableCell className="py-1.5 px-2">
            <Skeleton className="h-4 w-16" />
          </TableCell>
          <TableCell className="py-1.5 px-2">
            <Skeleton className="h-4 w-24" />
          </TableCell>
          <TableCell className="py-1.5 px-2">
            <Skeleton className="h-4 w-16" />
          </TableCell>
          <TableCell className="py-1.5 px-2">
            <Skeleton className="h-4 w-20" />
          </TableCell>
          <TableCell className="py-1.5 px-2">
            <Skeleton className="h-4 w-12" />
          </TableCell>
          <TableCell className="py-1.5 px-2">
            <Skeleton className="h-4 w-20" />
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

// ─── Main Table ────────────────────────────────────────────────────────────────

export function AgentRunTable({ runs, loading }: AgentRunTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function toggleRow(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  return (
    <div className="border border-border rounded-md overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-border bg-muted/30 hover:bg-muted/30">
            <TableHead className="py-1.5 px-2 w-6" />
            <TableHead className="py-1.5 px-2 text-xs font-semibold">Agent</TableHead>
            <TableHead className="py-1.5 px-2 text-xs font-semibold">Workspace</TableHead>
            <TableHead className="py-1.5 px-2 text-xs font-semibold">Status</TableHead>
            <TableHead className="py-1.5 px-2 text-xs font-semibold">Started</TableHead>
            <TableHead className="py-1.5 px-2 text-xs font-semibold">Duration</TableHead>
            <TableHead className="py-1.5 px-2 text-xs font-semibold">Triggered By</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <SkeletonRows />
          ) : runs.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={7}
                className="text-center py-8 text-sm text-muted-foreground"
              >
                No agent runs found.
              </TableCell>
            </TableRow>
          ) : (
            runs.map((run) => {
              const isExpanded = expandedId === run.id;
              return (
                <>
                  <TableRow
                    key={run.id}
                    className={cn(
                      "border-border cursor-pointer select-none transition-colors",
                      isExpanded
                        ? "bg-muted/40 hover:bg-muted/40"
                        : "hover:bg-muted/20"
                    )}
                    onClick={() => toggleRow(run.id)}
                  >
                    <TableCell className="py-1.5 px-2 text-muted-foreground w-6">
                      {isExpanded ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                    </TableCell>
                    <TableCell className="py-1.5 px-2">
                      <AgentBadge agent={run.agent} />
                    </TableCell>
                    <TableCell className="py-1.5 px-2 text-xs text-muted-foreground font-mono">
                      {run.workspaceSlug ?? <span className="opacity-40">—</span>}
                    </TableCell>
                    <TableCell className="py-1.5 px-2">
                      <StatusBadge status={run.status} />
                    </TableCell>
                    <TableCell className="py-1.5 px-2 text-xs text-muted-foreground tabular-nums">
                      {relativeTime(run.createdAt)}
                    </TableCell>
                    <TableCell className="py-1.5 px-2 text-xs text-muted-foreground tabular-nums font-mono">
                      {formatDuration(run.durationMs, run.status)}
                    </TableCell>
                    <TableCell className="py-1.5 px-2 text-xs text-muted-foreground">
                      {run.triggeredBy ?? <span className="opacity-40">—</span>}
                    </TableCell>
                  </TableRow>
                  {isExpanded && (
                    <TableRow key={`${run.id}-detail`} className="border-border">
                      <TableCell colSpan={7} className="p-0">
                        <ExpandedDetail run={run} />
                      </TableCell>
                    </TableRow>
                  )}
                </>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
