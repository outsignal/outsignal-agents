"use client";

import { useState, useMemo } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SubjectLine } from "./copy-tab";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SubjectLineRankingsProps {
  subjectLines: SubjectLine[];
  total: number;
  view: "global" | "per-campaign";
  onViewChange: (v: "global" | "per-campaign") => void;
}

type SortKey = "text" | "openRate" | "replyRate" | "totalSends";

// ---------------------------------------------------------------------------
// Toggle chip (inline — matches analytics-filters pattern)
// ---------------------------------------------------------------------------

function ViewToggle({
  view,
  onChange,
}: {
  view: "global" | "per-campaign";
  onChange: (v: "global" | "per-campaign") => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground mr-1">View:</span>
      {(["global", "per-campaign"] as const).map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={cn(
            "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors focus:outline-none",
            view === v
              ? "bg-brand text-brand-foreground border-brand-strong"
              : "bg-secondary text-muted-foreground border-border hover:bg-muted hover:text-foreground",
          )}
        >
          {v === "global" ? "Global" : "Per-campaign"}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SubjectLineRankings({
  subjectLines,
  total,
  view,
  onViewChange,
}: SubjectLineRankingsProps) {
  const [sortKey, setSortKey] = useState<SortKey>("replyRate");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortOrder((o) => (o === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortOrder("desc");
    }
  }

  const sorted = useMemo(() => {
    const copy = [...subjectLines];
    copy.sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortOrder === "asc"
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      const diff = (aVal as number) - (bVal as number);
      return sortOrder === "asc" ? diff : -diff;
    });
    return copy;
  }, [subjectLines, sortKey, sortOrder]);

  if (subjectLines.length === 0) {
    return (
      <div className="space-y-3">
        <ViewToggle view={view} onChange={onViewChange} />
        <p className="text-sm text-muted-foreground py-8 text-center">
          No subject line data available
        </p>
      </div>
    );
  }

  const isPerCampaign = view === "per-campaign";

  const columns: { key: SortKey | "campaign" | "step"; label: string; sortable: boolean }[] = [
    { key: "text", label: "Subject Line", sortable: true },
    ...(isPerCampaign
      ? [
          { key: "campaign" as const, label: "Campaign", sortable: false },
          { key: "step" as const, label: "Step", sortable: false },
        ]
      : []),
    { key: "openRate", label: "Open %", sortable: true },
    { key: "replyRate", label: "Reply %", sortable: true },
    { key: "totalSends", label: "Sends", sortable: true },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <ViewToggle view={view} onChange={onViewChange} />
        <span className="text-xs text-muted-foreground">
          {total} subject line{total !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={cn(
                      "px-4 py-3 text-left text-xs font-medium text-muted-foreground",
                      col.sortable &&
                        "cursor-pointer select-none hover:text-foreground",
                    )}
                    onClick={
                      col.sortable
                        ? () => handleSort(col.key as SortKey)
                        : undefined
                    }
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      {col.sortable && sortKey === col.key && (
                        sortOrder === "desc" ? (
                          <ChevronDown className="h-3 w-3" />
                        ) : (
                          <ChevronUp className="h-3 w-3" />
                        )
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((sl, idx) => (
                <tr
                  key={`${sl.text}-${sl.campaignName}-${sl.step}-${idx}`}
                  className="border-b transition-colors hover:bg-muted/30"
                >
                  <td
                    className="px-4 py-3 font-medium max-w-[320px] truncate"
                    title={sl.text}
                  >
                    {sl.text.length > 60
                      ? sl.text.slice(0, 60) + "..."
                      : sl.text}
                    {sl.isVariantB && (
                      <span className="ml-2 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-purple-500/20 text-purple-400 border border-purple-500/30">
                        B
                      </span>
                    )}
                  </td>
                  {isPerCampaign && (
                    <>
                      <td className="px-4 py-3 text-muted-foreground max-w-[180px] truncate">
                        {sl.campaignName ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground tabular-nums">
                        {sl.step ?? "—"}
                      </td>
                    </>
                  )}
                  <td className="px-4 py-3 tabular-nums">
                    {sl.openRate.toFixed(2)}%
                  </td>
                  <td
                    className={cn(
                      "px-4 py-3 tabular-nums font-medium",
                      sl.replyRate > 5
                        ? "text-green-500"
                        : sl.replyRate >= 2
                          ? "text-amber-500"
                          : "",
                    )}
                  >
                    {sl.replyRate.toFixed(2)}%
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {sl.totalSends.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
