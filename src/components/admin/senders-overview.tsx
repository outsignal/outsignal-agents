"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Plus, Mail, ExternalLink } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
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
import { AddLinkedInSenderDialog } from "@/components/admin/add-linkedin-sender-dialog";

interface Sender {
  id: string;
  workspaceSlug: string;
  name: string;
  emailAddress: string | null;
  emailSenderName: string | null;
  linkedinProfileUrl: string | null;
  linkedinEmail: string | null;
  loginMethod: string;
  sessionStatus: string;
  proxyUrl: string | null;
  linkedinTier: string;
  healthStatus: string;
  ssiScore: number | null;
  acceptanceRate: number | null;
  healthFlaggedAt: string | null;
  emailBounceStatus: string;
  warmupDay: number;
  lastActiveAt: string | null;
  lastPolledAt: string | null;
  dailyConnectionLimit: number;
  dailyMessageLimit: number;
  dailyProfileViewLimit: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  workspace: { name: string };
}


function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "—";
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

function truncateUrl(url: string, maxLen = 30): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/$/, "");
    const display = u.hostname + path;
    return display.length > maxLen ? display.slice(0, maxLen) + "…" : display;
  } catch {
    return url.length > maxLen ? url.slice(0, maxLen) + "…" : url;
  }
}

/**
 * Derive a display health status from multiple sender signals.
 * The raw healthStatus defaults to "healthy" in the DB, which lies for
 * senders that have never been polled or don't have a session yet.
 */
function deriveDisplayHealth(sender: Sender): string {
  if (sender.sessionStatus === "not_setup") return "not_connected";
  if (sender.sessionStatus === "expired") return "session_expired";
  if (!sender.lastPolledAt) return "unknown";
  return sender.healthStatus;
}

function SessionStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "active":
      return (
        <Badge variant="success" dot>
          Active
        </Badge>
      );
    case "expired":
      return (
        <Badge variant="warning" dot>
          Expired
        </Badge>
      );
    case "not_setup":
      return (
        <Badge variant="secondary" dot>
          Not Setup
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary">
          {status || "—"}
        </Badge>
      );
  }
}


export function SendersOverview() {
  const [senders, setSenders] = useState<Sender[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const [workspaceFilter, setWorkspaceFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const fetchSenders = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/senders");
      if (!res.ok) throw new Error(`Failed to fetch senders (${res.status})`);
      const data = await res.json();
      setSenders(data.senders ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch senders");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSenders();
  }, [fetchSenders]);

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
      result = result.filter((s) => s.sessionStatus === statusFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase().trim();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.emailAddress && s.emailAddress.toLowerCase().includes(q))
      );
    }

    return result;
  }, [senders, workspaceFilter, statusFilter, search]);

  return (
    <>
      {/* Filters + Actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Search name or email…"
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
              <SelectItem value="expired">Expired</SelectItem>
              <SelectItem value="not_setup">Not Setup</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button
          variant="brand"
          onClick={() => setShowAddDialog(true)}
        >
          <Plus className="size-4" />
          Add LinkedIn Sender
        </Button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="rounded-md border border-border">
          {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonTableRow key={i} columns={9} />
          ))}
        </div>
      ) : error ? (
        <EmptyState
          title="Failed to load senders"
          description={error}
          action={{ label: "Retry", onClick: fetchSenders }}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Mail}
          title="No LinkedIn accounts found"
          description={
            senders.length === 0
              ? "No LinkedIn accounts have been added yet. Add a LinkedIn account to get started."
              : "No LinkedIn accounts match your current filters. Try adjusting your search or filters."
          }
          action={
            senders.length === 0
              ? { label: "Add LinkedIn Account", onClick: () => setShowAddDialog(true) }
              : undefined
          }
        />
      ) : (
        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Workspace</TableHead>
                <TableHead>Email Address</TableHead>
                <TableHead>LinkedIn Profile</TableHead>
                <TableHead>Session Status</TableHead>
                <TableHead>Login Method</TableHead>
                <TableHead>Last Polled</TableHead>
                <TableHead>Health</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((sender) => {
                return (
                  <TableRow key={sender.id}>
                    <TableCell className="font-medium">{sender.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {sender.workspace.name}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {sender.emailAddress ?? "—"}
                    </TableCell>
                    <TableCell>
                      {sender.linkedinProfileUrl ? (
                        <a
                          href={sender.linkedinProfileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
                        >
                          {truncateUrl(sender.linkedinProfileUrl)}
                          <ExternalLink className="size-3" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <SessionStatusBadge status={sender.sessionStatus} />
                    </TableCell>
                    <TableCell className="text-muted-foreground capitalize">
                      {sender.loginMethod || "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatRelativeTime(sender.lastPolledAt)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={deriveDisplayHealth(sender)} type="health" />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Summary */}
      {!loading && !error && senders.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Showing {filtered.length} of {senders.length} sender{senders.length !== 1 ? "s" : ""}
        </p>
      )}

      <AddLinkedInSenderDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onSuccess={fetchSenders}
      />
    </>
  );
}
