"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Info,
  AlertTriangle,
  AlertCircle,
  CheckCheck,
  Bell,
} from "lucide-react";
import { Header } from "@/components/layout/header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Notification {
  id: string;
  type: string;
  severity: string;
  title: string;
  message: string | null;
  workspaceSlug: string | null;
  metadata: Record<string, unknown> | null;
  read: boolean;
  createdAt: string;
}

interface NotificationsResponse {
  notifications: Notification[];
  total: number;
  page: number;
  limit: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TYPE_OPTIONS = [
  { value: "onboard", label: "Onboard" },
  { value: "provisioning", label: "Provisioning" },
  { value: "agent", label: "Agent" },
  { value: "system", label: "System" },
  { value: "error", label: "Error" },
  { value: "approval", label: "Approval" },
  { value: "proposal", label: "Proposal" },
];

const SEVERITY_OPTIONS = [
  { value: "info", label: "Info" },
  { value: "warning", label: "Warning" },
  { value: "error", label: "Error" },
];

const typeBadgeVariant: Record<string, "success" | "brand" | "secondary" | "destructive" | "default"> = {
  onboard: "success",
  provisioning: "brand",
  agent: "default",
  system: "secondary",
  error: "destructive",
  approval: "success",
  proposal: "brand",
};

const typeBadgeClassName: Record<string, string> = {
  agent: "bg-purple-50 text-purple-700 border-purple-200",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function SeverityIcon({ severity }: { severity: string }) {
  switch (severity) {
    case "warning":
      return <AlertTriangle className="h-4 w-4 text-amber-500" />;
    case "error":
      return <AlertCircle className="h-4 w-4 text-red-500" />;
    default:
      return <Info className="h-4 w-4 text-blue-400" />;
  }
}

// ─── Skeleton rows ────────────────────────────────────────────────────────────

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <TableRow key={i} className="border-border">
          <TableCell>
            <div className="h-3.5 bg-muted rounded animate-pulse w-16" />
          </TableCell>
          <TableCell>
            <div className="h-3.5 bg-muted rounded animate-pulse w-4" />
          </TableCell>
          <TableCell>
            <div className="h-5 bg-muted rounded-full animate-pulse w-20" />
          </TableCell>
          <TableCell>
            <div className="h-3.5 bg-muted rounded animate-pulse w-48" />
          </TableCell>
          <TableCell>
            <div className="h-3.5 bg-muted rounded animate-pulse w-16" />
          </TableCell>
          <TableCell>
            <div className="h-3.5 bg-muted rounded animate-pulse w-64" />
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NotificationsPage() {
  const [data, setData] = useState<NotificationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [workspaceFilter, setWorkspaceFilter] = useState<string>("all");
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  const [page, setPage] = useState(1);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (typeFilter !== "all") params.set("type", typeFilter);
    if (severityFilter !== "all") params.set("severity", severityFilter);
    if (workspaceFilter !== "all") params.set("workspace", workspaceFilter);
    params.set("page", String(page));

    try {
      const res = await fetch(`/api/notifications?${params.toString()}`);
      const json = await res.json();
      setData(json);
    } finally {
      setLoading(false);
    }
  }, [typeFilter, severityFilter, workspaceFilter, page]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Fetch distinct workspace slugs for filter
  useEffect(() => {
    fetch("/api/notifications?page=1")
      .then((r) => r.json())
      .then((json: NotificationsResponse) => {
        const slugs = [
          ...new Set(
            json.notifications
              .map((n) => n.workspaceSlug)
              .filter((s): s is string => !!s),
          ),
        ].sort();
        setWorkspaces(slugs);
      })
      .catch(() => {});
  }, []);

  async function handleMarkAllRead() {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markAllRead: true }),
    });
    fetchNotifications();
  }

  async function handleMarkRead(id: string) {
    // Optimistically update local state
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        notifications: prev.notifications.map((n) =>
          n.id === id ? { ...n, read: true } : n
        ),
      };
    });
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [id] }),
    });
  }

  const totalPages = data ? Math.ceil(data.total / data.limit) : 1;
  const unreadCount = data
    ? data.notifications.filter((n) => !n.read).length
    : 0;

  return (
    <div>
      <Header
        title="Notifications"
        description="System events and alerts"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={handleMarkAllRead}
            disabled={unreadCount === 0}
          >
            <CheckCheck className="h-4 w-4 mr-2" />
            Mark all read
          </Button>
        }
      />

      <div className="p-8">
        {/* Filters */}
        <div className="flex items-center gap-3 mb-6">
          <Select
            value={typeFilter}
            onValueChange={(val) => {
              setTypeFilter(val);
              setPage(1);
            }}
          >
            <SelectTrigger size="sm">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {TYPE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={severityFilter}
            onValueChange={(val) => {
              setSeverityFilter(val);
              setPage(1);
            }}
          >
            <SelectTrigger size="sm">
              <SelectValue placeholder="All severities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severities</SelectItem>
              {SEVERITY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {workspaces.length > 0 && (
            <Select
              value={workspaceFilter}
              onValueChange={(val) => {
                setWorkspaceFilter(val);
                setPage(1);
              }}
            >
              <SelectTrigger size="sm">
                <SelectValue placeholder="All workspaces" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All workspaces</SelectItem>
                {workspaces.map((slug) => (
                  <SelectItem key={slug} value={slug}>
                    {slug}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {data && (
            <span className="text-xs text-muted-foreground ml-auto">
              {data.total} notification{data.total !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead className="w-10"></TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <SkeletonRows />
                ) : data && data.notifications.length > 0 ? (
                  data.notifications.map((n) => (
                    <TableRow
                      key={n.id}
                      onClick={() => !n.read && handleMarkRead(n.id)}
                      className={cn(
                        "border-border transition-colors",
                        !n.read && "bg-muted/50 cursor-pointer",
                        n.read && "opacity-75",
                        n.severity === "warning" &&
                          "border-l-2 border-l-amber-400",
                        n.severity === "error" &&
                          "border-l-2 border-l-red-500",
                        n.severity === "info" &&
                          !n.read &&
                          "border-l-2 border-l-brand",
                      )}
                    >
                      <TableCell className="text-xs text-muted-foreground">
                        {relativeTime(n.createdAt)}
                      </TableCell>
                      <TableCell>
                        <SeverityIcon severity={n.severity} />
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={typeBadgeVariant[n.type] ?? "secondary"}
                          className={cn(
                            "text-xs capitalize",
                            typeBadgeClassName[n.type],
                          )}
                        >
                          {n.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium text-sm">
                        {n.title}
                      </TableCell>
                      <TableCell>
                        {n.workspaceSlug ? (
                          <Link
                            href={`/workspace/${n.workspaceSlug}`}
                            className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                          >
                            {n.workspaceSlug}
                          </Link>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-xs">
                        {n.message
                          ? n.message.length > 100
                            ? n.message.slice(0, 100) + "..."
                            : n.message
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-12 text-center text-muted-foreground"
                    >
                      <div className="flex flex-col items-center gap-2">
                        <Bell className="h-8 w-8 text-muted-foreground/40" />
                        <p className="text-sm">No notifications yet.</p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4">
            <p className="text-xs text-muted-foreground">
              Page {page} of {totalPages}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
