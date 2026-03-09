"use client";

import { Fragment, useState } from "react";
import { ChevronUp, ChevronDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { StepAnalyticsChart, type StepData } from "./step-analytics-chart";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CampaignData {
  id: string;
  name: string;
  workspace: string;
  channels: string[];
  sent: number;
  replyRate: number;
  openRate: number;
  bounceRate: number;
  interestedRate: number;
  replied: number;
  opened: number;
  bounced: number;
  interested: number;
  copyStrategy: string | null;
  status: string;
}

interface CampaignRankingsTableProps {
  campaigns: CampaignData[];
  sort: string;
  order: string;
  onSortChange: (sort: string, order: string) => void;
}

interface StepsCache {
  [campaignId: string]: {
    loading: boolean;
    data: StepData[] | null;
    campaignName: string;
    error: string | null;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rateColor(rate: number, type: "reply" | "bounce"): string {
  if (type === "reply") {
    if (rate > 5) return "text-green-500";
    if (rate >= 2) return "text-amber-500";
    return "";
  }
  // bounce
  if (rate > 5) return "text-red-500";
  if (rate < 2) return "text-green-500";
  return "";
}

function ChannelBadge({ channels }: { channels: string[] }) {
  const hasEmail = channels.includes("email");
  const hasLinkedin = channels.includes("linkedin");

  if (hasEmail && hasLinkedin) {
    return (
      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-purple-500/20 text-purple-400 border border-purple-500/30">
        Both
      </span>
    );
  }
  if (hasLinkedin) {
    return (
      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-[#F0FF7A]/20 text-[#F0FF7A] border border-[#F0FF7A]/30">
        LinkedIn
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-blue-500/20 text-blue-400 border border-blue-500/30">
      Email
    </span>
  );
}

// ---------------------------------------------------------------------------
// Sortable column headers
// ---------------------------------------------------------------------------

const COLUMNS = [
  { key: "name", label: "Campaign", sortable: true },
  { key: "workspace", label: "Workspace", sortable: true },
  { key: "channels", label: "Channel", sortable: false },
  { key: "sent", label: "Sent", sortable: true },
  { key: "replyRate", label: "Reply %", sortable: true },
  { key: "openRate", label: "Open %", sortable: true },
  { key: "bounceRate", label: "Bounce %", sortable: true },
  { key: "interestedRate", label: "Interested %", sortable: true },
] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CampaignRankingsTable({
  campaigns,
  sort,
  order,
  onSortChange,
}: CampaignRankingsTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [stepsCache, setStepsCache] = useState<StepsCache>({});

  function handleSort(key: string) {
    if (sort === key) {
      onSortChange(key, order === "desc" ? "asc" : "desc");
    } else {
      onSortChange(key, "desc");
    }
  }

  async function handleExpand(campaign: CampaignData) {
    if (expandedId === campaign.id) {
      setExpandedId(null);
      return;
    }

    setExpandedId(campaign.id);

    // Already cached
    if (stepsCache[campaign.id]?.data) return;

    // Fetch step data
    setStepsCache((prev) => ({
      ...prev,
      [campaign.id]: {
        loading: true,
        data: null,
        campaignName: campaign.name,
        error: null,
      },
    }));

    try {
      const res = await fetch(`/api/analytics/campaigns/${campaign.id}/steps`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { steps: StepData[] };
      setStepsCache((prev) => ({
        ...prev,
        [campaign.id]: {
          loading: false,
          data: json.steps,
          campaignName: campaign.name,
          error: null,
        },
      }));
    } catch (err) {
      setStepsCache((prev) => ({
        ...prev,
        [campaign.id]: {
          loading: false,
          data: null,
          campaignName: campaign.name,
          error: err instanceof Error ? err.message : "Failed to load",
        },
      }));
    }
  }

  if (campaigns.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        No campaigns meet the minimum threshold (10+ sends) for this period
      </p>
    );
  }

  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    "px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground",
                    col.sortable && "cursor-pointer select-none hover:text-foreground",
                  )}
                  onClick={col.sortable ? () => handleSort(col.key) : undefined}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {col.sortable && sort === col.key && (
                      order === "desc" ? (
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
            {campaigns.map((c) => {
              const isExpanded = expandedId === c.id;
              const cached = stepsCache[c.id];

              return (
                <Fragment key={c.id}>
                  {/* Main row */}
                  <tr
                    className={cn(
                      "border-b cursor-pointer transition-colors hover:bg-muted/30",
                      isExpanded && "bg-muted/20",
                    )}
                    onClick={() => void handleExpand(c)}
                  >
                    <td className="px-4 py-3 font-medium max-w-[240px] truncate">
                      {c.name}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{c.workspace}</td>
                    <td className="px-4 py-3">
                      <ChannelBadge channels={c.channels} />
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {c.sent.toLocaleString()}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-3 tabular-nums font-medium",
                        rateColor(c.replyRate, "reply"),
                      )}
                    >
                      {c.replyRate.toFixed(1)}%
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {c.openRate.toFixed(1)}%
                    </td>
                    <td
                      className={cn(
                        "px-4 py-3 tabular-nums",
                        rateColor(c.bounceRate, "bounce"),
                      )}
                    >
                      {c.bounceRate.toFixed(1)}%
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {c.interestedRate.toFixed(1)}%
                    </td>
                  </tr>

                  {/* Expanded sub-row */}
                  {isExpanded && (
                    <tr className="border-b bg-muted/10">
                      <td colSpan={8} className="px-6 py-4">
                        {cached?.loading && (
                          <div className="flex items-center justify-center py-6">
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                            <span className="ml-2 text-sm text-muted-foreground">
                              Loading step analytics...
                            </span>
                          </div>
                        )}
                        {cached?.error && (
                          <p className="text-sm text-red-500 py-4 text-center">
                            {cached.error}
                          </p>
                        )}
                        {cached?.data && (
                          <StepAnalyticsChart
                            steps={cached.data}
                            campaignName={cached.campaignName}
                          />
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

