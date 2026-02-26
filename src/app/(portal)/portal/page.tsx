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
import type { Campaign } from "@/lib/emailbison/types";

export default async function PortalDashboardPage() {
  const { workspaceSlug } = await getPortalSession();
  const workspace = await getWorkspaceBySlug(workspaceSlug);

  if (!workspace) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Your workspace is being set up. Check back soon.
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold">{workspace.name}</h1>
        <p className="text-sm text-muted-foreground mt-1">Campaign performance overview</p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Total Sent" value={totalSent.toLocaleString()} />
        <MetricCard
          label="Open Rate"
          value={`${totalSent > 0 ? ((totalOpens / totalSent) * 100).toFixed(1) : 0}%`}
        />
        <MetricCard
          label="Reply Rate"
          value={`${totalSent > 0 ? ((totalReplies / totalSent) * 100).toFixed(1) : 0}%`}
          trend={
            totalSent > 0 && (totalReplies / totalSent) * 100 > 3 ? "up" : "neutral"
          }
        />
        <MetricCard
          label="Bounce Rate"
          value={`${totalSent > 0 ? ((totalBounces / totalSent) * 100).toFixed(1) : 0}%`}
          trend={
            totalSent > 0 && (totalBounces / totalSent) * 100 > 5 ? "warning" : "neutral"
          }
        />
      </div>

      {/* LinkedIn Summary */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">LinkedIn</p>
              <p className="text-lg font-medium mt-1">
                {senderCount} sender{senderCount !== 1 ? "s" : ""} connected
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Today</p>
              <p className="text-lg font-medium mt-1">
                {todayActions} action{todayActions !== 1 ? "s" : ""}
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
                    <TableCell className="text-right">
                      {campaign.total_leads.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {sent.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {campaign.replied.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">{rRate}%</TableCell>
                  </TableRow>
                );
              })}
              {campaigns.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center py-8 text-muted-foreground"
                  >
                    No campaigns yet
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
