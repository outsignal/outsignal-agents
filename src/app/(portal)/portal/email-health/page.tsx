import { redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal-session";
import { getWorkspaceBySlug } from "@/lib/workspaces";
import { EmailBisonClient } from "@/lib/emailbison/client";
import { prisma } from "@/lib/db";
import { MetricCard } from "@/components/dashboard/metric-card";
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
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { ShieldCheck } from "lucide-react";
import type { SenderEmail } from "@/lib/emailbison/types";

interface SenderHealthRow {
  email: string;
  name: string | undefined;
  status: string;
  emailsSent: number;
  bounced: number;
  bounceRate: number;
  replies: number;
  replyRate: number;
  healthStatus: "healthy" | "warning" | "critical";
}

// Domain DNS health data
interface DomainDnsRow {
  domain: string;
  spfStatus: string | null;
  dkimStatus: string | null;
  dmarcStatus: string | null;
  overallHealth: string;
}

function computeHealth(sender: SenderEmail): SenderHealthRow {
  const sent = sender.emails_sent_count;
  const bounced = sender.bounced_count;
  const bounceRate = sent > 0 ? (bounced / sent) * 100 : 0;
  const replyRate = sent > 0 ? (sender.unique_replied_count / sent) * 100 : 0;

  let healthStatus: "healthy" | "warning" | "critical" = "healthy";
  if (sender.status === "Disconnected") healthStatus = "critical";
  else if (bounceRate > 5) healthStatus = "critical";
  else if (bounceRate > 3) healthStatus = "warning";

  return {
    email: sender.email,
    name: sender.name,
    status: sender.status ?? "Unknown",
    emailsSent: sent,
    bounced,
    bounceRate,
    replies: sender.unique_replied_count,
    replyRate,
    healthStatus,
  };
}

function extractDomain(email: string): string {
  const parts = email.split("@");
  return parts.length === 2 ? parts[1].toLowerCase() : "";
}


export default async function PortalEmailHealthPage() {
  let session;
  try {
    session = await getPortalSession();
  } catch {
    redirect("/portal/login");
  }
  const { workspaceSlug } = session;
  const workspace = await getWorkspaceBySlug(workspaceSlug);

  if (!workspace) {
    return (
      <div className="p-6">
        <div className="text-center py-12 text-muted-foreground">
          Your workspace is being set up. Check back soon.
        </div>
      </div>
    );
  }

  const client = new EmailBisonClient(workspace.apiToken);

  let senders: SenderHealthRow[] = [];
  let error: string | null = null;

  try {
    const rawSenders = await client.getSenderEmails();
    senders = rawSenders.map(computeHealth);

    // Sort worst-first: critical > warning > healthy, then by bounce rate desc
    const sortOrder = { critical: 0, warning: 1, healthy: 2 };
    senders.sort((a, b) => {
      const orderDiff = sortOrder[a.healthStatus] - sortOrder[b.healthStatus];
      if (orderDiff !== 0) return orderDiff;
      return b.bounceRate - a.bounceRate;
    });
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to fetch sender data";
  }

  // ---- DB enrichment: domain DNS health ----
  // Extract unique sending domains from EmailBison senders
  const sendingDomains = [
    ...new Set(senders.map((s) => extractDomain(s.email)).filter(Boolean)),
  ];

  let domainHealthRows: DomainDnsRow[] = [];
  if (sendingDomains.length > 0) {
    const domainHealthRecords = await prisma.domainHealth.findMany({
      where: { domain: { in: sendingDomains } },
      select: {
        domain: true,
        spfStatus: true,
        dkimStatus: true,
        dmarcStatus: true,
        overallHealth: true,
      },
    });
    domainHealthRows = domainHealthRecords;
  }

  // Compute aggregates
  const totalSenders = senders.length;
  const disconnected = senders.filter((s) => s.status === "Disconnected");
  const connected = totalSenders - disconnected.length;
  const totalSent = senders.reduce((sum, s) => sum + s.emailsSent, 0);
  const totalBounced = senders.reduce((sum, s) => sum + s.bounced, 0);
  const totalReplies = senders.reduce((sum, s) => sum + s.replies, 0);
  const avgBounceRate = totalSent > 0 ? (totalBounced / totalSent) * 100 : 0;
  const avgReplyRate = totalSent > 0 ? (totalReplies / totalSent) * 100 : 0;

  const bounceTrend: "up" | "warning" | "down" =
    avgBounceRate > 5 ? "down" : avgBounceRate > 3 ? "warning" : "up";

  function dnsBadgeStyle(status: string | null, type: "spf" | "dkim" | "dmarc") {
    if (!status || status === "missing" || status === "fail")
      return "bg-red-100 text-red-800";
    if (type === "dkim" && status === "partial") return "bg-yellow-100 text-yellow-800";
    return "bg-emerald-100 text-emerald-800";
  }

  function dnsLabel(status: string | null, prefix: string) {
    if (!status || status === "missing") return `${prefix} \u2717`;
    if (status === "fail") return `${prefix} \u2717`;
    if (status === "partial") return `${prefix} ~`;
    return `${prefix} \u2713`;
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-medium text-foreground">Email Health</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Sender inbox health and deliverability metrics
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">
          <p>{error}</p>
        </div>
      )}

      {/* Disconnected inboxes alert */}
      {disconnected.length > 0 && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3">
          <p className="text-sm font-medium text-red-800">
            {disconnected.length} inbox{disconnected.length !== 1 ? "es" : ""} disconnected — contact your account manager to reconnect.
          </p>
        </div>
      )}

      {/* KPI Cards */}
      {!error && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <MetricCard
            label="Connected Inboxes"
            value={`${connected}/${totalSenders}`}
            icon="Mail"
            trend={disconnected.length > 0 ? "down" : "up"}
            detail={
              disconnected.length > 0
                ? `${disconnected.length} disconnected`
                : "All connected"
            }
            density="compact"
          />
          <MetricCard
            label="Avg Bounce Rate"
            value={avgBounceRate.toFixed(2)}
            suffix="%"
            icon="Activity"
            trend={bounceTrend}
            detail={
              bounceTrend === "up"
                ? "Healthy"
                : bounceTrend === "warning"
                  ? "Elevated"
                  : "Critical"
            }
            density="compact"
          />
          <MetricCard
            label="Avg Reply Rate"
            value={avgReplyRate.toFixed(2)}
            suffix="%"
            icon="Mail"
            trend={avgReplyRate > 1 ? "up" : "neutral"}
            density="compact"
          />
        </div>
      )}

      {/* Domain Health (DNS badges) */}
      <Card>
        <CardHeader>
          <CardTitle className="">Domain Health</CardTitle>
        </CardHeader>
        <CardContent>
          {domainHealthRows.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title="No domain health data"
              description="Domain DNS health records will appear here once your sending domains are checked."
              variant="compact"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted">
                  <TableHead>Domain</TableHead>
                  <TableHead>SPF</TableHead>
                  <TableHead>DKIM</TableHead>
                  <TableHead>DMARC</TableHead>
                  <TableHead>Overall</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {domainHealthRows.map((row) => (
                  <TableRow key={row.domain} className="hover:bg-muted border-border">
                    <TableCell className="font-mono text-sm font-medium">
                      {row.domain}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={`text-xs ${dnsBadgeStyle(row.spfStatus, "spf")}`}
                      >
                        {dnsLabel(row.spfStatus, "SPF")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={`text-xs ${dnsBadgeStyle(row.dkimStatus, "dkim")}`}
                      >
                        {dnsLabel(row.dkimStatus, "DKIM")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={`text-xs ${dnsBadgeStyle(row.dmarcStatus, "dmarc")}`}
                      >
                        {dnsLabel(row.dmarcStatus, "DMARC")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={row.overallHealth} type="health" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Sender Health Table */}
      <Card>
        <CardHeader>
          <CardTitle className="">Sender Health</CardTitle>
        </CardHeader>
        <CardContent>
          {senders.length === 0 && !error ? (
            <EmptyState
              icon={ShieldCheck}
              title="No senders configured"
              description="Sender inboxes will appear here once they are connected to your workspace."
              variant="compact"
            />
          ) : senders.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted">
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Sent</TableHead>
                  <TableHead className="text-right">Bounce %</TableHead>
                  <TableHead className="text-right">Reply %</TableHead>
                  <TableHead>Health</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {senders.map((sender) => (
                    <TableRow key={sender.email} className="hover:bg-muted border-border">
                      <TableCell className="font-medium text-sm">
                        {sender.email}
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          status={sender.status === "Connected" ? "healthy" : "critical"}
                          type="health"
                        />
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {sender.emailsSent.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        <span
                          className={
                            sender.healthStatus === "critical"
                              ? "text-red-600 font-bold"
                              : sender.healthStatus === "warning"
                                ? "text-amber-600 font-medium"
                                : ""
                          }
                        >
                          {sender.bounceRate.toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {sender.replyRate.toFixed(1)}%
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={sender.healthStatus} type="health" />
                      </TableCell>
                    </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
