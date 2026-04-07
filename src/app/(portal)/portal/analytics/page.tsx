import { redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal-session";
import { getWorkspaceBySlug } from "@/lib/workspaces";
import { EmailBisonClient } from "@/lib/emailbison/client";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/dashboard/metric-card";
import { EmptyState } from "@/components/ui/empty-state";
import { BarChart3 } from "lucide-react";

export default async function PortalAnalyticsPage() {
  let session;
  try {
    session = await getPortalSession();
  } catch {
    redirect("/portal/login");
  }
  const { workspaceSlug } = session;

  // Fetch key metrics
  const [totalPeople, totalReplies, interestedReplies, totalCampaigns] =
    await Promise.all([
      prisma.personWorkspace.count({
        where: { workspace: workspaceSlug },
      }),
      prisma.reply.count({
        where: { workspaceSlug, direction: "inbound" },
      }),
      prisma.reply.count({
        where: { workspaceSlug, direction: "inbound", interested: true },
      }),
      prisma.campaign.count({
        where: { workspaceSlug },
      }),
    ]);

  // Recent replies (last 7 days)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentReplies = await prisma.reply.count({
    where: {
      workspaceSlug,
      direction: "inbound",
      receivedAt: { gte: sevenDaysAgo },
    },
  });

  // Fetch all-time sent count from EmailBison (source of truth for reply rate denominator)
  const workspace = await getWorkspaceBySlug(workspaceSlug);
  let totalSent = 0;
  if (workspace?.apiToken) {
    try {
      const ebClient = new EmailBisonClient(workspace.apiToken);
      const stats = await ebClient.getWorkspaceStats("2020-01-01", new Date().toISOString().slice(0, 10));
      totalSent = parseInt(stats.emails_sent, 10) || 0;
    } catch (err) {
      console.warn("[portal-analytics] Failed to fetch EB stats:", err);
    }
  }

  const replyRate = totalSent > 0 ? ((totalReplies / totalSent) * 100) : 0;
  const interestRate = totalReplies > 0 ? ((interestedReplies / totalReplies) * 100) : 0;
  const hasData = totalPeople > 0 || totalCampaigns > 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-medium text-foreground">Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Campaign performance and engagement metrics
        </p>
      </div>

      {!hasData ? (
        <EmptyState
          icon={BarChart3}
          title="No analytics data yet"
          description="Analytics will populate as your campaigns run and generate engagement data."
        />
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              label="Total Prospects"
              value={totalPeople.toLocaleString()}
              icon="Send"
              density="compact"
            />
            <MetricCard
              label="Total Replies"
              value={totalReplies.toLocaleString()}
              icon="MessageSquareText"
              trend={totalReplies > 0 ? "up" : "neutral"}
              density="compact"
            />
            <MetricCard
              label="Interested Replies"
              value={interestedReplies.toLocaleString()}
              icon="Star"
              trend={interestedReplies > 0 ? "up" : "neutral"}
              density="compact"
            />
            <MetricCard
              label="Active Campaigns"
              value={totalCampaigns.toLocaleString()}
              icon="TrendingUp"
              density="compact"
            />
          </div>

          {/* Performance Overview */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="font-heading text-base">Engagement Rates</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Reply Rate</span>
                  <div className="flex items-center gap-3">
                    <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-brand rounded-full transition-all"
                        style={{ width: `${Math.min(replyRate, 100)}%` }}
                      />
                    </div>
                    <span className="text-sm font-mono tabular-nums font-medium text-foreground w-14 text-right">
                      {replyRate.toFixed(1)}%
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Interest Rate</span>
                  <div className="flex items-center gap-3">
                    <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full transition-all"
                        style={{ width: `${Math.min(interestRate, 100)}%` }}
                      />
                    </div>
                    <span className="text-sm font-mono tabular-nums font-medium text-foreground w-14 text-right">
                      {interestRate.toFixed(1)}%
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="font-heading text-base">Recent Activity</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between py-2 border-b border-border">
                  <span className="text-sm text-muted-foreground">Replies (last 7 days)</span>
                  <span className="text-sm font-mono tabular-nums font-medium text-foreground">
                    {recentReplies.toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-border">
                  <span className="text-sm text-muted-foreground">Total prospects reached</span>
                  <span className="text-sm font-mono tabular-nums font-medium text-foreground">
                    {totalPeople.toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-muted-foreground">Interested leads</span>
                  <span className="text-sm font-mono tabular-nums font-medium text-foreground">
                    {interestedReplies.toLocaleString()}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
