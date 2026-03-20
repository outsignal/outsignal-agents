import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { MetricCard } from "@/components/dashboard/metric-card";
import { prisma } from "@/lib/db";
import { getWorkspaceBySlug } from "@/lib/workspaces";
import { EmailBisonClient } from "@/lib/emailbison/client";
import type { SenderEmail } from "@/lib/emailbison/types";
import { Mail } from "lucide-react";

function formatRelativeTime(date: Date | string | null): string {
  if (!date) return "Never";
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay > 0) return `${diffDay}d ago`;
  if (diffHr > 0) return `${diffHr}h ago`;
  if (diffMin > 0) return `${diffMin}m ago`;
  return "just now";
}

interface SendersPageProps {
  params: Promise<{ slug: string }>;
}

interface EmailSenderHealth extends SenderEmail {
  computedBounceRate: number;
  computedReplyRate: number;
  healthStatus: "healthy" | "warning" | "critical";
}

function computeEmailHealth(senderEmails: SenderEmail[]): EmailSenderHealth[] {
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

export default async function SendersPage({ params }: SendersPageProps) {
  const { slug } = await params;

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
  });

  if (!workspace) notFound();

  const config = await getWorkspaceBySlug(slug);
  let emailSenders: SenderEmail[] = [];
  let emailError: string | null = null;

  if (config?.apiToken) {
    try {
      const client = new EmailBisonClient(config.apiToken);
      emailSenders = await client.getSenderEmails();
    } catch (err) {
      emailError =
        err instanceof Error ? err.message : "Failed to fetch email senders";
    }
  }

  const emailSenderHealth = computeEmailHealth(emailSenders);

  const totalEmailSenders = emailSenderHealth.length;
  const connectedInboxes = emailSenderHealth.filter(
    (s) => s.status === "Connected",
  ).length;

  const healthBadgeVariant: Record<string, "success" | "warning" | "destructive"> = {
    healthy: "success",
    warning: "warning",
    critical: "destructive",
  };

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-heading font-bold">Inboxes</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Email sending inboxes for {workspace.name}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        <MetricCard label="Total Inboxes" value={totalEmailSenders} icon="Mail" />
        <MetricCard label="Connected" value={connectedInboxes} detail={totalEmailSenders>0?Math.round((connectedInboxes/totalEmailSenders)*100)+"% connected":undefined} />
        <MetricCard label="Disconnected" value={totalEmailSenders - connectedInboxes} detail={totalEmailSenders>0&&(totalEmailSenders-connectedInboxes)>0?"Needs attention":undefined} />
      </div>

      <Card>
        <CardContent className="pt-6">
          {emailError && (
            <div className="rounded-lg border border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950 p-3 mb-4">
              <p className="text-sm text-red-800 dark:text-red-200">{emailError}</p>
            </div>
          )}
          {!config?.apiToken ? (
            <div className="text-center py-8 text-muted-foreground">
              <Mail className="h-10 w-10 mx-auto mb-3 opacity-50" />
              <p className="text-sm">No EmailBison API token configured for this workspace.</p>
            </div>
          ) : emailSenderHealth.length === 0 && !emailError ? (
            <div className="text-center py-8 text-muted-foreground">
              <Mail className="h-10 w-10 mx-auto mb-3 opacity-50" />
              <p className="text-sm">No email inboxes found.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted">
                  <TableHead>Name</TableHead>
                  <TableHead>Email Address</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Daily Limit</TableHead>
                  <TableHead className="text-right">Total Sent</TableHead>
                  <TableHead className="text-right">Bounces</TableHead>
                  <TableHead className="text-right">Bounce Rate</TableHead>
                  <TableHead className="text-right">Reply Rate</TableHead>
                  <TableHead>Health</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {emailSenderHealth.map((sender) => (
                  <TableRow key={sender.id} className="hover:bg-muted border-border">
                    <TableCell className="font-medium text-sm">{sender.name ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{sender.email}</TableCell>
                    <TableCell>
                      <Badge variant={sender.status === "Connected" ? "success" : "destructive"} className="text-xs">
                        {sender.status ?? "Unknown"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm font-mono tabular-nums">{sender.daily_limit ?? "—"}</TableCell>
                    <TableCell className="text-right text-sm font-mono tabular-nums">{sender.emails_sent_count.toLocaleString()}</TableCell>
                    <TableCell className="text-right text-sm font-mono tabular-nums">{sender.bounced_count.toLocaleString()}</TableCell>
                    <TableCell className="text-right text-sm font-mono tabular-nums">
                      <span className={sender.healthStatus==="critical"?"text-red-600 dark:text-red-400 font-bold":sender.healthStatus==="warning"?"text-amber-600 dark:text-amber-400 font-medium":""}>{sender.computedBounceRate.toFixed(1)}%</span>
                    </TableCell>
                    <TableCell className="text-right text-sm font-mono tabular-nums">{sender.computedReplyRate.toFixed(1)}%</TableCell>
                    <TableCell><Badge variant={healthBadgeVariant[sender.healthStatus]} className="text-xs">{sender.healthStatus}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
