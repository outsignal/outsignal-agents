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
import { Search, ChevronLeft, ChevronRight } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MergedCampaign {
  internalId: string;
  ebId: number | null;
  name: string;
  type: string;
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

const PAGE_SIZE = 15;

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

function statusBadgeClass(status: string): string {
  switch (status) {
    case "active":
      return "bg-green-100 text-green-700 border-green-200";
    case "paused":
      return "bg-amber-100 text-amber-800 border-amber-200";
    case "draft":
    case "internal_review":
    case "pending_approval":
      return "bg-gray-100 text-gray-800 border-gray-200";
    case "completed":
      return "bg-blue-100 text-blue-800 border-blue-200";
    default:
      return "bg-gray-100 text-gray-800 border-gray-200";
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
              <TableHead className="font-semibold text-foreground">Tags</TableHead>
              <TableHead className="text-center font-semibold text-foreground">Manage</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageItems.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={14}
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
                  <TableRow key={c.internalId} className="hover:bg-gray-50 [&>td]:py-3">
                    {/* Campaign name */}
                    <TableCell>
                      <Link
                        href={`/portal/campaigns/${c.internalId}`}
                        className="font-medium text-blue-600 hover:underline"
                      >
                        {c.name}
                      </Link>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Last updated {formatRelativeTime(c.updatedAt)}
                      </p>
                    </TableCell>

                    {/* Type */}
                    <TableCell>
                      <Badge className="bg-blue-100 text-blue-700 border-blue-200" size="xs">
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
                        <span className="text-sm tabular-nums font-semibold whitespace-nowrap">
                          {c.completionPercentage.toFixed(0)}%
                        </span>
                        <div className="flex-1 h-2.5 rounded-full bg-gray-200 overflow-hidden">
                          <div
                            className="h-2.5 rounded-full bg-green-500 transition-all"
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
                          <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded text-xs font-medium">
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
                        <span className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded text-xs font-medium">
                          {pct(c.uniqueReplies, c.emailsSent)}
                        </span>
                      </span>
                    </TableCell>

                    {/* Unsubscribes */}
                    <TableCell className="text-right tabular-nums">
                      <span className="inline-flex items-center gap-1.5">
                        {c.unsubscribed.toLocaleString()}
                        <span
                          className={`px-1.5 py-0.5 rounded text-xs font-medium ${c.unsubscribed > 0 ? "bg-red-50 text-red-600" : "bg-gray-100 text-muted-foreground"}`}
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
                          className={`px-1.5 py-0.5 rounded text-xs font-medium ${bounceRate > 2 ? "bg-red-100 text-red-700" : "bg-gray-100 text-muted-foreground"}`}
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
                          className={`px-1.5 py-0.5 rounded text-xs font-medium ${c.interested > 0 ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-muted-foreground"}`}
                        >
                          {pct(c.interested, c.emailsSent)}
                        </span>
                      </span>
                    </TableCell>

                    {/* Tags */}
                    <TableCell>
                      {c.tags.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {c.tags.map((tag) => (
                            <Badge key={tag} className="bg-gray-100 text-gray-700 border-gray-200" size="xs">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">&mdash;</span>
                      )}
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
