import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
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
import { getWorkspaceBySlug } from "@/lib/workspaces";
import { EmailBisonClient } from "@/lib/emailbison/client";
import type { SenderEmail } from "@/lib/emailbison/types";

interface InboxHealthPageProps {
  params: Promise<{ slug: string }>;
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

export default async function InboxHealthPage({
  params,
}: InboxHealthPageProps) {
  const { slug } = await params;
  const workspace = await getWorkspaceBySlug(slug);
  if (!workspace) notFound();

  const client = new EmailBisonClient(workspace.apiToken);

  let senderEmails: SenderEmail[] = [];
  let error: string | null = null;

  try {
    senderEmails = await client.getSenderEmails();
  } catch (err) {
    error =
      err instanceof Error ? err.message : "Failed to fetch sender emails";
  }

  const senderHealth = computeSenderHealth(senderEmails);

  // Sort: critical first, then warning, then healthy
  const sortOrder = { critical: 0, warning: 1, healthy: 2 };
  senderHealth.sort(
    (a, b) => sortOrder[a.healthStatus] - sortOrder[b.healthStatus],
  );

  const healthy = senderHealth.filter(
    (s) => s.healthStatus === "healthy",
  ).length;
  const warning = senderHealth.filter(
    (s) => s.healthStatus === "warning",
  ).length;
  const critical = senderHealth.filter(
    (s) => s.healthStatus === "critical",
  ).length;

  const totalSentAll = senderHealth.reduce(
    (sum, s) => sum + s.emails_sent_count,
    0,
  );
  const totalBouncedAll = senderHealth.reduce(
    (sum, s) => sum + s.bounced_count,
    0,
  );
  const overallBounceRate =
    totalSentAll > 0 ? (totalBouncedAll / totalSentAll) * 100 : 0;

  const healthBadgeStyles = {
    healthy: "bg-emerald-100 text-emerald-800",
    warning: "bg-yellow-100 text-yellow-800",
    critical: "bg-red-100 text-red-800",
  };

  return (
    <div>
      <Header
        title="Inbox Health"
        description={`${workspace.name} - ${senderHealth.length} sender emails monitored`}
      />
      <div className="p-8 space-y-6">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <MetricCard label="Total Senders" value={senderHealth.length} />
          <MetricCard
            label="Overall Bounce Rate"
            value={`${overallBounceRate.toFixed(2)}%`}
            trend={
              overallBounceRate > 5
                ? "down"
                : overallBounceRate > 2
                  ? "warning"
                  : "up"
            }
          />
          <MetricCard
            label="Healthy"
            value={healthy}
            trend="up"
            detail="Bounce rate < 2%"
          />
          <MetricCard
            label="Warning"
            value={warning}
            trend={warning > 0 ? "warning" : "neutral"}
            detail="Bounce rate 2-5%"
          />
          <MetricCard
            label="Critical"
            value={critical}
            trend={critical > 0 ? "down" : "neutral"}
            detail="Bounce rate > 5%"
          />
        </div>

        {critical > 0 && (
          <div className="rounded-lg border border-red-300 bg-red-50 p-4">
            <h3 className="font-heading font-bold text-red-900">
              Action Required
            </h3>
            <p className="text-sm text-red-800 mt-1">
              {critical} sender email{critical !== 1 ? "s" : ""} ha
              {critical !== 1 ? "ve" : "s"} a bounce rate above 5%. These
              should be removed from active campaigns to protect deliverability.
            </p>
            <ul className="mt-2 space-y-1">
              {senderHealth
                .filter((s) => s.healthStatus === "critical")
                .map((s) => (
                  <li key={s.id} className="text-sm text-red-700 font-medium">
                    {s.email} - {s.computedBounceRate.toFixed(1)}% bounce rate (
                    {s.bounced_count} bounces / {s.emails_sent_count} sent)
                  </li>
                ))}
            </ul>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="font-heading">Sender Emails</CardTitle>
          </CardHeader>
          <CardContent>
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
                      {sender.tags
                        ?.map((t) => (
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
                        className={`text-xs ${sender.status === "Connected" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}
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
                        className={`text-xs ${healthBadgeStyles[sender.healthStatus]}`}
                      >
                        {sender.healthStatus}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {senderHealth.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={11}
                      className="text-center py-8 text-muted-foreground"
                    >
                      No sender emails found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
