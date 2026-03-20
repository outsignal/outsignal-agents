import { redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal-session";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/dashboard/metric-card";
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
import { ShieldCheck, Activity } from "lucide-react";

export default async function PortalDeliverabilityPage() {
  let session;
  try {
    session = await getPortalSession();
  } catch {
    redirect("/portal/login");
  }
  const { workspaceSlug } = session;

  const workspace = await prisma.workspace.findUnique({
    where: { slug: workspaceSlug },
    select: { senderEmailDomains: true },
  });

  // Parse senderEmailDomains JSON string
  let sendingDomains: string[] = [];
  if (workspace?.senderEmailDomains) {
    try {
      const parsed = JSON.parse(workspace.senderEmailDomains);
      if (Array.isArray(parsed)) sendingDomains = parsed;
    } catch {
      // Not valid JSON, ignore
    }
  }

  // Fetch domain health records (includes blacklist data)
  const domainHealthRecords = sendingDomains.length > 0
    ? await prisma.domainHealth.findMany({
        where: { domain: { in: sendingDomains } },
        select: {
          domain: true,
          spfStatus: true,
          dkimStatus: true,
          dmarcStatus: true,
          overallHealth: true,
          blacklistHits: true,
          blacklistSeverity: true,
          lastBlacklistCheck: true,
          lastDnsCheck: true,
        },
      })
    : [];

  // Fetch recent health events for this workspace
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
      createdAt: true,
    },
  });

  // Compute aggregates
  const totalDomains = sendingDomains.length;
  const healthyDomains = domainHealthRecords.filter(
    (d) => d.overallHealth === "healthy",
  ).length;
  const criticalDomains = domainHealthRecords.filter(
    (d) => d.overallHealth === "critical",
  ).length;
  const blacklistedDomains = domainHealthRecords.filter(
    (d) => d.blacklistSeverity && d.blacklistSeverity !== "none",
  ).length;

  function dnsBadgeStyle(status: string | null) {
    if (!status || status === "missing" || status === "fail")
      return "bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-200";
    if (status === "partial") return "bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-200";
    return "bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200";
  }

  function dnsLabel(status: string | null, prefix: string) {
    if (!status || status === "missing") return `${prefix} \u2717`;
    if (status === "fail") return `${prefix} \u2717`;
    if (status === "partial") return `${prefix} ~`;
    return `${prefix} \u2713`;
  }

  function eventReasonLabel(reason: string): string {
    switch (reason) {
      case "manual":
        return "Daily limit reduced";
      case "bounce_rate":
        return "Bounce rate elevated";
      case "step_down":
        return "Step-down recovery";
      case "blacklist":
        return "Blacklist detected";
      default:
        return reason;
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-medium text-foreground">Deliverability</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Email deliverability health, DNS authentication, and blacklist monitoring
        </p>
      </div>

      {totalDomains === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No sending domains configured"
          description="Deliverability data will appear here once your sending domains are set up. Contact your Outsignal account manager."
        />
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              label="Sending Domains"
              value={totalDomains.toString()}
              icon="Mail"
              density="compact"
            />
            <MetricCard
              label="Healthy Domains"
              value={`${healthyDomains}/${totalDomains}`}
              icon="ShieldCheck"
              trend={healthyDomains === totalDomains ? "up" : "warning"}
              detail={healthyDomains === totalDomains ? "All healthy" : `${criticalDomains} need attention`}
              density="compact"
            />
            <MetricCard
              label="DNS Authentication"
              value={domainHealthRecords.length > 0 ? `${domainHealthRecords.length} checked` : "Pending"}
              icon="Activity"
              density="compact"
            />
            <MetricCard
              label="Blacklist Status"
              value={blacklistedDomains === 0 ? "Clear" : `${blacklistedDomains} listed`}
              icon="AlertTriangle"
              trend={blacklistedDomains === 0 ? "up" : "down"}
              detail={blacklistedDomains === 0 ? "No listings" : "Action needed"}
              density="compact"
            />
          </div>

          {/* Domain DNS Health Table */}
          <Card>
            <CardHeader>
              <CardTitle className="font-heading">Domain Authentication</CardTitle>
            </CardHeader>
            <CardContent>
              {domainHealthRecords.length === 0 ? (
                <EmptyState
                  icon={ShieldCheck}
                  title="DNS checks pending"
                  description="Domain authentication records will appear here once your sending domains are checked."
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
                      <TableHead>Blacklist</TableHead>
                      <TableHead>Overall</TableHead>
                      <TableHead>Last Checked</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {domainHealthRecords.map((row) => (
                      <TableRow key={row.domain} className="hover:bg-muted border-border">
                        <TableCell className="font-mono text-sm font-medium">
                          {row.domain}
                        </TableCell>
                        <TableCell>
                          <Badge className={`text-xs ${dnsBadgeStyle(row.spfStatus)}`}>
                            {dnsLabel(row.spfStatus, "SPF")}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={`text-xs ${dnsBadgeStyle(row.dkimStatus)}`}>
                            {dnsLabel(row.dkimStatus, "DKIM")}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={`text-xs ${dnsBadgeStyle(row.dmarcStatus)}`}>
                            {dnsLabel(row.dmarcStatus, "DMARC")}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {row.blacklistSeverity && row.blacklistSeverity !== "none" ? (
                            <Badge className="text-xs bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-200">
                              Listed
                            </Badge>
                          ) : (
                            <Badge className="text-xs bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200">
                              Clear
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={row.overallHealth} type="health" />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono tabular-nums">
                          {row.lastDnsCheck
                            ? row.lastDnsCheck.toLocaleDateString("en-GB", {
                                day: "numeric",
                                month: "short",
                              })
                            : "\u2014"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Recent Health Events */}
          <Card>
            <CardHeader>
              <CardTitle className="font-heading">Recent Health Events</CardTitle>
            </CardHeader>
            <CardContent>
              {recentEvents.length === 0 ? (
                <EmptyState
                  icon={Activity}
                  title="No recent events"
                  description="Email health events will appear here when changes are detected in your email inboxes."
                  variant="compact"
                />
              ) : (
                <div className="divide-y divide-border">
                  {recentEvents.map((event) => (
                    <div key={event.id} className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground">
                          {eventReasonLabel(event.reason)}
                        </p>
                        <p className="text-xs text-muted-foreground font-mono truncate">
                          {event.senderEmail}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {event.fromStatus && event.toStatus && (
                          <span className="text-xs text-muted-foreground">
                            {event.fromStatus} {"\u2192"} {event.toStatus}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground font-mono tabular-nums">
                          {event.createdAt.toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                          })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
