"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Mail } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SkeletonTableRow } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";

interface InboxSender {
  id: string;
  workspaceSlug: string;
  name: string;
  emailAddress: string | null;
  emailSenderName: string | null;
  emailBounceStatus: string;
  warmupDay: number;
  healthStatus: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  workspace: { name: string };
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "\u2014";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function SenderStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "active":
      return (
        <Badge variant="success" dot>
          Active
        </Badge>
      );
    case "paused":
      return (
        <Badge variant="warning" dot>
          Paused
        </Badge>
      );
    case "disabled":
      return (
        <Badge variant="destructive" dot>
          Disabled
        </Badge>
      );
    case "setup":
      return (
        <Badge variant="secondary" dot>
          Setup
        </Badge>
      );
    default:
      return <Badge variant="secondary">{status || "\u2014"}</Badge>;
  }
}

export function InboxesOverview() {
  const [senders, setSenders] = useState<InboxSender[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [workspaceFilter, setWorkspaceFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const fetchInboxes = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/inboxes");
      if (!res.ok) throw new Error(`Failed to fetch inboxes (${res.status})`);
      const data = await res.json();
      setSenders(data.senders ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch inboxes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInboxes();
  }, [fetchInboxes]);

  const workspaces = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of senders) {
      map.set(s.workspaceSlug, s.workspace.name);
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [senders]);

  const filtered = useMemo(() => {
    let result = senders;

    if (workspaceFilter !== "all") {
      result = result.filter((s) => s.workspaceSlug === workspaceFilter);
    }

    if (statusFilter !== "all") {
      result = result.filter((s) => s.status === statusFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase().trim();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.emailAddress && s.emailAddress.toLowerCase().includes(q)),
      );
    }

    return result;
  }, [senders, workspaceFilter, statusFilter, search]);

  return (
    <>
      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Search name or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 w-[220px]"
            />
          </div>

          <Select value={workspaceFilter} onValueChange={setWorkspaceFilter}>
            <SelectTrigger size="sm" className="w-[160px]">
              <SelectValue placeholder="All Workspaces" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Workspaces</SelectItem>
              {workspaces.map(([slug, name]) => (
                <SelectItem key={slug} value={slug}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger size="sm" className="w-[130px]">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="paused">Paused</SelectItem>
              <SelectItem value="disabled">Disabled</SelectItem>
              <SelectItem value="setup">Setup</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="rounded-md border border-border">
          {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonTableRow key={i} columns={7} />
          ))}
        </div>
      ) : error ? (
        <EmptyState
          title="Failed to load inboxes"
          description={error}
          action={{ label: "Retry", onClick: fetchInboxes }}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Mail}
          title="No inboxes found"
          description={
            senders.length === 0
              ? "No email sending accounts have been synced yet."
              : "No inboxes match your current filters. Try adjusting your search or filters."
          }
        />
      ) : (
        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email Address</TableHead>
                <TableHead>Workspace</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Health</TableHead>
                <TableHead>Bounce Status</TableHead>
                <TableHead>Last Synced</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((sender) => (
                <TableRow key={sender.id}>
                  <TableCell className="font-medium">{sender.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {sender.emailAddress ?? "\u2014"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {sender.workspace.name}
                  </TableCell>
                  <TableCell>
                    <SenderStatusBadge status={sender.status} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={sender.healthStatus} type="health" />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={sender.emailBounceStatus} type="health" />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatRelativeTime(sender.updatedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Summary */}
      {!loading && !error && senders.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Showing {filtered.length} of {senders.length} inbox
          {senders.length !== 1 ? "es" : ""}
        </p>
      )}
    </>
  );
}
