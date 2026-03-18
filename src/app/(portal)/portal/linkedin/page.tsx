import { redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal-session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { prisma } from "@/lib/db";
import { PortalConnectButton } from "@/components/portal/linkedin-connect-button";
import { AddAccountButton } from "@/components/linkedin/add-account-button";
import { EmptyState } from "@/components/ui/empty-state";
import { PortalRefreshButton } from "@/components/portal/portal-refresh-button";
import { MetricCard } from "@/components/dashboard/metric-card";
import { HealthStatusBadge } from "@/components/portal/health-status-badge";
import { LinkedinIcon, Clock, AlertTriangle } from "lucide-react";

export default async function PortalLinkedInPage() {
  let session;
  try {
    session = await getPortalSession();
  } catch {
    redirect("/portal/login");
  }
  const { workspaceSlug } = session;

  const senders = await prisma.sender.findMany({
    where: { workspaceSlug, OR: [{ linkedinProfileUrl: { not: null } }, { loginMethod: { not: "none" } }] },
    orderBy: { createdAt: "desc" },
  });

  const senderIds = senders.map((s) => s.id);

  // Get today's usage per sender
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const dailyUsage = await prisma.linkedInDailyUsage.findMany({
    where: {
      senderId: { in: senderIds },
      date: todayStart,
    },
  });

  const usageMap = new Map(dailyUsage.map((u) => [u.senderId, u]));

  // Fetch last 7 days of usage for the trend chart
  const sevenDaysAgo = new Date(todayStart);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

  const weeklyUsage = await prisma.linkedInDailyUsage.findMany({
    where: {
      senderId: { in: senderIds },
      date: { gte: sevenDaysAgo, lte: todayStart },
    },
    orderBy: { date: "asc" },
  });

  // Aggregate by date across all senders
  const dateMap = new Map<
    string,
    { connections: number; messages: number; views: number }
  >();

  // Initialize all 7 days
  for (let i = 0; i < 7; i++) {
    const d = new Date(sevenDaysAgo);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    dateMap.set(key, { connections: 0, messages: 0, views: 0 });
  }

  for (const row of weeklyUsage) {
    const key = row.date.toISOString().slice(0, 10);
    const existing = dateMap.get(key) ?? { connections: 0, messages: 0, views: 0 };
    existing.connections += row.connectionsSent;
    existing.messages += row.messagesSent;
    existing.views += row.profileViews;
    dateMap.set(key, existing);
  }

  const chartData = Array.from(dateMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, vals]) => ({ date, ...vals }));

  const connectionsSparkline = chartData.map(d => d.connections);
  const messagesSparkline = chartData.map(d => d.messages);
  const viewsSparkline = chartData.map(d => d.views);

  const totalConnections = chartData.reduce((sum, d) => sum + d.connections, 0);
  const totalMessages = chartData.reduce((sum, d) => sum + d.messages, 0);
  const totalViews = chartData.reduce((sum, d) => sum + d.views, 0);

  const now = new Date();

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-heading font-medium text-foreground">LinkedIn</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your LinkedIn senders and connections
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            Updated{" "}
            {now.toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
          <PortalRefreshButton />
        </div>
      </div>

      {senders.some(s => s.sessionStatus === "expired") && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950 px-4 py-3 flex items-center gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <p className="text-sm text-amber-800 dark:text-amber-200">
            Your LinkedIn session has expired. Please reconnect to continue outreach.
          </p>
        </div>
      )}

      {senders.length === 0 ? (
        <EmptyState
          icon={LinkedinIcon}
          title="No LinkedIn accounts connected"
          description="To add LinkedIn senders to your account, please contact your account manager."
        />
      ) : (
        <>
          {/* 7-Day Activity */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">7-Day Activity</p>
            <div className="grid grid-cols-3 gap-4">
              <MetricCard label="Connections Sent" value={totalConnections.toLocaleString()} sparklineData={connectionsSparkline} sparklineColor="#635BFF" density="compact" icon="UserPlus" />
              <MetricCard label="Messages Sent" value={totalMessages.toLocaleString()} sparklineData={messagesSparkline} sparklineColor="#635BFF" density="compact" icon="MessageSquare" />
              <MetricCard label="Profile Views" value={totalViews.toLocaleString()} sparklineData={viewsSparkline} sparklineColor="#635BFF" density="compact" icon="Eye" />
            </div>
          </div>

          {/* Senders Table */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="font-heading">Senders</CardTitle>
              <AddAccountButton workspaceSlug={workspaceSlug} />
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted">
                    <TableHead>Name</TableHead>
                    <TableHead>Health</TableHead>
                    <TableHead className="text-right">Connections</TableHead>
                    <TableHead className="text-right">Messages</TableHead>
                    <TableHead className="text-right">Views</TableHead>
                    <TableHead>Session</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {senders.map((sender) => {
                    const usage = usageMap.get(sender.id);
                    return (
                      <TableRow key={sender.id} className="hover:bg-muted border-border">
                        <TableCell className="font-medium">
                          {sender.name}
                          {sender.linkedinProfileUrl && (
                            <a
                              href={sender.linkedinProfileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ml-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                            >
                              Profile
                            </a>
                          )}
                        </TableCell>
                        <TableCell>
                          <HealthStatusBadge
                            status={sender.healthStatus}
                          />
                        </TableCell>
                        <TableCell className="text-right text-sm font-mono tabular-nums">
                          <span className={
                            (usage?.connectionsSent ?? 0) >= sender.dailyConnectionLimit
                              ? "text-red-500"
                              : (usage?.connectionsSent ?? 0) >= sender.dailyConnectionLimit * 0.8
                                ? "text-amber-500"
                                : "text-muted-foreground"
                          }>
                            {usage?.connectionsSent ?? 0}
                          </span>
                          <span className="text-muted-foreground">/{sender.dailyConnectionLimit}</span>
                        </TableCell>
                        <TableCell className="text-right text-sm font-mono tabular-nums">
                          <span className={
                            (usage?.messagesSent ?? 0) >= sender.dailyMessageLimit
                              ? "text-red-500"
                              : (usage?.messagesSent ?? 0) >= sender.dailyMessageLimit * 0.8
                                ? "text-amber-500"
                                : "text-muted-foreground"
                          }>
                            {usage?.messagesSent ?? 0}
                          </span>
                          <span className="text-muted-foreground">/{sender.dailyMessageLimit}</span>
                        </TableCell>
                        <TableCell className="text-right text-sm font-mono tabular-nums">
                          <span className={
                            (usage?.profileViews ?? 0) >= sender.dailyProfileViewLimit
                              ? "text-red-500"
                              : (usage?.profileViews ?? 0) >= sender.dailyProfileViewLimit * 0.8
                                ? "text-amber-500"
                                : "text-muted-foreground"
                          }>
                            {usage?.profileViews ?? 0}
                          </span>
                          <span className="text-muted-foreground">/{sender.dailyProfileViewLimit}</span>
                        </TableCell>
                        <TableCell>
                          <PortalConnectButton
                            senderId={sender.id}
                            senderName={sender.name}
                            sessionStatus={sender.sessionStatus}
                            hasProxy={!!sender.proxyUrl}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
