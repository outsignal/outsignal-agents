"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Header } from "@/components/layout/header";
import { MetricCard } from "@/components/dashboard/metric-card";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Sun, Heart, Calendar, Clock, Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OooRecord {
  id: string;
  personEmail: string;
  personName: string | null;
  workspaceSlug: string;
  oooUntil: string;
  oooReason: string;
  oooDetectedAt: string;
  eventName: string | null;
  triggerRunId: string | null;
  status: string;
  needsManualReview: boolean;
  originalCampaignId: string | null;
  sentAt: string | null;
  cancelledAt: string | null;
  failureReason: string | null;
  createdAt: string;
}

interface OooSummary {
  totalOoo: number;
  returningThisWeek: number;
  reengaged: number;
  failed: number;
}

interface OooData {
  records: OooRecord[];
  summary: OooSummary;
}

interface Workspace {
  slug: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const REASON_ICONS: Record<string, React.ReactNode> = {
  holiday: <Sun className="h-3.5 w-3.5 inline-block mr-1 text-amber-500 dark:text-amber-400" />,
  illness: <Heart className="h-3.5 w-3.5 inline-block mr-1 text-red-400 dark:text-red-300" />,
  conference: <Calendar className="h-3.5 w-3.5 inline-block mr-1 text-blue-400 dark:text-blue-300" />,
  generic: <Clock className="h-3.5 w-3.5 inline-block mr-1 text-muted-foreground" />,
};

function ReasonCell({ reason, eventName }: { reason: string; eventName: string | null }) {
  const icon = REASON_ICONS[reason] ?? REASON_ICONS.generic;
  const label = reason.charAt(0).toUpperCase() + reason.slice(1);
  return (
    <span className="flex items-center text-sm">
      {icon}
      {label}
      {eventName && (
        <span className="ml-1 text-muted-foreground text-xs">({eventName})</span>
      )}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "pending") {
    return (
      <Badge variant="warning" className="text-xs font-medium">
        Pending
      </Badge>
    );
  }
  if (status === "sent") {
    return (
      <Badge variant="success" className="text-xs font-medium">
        Sent
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="destructive" className="text-xs font-medium">
        Failed
      </Badge>
    );
  }
  if (status === "cancelled") {
    return (
      <Badge variant="secondary" className="text-xs font-medium">
        Cancelled
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-xs">
      {status}
    </Badge>
  );
}

const STATUS_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "pending", label: "Pending" },
  { value: "sent", label: "Sent" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
];

// ---------------------------------------------------------------------------
// Inline date editor
// ---------------------------------------------------------------------------

function EditDateCell({
  record,
  onSaved,
}: {
  record: OooRecord;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(record.oooUntil.slice(0, 10));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!value) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/ooo/${record.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oooUntil: new Date(value).toISOString() }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      toast.success("Return date updated");
      setEditing(false);
      onSaved();
    } catch (err) {
      toast.error(`Failed to update: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm">{formatDate(record.oooUntil)}</span>
        {record.needsManualReview && (
          <Badge className="bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800 text-[10px] font-medium">
            Review
          </Badge>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={() => setEditing(true)}
          title="Edit return date"
        >
          <Pencil className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        type="date"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="text-sm border border-border rounded px-2 py-0.5 h-7 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <Button
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={handleSave}
        disabled={saving}
      >
        {saving ? "..." : "Save"}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0"
        onClick={() => {
          setEditing(false);
          setValue(record.oooUntil.slice(0, 10));
        }}
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function OooQueuePage() {
  const [workspaceFilter, setWorkspaceFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [data, setData] = useState<OooData | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (workspaceFilter !== "all") params.set("workspaceSlug", workspaceFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);

      const res = await fetch(`/api/ooo?${params.toString()}`);
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as OooData;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [workspaceFilter, statusFilter]);

  // Fetch workspace list for filter dropdown
  useEffect(() => {
    fetch("/api/workspaces")
      .then(async (res) => {
        if (!res.ok) return;
        const json = (await res.json()) as { workspaces: Workspace[] };
        setWorkspaces(json.workspaces ?? []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCancel = async (record: OooRecord) => {
    try {
      const res = await fetch(`/api/ooo/${record.id}`, { method: "DELETE" });
      if (!res.ok) {
        const errData = (await res.json()) as { error?: string };
        throw new Error(errData.error ?? `HTTP ${res.status}`);
      }
      toast.success(`Re-engagement cancelled for ${record.personEmail}`);
      fetchData();
    } catch (err) {
      toast.error(
        `Failed to cancel: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const records = data?.records ?? [];

  return (
    <div>
      <Header
        title="OOO Queue"
        description="Manage out-of-office re-engagement tasks"
      />

      <div className="p-6 space-y-6">
        {/* Error state */}
        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 p-4">
            <p className="text-sm text-red-800">Failed to load OOO data: {error}</p>
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-lg" />
              ))}
            </div>
            <Skeleton className="h-64 rounded-lg" />
          </>
        )}

        {/* Loaded state */}
        {!loading && data && (
          <>
            {/* Summary metric cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricCard
                label="Total OOO"
                value={data.summary.totalOoo.toLocaleString()}
              />
              <MetricCard
                label="Returning This Week"
                value={data.summary.returningThisWeek.toLocaleString()}
                trend={data.summary.returningThisWeek > 0 ? "warning" : "neutral"}
              />
              <MetricCard
                label="Re-engaged"
                value={data.summary.reengaged.toLocaleString()}
                trend={data.summary.reengaged > 0 ? "up" : "neutral"}
              />
              <MetricCard
                label="Failed"
                value={data.summary.failed.toLocaleString()}
                trend={data.summary.failed > 0 ? "down" : "neutral"}
              />
            </div>

            {/* Filters row */}
            <div className="flex items-center gap-3 flex-wrap">
              <Select value={workspaceFilter} onValueChange={setWorkspaceFilter}>
                <SelectTrigger className="h-8 text-xs w-[200px]" aria-label="Filter by workspace">
                  <SelectValue placeholder="All Workspaces" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">All Workspaces</SelectItem>
                  {workspaces.map((ws) => (
                    <SelectItem key={ws.slug} value={ws.slug} className="text-xs">
                      {ws.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-8 text-xs w-[160px]" aria-label="Filter by status">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value} className="text-xs">
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <span className="text-xs text-muted-foreground ml-auto">
                {records.length} record{records.length !== 1 ? "s" : ""}
              </span>
            </div>

            {/* OOO records table */}
            <Card>
              <CardHeader>
                <CardTitle>OOO Re-engagements</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[220px]">Lead</TableHead>
                      <TableHead>Workspace</TableHead>
                      <TableHead className="w-[220px]">Return Date</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {records.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={6}
                          className="text-center py-8 text-muted-foreground"
                        >
                          No OOO records found
                        </TableCell>
                      </TableRow>
                    )}
                    {records.map((record) => (
                      <TableRow key={record.id}>
                        {/* Lead */}
                        <TableCell>
                          {record.personName && (
                            <p className="text-sm font-medium">{record.personName}</p>
                          )}
                          <p
                            className={cn(
                              "text-xs font-mono text-muted-foreground",
                              !record.personName && "text-sm text-foreground",
                            )}
                          >
                            {record.personEmail}
                          </p>
                        </TableCell>

                        {/* Workspace */}
                        <TableCell>
                          <span className="text-sm font-mono text-muted-foreground">
                            {record.workspaceSlug}
                          </span>
                        </TableCell>

                        {/* Return Date — inline edit for pending */}
                        <TableCell>
                          {record.status === "pending" ? (
                            <EditDateCell record={record} onSaved={fetchData} />
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="text-sm">{formatDate(record.oooUntil)}</span>
                              {record.needsManualReview && (
                                <Badge className="bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800 text-[10px] font-medium">
                                  Review
                                </Badge>
                              )}
                            </div>
                          )}
                        </TableCell>

                        {/* Reason */}
                        <TableCell>
                          <ReasonCell
                            reason={record.oooReason}
                            eventName={record.eventName}
                          />
                        </TableCell>

                        {/* Status */}
                        <TableCell>
                          <StatusBadge status={record.status} />
                        </TableCell>

                        {/* Actions */}
                        <TableCell className="text-right">
                          {record.status === "pending" && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-xs text-destructive hover:text-destructive hover:bg-red-50"
                                >
                                  Cancel
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Cancel re-engagement?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Cancel re-engagement for{" "}
                                    <span className="font-medium">{record.personEmail}</span>?
                                    This will cancel the scheduled Trigger.dev task and cannot
                                    be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Keep</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => handleCancel(record)}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  >
                                    Cancel re-engagement
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
