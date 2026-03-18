import { notFound } from "next/navigation";
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
import { ConnectButton } from "@/components/linkedin/connect-button";
import { AddAccountButton } from "@/components/linkedin/add-account-button";
import { EmptyState } from "@/components/ui/empty-state";
import { MetricCard } from "@/components/dashboard/metric-card";
import { HealthStatusBadge } from "@/components/portal/health-status-badge";
import { LinkedinIcon, AlertTriangle } from "lucide-react";

interface LinkedInPageProps {
  params: Promise<{ slug: string }>;
}

export default async function LinkedInPage({ params }: LinkedInPageProps) {
  const { slug } = await params;

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    include: {
      senders: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!workspace) notFound();

  const senderIds = workspace.senders.map((s) => s.id);

  // Get today's usage per sender
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const dailyUsage = senderIds.length > 0
    ? await prisma.linkedInDailyUsage.findMany({
        where: {
          senderId: { in: senderIds },
          date: todayStart,
        },
      })
    : [];

  const usageMap = new Map(dailyUsage.map((u) => [u.senderId, u]));

  // Fetch last 7 days of usage for sparklines
  const sevenDaysAgo = new Date(todayStart);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

  const weeklyUsage = senderIds.length > 0
    ? await prisma.linkedInDailyUsage.findMany({
        where: {
          senderId: { in: senderIds },
          date: { gte: sevenDaysAgo, lte: todayStart },
        },
        orderBy: { date: "asc" },
      })
    : [];

  // Aggregate by date across all senders
  const dateMap = new Map<string, { connections: number; messages: number; views: number }>();
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
    .map(([, vals]) => vals);

  const connectionsSparkline = chartData.map((d) => d.connections);
  const messagesSparkline = chartData.map((d) => d.messages);
  const viewsSparkline = chartData.map((d) => d.views);

  const totalConnections = chartData.reduce((sum, d) => sum + d.connections, 0);
  const totalMessages = chartData.reduce((sum, d) => sum + d.messages, 0);
  const totalViews = chartData.reduce((sum, d) => sum + d.views, 0);

  const statusVariant: Record<string, "secondary" | "success" | "warning" | "destructive"> = {
    setup: "secondary",
    active: "success",
    paused: "warning",
    disabled: "destructive",
  };

  const hasExpiredSessions = workspace.senders.some(
    (s) => s.sessionStatus === "expired",
  );

  return (
    <div className="space-y-6">
      {/* Session expired alert */}
      {hasExpiredSessions && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950 px-4 py-3 flex items-center gap-3">
          <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 shrink-0" />
          <p className="text-sm text-yellow-800 dark:text-yellow-200">
            One or more LinkedIn sessions have expired. Reconnect to resume outreach.
          </p>
        </div>
      )}

      {workspace.senders.length === 0 ? (
        <EmptyState
          icon={LinkedinIcon}
          title="No LinkedIn senders configured"
          description="Add a LinkedIn account to start sending connection requests and messages."
        />
      ) : (
        <>
          {/* 7-Day Activity Metrics */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              7-Day Activity
            </p>
            <div className="grid grid-cols-3 gap-4">
              <MetricCard
                label="Connections Sent"
                value={totalConnections.toLocaleString()}
                sparklineData={connectionsSparkline}
                sparklineColor="#635BFF"
                density="compact"
                icon="UserPlus"
              />
              <MetricCard
                label="Messages Sent"
                value={totalMessages.toLocaleString()}
                sparklineData={messagesSparkline}
                sparklineColor="#635BFF"
                density="compact"
                icon="MessageSquare"
              />
              <MetricCard
                label="Profile Views"
                value={totalViews.toLocaleString()}
                sparklineData={viewsSparkline}
                sparklineColor="#635BFF"
                density="compact"
                icon="Eye"
              />
            </div>
          </div>

          {/* Senders Table */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="font-heading">Senders</CardTitle>
              <AddAccountButton workspaceSlug={slug} />
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted">
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Health</TableHead>
                    <TableHead>Warmup</TableHead>
                    <TableHead className="text-right">Connections</TableHead>
                    <TableHead className="text-right">Messages</TableHead>
                    <TableHead className="text-right">Views</TableHead>
                    <TableHead>Session</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {workspace.senders.map((sender) => {
                    const usage = usageMap.get(sender.id);
                    return (
                      <TableRow
                        key={sender.id}
                        className="hover:bg-muted border-border"
                      >
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
                        <TableCell className="text-sm text-muted-foreground">
                          {sender.emailAddress ?? "\u2014"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={statusVariant[sender.status] ?? "secondary"}
                            className="text-xs"
                          >
                            {sender.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <HealthStatusBadge status={sender.healthStatus} />
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {sender.warmupDay > 0
                            ? `Day ${sender.warmupDay}`
                            : "Not started"}
                        </TableCell>
                        <TableCell className="text-right text-sm font-mono tabular-nums">
                          <span
                            className={
                              (usage?.connectionsSent ?? 0) >= sender.dailyConnectionLimit
                                ? "text-red-500"
                                : (usage?.connectionsSent ?? 0) >= sender.dailyConnectionLimit * 0.8
                                  ? "text-amber-500"
                                  : "text-muted-foreground"
                            }
                          >
                            {usage?.connectionsSent ?? 0}
                          </span>
                          <span className="text-muted-foreground">/{sender.dailyConnectionLimit}</span>
                        </TableCell>
                        <TableCell className="text-right text-sm font-mono tabular-nums">
                          <span
                            className={
                              (usage?.messagesSent ?? 0) >= sender.dailyMessageLimit
                                ? "text-red-500"
                                : (usage?.messagesSent ?? 0) >= sender.dailyMessageLimit * 0.8
                                  ? "text-amber-500"
                                  : "text-muted-foreground"
                            }
                          >
                            {usage?.messagesSent ?? 0}
                          </span>
                          <span className="text-muted-foreground">/{sender.dailyMessageLimit}</span>
                        </TableCell>
                        <TableCell className="text-right text-sm font-mono tabular-nums">
                          <span
                            className={
                              (usage?.profileViews ?? 0) >= sender.dailyProfileViewLimit
                                ? "text-red-500"
                                : (usage?.profileViews ?? 0) >= sender.dailyProfileViewLimit * 0.8
                                  ? "text-amber-500"
                                  : "text-muted-foreground"
                            }
                          >
                            {usage?.profileViews ?? 0}
                          </span>
                          <span className="text-muted-foreground">/{sender.dailyProfileViewLimit}</span>
                        </TableCell>
                        <TableCell>
                          <ConnectButton
                            senderId={sender.id}
                            senderName={sender.name}
                            sessionStatus={sender.sessionStatus}
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
