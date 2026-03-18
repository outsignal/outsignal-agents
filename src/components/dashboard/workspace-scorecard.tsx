"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { ExternalLink, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableCell,
  SortableTableHead,
  TableHead,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { WorkspaceSummary } from "@/app/api/dashboard/stats/route";

type SortKey =
  | "name"
  | "replies7d"
  | "sends7d"
  | "replyRate"
  | "bounceRate"
  | "activeCampaigns";

type SortState = { key: SortKey; direction: "asc" | "desc" } | null;

function handleSort(
  key: string,
  current: SortState,
): SortState {
  if (current?.key === key) {
    return current.direction === "asc"
      ? { key: key as SortKey, direction: "desc" }
      : null;
  }
  return { key: key as SortKey, direction: "asc" };
}

function healthDot(ws: WorkspaceSummary): "green" | "amber" | "red" {
  if (ws.bounceRate > 5 || ws.hasAlerts) return "red";
  if (ws.bounceRate > 2 || ws.replyRate < 1) return "amber";
  return "green";
}

const dotColors = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
};

const borderColors = {
  green: "",
  amber: "border-l-[3px] border-l-amber-400",
  red: "border-l-[3px] border-l-red-400",
};

function SentimentBar({ breakdown }: { breakdown: WorkspaceSummary["sentimentBreakdown"] }) {
  const total = breakdown.positive + breakdown.neutral + breakdown.negative;
  if (total === 0) {
    return <span className="text-xs text-muted-foreground">--</span>;
  }

  const pPct = (breakdown.positive / total) * 100;
  const nPct = (breakdown.neutral / total) * 100;
  const negPct = (breakdown.negative / total) * 100;

  return (
    <div className="flex items-center gap-1.5" title={`+${breakdown.positive} / ~${breakdown.neutral} / -${breakdown.negative}`}>
      <div className="flex h-2 w-16 overflow-hidden rounded-full bg-muted">
        {pPct > 0 && (
          <div
            className="bg-emerald-500 transition-all"
            style={{ width: `${pPct}%` }}
          />
        )}
        {nPct > 0 && (
          <div
            className="bg-gray-400 transition-all"
            style={{ width: `${nPct}%` }}
          />
        )}
        {negPct > 0 && (
          <div
            className="bg-red-500 transition-all"
            style={{ width: `${negPct}%` }}
          />
        )}
      </div>
      <span className="text-[10px] tabular-nums text-muted-foreground">{total}</span>
    </div>
  );
}

interface WorkspaceScorecardProps {
  summaries: WorkspaceSummary[];
}

export function WorkspaceScorecard({ summaries }: WorkspaceScorecardProps) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState>({ key: "sends7d", direction: "desc" });

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    let list = q
      ? summaries.filter(
          (ws) =>
            ws.name.toLowerCase().includes(q) ||
            ws.slug.toLowerCase().includes(q),
        )
      : [...summaries];

    if (sort) {
      list.sort((a, b) => {
        const aVal = a[sort.key];
        const bVal = b[sort.key];
        if (typeof aVal === "string" && typeof bVal === "string") {
          return sort.direction === "asc"
            ? aVal.localeCompare(bVal)
            : bVal.localeCompare(aVal);
        }
        const aNum = Number(aVal);
        const bNum = Number(bVal);
        return sort.direction === "asc" ? aNum - bNum : bNum - aNum;
      });
    }

    return list;
  }, [summaries, search, sort]);

  const onSort = (key: string) => setSort((prev) => handleSort(key, prev));

  if (summaries.length === 0) return null;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-4 pb-3">
        <CardTitle>Workspace Scorecard</CardTitle>
        <div className="relative w-56">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search workspaces..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <SortableTableHead sortKey="name" currentSort={sort} onSort={onSort}>
                Workspace
              </SortableTableHead>
              <TableHead className="w-8" />
              <SortableTableHead sortKey="replies7d" currentSort={sort} onSort={onSort}>
                Replies
              </SortableTableHead>
              <SortableTableHead sortKey="sends7d" currentSort={sort} onSort={onSort}>
                Sends
              </SortableTableHead>
              <SortableTableHead sortKey="replyRate" currentSort={sort} onSort={onSort}>
                Reply %
              </SortableTableHead>
              <SortableTableHead sortKey="bounceRate" currentSort={sort} onSort={onSort}>
                Bounce %
              </SortableTableHead>
              <SortableTableHead sortKey="activeCampaigns" currentSort={sort} onSort={onSort}>
                Campaigns
              </SortableTableHead>
              <TableHead>Sentiment</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  {search ? "No workspaces match your search" : "No active workspaces"}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((ws) => {
                const health = healthDot(ws);
                return (
                  <TableRow
                    key={ws.slug}
                    className={cn(borderColors[health])}
                  >
                    <TableCell className="pr-0 w-8">
                      <span
                        className={cn(
                          "inline-block size-2 rounded-full",
                          dotColors[health],
                        )}
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      <Link
                        href={`/workspace/${ws.slug}`}
                        className="hover:text-[#635BFF] transition-colors"
                      >
                        {ws.name}
                      </Link>
                    </TableCell>
                    <TableCell className="pr-0 w-8">
                      <a
                        href={`https://portal.outsignal.ai/portal/${ws.slug}/inbox`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-[#635BFF] transition-colors"
                        title="Open client portal"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {ws.replies7d}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {ws.sends7d.toLocaleString()}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      <span
                        className={cn(
                          ws.replyRate < 1 && ws.sends7d > 0
                            ? "text-red-600"
                            : ws.replyRate >= 3
                              ? "text-emerald-600"
                              : "",
                        )}
                      >
                        {ws.sends7d > 0 ? `${ws.replyRate}%` : "\u2014"}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      <span
                        className={cn(
                          ws.bounceRate > 5
                            ? "text-red-600"
                            : ws.bounceRate > 2
                              ? "text-amber-600"
                              : "",
                        )}
                      >
                        {ws.sends7d > 0 ? `${ws.bounceRate}%` : "\u2014"}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {ws.activeCampaigns}
                    </TableCell>
                    <TableCell>
                      <SentimentBar breakdown={ws.sentimentBreakdown} />
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
