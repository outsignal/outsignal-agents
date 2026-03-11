"use client";

import Link from "next/link";
import { ShieldCheck } from "lucide-react";

export interface DeliverabilityData {
  domainsHealthy: number;
  domainsAtRisk: number;
  worstDomain: string | null;
  worstDomainHealth: string | null;
  sendersWarning: number;
  sendersCritical: number;
}

interface DeliverabilityBentoCardProps {
  data: DeliverabilityData;
  loading?: boolean;
}

function HealthChip({ health }: { health: string }) {
  const classes =
    health === "critical"
      ? "bg-red-100 text-red-700 border border-red-200"
      : "bg-amber-100 text-amber-700 border border-amber-200";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${classes}`}>
      {health}
    </span>
  );
}

export function DeliverabilityBentoCard({ data, loading }: DeliverabilityBentoCardProps) {
  const allClear = data.domainsAtRisk === 0 && data.sendersWarning === 0 && data.sendersCritical === 0;
  const sendersNeedAttention = data.sendersWarning + data.sendersCritical;

  return (
    <div className="rounded-lg border bg-card/50 p-4 h-full flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Deliverability</span>
        </div>
        <Link
          href="/deliverability"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          View details
        </Link>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        </div>
      ) : allClear ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-1 py-2">
          <ShieldCheck className="h-6 w-6 text-green-500" />
          <span className="text-sm font-medium text-green-600">All clear</span>
          <span className="text-xs text-muted-foreground">All domains and senders healthy</span>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {/* Domain stats */}
          <div className="flex items-center gap-3 text-sm">
            <span className="text-green-600 font-medium">
              {data.domainsHealthy} healthy
            </span>
            {data.domainsAtRisk > 0 && (
              <>
                <span className="text-muted-foreground">/</span>
                <span className="text-red-600 font-medium">
                  {data.domainsAtRisk} at-risk
                </span>
              </>
            )}
            <span className="text-xs text-muted-foreground">domains</span>
          </div>

          {/* Worst domain highlight */}
          {data.worstDomain && data.worstDomainHealth && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Worst:</span>
              <span className="font-mono text-foreground">{data.worstDomain}</span>
              <HealthChip health={data.worstDomainHealth} />
            </div>
          )}

          {/* Senders needing attention */}
          {sendersNeedAttention > 0 && (
            <div className="text-xs text-amber-600 font-medium">
              {sendersNeedAttention} sender{sendersNeedAttention === 1 ? "" : "s"} need attention
            </div>
          )}
        </div>
      )}
    </div>
  );
}
