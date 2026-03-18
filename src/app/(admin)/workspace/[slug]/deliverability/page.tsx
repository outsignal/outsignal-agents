import { notFound } from "next/navigation";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ErrorBanner } from "@/components/ui/error-banner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getWorkspaceBySlug } from "@/lib/workspaces";
import { prisma } from "@/lib/db";
import { EmailBisonClient } from "@/lib/emailbison/client";
import type { SenderEmail } from "@/lib/emailbison/types";
import { EmailGuardReputation } from "@/components/workspace/emailguard-reputation";
import { InboxPlacementTests } from "@/components/workspace/inbox-placement-tests";

interface DeliverabilityPageProps {
  params: Promise<{ slug: string }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(isoString: string | Date | null): string {
  if (!isoString) return "Never";
  const date = typeof isoString === "string" ? new Date(isoString) : isoString;
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

function dnsVariant(status: string | null) {
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

interface SenderHealth extends SenderEmail {
  computedBounceRate: number;
  computedReplyRate: number;
  healthStatus: "healthy" | "warning" | "critical";
}

function computeSenderHealth(senderEmails: SenderEmail[]): SenderHealth[] {
  return senderEmails.map((sender) => {
    const totalSent = sender.emails_sent_count;
    const totalBounces = sender.bounced_count;
    const bounceRate = totalSent > 0 ? (totalBounces / totalSent) * 100 : 0;
    const replyRate =
      totalSent > 0 ? (sender.unique_replied_count / totalSent) * 100 : 0;

    let healthStatus: "healthy" | "warning" | "critical" = "healthy";
    if (bounceRate > 5) healthStatus = "critical";
    else if (bounceRate > 2) healthStatus = "warning";

    return {
      ...sender,
      computedBounceRate: bounceRate,
      computedReplyRate: replyRate,
      healthStatus,
    };
  });
}

const healthBadgeStyles: Record<string, string> = {
  healthy: "bg-emerald-100 text-emerald-800",
  warning: "bg-yellow-100 text-yellow-800",
  critical: "bg-red-100 text-red-800",
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function WorkspaceDeliverabilityPage({
  params,
}: DeliverabilityPageProps) {
  const { slug } = await params;
  const workspace = await getWorkspaceBySlug(slug);
  if (!workspace) notFound();

  // -------------------------------------------------------------------------
  // 1. Domain Health — scoped to this workspace's sender domains
  // -------------------------------------------------------------------------

  const wsSenders = await prisma.sender.findMany({
    where: { workspaceSlug: slug, emailAddress: { not: null } },
    select: { emailAddress: true },
  });

  const wsDomains = new Set<string>();
  for (const s of wsSenders) {
    if (!s.emailAddress) continue;
    const atIdx = s.emailAddress.lastIndexOf("@");
    if (atIdx !== -1) wsDomains.add(s.emailAddress.slice(atIdx + 1));
  }

  const domainList = [...wsDomains];

  const domains =
    domainList.length > 0
      ? await prisma.domainHealth.findMany({
          where: { domain: { in: domainList } },
          orderBy: { domain: "asc" },
        })
      : [];

  // Count senders per domain
  const senderCountByDomain = new Map<string, number>();
  for (const d of domainList) senderCountByDomain.set(d, 0);
  for (const s of wsSenders) {
    if (!s.emailAddress) continue;
    const atIdx = s.emailAddress.lastIndexOf("@");
    if (atIdx === -1) continue;
    const domain = s.emailAddress.slice(atIdx + 1);
    if (senderCountByDomain.has(domain)) {
      senderCountByDomain.set(domain, (senderCountByDomain.get(domain) ?? 0) + 1);
    }
  }

  const domainData = domains.map((d) => {
    let dkimSelectors: string[] = [];
    let blacklistHits: string[] = [];
    try {
      if (d.dkimSelectors) dkimSelectors = JSON.parse(d.dkimSelectors) as string[];
    } catch { /* ignore */ }
    try {
      if (d.blacklistHits) blacklistHits = JSON.parse(d.blacklistHits) as string[];
    } catch { /* ignore */ }

    return {
      domain: d.domain,
      spfStatus: d.spfStatus,
      dkimStatus: d.dkimStatus,
      dkimSelectors,
      dmarcStatus: d.dmarcStatus,
      dmarcPolicy: d.dmarcPolicy,
      mxStatus: d.mxStatus,
      blacklistHits,
      blacklistSeverity: d.blacklistSeverity,
      overallHealth: d.overallHealth,
      lastDnsCheck: d.lastDnsCheck,
      lastBlacklistCheck: d.lastBlacklistCheck,
      activeSenderCount: senderCountByDomain.get(d.domain) ?? 0,
    };
  });

  // Domain health summary
  const domainCounts = {
    healthy: domainData.filter((d) => d.overallHealth === "healthy").length,
    warning: domainData.filter((d) => d.overallHealth === "warning").length,
    critical: domainData.filter((d) => d.overallHealth === "critical").length,
  };

  // -------------------------------------------------------------------------
  // 2. Inbox Health — from EmailBison (merged from inbox-health page)
  // -------------------------------------------------------------------------

  const client = new EmailBisonClient(workspace.apiToken);
  let senderEmails: SenderEmail[] = [];
  let emailError: string | null = null;

  try {
    senderEmails = await client.getSenderEmails();
  } catch (err) {
    emailError =
      err instanceof Error ? err.message : "Failed to fetch sender emails";
  }

  const senderHealth = computeSenderHealth(senderEmails);
  const sortOrder: Record<string, number> = { critical: 0, warning: 1, healthy: 2 };
  senderHealth.sort(
    (a, b) => (sortOrder[a.healthStatus] ?? 3) - (sortOrder[b.healthStatus] ?? 3),
  );

  const healthyCt = senderHealth.filter((s) => s.healthStatus === "healthy").length;
  const warningCt = senderHealth.filter((s) => s.healthStatus === "warning").length;
  const criticalCt = senderHealth.filter((s) => s.healthStatus === "critical").length;

  const totalSentAll = senderHealth.reduce((sum, s) => sum + s.emails_sent_count, 0);
  const totalBouncedAll = senderHealth.reduce((sum, s) => sum + s.bounced_count, 0);
  const overallBounceRate =
    totalSentAll > 0 ? (totalBouncedAll / totalSentAll) * 100 : 0;

  const bounceTrend = overallBounceRate > 5 ? "down" : overallBounceRate > 2 ? "warning" : "up";

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Deliverability</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Domain health, inbox performance, and bounce rates for {workspace.name}
        </p>
      </div>

      {emailError && <ErrorBanner message={emailError} />}

      {/* ----------------------------------------------------------------- */}
      {/* KPI cards                                                         */}
      {/* ----------------------------------------------------------------- */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Domains"
          value={domainData.length}
          icon="ShieldCheck"
          detail={
            domainCounts.critical > 0
              ? `${domainCounts.critical} critical`
              : domainCounts.warning > 0
                ? `${domainCounts.warning} warning`
                : "All healthy"
          }
          trend={
            domainCounts.critical > 0
              ? "down"
              : domainCounts.warning > 0
                ? "warning"
                : "up"
          }
        />
        <MetricCard
          label="Sender Emails"
          value={senderHealth.length}
          icon="Mail"
          detail={
            criticalCt > 0
              ? `${criticalCt} critical`
              : warningCt > 0
                ? `${warningCt} warning`
                : "All healthy"
          }
          trend={criticalCt > 0 ? "down" : warningCt > 0 ? "warning" : "up"}
        />
        <MetricCard
          label="Bounce Rate"
          value={`${overallBounceRate.toFixed(2)}%`}
          icon="Activity"
          trend={bounceTrend}
          detail={
            bounceTrend === "up"
              ? "Healthy"
              : bounceTrend === "warning"
                ? "Elevated"
                : "Critical"
          }
        />
        <MetricCard
          label="Total Sent"
          value={totalSentAll.toLocaleString()}
          icon="Send"
        />
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Critical alerts                                                   */}
      {/* ----------------------------------------------------------------- */}
      {criticalCt > 0 && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 dark:bg-red-950/30 dark:border-red-800">
          <h3 className="font-medium text-red-900 dark:text-red-300">
            Action Required
          </h3>
          <p className="text-sm text-red-800 dark:text-red-200 mt-1">
            {criticalCt} sender email{criticalCt !== 1 ? "s" : ""} ha
            {criticalCt !== 1 ? "ve" : "s"} a bounce rate above 5%. Remove from
            active campaigns to protect deliverability.
          </p>
          <ul className="mt-2 space-y-1">
            {senderHealth
              .filter((s) => s.healthStatus === "critical")
              .map((s) => (
                <li key={s.id} className="text-sm text-red-700 dark:text-red-300 font-medium">
                  {s.email} - {s.computedBounceRate.toFixed(1)}% bounce rate (
                  {s.bounced_count} bounces / {s.emails_sent_count} sent)
                </li>
              ))}
          </ul>
        </div>
      )}

      {domainCounts.critical > 0 && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 dark:bg-red-950/30 dark:border-red-800">
          <h3 className="font-medium text-red-900 dark:text-red-300">
            Domain Issues Detected
          </h3>
          <p className="text-sm text-red-800 dark:text-red-200 mt-1">
            {domainCounts.critical} domain{domainCounts.critical !== 1 ? "s" : ""}{" "}
            {domainCounts.critical !== 1 ? "have" : "has"} critical DNS or
            blacklist issues requiring attention.
          </p>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Domain Health Table                                               */}
      {/* ----------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading">Domain Health</CardTitle>
        </CardHeader>
        <CardContent>
          {domainData.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No domains found for this workspace
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="bg-muted">Domain</TableHead>
                    <TableHead className="bg-muted">Health</TableHead>
                    <TableHead className="bg-muted">SPF</TableHead>
                    <TableHead className="bg-muted">DKIM</TableHead>
                    <TableHead className="bg-muted">DMARC</TableHead>
                    <TableHead className="bg-muted">MX</TableHead>
                    <TableHead className="bg-muted hidden md:table-cell">
                      Blacklists
                    </TableHead>
                    <TableHead className="bg-muted text-right">Senders</TableHead>
                    <TableHead className="bg-muted hidden lg:table-cell">
                      Last Checked
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {domainData.map((d) => {
                    const hasBlacklistHits = d.blacklistHits.length > 0;
                    const lastChecked = d.lastDnsCheck ?? d.lastBlacklistCheck;

                    return (
                      <TableRow
                        key={d.domain}
                        className="hover:bg-muted/50 transition-colors"
                      >
                        <TableCell className="font-medium">{d.domain}</TableCell>
                        <TableCell>
                          <Badge
                            variant={healthVariant(d.overallHealth)}
                            className="text-xs capitalize"
                          >
                            {d.overallHealth}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={dnsVariant(d.spfStatus)}
                            className="text-xs"
                          >
                            {d.spfStatus ?? "unknown"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={dnsVariant(d.dkimStatus)}
                            className="text-xs"
                          >
                            {d.dkimStatus ?? "unknown"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={dnsVariant(d.dmarcStatus)}
                            className="text-xs"
                          >
                            {d.dmarcStatus ?? "unknown"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={dnsVariant(d.mxStatus)}
                            className="text-xs"
                          >
                            {d.mxStatus ?? "unknown"}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          {hasBlacklistHits ? (
                            <Badge variant="destructive" className="text-xs">
                              {d.blacklistHits.length}{" "}
                              {d.blacklistHits.length === 1 ? "hit" : "hits"}
                            </Badge>
                          ) : (
                            <Badge variant="success" className="text-xs">
                              Clear
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {d.activeSenderCount}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-muted-foreground">
                          {formatRelativeTime(lastChecked)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ----------------------------------------------------------------- */}
      {/* Inbox Health — Sender Emails Table                                */}
      {/* ----------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading">Inbox Health</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <MetricCard label="Total Senders" value={senderHealth.length} density="compact" />
            <MetricCard
              label="Overall Bounce Rate"
              value={`${overallBounceRate.toFixed(2)}%`}
              trend={bounceTrend}
              density="compact"
            />
            <MetricCard
              label="Healthy"
              value={healthyCt}
              trend="up"
              detail="< 2%"
              density="compact"
            />
            <MetricCard
              label="Warning"
              value={warningCt}
              trend={warningCt > 0 ? "warning" : "neutral"}
              detail="2-5%"
              density="compact"
            />
            <MetricCard
              label="Critical"
              value={criticalCt}
              trend={criticalCt > 0 ? "down" : "neutral"}
              detail="> 5%"
              density="compact"
            />
          </div>

          {senderHealth.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No sender emails found
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Daily Limit</TableHead>
                    <TableHead className="text-right">Total Sent</TableHead>
                    <TableHead className="text-right">Bounces</TableHead>
                    <TableHead className="text-right">Bounce Rate</TableHead>
                    <TableHead className="text-right">Replies</TableHead>
                    <TableHead className="text-right">Reply Rate</TableHead>
                    <TableHead>Health</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {senderHealth.map((sender) => (
                    <TableRow key={sender.id}>
                      <TableCell className="font-medium text-sm">
                        {sender.email}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {sender.name ?? "-"}
                      </TableCell>
                      <TableCell>
                        {sender.tags?.map((t) => (
                          <Badge
                            key={t.id}
                            variant="secondary"
                            className="text-xs"
                          >
                            {t.name}
                          </Badge>
                        ))}
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
                      <TableCell className="text-right">
                        {sender.daily_limit ?? "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        {sender.emails_sent_count.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {sender.bounced_count.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={
                            sender.healthStatus === "critical"
                              ? "text-red-600 font-bold"
                              : sender.healthStatus === "warning"
                                ? "text-amber-600 font-medium"
                                : ""
                          }
                        >
                          {sender.computedBounceRate.toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        {sender.unique_replied_count.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {sender.computedReplyRate.toFixed(1)}%
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={`text-xs ${healthBadgeStyles[sender.healthStatus] ?? ""}`}
                        >
                          {sender.healthStatus}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ----------------------------------------------------------------- */}
      {/* EmailGuard Reputation                                             */}
      {/* ----------------------------------------------------------------- */}
      <EmailGuardReputation slug={slug} />

      {/* ----------------------------------------------------------------- */}
      {/* Inbox Placement Tests                                             */}
      {/* ----------------------------------------------------------------- */}
      <InboxPlacementTests slug={slug} />
    </div>
  );
}
