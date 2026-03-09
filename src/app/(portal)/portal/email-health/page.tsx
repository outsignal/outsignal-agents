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

export default async function PortalEmailHealthPage() {
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
    warning: "bg-yellow-100 text-yellow-800",
    critical: "bg-red-100 text-red-800",
  };

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
                </TableRow>
              </TableHeader>
              <TableBody>
                {senders.map((sender) => (
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
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
