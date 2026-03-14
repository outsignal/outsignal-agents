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
import { Mail } from "lucide-react";
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

// DB-sourced sender data enrichment
interface DbSenderData {
  emailBounceStatus: string;
  emailBounceStatusAt: Date | null;
  warmupDay: number | null;
  recentEventNote: string | null;
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

function recentEventToNote(reason: string): string {
  switch (reason) {
    case "manual":
      return "Daily limit reduced";
    case "bounce_rate":
      return "Status elevated";
    case "step_down":
      return "Recovering";
    case "blacklist":
      return "Blacklist detected";
    default:
      return "Status updated";
  }
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

  // ---- DB enrichment: sender health status + recent events ----
  const dbSenders = await prisma.sender.findMany({
    where: {
      workspaceSlug,
      emailAddress: { not: null },
    },
    select: {
      emailAddress: true,
      emailBounceStatus: true,
      emailBounceStatusAt: true,
      warmupDay: true,
    },
  });

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentEvents = await prisma.emailHealthEvent.findMany({
    where: { workspaceSlug },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  // Group recent events by senderEmail (most recent per sender)
  const eventBySender = new Map<string, { reason: string; createdAt: Date }>();
  for (const evt of recentEvents) {
    if (!eventBySender.has(evt.senderEmail)) {
      eventBySender.set(evt.senderEmail, {
        reason: evt.reason,
        createdAt: evt.createdAt,
      });
    }
  }

  // Build DB sender lookup
  const dbSenderMap = new Map<string, DbSenderData>();
  for (const s of dbSenders) {
    if (!s.emailAddress) continue;
    const evt = eventBySender.get(s.emailAddress);
    const isRecent = evt && evt.createdAt >= sevenDaysAgo;
    dbSenderMap.set(s.emailAddress.toLowerCase(), {
      emailBounceStatus: s.emailBounceStatus,
      emailBounceStatusAt: s.emailBounceStatusAt,
      warmupDay: s.warmupDay,
      recentEventNote: isRecent ? recentEventToNote(evt.reason) : null,
    });
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

  const healthBadgeStyles = {
    healthy: "bg-emerald-100 text-emerald-800",
    elevated: "bg-blue-100 text-blue-800",
    warning: "bg-yellow-100 text-yellow-800",
    critical: "bg-red-100 text-red-800",
  };

  // DB bounce status badge styles (includes "elevated" from DB model)
  const emailBounceStatusStyles: Record<string, string> = {
    healthy: "bg-emerald-100 text-emerald-800",
    elevated: "bg-blue-100 text-blue-800",
    warning: "bg-yellow-100 text-yellow-800",
    critical: "bg-red-100 text-red-800",
  };

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
        <h1 className="text-2xl font-heading font-bold">Email Health</h1>
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
        <div className="rounded-lg border border-red-300 bg-red-50 p-4">
          <h3 className="font-heading font-bold text-red-900">
            {disconnected.length} inbox{disconnected.length !== 1 ? "es" : ""}{" "}
            disconnected
          </h3>
          <p className="text-sm text-red-800 mt-1">
            These inboxes are no longer connected and cannot send emails.
            Contact your Outsignal account manager to reconnect them.
          </p>
          <ul className="mt-2 space-y-1">
            {disconnected.map((s) => (
              <li key={s.email} className="text-sm text-red-700 font-medium">
                {s.email}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* KPI Cards */}
      {!error && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <MetricCard
            label="Connected Inboxes"
            value={`${connected}/${totalSenders}`}
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
            value={`${avgBounceRate.toFixed(2)}%`}
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
            value={`${avgReplyRate.toFixed(2)}%`}
            trend={avgReplyRate > 1 ? "up" : "neutral"}
            density="compact"
          />
        </div>
      )}

      {/* Domain Health (DNS badges) */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading">Domain Health</CardTitle>
        </CardHeader>
        <CardContent>
          {domainHealthRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
                <Mail className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">No domain health data</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                Domain DNS health records will appear here once your sending domains are checked.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Domain</TableHead>
                  <TableHead>SPF</TableHead>
                  <TableHead>DKIM</TableHead>
                  <TableHead>DMARC</TableHead>
                  <TableHead>Overall</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {domainHealthRows.map((row) => (
                  <TableRow key={row.domain}>
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
                      <Badge
                        className={`text-xs ${
                          row.overallHealth === "healthy"
                            ? "bg-emerald-100 text-emerald-800"
                            : row.overallHealth === "warning"
                              ? "bg-yellow-100 text-yellow-800"
                              : row.overallHealth === "critical"
                                ? "bg-red-100 text-red-800"
                                : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {row.overallHealth}
                      </Badge>
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
          <CardTitle className="font-heading">Sender Health</CardTitle>
        </CardHeader>
        <CardContent>
          {senders.length === 0 && !error ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
                <Mail className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">No senders configured</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                Sender inboxes will appear here once they are connected to your
                workspace.
              </p>
            </div>
          ) : senders.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Sent</TableHead>
                  <TableHead className="text-right">Bounces</TableHead>
                  <TableHead className="text-right">Bounce %</TableHead>
                  <TableHead className="text-right">Replies</TableHead>
                  <TableHead className="text-right">Reply %</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead>Bounce Status</TableHead>
                  <TableHead>Recent</TableHead>
                  <TableHead className="text-right">Warmup Day</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {senders.map((sender) => {
                  const dbData = dbSenderMap.get(sender.email.toLowerCase());
                  const emailBounceStatus = dbData?.emailBounceStatus ?? null;
                  return (
                    <TableRow key={sender.email}>
                      <TableCell className="font-medium text-sm">
                        {sender.email}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={`text-xs ${
                            sender.status === "Connected"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-red-100 text-red-800"
                          }`}
                        >
                          {sender.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {sender.emailsSent.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {sender.bounced.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
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
                      <TableCell className="text-right tabular-nums">
                        {sender.replies.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {sender.replyRate.toFixed(1)}%
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={`text-xs ${healthBadgeStyles[sender.healthStatus]}`}
                        >
                          {sender.healthStatus}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {emailBounceStatus ? (
                          <Badge
                            className={`text-xs ${emailBounceStatusStyles[emailBounceStatus] ?? "bg-gray-100 text-gray-600"}`}
                          >
                            {emailBounceStatus}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {dbData?.recentEventNote ? (
                          <span className="text-xs text-muted-foreground">
                            {dbData.recentEventNote}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {dbData?.warmupDay != null ? (
                          <span className="text-xs">{dbData.warmupDay}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
