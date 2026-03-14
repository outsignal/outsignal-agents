"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

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

function barColor(sent: number, limit: number): string {
  if (limit === 0) return "bg-muted";
  const pct = sent / limit;
  if (pct >= 0.85) return "bg-red-500";
  if (pct >= 0.6) return "bg-amber-500";
  return "bg-emerald-500";
}

function MiniBar({ label, sent, limit }: { label: string; sent: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, (sent / limit) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground text-[10px] w-5 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", barColor(sent, limit))}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] tabular-nums text-foreground/70 w-8 text-right">
        {sent}/{limit}
      </span>
    </div>
  );
}

export function DailyLimitsBar({
  senderId,
  initialBudget,
}: {
  senderId: string;
  initialBudget?: Budget | null;
}) {
  const [budget, setBudget] = useState<Budget | null>(initialBudget ?? null);

  useEffect(() => {
    // Skip fetch if budget was provided via props (batch mode)
    if (initialBudget !== undefined) return;
    fetch(`/api/senders/${senderId}/budget`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setBudget)
      .catch(() => {});
  }, [senderId, initialBudget]);

  if (!budget) {
    return (
      <div className="flex items-start gap-2">
        <span className="text-muted-foreground w-20 shrink-0">Limits</span>
        <span className="text-muted-foreground text-xs">Loading...</span>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2">
      <span className="text-muted-foreground w-20 shrink-0">Limits</span>
      <div className="flex-1 space-y-1 min-w-0">
        <MiniBar label="C" sent={budget.connections.sent} limit={budget.connections.limit} />
        <MiniBar label="M" sent={budget.messages.sent} limit={budget.messages.limit} />
        <MiniBar label="V" sent={budget.profileViews.sent} limit={budget.profileViews.limit} />
      </div>
    </div>
  );
}
