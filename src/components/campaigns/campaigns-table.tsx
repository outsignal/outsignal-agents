"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Eye,
  Pause,
  Play,
  Archive,
  Megaphone,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  SortableTableHead,
  TableRowActions,
  type TableRowAction,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CampaignRow {
  id: string;
  name: string;
  status: string;
  type: string;
  workspaceSlug: string;
  workspaceName: string;
  leadCount: number;
  dailyLeadCap: number;
  updatedAt: string; // ISO string (serialized from server)
  createdAt: string;
}

type SortKey = "name" | "status" | "leadCount" | "updatedAt";
type SortDir = "asc" | "desc";

interface CampaignsTableProps {
  campaigns: CampaignRow[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = now - then;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CampaignsTable({ campaigns }: CampaignsTableProps) {
  const router = useRouter();
  const [sort, setSort] = React.useState<{ key: SortKey; direction: SortDir }>({
    key: "updatedAt",
    direction: "desc",
  });
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = React.useState(false);

  // ─── Sorting ────────────────────────────────────────────────────────────────

  const handleSort = React.useCallback((key: string) => {
    setSort((prev) => {
      if (prev.key === key) {
        return { key: key as SortKey, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { key: key as SortKey, direction: "asc" };
    });
  }, []);

  const sortedCampaigns = React.useMemo(() => {
    return [...campaigns].sort((a, b) => {
      const { key, direction } = sort;
      let cmp = 0;
      if (key === "name") {
        cmp = a.name.localeCompare(b.name);
      } else if (key === "status") {
        cmp = a.status.localeCompare(b.status);
      } else if (key === "leadCount") {
        cmp = a.leadCount - b.leadCount;
      } else if (key === "updatedAt") {
        cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
      }
      return direction === "asc" ? cmp : -cmp;
    });
  }, [campaigns, sort]);

  // ─── Selection ──────────────────────────────────────────────────────────────

  const allSelected = campaigns.length > 0 && selected.size === campaigns.length;
  const someSelected = selected.size > 0 && !allSelected;

  const toggleAll = React.useCallback(() => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(campaigns.map((c) => c.id)));
    }
  }, [allSelected, campaigns]);

  const toggleRow = React.useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // ─── Row Actions ────────────────────────────────────────────────────────────

  const getRowActions = React.useCallback(
    (campaign: CampaignRow): TableRowAction[] => {
      const actions: TableRowAction[] = [
        {
          label: "View Details",
          icon: Eye,
          onClick: () => router.push(`/campaigns/${campaign.id}`),
        },
      ];

      if (campaign.status === "active") {
        actions.push({
          label: "Pause",
          icon: Pause,
          onClick: () => updateStatus(campaign.id, "paused"),
        });
      } else if (campaign.status === "paused") {
        actions.push({
          label: "Resume",
          icon: Play,
          onClick: () => updateStatus(campaign.id, "active"),
        });
      }

      if (campaign.status !== "completed") {
        actions.push({
          label: "Complete",
          icon: Archive,
          onClick: () => updateStatus(campaign.id, "completed"),
          destructive: true,
        });
      }

      return actions;
    },
    [router],
  );

  // ─── Status Update ─────────────────────────────────────────────────────────

  async function updateStatus(id: string, newStatus: string) {
    try {
      await fetch(`/api/campaigns/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      router.refresh();
    } catch (err) {
      console.error("Failed to update campaign status:", err);
    }
  }

  // ─── Bulk Actions ───────────────────────────────────────────────────────────

  async function bulkUpdateStatus(newStatus: string) {
    setBulkLoading(true);
    try {
      await Promise.all(
        Array.from(selected).map((id) =>
          fetch(`/api/campaigns/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: newStatus }),
          }),
        ),
      );
      setSelected(new Set());
      router.refresh();
    } catch (err) {
      console.error("Bulk update failed:", err);
    } finally {
      setBulkLoading(false);
    }
  }

  // ─── Empty State ────────────────────────────────────────────────────────────

  if (campaigns.length === 0) {
    return (
      <EmptyState
        icon={Megaphone}
        title="No campaigns yet"
        description="Create your first campaign to start generating replies."
        variant="default"
      />
    );
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">
      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted px-4 py-2.5 animate-fade-in">
          <span className="text-sm font-medium text-foreground">
            {selected.size} selected
          </span>
          <div className="h-4 w-px bg-border" />
          <Button
            variant="outline"
            size="sm"
            onClick={() => bulkUpdateStatus("paused")}
            disabled={bulkLoading}
          >
            <Pause className="size-3.5 mr-1.5" />
            Pause Selected
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => bulkUpdateStatus("completed")}
            disabled={bulkLoading}
          >
            <Archive className="size-3.5 mr-1.5" />
            Complete Selected
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelected(new Set())}
            disabled={bulkLoading}
          >
            Clear
          </Button>
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected ? true : someSelected ? "indeterminate" : false}
                  onCheckedChange={toggleAll}
                  aria-label="Select all"
                />
              </TableHead>
              <SortableTableHead
                sortKey="name"
                currentSort={sort}
                onSort={handleSort}
              >
                Name
              </SortableTableHead>
              <TableHead className="hidden md:table-cell">Workspace</TableHead>
              <SortableTableHead
                sortKey="status"
                currentSort={sort}
                onSort={handleSort}
              >
                Status
              </SortableTableHead>
              <SortableTableHead
                sortKey="leadCount"
                currentSort={sort}
                onSort={handleSort}
                className="text-right"
              >
                Leads
              </SortableTableHead>
              <SortableTableHead
                sortKey="updatedAt"
                currentSort={sort}
                onSort={handleSort}
                className="hidden md:table-cell"
              >
                Last Activity
              </SortableTableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedCampaigns.map((campaign) => (
              <TableRow key={campaign.id}>
                <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={selected.has(campaign.id)}
                    onCheckedChange={() => toggleRow(campaign.id)}
                    aria-label={`Select ${campaign.name}`}
                  />
                </TableCell>
                <TableCell>
                  <div>
                    <Link
                      href={`/campaigns/${campaign.id}`}
                      className="font-medium text-sm text-foreground hover:text-brand transition-colors"
                    >
                      {campaign.name}
                    </Link>
                    {campaign.type === "signal" && (
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <Badge variant="purple" size="xs">
                          Signal
                        </Badge>
                        {campaign.dailyLeadCap && (
                          <span className="text-[11px] text-muted-foreground">
                            {campaign.dailyLeadCap}/day cap
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <Link
                    href={`/workspace/${campaign.workspaceSlug}`}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {campaign.workspaceName}
                  </Link>
                </TableCell>
                <TableCell>
                  <StatusBadge status={campaign.status} type="campaign" />
                </TableCell>
                <TableCell className="text-right">
                  <span className="font-mono text-sm text-foreground">
                    {campaign.leadCount.toLocaleString()}
                  </span>
                </TableCell>
                <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                  {relativeTime(campaign.updatedAt)}
                </TableCell>
                <TableCell className="w-12 px-2">
                  <TableRowActions actions={getRowActions(campaign)} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
