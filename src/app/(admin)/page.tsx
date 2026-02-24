export const dynamic = "force-dynamic";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Header } from "@/components/layout/header";
import { MetricCard } from "@/components/dashboard/metric-card";
import {
  OverviewTable,
  type WorkspaceSummary,
} from "@/components/dashboard/overview-table";
import { getAllWorkspaces, getWorkspaceBySlug } from "@/lib/workspaces";
import { EmailBisonClient } from "@/lib/emailbison/client";
import { prisma } from "@/lib/db";

async function fetchWorkspaceSummaries(): Promise<WorkspaceSummary[]> {
  const allWorkspaces = await getAllWorkspaces();
  const workspaces = allWorkspaces.filter((w) => w.hasApiToken);

  const results = await Promise.allSettled(
    workspaces.map(async (ws) => {
      const wsConfig = await getWorkspaceBySlug(ws.slug);
      if (!wsConfig) throw new Error(`Workspace not found: ${ws.slug}`);
      const client = new EmailBisonClient(wsConfig.apiToken);
      const [campaigns, senderEmails, replies] = await Promise.all([
        client.getCampaigns(),
        client.getSenderEmails(),
        client.getReplies(),
      ]);

      const activeCampaigns = campaigns.filter(
        (c) => c.status === "active",
      ).length;
      const totalLeads = campaigns.reduce(
        (sum, c) => sum + (c.total_leads ?? 0),
        0,
      );
      const totalSent = campaigns.reduce(
        (sum, c) => sum + (c.emails_sent ?? 0),
        0,
      );
      const totalReplies = campaigns.reduce(
        (sum, c) => sum + (c.replied ?? 0),
        0,
      );
      const replyRate = totalSent > 0 ? (totalReplies / totalSent) * 100 : 0;

      const totalBounces = campaigns.reduce(
        (sum, c) => sum + (c.bounced ?? 0),
        0,
      );
      const bounceRate = totalSent > 0 ? (totalBounces / totalSent) * 100 : 0;

      const flaggedSenders = senderEmails.filter((s) => {
        return s.emails_sent_count > 0 && (s.bounced_count / s.emails_sent_count) * 100 > 5;
      }).length;

      return {
        slug: ws.slug,
        name: ws.name,
        vertical: ws.vertical,
        activeCampaigns,
        totalLeads,
        replyRate,
        bounceRate,
        flaggedSenders,
      };
    }),
  );

  return results.map((result, i) => {
    if (result.status === "fulfilled") return result.value;
    return {
      slug: workspaces[i].slug,
      name: workspaces[i].name,
      vertical: workspaces[i].vertical,
      activeCampaigns: 0,
      totalLeads: 0,
      replyRate: 0,
      bounceRate: 0,
      flaggedSenders: 0,
      error: "Failed to connect",
    };
  });
}

export default async function DashboardPage() {
  const summaries = await fetchWorkspaceSummaries();
  const dbLeadCount = await prisma.lead.count();

  const totalActiveCampaigns = summaries.reduce(
    (sum, s) => sum + s.activeCampaigns,
    0,
  );
  const totalLeads = summaries.reduce((sum, s) => sum + s.totalLeads, 0);
  const avgReplyRate =
    summaries.length > 0
      ? summaries.reduce((sum, s) => sum + s.replyRate, 0) / summaries.length
      : 0;
  const totalFlagged = summaries.reduce((sum, s) => sum + s.flaggedSenders, 0);

  return (
    <div>
      <Header
        title="Dashboard"
        description={`${summaries.length} workspace${summaries.length !== 1 ? "s" : ""} connected`}
      />
      <div className="p-8 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <MetricCard
            label="Active Campaigns"
            value={totalActiveCampaigns}
          />
          <MetricCard
            label="Campaign Leads"
            value={totalLeads.toLocaleString()}
          />
          <MetricCard
            label="DB Leads"
            value={dbLeadCount.toLocaleString()}
            detail="Synced from Email Bison + Clay"
          />
          <MetricCard
            label="Avg Reply Rate"
            value={`${avgReplyRate.toFixed(1)}%`}
            trend={avgReplyRate > 3 ? "up" : avgReplyRate > 1 ? "neutral" : "down"}
          />
          <MetricCard
            label="Flagged Senders"
            value={totalFlagged}
            trend={totalFlagged > 0 ? "warning" : "neutral"}
            detail={totalFlagged > 0 ? "High bounce rate detected" : "All healthy"}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="font-heading">Workspaces</CardTitle>
          </CardHeader>
          <CardContent>
            <OverviewTable summaries={summaries} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
