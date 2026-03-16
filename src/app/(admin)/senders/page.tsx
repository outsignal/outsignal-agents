"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback } from "react";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SenderCard } from "@/components/senders/sender-card";
import { SenderFormModal } from "@/components/senders/sender-form-modal";
import type { SenderWithWorkspace } from "@/components/senders/types";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkedinIcon } from "lucide-react";

function SenderCardSkeleton() {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-48" />
          <Skeleton className="h-3 w-24" />
        </div>
        <div className="flex flex-col items-end gap-1">
          <Skeleton className="h-5 w-14 rounded-full" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-3/4" />
      </div>
      <div className="flex gap-2 pt-2 border-t">
        <Skeleton className="h-7 w-14" />
        <Skeleton className="h-7 w-16" />
        <Skeleton className="h-7 w-16 ml-auto" />
      </div>
    </div>
  );
}

interface WorkspaceOption {
  slug: string;
  name: string;
}

interface BudgetMetric {
  sent: number;
  limit: number;
  remaining: number;
}

interface Budget {
  connections: BudgetMetric;
  messages: BudgetMetric;
  profileViews: BudgetMetric;
}

export default function SendersPage() {
  const [senders, setSenders] = useState<SenderWithWorkspace[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [budgets, setBudgets] = useState<Record<string, Budget | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [filterWorkspace, setFilterWorkspace] = useState<string>("all");

  const fetchSenders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params =
        filterWorkspace !== "all" ? `?workspace=${filterWorkspace}` : "";
      const res = await fetch(`/api/senders${params}`);
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const fetchedSenders: SenderWithWorkspace[] = data.senders ?? [];
      setSenders(fetchedSenders);

      // Build unique workspace list from senders for the dropdown/filter
      if (filterWorkspace === "all") {
        const seen = new Set<string>();
        const wsOptions: WorkspaceOption[] = [];
        for (const s of fetchedSenders) {
          if (!seen.has(s.workspaceSlug)) {
            seen.add(s.workspaceSlug);
            wsOptions.push({ slug: s.workspaceSlug, name: s.workspace.name });
          }
        }
        setWorkspaces(wsOptions);
      }

      // Batch-fetch budgets for all senders
      if (fetchedSenders.length > 0) {
        const ids = fetchedSenders.map((s) => s.id).join(",");
        fetch(`/api/senders/budgets?ids=${ids}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((result) => {
            if (result?.budgets) setBudgets(result.budgets);
          })
          .catch(() => {});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load senders");
    } finally {
      setLoading(false);
    }
  }, [filterWorkspace]);

  useEffect(() => {
    void fetchSenders();
  }, [fetchSenders]);

  const visibleSenders =
    filterWorkspace === "all"
      ? senders
      : senders.filter((s) => s.workspaceSlug === filterWorkspace);

  return (
    <div>
      <Header
        title="LinkedIn Senders"
        description="Manage LinkedIn sender accounts across all workspaces"
        actions={
          <Button size="sm" onClick={() => setAddOpen(true)}>
            Add Sender
          </Button>
        }
      />

      <div className="p-6 space-y-6">
        {/* Workspace filter */}
        {workspaces.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Workspace:</span>
            <Select value={filterWorkspace} onValueChange={setFilterWorkspace}>
              <SelectTrigger className="w-48 h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All workspaces</SelectItem>
                {workspaces.map((ws) => (
                  <SelectItem key={ws.slug} value={ws.slug}>
                    {ws.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="rounded-md bg-destructive/10 text-destructive px-4 py-3 text-sm">
            {error}
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <SenderCardSkeleton key={i} />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && visibleSenders.length === 0 && (
          <EmptyState
            icon={LinkedinIcon}
            title="No senders connected"
            description="Add your first LinkedIn sender account to start automating outreach across your workspaces."
            action={{ label: "Add Sender", onClick: () => setAddOpen(true) }}
          />
        )}

        {/* Sender cards grid */}
        {!loading && visibleSenders.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {visibleSenders.map((sender) => (
              <SenderCard
                key={sender.id}
                sender={sender}
                workspaces={workspaces}
                initialBudget={budgets[sender.id]}
                onMutate={fetchSenders}
              />
            ))}
          </div>
        )}
      </div>

      {/* Add sender modal */}
      <SenderFormModal
        open={addOpen}
        onOpenChange={setAddOpen}
        workspaces={workspaces}
        onSaved={fetchSenders}
      />
    </div>
  );
}
