"use client";

import Link from "next/link";
import { BarChart3, ArrowRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { CampaignData } from "@/components/analytics/campaign-rankings-table";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CampaignSummaryProps {
  campaigns: CampaignData[] | null;
  loading: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CampaignSummary({ campaigns, loading }: CampaignSummaryProps) {
  const top5 = campaigns
    ?.slice()
    .sort((a, b) => b.replyRate - a.replyRate)
    .slice(0, 5);

  return (
    <div className="rounded-lg border bg-card/50 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-muted-foreground" />
          <h3 className="font-semibold">Campaign Rankings</h3>
        </div>
        <Link
          href="/analytics?tab=performance"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          View details
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      ) : !top5 || top5.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          No campaign data yet.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground uppercase tracking-wider">
              <th className="text-left pb-2 font-medium">#</th>
              <th className="text-left pb-2 font-medium">Campaign</th>
              <th className="text-right pb-2 font-medium">Reply %</th>
              <th className="text-right pb-2 font-medium">Interested %</th>
            </tr>
          </thead>
          <tbody>
            {top5.map((c, idx) => (
              <tr key={c.id} className="border-t border-border/50">
                <td className="py-1.5 text-muted-foreground tabular-nums">
                  {idx + 1}
                </td>
                <td className="py-1.5 font-medium truncate max-w-[180px]" title={c.name}>
                  {c.name.length > 25 ? `${c.name.slice(0, 25)}...` : c.name}
                </td>
                <td className="py-1.5 text-right tabular-nums font-medium">
                  {c.replyRate.toFixed(1)}%
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {c.interestedRate.toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
