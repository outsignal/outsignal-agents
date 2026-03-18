"use client";

import { useState, useEffect, useCallback } from "react";
import {
  DomainHealthCards,
  type DomainData,
} from "@/components/deliverability/domain-health-cards";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { SenderData } from "@/components/deliverability/sender-health-table";

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function TableSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-9 w-full" />
      {[...Array(6)].map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DomainsTab
// ---------------------------------------------------------------------------

export function DomainsTab() {
  const [workspace, setWorkspace] = useState<string>("");
  const [workspaceOptions, setWorkspaceOptions] = useState<string[]>([]);
  const [domains, setDomains] = useState<DomainData[] | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async (ws: string) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (ws) params.set("workspace", ws);
    const qs = params.toString() ? `?${params.toString()}` : "";

    const [domainsRes, sendersRes] = await Promise.allSettled([
      fetch(`/api/deliverability/domains${qs}`),
      fetch(`/api/deliverability/senders${qs}`),
    ]);

    if (domainsRes.status === "fulfilled" && domainsRes.value.ok) {
      const json = (await domainsRes.value.json()) as DomainData[];
      setDomains(json);
    } else {
      setDomains([]);
    }

    // Extract workspace options from senders for filter
    if (sendersRes.status === "fulfilled" && sendersRes.value.ok) {
      const json = (await sendersRes.value.json()) as SenderData[];
      const slugs = [...new Set(json.map((s) => s.workspaceSlug))].sort();
      setWorkspaceOptions(slugs);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchData(workspace);
  }, [fetchData, workspace]);

  function handleWorkspaceChange(val: string) {
    setWorkspace(val === "all" ? "" : val);
  }

  return (
    <div className="space-y-6">
      {/* Workspace filter */}
      <div className="flex items-center justify-end gap-2">
        <span className="text-xs text-muted-foreground">Workspace:</span>
        <Select
          value={workspace || "all"}
          onValueChange={handleWorkspaceChange}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All workspaces" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All workspaces</SelectItem>
            {workspaceOptions.map((slug) => (
              <SelectItem key={slug} value={slug}>
                {slug}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Domain Health Table */}
      {loading ? (
        <TableSkeleton />
      ) : (
        <DomainHealthCards domains={domains ?? []} />
      )}
    </div>
  );
}
