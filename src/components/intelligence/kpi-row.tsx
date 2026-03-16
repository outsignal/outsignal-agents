"use client";

import {
  MessageSquareText,
  TrendingUp,
  Lightbulb,
  Trophy,
  Target,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface KpiRowProps {
  repliesCount: number | null;
  avgReplyRate: number | null;
  activeInsights: number | null;
  topWorkspace: string | null;
  interestedRate: number | null;
  loading: boolean;
}

// ---------------------------------------------------------------------------
// KPI card config
// ---------------------------------------------------------------------------

interface KpiCardDef {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  format: (value: number | string | null) => string;
  valueKey: keyof Omit<KpiRowProps, "loading">;
  subtext?: string;
}

const KPI_CARDS: KpiCardDef[] = [
  {
    label: "Total Replies",
    icon: MessageSquareText,
    valueKey: "repliesCount",
    format: (v) => (v != null ? Number(v).toLocaleString() : "--"),
    subtext: "in period",
  },
  {
    label: "Avg Reply Rate",
    icon: TrendingUp,
    valueKey: "avgReplyRate",
    format: (v) => (v != null ? `${Number(v).toFixed(1)}%` : "--"),
    subtext: "across campaigns",
  },
  {
    label: "Active Insights",
    icon: Lightbulb,
    valueKey: "activeInsights",
    format: (v) => (v != null ? String(v) : "--"),
    subtext: "pending review",
  },
  {
    label: "Top Workspace",
    icon: Trophy,
    valueKey: "topWorkspace",
    format: (v) => (v != null && v !== "" ? String(v) : "--"),
    subtext: "by reply rate",
  },
  {
    label: "Interested Rate",
    icon: Target,
    valueKey: "interestedRate",
    format: (v) => (v != null ? `${Number(v).toFixed(1)}%` : "--"),
    subtext: "of all replies",
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function KpiRow(props: KpiRowProps) {
  const { loading } = props;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
      {KPI_CARDS.map((card) => {
        const Icon = card.icon;
        const rawValue = props[card.valueKey];

        return (
          <div
            key={card.label}
            className="rounded-lg border bg-card p-4 space-y-2"
          >
            <div className="flex items-center gap-2">
              <Icon className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground font-medium">
                {card.label}
              </span>
            </div>
            {loading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <p className="text-2xl font-bold tabular-nums truncate">
                {card.format(rawValue as string | number | null)}
              </p>
            )}
            {card.subtext && !loading && (
              <p className="text-xs text-muted-foreground">{card.subtext}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
