"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, ChevronLeft, ChevronRight, Mail, Linkedin, Layers } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MergedCampaign {
  internalId: string;
  ebId: number | null;
  name: string;
  type: string;
  channels: string[];
  status: string;
  completionPercentage: number;
  emailsSent: number;
  opened: number;
  uniqueOpens: number;
  replied: number;
  uniqueReplies: number;
  bounced: number;
  unsubscribed: number;
  interested: number;
  totalLeadsContacted: number;
  totalLeads: number;
  openTracking: boolean;
  tags: string[];
  updatedAt: string;
}

interface CampaignListTableProps {
  campaigns: MergedCampaign[];
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20;

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;

  if (diffMs < 60_000) return "just now";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(diffMs / 86_400_000);
  if (days < 7) return `${days}d ago`;

  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) return "0.0%";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function channelBadge(channels: string[]) {
  const hasEmail = channels.includes("email");
  const hasLinkedin = channels.includes("linkedin");
  if (hasEmail && hasLinkedin) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950 border border-purple-200 dark:border-purple-800 px-1.5 py-0.5 rounded">
        <Layers className="h-3 w-3" />
        Multi
      </span>
    );
  }
  if (hasLinkedin) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 px-1.5 py-0.5 rounded">
        <Linkedin className="h-3 w-3" />
        LinkedIn
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-stone-600 dark:text-stone-400 bg-stone-50 dark:bg-stone-900 border border-stone-200 dark:border-stone-700 px-1.5 py-0.5 rounded">
      <Mail className="h-3 w-3" />
      Email
    </span>
  );
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "active":
      return "bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800";
    case "paused":
      return "bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-200 border-amber-200 dark:border-amber-800";
    case "draft":
    case "internal_review":
    case "pending_approval":
      return "bg-stone-100 dark:bg-stone-800 text-stone-800 dark:text-stone-200 border-stone-200 dark:border-stone-700";
    case "completed":
      return "bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-200 border-blue-200 dark:border-blue-800";
    default:
      return "bg-stone-100 dark:bg-stone-800 text-stone-800 dark:text-stone-200 border-stone-200 dark:border-stone-700";
  }
}

function formatStatus(status: string): string {
  return status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CampaignListTable({ campaigns, className }: CampaignListTableProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);

  // Filter
  const filtered = useMemo(() => {
    let result = campaigns;

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((c) => c.name.toLowerCase().includes(q));
    }

    if (statusFilter !== "all") {
      result = result.filter((c) => c.status === statusFilter);
    }

    return result;
  }, [campaigns, search, statusFilter]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(startIdx, startIdx + PAGE_SIZE);
  const showFrom = filtered.length === 0 ? 0 : startIdx + 1;
  const showTo = Math.min(startIdx + PAGE_SIZE, filtered.length);

  // Reset to page 1 on filter change
  const handleSearch = (val: string) => {
    setSearch(val);
    setPage(1);
  };
  const handleStatusFilter = (val: string) => {
    setStatusFilter(val);
    setPage(1);
  };

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {/* Filters */}
      <div className="shrink-0 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search campaigns..."
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={handleStatusFilter}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[200px] font-semibold text-foreground">Campaign</TableHead>
              <TableHead className="font-semibold text-foreground">Type</TableHead>
              <TableHead className="font-semibold text-foreground">Status</TableHead>
              <TableHead className="font-semibold text-foreground">Progress</TableHead>
              <TableHead className="text-right font-semibold text-foreground">Total Leads</TableHead>
              <TableHead className="text-right font-semibold text-foreground">Contacted</TableHead>
              <TableHead className="text-right font-semibold text-foreground">Sent</TableHead>
              <TableHead className="text-right font-semibold text-foreground">Opens</TableHead>
              <TableHead className="text-right font-semibold text-foreground">Replies</TableHead>
              <TableHead className="text-right font-semibold text-foreground">Unsubs</TableHead>
              <TableHead className="text-right font-semibold text-foreground">Bounces</TableHead>
              <TableHead className="text-right font-semibold text-foreground">Interested</TableHead>
              <TableHead className="text-center font-semibold text-foreground">Manage</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageItems.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={13}
                  className="h-24 text-center text-muted-foreground"
                >
                  No campaigns found.
                </TableCell>
              </TableRow>
            ) : (
              pageItems.map((c) => {
                const bounceRate =
                  c.emailsSent > 0 ? (c.bounced / c.emailsSent) * 100 : 0;

                return (
                  <TableRow key={c.internalId} className="hover:bg-stone-50 dark:hover:bg-stone-800/50 [&>td]:py-3">
                    {/* Campaign name */}
                    <TableCell>
                      <Link
                        href={`/portal/campaigns/${c.internalId}`}
                        className="font-medium text-blue-600 hover:underline"
                      >
                        {c.name}
                      </Link>
                      <div className="flex items-center gap-2 mt-0.5">
                        {channelBadge(c.channels)}
                        <span className="text-xs text-muted-foreground">
                          {formatRelativeTime(c.updatedAt)}
                        </span>
                      </div>
                    </TableCell>

                    {/* Type */}
                    <TableCell>
                      <Badge className="bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800" size="xs">
                        {c.type.charAt(0).toUpperCase() + c.type.slice(1)}
                      </Badge>
                    </TableCell>

                    {/* Status */}
                    <TableCell>
                      <Badge className={statusBadgeClass(c.status)} size="xs">
                        {formatStatus(c.status)}
                      </Badge>
                    </TableCell>

                    {/* Progress */}
                    <TableCell>
                      <div className="flex items-center gap-2 min-w-[80px]">
                        <span className="text-sm tabular-nums whitespace-nowrap">
                          {c.completionPercentage % 1 === 0 ? c.completionPercentage.toFixed(0) : c.completionPercentage.toFixed(2)}%
                        </span>
                        <div className="flex-1 h-2.5 rounded-full bg-stone-200 dark:bg-stone-700 overflow-hidden">
                          <div
                            className="h-2.5 rounded-full bg-green-500 dark:bg-green-400 transition-all"
                            style={{
                              width: `${Math.min(c.completionPercentage, 100)}%`,
                            }}
                          />
                        </div>
                      </div>
                    </TableCell>

                    {/* Total Leads */}
                    <TableCell className="text-right tabular-nums">
                      {c.totalLeads.toLocaleString()}
                    </TableCell>

                    {/* Contacted */}
                    <TableCell className="text-right tabular-nums">
                      {c.totalLeadsContacted.toLocaleString()}
                    </TableCell>

                    {/* Sent */}
                    <TableCell className="text-right tabular-nums">
                      {c.emailsSent.toLocaleString()}
                    </TableCell>

                    {/* Opens */}
                    <TableCell className="text-right tabular-nums">
                      {c.openTracking ? (
                        <span className="inline-flex items-center gap-1.5">
                          {c.opened.toLocaleString()}
                          <span className="bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 px-1 py-0 rounded text-[11px] font-medium">
                            {pct(c.opened, c.emailsSent)}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">
                          N/A
                        </span>
                      )}
                    </TableCell>

                    {/* Replies */}
                    <TableCell className="text-right tabular-nums">
                      <span className="inline-flex items-center gap-1.5">
                        {c.uniqueReplies.toLocaleString()}
                        <span className="bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300 px-1 py-0 rounded text-[11px] font-medium">
                          {pct(c.uniqueReplies, c.emailsSent)}
                        </span>
                      </span>
                    </TableCell>

                    {/* Unsubscribes */}
                    <TableCell className="text-right tabular-nums">
                      <span className="inline-flex items-center gap-1.5">
                        {c.unsubscribed.toLocaleString()}
                        <span
                          className={`px-1 py-0 rounded text-[11px] font-medium ${c.unsubscribed > 0 ? "bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400" : "bg-stone-100 dark:bg-stone-800 text-muted-foreground"}`}
                        >
                          {pct(c.unsubscribed, c.emailsSent)}
                        </span>
                      </span>
                    </TableCell>

                    {/* Bounces */}
                    <TableCell className="text-right tabular-nums">
                      <span className="inline-flex items-center gap-1.5">
                        {c.bounced.toLocaleString()}
                        <span
                          className={`px-1 py-0 rounded text-[11px] font-medium ${bounceRate > 2 ? "bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300" : "bg-stone-100 dark:bg-stone-800 text-muted-foreground"}`}
                        >
                          {pct(c.bounced, c.emailsSent)}
                        </span>
                      </span>
                    </TableCell>

                    {/* Interested */}
                    <TableCell className="text-right tabular-nums">
                      <span className="inline-flex items-center gap-1.5">
                        {c.interested.toLocaleString()}
                        <span
                          className={`px-1 py-0 rounded text-[11px] font-medium ${c.interested > 0 ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300" : "bg-stone-100 dark:bg-stone-800 text-muted-foreground"}`}
                        >
                          {pct(c.interested, c.emailsSent)}
                        </span>
                      </span>
                    </TableCell>

                    {/* Manage */}
                    <TableCell className="text-center">
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/portal/campaigns/${c.internalId}`}>
                          Manage
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {filtered.length > 0 && (
        <div className="shrink-0 flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Showing {showFrom} to {showTo} of {filtered.length} results
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
