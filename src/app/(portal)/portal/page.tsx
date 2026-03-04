import { getPortalSession } from "@/lib/portal-session";
import { getWorkspaceBySlug } from "@/lib/workspaces";
import { EmailBisonClient } from "@/lib/emailbison/client";
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
import { prisma } from "@/lib/db";
import { PortalRefreshButton } from "@/components/portal/portal-refresh-button";
import { Linkedin, Clock } from "lucide-react";
import type { Campaign } from "@/lib/emailbison/types";

export default async function PortalDashboardPage() {
  const { workspaceSlug } = await getPortalSession();
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

  let campaigns: Campaign[] = [];
  let error: string | null = null;

  try {
    campaigns = await client.getCampaigns();
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to fetch campaigns";
  }

  const totalSent = campaigns.reduce((sum, c) => sum + (c.emails_sent ?? 0), 0);
  const totalOpens = campaigns.reduce((sum, c) => sum + (c.unique_opens ?? 0), 0);
  const totalReplies = campaigns.reduce((sum, c) => sum + (c.replied ?? 0), 0);
  const totalBounces = campaigns.reduce((sum, c) => sum + (c.bounced ?? 0), 0);

  // LinkedIn summary
  const senderCount = await prisma.sender.count({
    where: { workspaceSlug, sessionStatus: "active" },
  });
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayActions = await prisma.linkedInAction.count({
    where: {
      workspaceSlug,
      status: "complete",
      completedAt: { gte: todayStart },
    },
  });

  const statusColors: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-800",
    paused: "bg-yellow-100 text-yellow-800",
    draft: "bg-gray-100 text-gray-800",
    completed: "bg-blue-100 text-blue-800",
  };

  const now = new Date();

  return (
    <div className="p-6 space-y-6">
      {/* Header with refresh */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold">{workspace.name}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Campaign performance overview
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            Updated {now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
          </span>
          <PortalRefreshButton />
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Total Sent"
          value={totalSent.toLocaleString()}
          density="compact"
        />
        <MetricCard
          label="Open Rate"
          value={`${totalSent > 0 ? ((totalOpens / totalSent) * 100).toFixed(1) : 0}%`}
          density="compact"
        />
        <MetricCard
          label="Reply Rate"
          value={`${totalSent > 0 ? ((totalReplies / totalSent) * 100).toFixed(1) : 0}%`}
          trend={
            totalSent > 0 && (totalReplies / totalSent) * 100 > 3 ? "up" : "neutral"
          }
          density="compact"
        />
        <MetricCard
          label="Bounce Rate"
          value={`${totalSent > 0 ? ((totalBounces / totalSent) * 100).toFixed(1) : 0}%`}
          trend={
            totalSent > 0 && (totalBounces / totalSent) * 100 > 5 ? "warning" : "neutral"
          }
          density="compact"
        />
      </div>

      {/* LinkedIn Summary */}
      <Card density="compact">
        <CardContent className="pt-4">
          <div className="flex items-center gap-2 mb-3">
            <Linkedin className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-medium">LinkedIn Overview</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-2xl font-heading font-semibold tabular-nums">
                {senderCount}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Active sender{senderCount !== 1 ? "s" : ""}
              </p>
            </div>
            <div>
              <p className="text-2xl font-heading font-semibold tabular-nums">
                {todayActions}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Action{todayActions !== 1 ? "s" : ""} today
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Campaigns Table */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading">Campaigns</CardTitle>
        </CardHeader>
        <CardContent>
          {campaigns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
                <svg
                  className="h-6 w-6 text-muted-foreground"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M21.75 9v.906a2.25 2.25 0 01-1.183 1.981l-6.478 3.488M2.25 9v.906a2.25 2.25 0 001.183 1.981l6.478 3.488m8.839 2.51l-4.66-2.51m0 0l-1.023-.55a2.25 2.25 0 00-2.134 0l-1.022.55m0 0l-4.661 2.51m16.5 1.615a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V8.844a2.25 2.25 0 011.183-1.98l7.5-4.04a2.25 2.25 0 012.134 0l7.5 4.04a2.25 2.25 0 011.183 1.98V18"
                  />
                </svg>
              </div>
              <p className="text-sm font-medium">No campaigns yet</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                Your campaigns will appear here once they are set up.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right">Sent</TableHead>
                  <TableHead className="text-right">Replies</TableHead>
                  <TableHead className="text-right">Reply Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((campaign) => {
                  const sent = campaign.emails_sent ?? 0;
                  const rRate =
                    sent > 0
                      ? ((campaign.replied / sent) * 100).toFixed(1)
                      : "0.0";
                  return (
                    <TableRow key={campaign.id}>
                      <TableCell className="font-medium">
                        {campaign.name}
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={`text-xs ${statusColors[campaign.status] ?? ""}`}
                        >
                          {campaign.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {campaign.total_leads.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {sent.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {campaign.replied.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{rRate}%</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
