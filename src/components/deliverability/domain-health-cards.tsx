"use client";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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

function dnsVariant(status: string) {
  switch (status) {
    case "pass":
      return "success" as const;
    case "partial":
      return "warning" as const;
    case "fail":
    case "missing":
      return "destructive" as const;
    default:
      return "secondary" as const;
  }
}

function healthVariant(health: string) {
  switch (health) {
    case "healthy":
      return "success" as const;
    case "warning":
      return "warning" as const;
    case "critical":
      return "destructive" as const;
    default:
      return "secondary" as const;
  }
}

// ---------------------------------------------------------------------------
// Domain Health Table
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
    <div className="rounded-lg border border-border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="bg-muted">Domain</TableHead>
            <TableHead className="bg-muted">Health</TableHead>
            <TableHead className="bg-muted">SPF</TableHead>
            <TableHead className="bg-muted">DKIM</TableHead>
            <TableHead className="bg-muted">DMARC</TableHead>
            <TableHead className="bg-muted hidden md:table-cell">Blacklists</TableHead>
            <TableHead className="bg-muted text-right">Senders</TableHead>
            <TableHead className="bg-muted hidden lg:table-cell">Last Checked</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {domains.map((d) => {
            const hasBlacklistHits = d.blacklistHits.length > 0;
            const lastChecked = d.lastDnsCheck ?? d.lastBlacklistCheck;

            return (
              <TableRow key={d.domain} className="hover:bg-muted/50 transition-colors">
                <TableCell className="font-medium">{d.domain}</TableCell>
                <TableCell>
                  <Badge variant={healthVariant(d.overallHealth)} className="text-xs capitalize">
                    {d.overallHealth}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={dnsVariant(d.spfStatus)} className="text-xs">
                    {d.spfStatus}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={dnsVariant(d.dkimStatus)} className="text-xs">
                    {d.dkimStatus}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={dnsVariant(d.dmarcStatus)} className="text-xs">
                    {d.dmarcStatus}
                  </Badge>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {hasBlacklistHits ? (
                    <Badge variant="destructive" className="text-xs">
                      {d.blacklistHits.length} {d.blacklistHits.length === 1 ? "hit" : "hits"}
                    </Badge>
                  ) : (
                    <Badge variant="success" className="text-xs">
                      Clear
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right font-mono">{d.activeSenderCount}</TableCell>
                <TableCell className="hidden lg:table-cell text-muted-foreground">
                  {formatRelativeTime(lastChecked)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
