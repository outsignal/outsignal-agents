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
import { ShieldCheck, Activity, HeartPulse } from "lucide-react";
import type { SenderEmail } from "@/lib/emailbison/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EmailSenderRow {
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

interface DomainDnsRow {
  domain: string;
  spfStatus: string | null;
  dkimStatus: string | null;
  dmarcStatus: string | null;
  overallHealth: string;
  blacklistSeverity: string | null;
}

interface LinkedInSenderRow {
  id: string;
  name: string;
  healthStatus: string;
  sessionStatus: string;
  lastPolledAt: Date | null;
  todayConnections: number;
  todayMessages: number;
  todayViews: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeEmailHealth(sender: SenderEmail): EmailSenderRow {
  const sent = sender.emails_sent_count;
  const bounced = sender.bounced_count;
  const bounceRate = sent > 0 ? (bounced / sent) * 100 : 0;
  const replyRate = sent > 0 ? (sender.unique_replied_count / sent) * 100 : 0;

  let healthStatus: "healthy" | "warning" | "critical" = "healthy";
  if (sender.status === "Not connected") healthStatus = "critical";
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

function dnsBadgeStyle(status: string | null) {
  if (!status || status === "missing" || status === "fail")
    return "bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-200";
  return "bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200";
}

function dnsIcon(status: string | null): string {
  if (!status || status === "missing" || status === "fail") return "\u2717";
  return "\u2713";
}

function eventReasonLabel(reason: string): string {
  switch (reason) {
    case "manual":
      return "Limit Reduced";
    case "bounce_rate":
      return "Bounce Rate";
    case "step_down":
      return "Auto Recovery";
    case "blacklist":
      return "Blacklist";
    case "auto_recovered":
      return "Auto Recovery";
    case "blacklist_cleared":
      return "Blacklist Cleared";
    default:
      return reason;
  }
}

function relativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function PortalSenderHealthPage() {
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

  // ---- Workspace-level data for domain list ----
  const wsRecord = await prisma.workspace.findUnique({
    where: { slug: workspaceSlug },
    select: { senderEmailDomains: true },
  });

  // ---- Email senders from EmailBison ----
  const client = new EmailBisonClient(workspace.apiToken);
  let emailSenders: EmailSenderRow[] = [];
  let emailError: string | null = null;

  try {
    const rawSenders = await client.getSenderEmails();
    emailSenders = rawSenders.map(computeEmailHealth);
    const sortOrder = { critical: 0, warning: 1, healthy: 2 };
    emailSenders.sort((a, b) => {
      const orderDiff = sortOrder[a.healthStatus] - sortOrder[b.healthStatus];
      if (orderDiff !== 0) return orderDiff;
      return b.bounceRate - a.bounceRate;
    });
  } catch (err) {
    emailError = err instanceof Error ? err.message : "Failed to fetch sender data";
  }

  // ---- LinkedIn senders from DB ----
  const linkedinSenders = await prisma.sender.findMany({
    where: {
      workspaceSlug,
      emailBisonSenderId: null,
      OR: [{ linkedinProfileUrl: { not: null } }, { loginMethod: { not: "none" } }],
    },
    orderBy: { createdAt: "desc" },
  });

  const linkedinSenderIds = linkedinSenders.map((s) => s.id);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const dailyUsage = linkedinSenderIds.length > 0
    ? await prisma.linkedInDailyUsage.findMany({
        where: { senderId: { in: linkedinSenderIds }, date: todayStart },
      })
    : [];

  const usageMap = new Map(dailyUsage.map((u) => [u.senderId, u]));

  const linkedinRows: LinkedInSenderRow[] = linkedinSenders.map((s) => {
    const usage = usageMap.get(s.id);
    return {
      id: s.id,
      name: s.name,
      healthStatus: s.healthStatus,
      sessionStatus: s.sessionStatus,
      lastPolledAt: s.lastPolledAt,
      todayConnections: usage?.connectionsSent ?? 0,
      todayMessages: usage?.messagesSent ?? 0,
      todayViews: usage?.profileViews ?? 0,
    };
  });

  // ---- Domain health from DB ----
  // Get domains from both EmailBison senders and workspace senderEmailDomains
  const ebDomains = [
    ...new Set(emailSenders.map((s) => extractDomain(s.email)).filter(Boolean)),
  ];

  let wsDomains: string[] = [];
  if (wsRecord?.senderEmailDomains) {
    try {
      const parsed = JSON.parse(wsRecord.senderEmailDomains);
      if (Array.isArray(parsed)) wsDomains = parsed;
    } catch {}
  }

  const allDomains = [...new Set([...ebDomains, ...wsDomains])];

  const domainHealthRecords: DomainDnsRow[] =
    allDomains.length > 0
      ? await prisma.domainHealth.findMany({
          where: { domain: { in: allDomains } },
          select: {
            domain: true,
            spfStatus: true,
            dkimStatus: true,
            dmarcStatus: true,
            overallHealth: true,
            blacklistSeverity: true,
          },
        })
      : [];

  // ---- Recent health events ----
  const recentEvents = await prisma.emailHealthEvent.findMany({
    where: { workspaceSlug },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      senderEmail: true,
      reason: true,
      fromStatus: true,
      toStatus: true,
      detail: true,
      createdAt: true,
    },
  });

  // ---- Compute aggregates ----
  const totalEmailSenders = emailSenders.length;
  const disconnected = emailSenders.filter((s) => s.status === "Not connected");
  const connectedInboxes = totalEmailSenders - disconnected.length;

  const totalSent = emailSenders.reduce((sum, s) => sum + s.emailsSent, 0);
  const totalBounced = emailSenders.reduce((sum, s) => sum + s.bounced, 0);
  const avgBounceRate = totalSent > 0 ? (totalBounced / totalSent) * 100 : 0;

  const domainAuthPass = domainHealthRecords.filter(
    (d) =>
      d.spfStatus === "pass" &&
      d.dkimStatus === "pass" &&
      d.dmarcStatus === "pass",
  ).length;
  const domainAuthPassRate =
    domainHealthRecords.length > 0
      ? (domainAuthPass / domainHealthRecords.length) * 100
      : 0;

  const totalLinkedin = linkedinRows.length;
  const onlineLinkedin = linkedinRows.filter(
    (s) => s.healthStatus === "healthy" && s.sessionStatus === "active",
  ).length;

  // ---- Health score hero ----
  const criticalEmailSenders = emailSenders.filter((s) => s.healthStatus === "critical").length;
  const warningEmailSenders = emailSenders.filter((s) => s.healthStatus === "warning").length;
  const criticalDomains = domainHealthRecords.filter((d) => d.overallHealth === "critical").length;
  const warningDomains = domainHealthRecords.filter((d) => d.overallHealth === "warning").length;
  const criticalLinkedin = linkedinRows.filter(
    (s) => s.healthStatus === "blocked" || s.healthStatus === "session_expired",
  ).length;
  const warningLinkedin = linkedinRows.filter(
    (s) => s.healthStatus === "warning" || s.healthStatus === "paused",
  ).length;

  const totalSystems = totalEmailSenders + domainHealthRecords.length + totalLinkedin;
  const healthySystems =
    totalSystems -
    criticalEmailSenders -
    warningEmailSenders -
    criticalDomains -
    warningDomains -
    criticalLinkedin -
    warningLinkedin;

  const hasCritical = criticalEmailSenders > 0 || criticalDomains > 0 || criticalLinkedin > 0;
  const hasWarning = warningEmailSenders > 0 || warningDomains > 0 || warningLinkedin > 0;
  const overallStatus: "healthy" | "warning" | "critical" = hasCritical
    ? "critical"
    : hasWarning
      ? "warning"
      : "healthy";

  const statusColorMap = {
    healthy: {
      bg: "bg-emerald-50 dark:bg-emerald-950/50",
      ring: "ring-emerald-200 dark:ring-emerald-800",
      dot: "bg-emerald-500",
      text: "text-emerald-700 dark:text-emerald-400",
    },
    warning: {
      bg: "bg-amber-50 dark:bg-amber-950/50",
      ring: "ring-amber-200 dark:ring-amber-800",
      dot: "bg-amber-500",
      text: "text-amber-700 dark:text-amber-400",
    },
    critical: {
      bg: "bg-red-50 dark:bg-red-950/50",
      ring: "ring-red-200 dark:ring-red-800",
      dot: "bg-red-500",
      text: "text-red-700 dark:text-red-400",
    },
  };
  const sc = statusColorMap[overallStatus];

  const bounceTrend: "up" | "warning" | "down" =
    avgBounceRate > 5 ? "down" : avgBounceRate > 3 ? "warning" : "up";
  const bounceDetail =
    avgBounceRate < 2 ? "Healthy" : avgBounceRate < 3 ? "Elevated" : avgBounceRate <= 5 ? "Warning" : "Critical";

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-medium text-foreground">Sender Health</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Unified view of email inbox, LinkedIn account, and domain health
        </p>
      </div>

      {/* Error banner */}
      {emailError && (
        <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-4 text-sm text-red-800 dark:text-red-200">
          <p>{emailError}</p>
        </div>
      )}

      {/* A. Health Score Hero */}
      <div
        className={`rounded-xl ${sc.bg} ring-1 ${sc.ring} px-6 py-8 flex flex-col items-center justify-center text-center`}
      >
        <div className="flex items-center gap-3 mb-3">
          <span className={`inline-block h-4 w-4 rounded-full ${sc.dot} animate-pulse`} />
          <HeartPulse className={`h-6 w-6 ${sc.text}`} />
        </div>
        <p className={`text-3xl font-semibold font-mono tabular-nums ${sc.text}`}>
          {healthySystems}/{totalSystems} systems healthy
        </p>
        <p className="text-sm text-muted-foreground mt-2">
          Monitored every 12 hours
        </p>
      </div>

      {/* Disconnected inboxes alert */}
      {disconnected.length > 0 && (
        <div className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950 px-4 py-3">
          <p className="text-sm font-medium text-red-800 dark:text-red-200">
            {disconnected.length} inbox{disconnected.length !== 1 ? "es" : ""}{" "}
            disconnected -- contact your account manager to reconnect.
          </p>
        </div>
      )}

      {/* B. 4 KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Connected Inboxes"
          value={`${connectedInboxes}/${totalEmailSenders}`}
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
          detail={bounceDetail}
          density="compact"
        />
        <MetricCard
          label="Domain Auth Pass Rate"
          value={domainHealthRecords.length > 0 ? domainAuthPassRate.toFixed(0) : "--"}
          suffix={domainHealthRecords.length > 0 ? "%" : ""}
          icon="ShieldCheck"
          trend={
            domainHealthRecords.length === 0
              ? "neutral"
              : domainAuthPassRate === 100
                ? "up"
                : domainAuthPassRate >= 80
                  ? "warning"
                  : "down"
          }
          detail={
            domainHealthRecords.length === 0
              ? "No data"
              : domainAuthPassRate === 100
                ? "All passing"
                : `${domainAuthPass}/${domainHealthRecords.length} domains`
          }
          density="compact"
        />
        <MetricCard
          label="LinkedIn Accounts Online"
          value={totalLinkedin > 0 ? `${onlineLinkedin}/${totalLinkedin}` : "--"}
          icon="LinkedinIcon"
          trend={
            totalLinkedin === 0
              ? "neutral"
              : onlineLinkedin === totalLinkedin
                ? "up"
                : "warning"
          }
          detail={
            totalLinkedin === 0
              ? "None configured"
              : onlineLinkedin === totalLinkedin
                ? "All online"
                : `${totalLinkedin - onlineLinkedin} offline`
          }
          density="compact"
        />
      </div>

      {/* C. Two-section layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Email Inboxes Table */}
        <Card>
          <CardHeader>
            <CardTitle>Email Inboxes</CardTitle>
          </CardHeader>
          <CardContent>
            {emailSenders.length === 0 && !emailError ? (
              <EmptyState
                icon={ShieldCheck}
                title="No inboxes configured"
                description="Email inboxes will appear here once they are connected."
                variant="compact"
              />
            ) : emailSenders.length > 0 ? (
              <div className="max-h-[480px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted">
                      <TableHead>Email</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Sent</TableHead>
                      <TableHead className="text-right">Bounce%</TableHead>
                      <TableHead className="text-right">Reply%</TableHead>
                      <TableHead>Health</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {emailSenders.map((sender) => (
                      <TableRow key={sender.email} className="hover:bg-muted border-border">
                        <TableCell className="font-medium text-sm max-w-[200px] truncate">
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
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* Right: LinkedIn Accounts Table */}
        <Card>
          <CardHeader>
            <CardTitle>LinkedIn Accounts</CardTitle>
          </CardHeader>
          <CardContent>
            {linkedinRows.length === 0 ? (
              <EmptyState
                icon={ShieldCheck}
                title="No LinkedIn accounts"
                description="LinkedIn accounts will appear here once they are connected."
                variant="compact"
              />
            ) : (
              <div className="max-h-[480px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted">
                      <TableHead>Name</TableHead>
                      <TableHead>Health</TableHead>
                      <TableHead>Session</TableHead>
                      <TableHead>Today</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {linkedinRows.map((sender) => (
                      <TableRow key={sender.id} className="hover:bg-muted border-border">
                        <TableCell className="font-medium text-sm">
                          <div>{sender.name}</div>
                          {sender.lastPolledAt && (
                            <div className="text-[11px] text-muted-foreground">
                              Last polled {relativeTime(sender.lastPolledAt)}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={sender.healthStatus} type="health" />
                        </TableCell>
                        <TableCell>
                          <StatusBadge
                            status={
                              sender.sessionStatus === "active"
                                ? "healthy"
                                : sender.sessionStatus === "expired"
                                  ? "session_expired"
                                  : "not_connected"
                            }
                            type="health"
                          />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          <div className="space-y-0.5">
                            <div>{sender.todayConnections} connects</div>
                            <div>{sender.todayMessages} msgs</div>
                            <div>{sender.todayViews} views</div>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* D. Domain Authentication Section */}
      <Card>
        <CardHeader>
          <CardTitle>Domain Authentication</CardTitle>
        </CardHeader>
        <CardContent>
          {domainHealthRecords.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title="No domain health data"
              description="Domain DNS health records will appear here once your sending domains are checked."
              variant="compact"
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {domainHealthRecords.map((row) => (
                <div
                  key={row.domain}
                  className="rounded-lg border border-border bg-card p-4 space-y-2"
                >
                  <p className="font-mono text-sm font-medium text-foreground truncate">
                    {row.domain}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge className={`text-xs ${dnsBadgeStyle(row.spfStatus)}`}>
                      SPF {dnsIcon(row.spfStatus)}
                    </Badge>
                    <Badge className={`text-xs ${dnsBadgeStyle(row.dkimStatus)}`}>
                      DKIM {dnsIcon(row.dkimStatus)}
                    </Badge>
                    <Badge className={`text-xs ${dnsBadgeStyle(row.dmarcStatus)}`}>
                      DMARC {dnsIcon(row.dmarcStatus)}
                    </Badge>
                    {row.blacklistSeverity && row.blacklistSeverity !== "none" ? (
                      <Badge className="text-xs bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-200">
                        Blacklisted
                      </Badge>
                    ) : (
                      <Badge className="text-xs bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200">
                        Clear
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* E. Recent Health Events Timeline */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Health Events</CardTitle>
        </CardHeader>
        <CardContent>
          {recentEvents.length === 0 ? (
            <EmptyState
              icon={Activity}
              title="No recent events"
              description="Email health events will appear here when changes are detected."
              variant="compact"
            />
          ) : (
            <div className="divide-y divide-border">
              {recentEvents.map((event) => (
                <div
                  key={event.id}
                  className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" size="xs">
                        {eventReasonLabel(event.reason)}
                      </Badge>
                      <p className="text-sm font-medium text-foreground truncate">
                        {event.senderEmail}
                      </p>
                    </div>
                    {event.detail && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {event.detail}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {event.fromStatus && event.toStatus && (
                      <span className="flex items-center gap-1.5 text-xs">
                        <StatusBadge status={event.fromStatus} type="health" />
                        <span className="text-muted-foreground">{"\u2192"}</span>
                        <StatusBadge status={event.toStatus} type="health" />
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground font-mono tabular-nums ml-2">
                      {relativeTime(event.createdAt)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
