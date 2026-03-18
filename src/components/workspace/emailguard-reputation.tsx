"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Shield, AlertTriangle, Info } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DomainEmailGuardData {
  domain: string;
  reputation: Record<string, unknown> | null;
  context: Record<string, unknown> | null;
  nameserverReputation: Record<string, unknown> | null;
  dmarcInsights: {
    domain?: string;
    total_messages?: number;
    pass_count?: number;
    fail_count?: number;
    pass_rate?: number;
  } | null;
  dmarcSources: Array<{
    source_ip?: string;
    hostname?: string | null;
    message_count?: number;
    spf_aligned?: boolean;
    dkim_aligned?: boolean;
  }> | null;
  dmarcFailures: Array<{
    source_ip?: string;
    hostname?: string | null;
    disposition?: string;
    spf_result?: string;
    dkim_result?: string;
    message_count?: number;
  }> | null;
  lastChecked: string | null;
}

interface ApiResponse {
  available: boolean;
  domains?: DomainEmailGuardData[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EmailGuardReputation({ slug }: { slug: string }) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      try {
        const res = await fetch(`/api/workspace/${slug}/emailguard`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as ApiResponse;
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchData();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Not configured
  if (!loading && data && !data.available) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex items-center gap-3 justify-center text-muted-foreground">
            <Info className="h-5 w-5" />
            <p className="text-sm">
              EmailGuard is not configured. Set the{" "}
              <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">
                EMAILGUARD_API_TOKEN
              </code>{" "}
              environment variable to enable reputation monitoring.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Loading
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="font-heading flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Domain Reputation
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="h-6 w-6 rounded-full border-2 border-muted-foreground/30 border-t-foreground animate-spin" />
            <span className="ml-3 text-sm text-muted-foreground">
              Loading EmailGuard data...
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Error
  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="font-heading flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Domain Reputation
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-destructive py-4">
            <AlertTriangle className="h-4 w-4" />
            <p className="text-sm">{error}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const domains = data?.domains ?? [];

  if (domains.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="font-heading flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Domain Reputation
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-8">
            No domains found for this workspace
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Reputation Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Domain Reputation (EmailGuard)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {domains.map((d) => (
            <DomainReputationCard key={d.domain} data={d} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-domain card
// ---------------------------------------------------------------------------

function DomainReputationCard({ data }: { data: DomainEmailGuardData }) {
  const rep = data.reputation as Record<string, unknown> | null;
  const ctx = data.context as Record<string, unknown> | null;
  const nsRep = data.nameserverReputation as Record<string, unknown> | null;

  // Extract score/rating from reputation data (structure varies by API)
  const reputationScore =
    (rep?.score as number | undefined) ??
    (rep?.reputation_score as number | undefined) ??
    null;
  const reputationRating =
    (rep?.rating as string | undefined) ??
    (rep?.reputation as string | undefined) ??
    null;

  const nsScore =
    (nsRep?.score as number | undefined) ??
    (nsRep?.reputation_score as number | undefined) ??
    null;

  return (
    <div className="rounded-lg border border-border p-4 space-y-4">
      {/* Domain header */}
      <div className="flex items-center justify-between">
        <h4 className="font-medium text-sm">{data.domain}</h4>
        {data.lastChecked && (
          <span className="text-xs text-muted-foreground">
            Checked:{" "}
            {new Date(data.lastChecked).toLocaleString(undefined, {
              dateStyle: "short",
              timeStyle: "short",
            })}
          </span>
        )}
      </div>

      {/* Reputation scores row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Domain Reputation */}
        <div className="rounded-md bg-muted/50 p-3">
          <p className="text-xs text-muted-foreground mb-1">
            Domain Reputation
          </p>
          {reputationScore !== null ? (
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold tabular-nums">
                {reputationScore}
              </span>
              {reputationRating && (
                <Badge
                  variant={
                    reputationRating === "good" || reputationRating === "high"
                      ? "success"
                      : reputationRating === "medium" ||
                          reputationRating === "neutral"
                        ? "warning"
                        : "destructive"
                  }
                  className="text-xs capitalize"
                >
                  {reputationRating}
                </Badge>
              )}
            </div>
          ) : rep ? (
            <span className="text-sm text-muted-foreground">
              {JSON.stringify(rep).slice(0, 80)}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">--</span>
          )}
        </div>

        {/* Nameserver Reputation */}
        <div className="rounded-md bg-muted/50 p-3">
          <p className="text-xs text-muted-foreground mb-1">
            Nameserver Reputation
          </p>
          {nsScore !== null ? (
            <span className="text-lg font-semibold tabular-nums">{nsScore}</span>
          ) : nsRep ? (
            <span className="text-sm text-muted-foreground">
              {JSON.stringify(nsRep).slice(0, 80)}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">--</span>
          )}
        </div>

        {/* Domain Context */}
        <div className="rounded-md bg-muted/50 p-3">
          <p className="text-xs text-muted-foreground mb-1">Domain Context</p>
          {ctx ? (
            <span className="text-sm text-muted-foreground">
              {(ctx.context as string) ??
                (ctx.description as string) ??
                JSON.stringify(ctx).slice(0, 80)}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">--</span>
          )}
        </div>
      </div>

      {/* DMARC Insights */}
      {data.dmarcInsights && (
        <div className="space-y-2">
          <h5 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            DMARC Insights
          </h5>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-md bg-muted/50 p-2.5">
              <p className="text-xs text-muted-foreground">Total Messages</p>
              <p className="text-base font-semibold tabular-nums">
                {data.dmarcInsights.total_messages?.toLocaleString() ?? "--"}
              </p>
            </div>
            <div className="rounded-md bg-muted/50 p-2.5">
              <p className="text-xs text-muted-foreground">Pass Rate</p>
              <p className="text-base font-semibold tabular-nums">
                {data.dmarcInsights.pass_rate != null
                  ? `${(data.dmarcInsights.pass_rate * 100).toFixed(1)}%`
                  : "--"}
              </p>
            </div>
            <div className="rounded-md bg-emerald-50 dark:bg-emerald-950/30 p-2.5">
              <p className="text-xs text-muted-foreground">Passed</p>
              <p className="text-base font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                {data.dmarcInsights.pass_count?.toLocaleString() ?? "--"}
              </p>
            </div>
            <div className="rounded-md bg-red-50 dark:bg-red-950/30 p-2.5">
              <p className="text-xs text-muted-foreground">Failed</p>
              <p className="text-base font-semibold tabular-nums text-red-700 dark:text-red-400">
                {data.dmarcInsights.fail_count?.toLocaleString() ?? "--"}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* DMARC Sources */}
      {data.dmarcSources && data.dmarcSources.length > 0 && (
        <div className="space-y-2">
          <h5 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            DMARC Sources
          </h5>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="bg-muted text-xs">Source IP</TableHead>
                  <TableHead className="bg-muted text-xs">Hostname</TableHead>
                  <TableHead className="bg-muted text-xs text-right">
                    Messages
                  </TableHead>
                  <TableHead className="bg-muted text-xs">SPF</TableHead>
                  <TableHead className="bg-muted text-xs">DKIM</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.dmarcSources.slice(0, 10).map((src, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">
                      {src.source_ip ?? "--"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {src.hostname ?? "--"}
                    </TableCell>
                    <TableCell className="text-xs text-right tabular-nums">
                      {src.message_count ?? "--"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={src.spf_aligned ? "success" : "destructive"}
                        className="text-xs"
                      >
                        {src.spf_aligned ? "aligned" : "fail"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={src.dkim_aligned ? "success" : "destructive"}
                        className="text-xs"
                      >
                        {src.dkim_aligned ? "aligned" : "fail"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* DMARC Failures */}
      {data.dmarcFailures && data.dmarcFailures.length > 0 && (
        <div className="space-y-2">
          <h5 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
            DMARC Failures
          </h5>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="bg-muted text-xs">Source IP</TableHead>
                  <TableHead className="bg-muted text-xs">Hostname</TableHead>
                  <TableHead className="bg-muted text-xs">
                    Disposition
                  </TableHead>
                  <TableHead className="bg-muted text-xs">SPF</TableHead>
                  <TableHead className="bg-muted text-xs">DKIM</TableHead>
                  <TableHead className="bg-muted text-xs text-right">
                    Count
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.dmarcFailures.slice(0, 10).map((fail, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">
                      {fail.source_ip ?? "--"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fail.hostname ?? "--"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          fail.disposition === "none"
                            ? "secondary"
                            : "destructive"
                        }
                        className="text-xs capitalize"
                      >
                        {fail.disposition ?? "--"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          fail.spf_result === "pass"
                            ? "success"
                            : "destructive"
                        }
                        className="text-xs"
                      >
                        {fail.spf_result ?? "--"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          fail.dkim_result === "pass"
                            ? "success"
                            : "destructive"
                        }
                        className="text-xs"
                      >
                        {fail.dkim_result ?? "--"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-right tabular-nums">
                      {fail.message_count ?? "--"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
