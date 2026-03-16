"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DomainData {
  domain: string;
  spfStatus: string;
  dkimStatus: string;
  dkimSelectors: string[];
  dmarcStatus: string;
  dmarcPolicy: string | null;
  blacklistHits: string[];
  blacklistSeverity: string | null;
  overallHealth: string;
  lastDnsCheck: string | null;
  lastBlacklistCheck: string | null;
  activeSenderCount: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return "Never";
  const date = new Date(isoString);
  const diffMs = Date.now() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) return `${diffDays}d ago`;
  if (diffHours > 0) return `${diffHours}h ago`;
  if (diffMinutes > 0) return `${diffMinutes}m ago`;
  return "just now";
}

function getDnsBadgeClass(status: string): string {
  switch (status) {
    case "pass":
      return "bg-emerald-100 text-emerald-800 border-emerald-200";
    case "partial":
      return "bg-yellow-100 text-yellow-800 border-yellow-200";
    case "fail":
    case "missing":
      return "bg-red-100 text-red-800 border-red-200";
    default:
      return "bg-gray-100 text-gray-600 border-gray-200";
  }
}

function getHealthChipClass(health: string): string {
  switch (health) {
    case "healthy":
      return "bg-emerald-100 text-emerald-800 border-emerald-200";
    case "warning":
      return "bg-amber-100 text-amber-800 border-amber-200";
    case "critical":
      return "bg-red-100 text-red-800 border-red-200";
    default:
      return "bg-gray-100 text-gray-600 border-gray-200";
  }
}

// ---------------------------------------------------------------------------
// Domain Health Card
// ---------------------------------------------------------------------------

function DomainCard({ domain }: { domain: DomainData }) {
  const hasBlacklistHits = domain.blacklistHits.length > 0;
  const lastChecked = domain.lastDnsCheck ?? domain.lastBlacklistCheck;

  return (
    <Card className="flex flex-col gap-0">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-medium truncate" title={domain.domain}>
            {domain.domain}
          </CardTitle>
          <span
            className={cn(
              "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize",
              getHealthChipClass(domain.overallHealth),
            )}
          >
            {domain.overallHealth}
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 pt-0">
        {/* DNS badges */}
        <div className="flex flex-wrap gap-1.5">
          <span
            className={cn(
              "rounded border px-2 py-0.5 text-xs font-medium",
              getDnsBadgeClass(domain.spfStatus),
            )}
          >
            SPF {domain.spfStatus}
          </span>
          <span
            className={cn(
              "rounded border px-2 py-0.5 text-xs font-medium",
              getDnsBadgeClass(domain.dkimStatus),
            )}
          >
            DKIM {domain.dkimStatus}
          </span>
          <span
            className={cn(
              "rounded border px-2 py-0.5 text-xs font-medium",
              getDnsBadgeClass(domain.dmarcStatus),
            )}
          >
            DMARC {domain.dmarcStatus}
          </span>
        </div>

        {/* Blacklist status */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Blacklists</span>
          {hasBlacklistHits ? (
            <span className="rounded-full border border-red-200 bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-800">
              {domain.blacklistHits.length}{" "}
              {domain.blacklistHits.length === 1 ? "blacklist" : "blacklists"}
            </span>
          ) : (
            <span className="rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800">
              Clear
            </span>
          )}
        </div>

        {/* Active senders */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Active senders</span>
          <span className="text-xs font-medium">
            {domain.activeSenderCount}{" "}
            {domain.activeSenderCount === 1 ? "sender" : "senders"}
          </span>
        </div>

        {/* Last checked */}
        <div className="flex items-center justify-between border-t border-border/50 pt-2">
          <span className="text-[10px] text-muted-foreground">Last checked</span>
          <span className="text-[10px] text-muted-foreground">
            {formatRelativeTime(lastChecked)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Domain Health Cards Grid
// ---------------------------------------------------------------------------

interface DomainHealthCardsProps {
  domains: DomainData[];
}

export function DomainHealthCards({ domains }: DomainHealthCardsProps) {
  if (domains.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-muted-foreground">No domains found</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {domains.map((domain) => (
        <DomainCard key={domain.domain} domain={domain} />
      ))}
    </div>
  );
}
