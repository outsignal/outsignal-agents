import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MetricCard } from "@/components/dashboard/metric-card";
import { prisma } from "@/lib/db";
import { getWorkspaceBySlug } from "@/lib/workspaces";
import { EmailBisonClient } from "@/lib/emailbison/client";
import type { SenderEmail } from "@/lib/emailbison/types";
import { Mail, Linkedin } from "lucide-react";

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

  const linkedinSenders = await prisma.sender.findMany({
    where: { workspaceSlug: slug },
    orderBy: { name: "asc" },
  });

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
  const totalLinkedinSenders = linkedinSenders.length;
  const connectedInboxes = emailSenderHealth.filter(
    (s) => s.status === "Connected",
  ).length;
  const activeLinkedinSessions = linkedinSenders.filter(
    (s) => s.sessionStatus === "active",
  ).length;

  const linkedinStatusVariant: Record<string, "secondary" | "success" | "warning" | "destructive"> = {
    setup: "secondary",
    active: "success",
    paused: "warning",
    disabled: "destructive",
  };

  const linkedinSessionVariant: Record<string, "secondary" | "success" | "warning" | "destructive"> = {
    active: "success",
    expired: "warning",
    not_setup: "secondary",
  };

  const healthBadgeVariant: Record<string, "success" | "warning" | "destructive"> = {
    healthy: "success",
    warning: "warning",
    critical: "destructive",
  };

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Senders</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Email and LinkedIn sending accounts for {workspace.name}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <MetricCard label="Email Senders" value={totalEmailSenders} icon="Mail" />
        <MetricCard label="LinkedIn Senders" value={totalLinkedinSenders} icon="Linkedin" />
        <MetricCard label="Connected Inboxes" value={connectedInboxes} detail={totalEmailSenders>0?Math.round((connectedInboxes/totalEmailSenders)*100)+"% connected":undefined} />
        <MetricCard label="Active LinkedIn Sessions" value={activeLinkedinSessions} detail={totalLinkedinSenders>0?Math.round((activeLinkedinSessions/totalLinkedinSenders)*100)+"% active":undefined} />
      </div>

      <Tabs defaultValue="email" className="space-y-4">
        <TabsList>
          <TabsTrigger value="email" className="gap-1.5">
            <Mail className="size-4" />Email Senders
            {totalEmailSenders > 0 && <Badge variant="secondary" className="ml-1 text-xs">{totalEmailSenders}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="linkedin" className="gap-1.5">
            <Linkedin className="size-4" />LinkedIn Senders
            {totalLinkedinSenders > 0 && <Badge variant="secondary" className="ml-1 text-xs">{totalLinkedinSenders}</Badge>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="email">
          <Card>
            <CardHeader><CardTitle className="font-heading">Email Senders</CardTitle></CardHeader>
            <CardContent>
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
                  <p className="text-sm">No email senders found.</p>
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
                          <span className={sender.healthStatus==="critical"?"text-red-600 font-bold":sender.healthStatus==="warning"?"text-amber-600 font-medium":""}>{sender.computedBounceRate.toFixed(1)}%</span>
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
        </TabsContent>

        <TabsContent value="linkedin">
          <Card>
            <CardHeader><CardTitle className="font-heading">LinkedIn Senders</CardTitle></CardHeader>
            <CardContent>
              {linkedinSenders.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Linkedin className="h-10 w-10 mx-auto mb-3 opacity-50" />
                  <p className="text-sm">No LinkedIn senders configured for this workspace.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted">
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Health</TableHead>
                      <TableHead>Session Status</TableHead>
                      <TableHead>Login Method</TableHead>
                      <TableHead className="text-right">Warmup Day</TableHead>
                      <TableHead>Last Polled</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {linkedinSenders.map((sender) => (
                      <TableRow key={sender.id} className="hover:bg-muted border-border">
                        <TableCell className="font-medium text-sm">
                          {sender.name}
                          {sender.linkedinProfileUrl && (
                            <a href={sender.linkedinProfileUrl} target="_blank" rel="noopener noreferrer"
                              className="ml-2 text-xs text-muted-foreground hover:text-foreground transition-colors">Profile</a>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{sender.emailAddress ?? "—"}</TableCell>
                        <TableCell><Badge variant={linkedinStatusVariant[sender.status] ?? "secondary"} className="text-xs">{sender.status}</Badge></TableCell>
                        <TableCell><Badge variant={sender.healthStatus === "healthy" ? "success" : sender.healthStatus === "warning" ? "warning" : sender.healthStatus === "critical" ? "destructive" : "secondary"} className="text-xs">{sender.healthStatus}</Badge></TableCell>
                        <TableCell><Badge variant={linkedinSessionVariant[sender.sessionStatus] ?? "secondary"} className="text-xs">{sender.sessionStatus === "not_setup" ? "Not Setup" : sender.sessionStatus}</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground capitalize">{sender.loginMethod || "—"}</TableCell>
                        <TableCell className="text-right text-sm font-mono tabular-nums">{sender.warmupDay > 0 ? "Day " + sender.warmupDay : "Not started"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{sender.lastPolledAt ? formatRelativeTime(sender.lastPolledAt) : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
