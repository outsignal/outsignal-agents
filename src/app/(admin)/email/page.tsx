import Link from "next/link";
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
import { getAllWorkspaces, getWorkspaceBySlug } from "@/lib/workspaces";
import { EmailBisonClient } from "@/lib/emailbison/client";
import type { SenderEmail } from "@/lib/emailbison/types";
import { WorkspaceFilterSelect } from "@/components/email/workspace-filter-select";

interface SenderHealthRow {
  email: string;
  name: string | undefined;
  workspaceName: string;
  workspaceSlug: string;
  status: string;
  emailsSent: number;
  bounced: number;
  bounceRate: number;
  replies: number;
  replyRate: number;
  healthStatus: "healthy" | "warning" | "critical";
}

function computeHealth(sender: SenderEmail, workspaceName: string, workspaceSlug: string): SenderHealthRow {
  const sent = sender.emails_sent_count;
  const bounced = sender.bounced_count;
  const bounceRate = sent > 0 ? (bounced / sent) * 100 : 0;
  const replyRate = sent > 0 ? (sender.unique_replied_count / sent) * 100 : 0;

  let healthStatus: "healthy" | "warning" | "critical" = "healthy";
  if (sender.status === "Disconnected") healthStatus = "critical";
  else if (bounceRate > 5) healthStatus = "critical";
  else if (bounceRate > 2) healthStatus = "warning";

  return {
    email: sender.email,
    name: sender.name,
    workspaceName,
    workspaceSlug,
    status: sender.status ?? "Unknown",
    emailsSent: sent,
    bounced,
    bounceRate,
    replies: sender.unique_replied_count,
    replyRate,
    healthStatus,
  };
}

export default async function EmailHealthPage({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string; page?: string }>;
}) {
  const { workspace: workspaceFilter, page: pageParam } = await searchParams;
  const currentPage = Math.max(1, parseInt(pageParam ?? "1"));
  const PAGE_SIZE = 50;
  const allWorkspaces = await getAllWorkspaces();
  const allActiveWorkspaces = allWorkspaces.filter((ws) => ws.hasApiToken);
  const activeWorkspaces = workspaceFilter
    ? allActiveWorkspaces.filter((ws) => ws.slug === workspaceFilter)
    : allActiveWorkspaces;

  const allSenders: SenderHealthRow[] = [];
  const failedWorkspaces: string[] = [];

  // Fetch sender emails for each workspace in parallel
  const results = await Promise.allSettled(
    activeWorkspaces.map(async (ws) => {
      const config = await getWorkspaceBySlug(ws.slug);
      if (!config) return { slug: ws.slug, name: ws.name, senders: [] as SenderEmail[] };
      const client = new EmailBisonClient(config.apiToken);
      const senders = await client.getSenderEmails();
      return { slug: ws.slug, name: ws.name, senders };
    }),
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      const { slug, name, senders } = result.value;
      for (const sender of senders) {
        allSenders.push(computeHealth(sender, name, slug));
      }
    } else {
      failedWorkspaces.push(activeWorkspaces[i].name);
    }
  }

  // Sort worst-first: critical → warning → healthy, then by bounce rate desc
  const sortOrder = { critical: 0, warning: 1, healthy: 2 };
  allSenders.sort((a, b) => {
    const orderDiff = sortOrder[a.healthStatus] - sortOrder[b.healthStatus];
    if (orderDiff !== 0) return orderDiff;
    return b.bounceRate - a.bounceRate;
  });

  // Compute aggregates
  const totalSenders = allSenders.length;
  const disconnected = allSenders.filter((s) => s.status === "Disconnected");
  const connected = totalSenders - disconnected.length;
  const totalSent = allSenders.reduce((sum, s) => sum + s.emailsSent, 0);
  const totalBounced = allSenders.reduce((sum, s) => sum + s.bounced, 0);
  const totalReplies = allSenders.reduce((sum, s) => sum + s.replies, 0);
  const avgBounceRate = totalSent > 0 ? (totalBounced / totalSent) * 100 : 0;
  const avgReplyRate = totalSent > 0 ? (totalReplies / totalSent) * 100 : 0;
  const highBounce = allSenders.filter((s) => s.bounceRate > 5 && s.status !== "Disconnected");

  // Pagination
  const totalPages = Math.ceil(totalSenders / PAGE_SIZE);
  const paginatedSenders = allSenders.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  function buildPageUrl(page: number): string {
    const params = new URLSearchParams();
    if (workspaceFilter) params.set("workspace", workspaceFilter);
    if (page > 1) params.set("page", String(page));
    const qs = params.toString();
    return qs ? `/email?${qs}` : "/email";
  }

  const bounceTrend = avgBounceRate > 5 ? "down" : avgBounceRate > 2 ? "warning" : "up";

  const healthBadgeStyles = {
    healthy: "bg-emerald-100 text-emerald-800",
    warning: "bg-yellow-100 text-yellow-800",
    critical: "bg-red-100 text-red-800",
  };

  return (
    <div>
      <Header
        title="Email Health"
        description={`Monitoring ${totalSenders} senders across ${activeWorkspaces.length} workspaces`}
      />
      <div className="p-6 space-y-6">
        {/* Workspace filter */}
        <div className="flex justify-end">
          <WorkspaceFilterSelect
            workspaces={allActiveWorkspaces.map((ws) => ({ slug: ws.slug, name: ws.name }))}
            currentWorkspace={workspaceFilter ?? ""}
          />
        </div>

        {/* Alert banners */}
        {disconnected.length > 0 && (
          <div className="rounded-lg border border-red-300 bg-red-50 p-4">
            <h3 className="font-heading font-bold text-red-900">
              {disconnected.length} inbox{disconnected.length !== 1 ? "es" : ""} disconnected
            </h3>
            <p className="text-sm text-red-800 mt-1">
              These inboxes are no longer connected and cannot send emails. Reconnect them immediately.
            </p>
            <ul className="mt-2 space-y-1">
              {disconnected.map((s) => (
                <li key={`${s.workspaceSlug}-${s.email}`} className="text-sm text-red-700 font-medium">
                  {s.email}{" "}
                  <Link
                    href={`/workspace/${s.workspaceSlug}/inbox-health`}
                    className="underline text-red-600 hover:text-red-800"
                  >
                    ({s.workspaceName})
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {highBounce.length > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
            <h3 className="font-heading font-bold text-amber-900">
              {highBounce.length} sender{highBounce.length !== 1 ? "s" : ""} with high bounce rates
            </h3>
            <p className="text-sm text-amber-800 mt-1">
              These senders have bounce rates above 5%. Consider removing them from active campaigns.
            </p>
            <ul className="mt-2 space-y-1">
              {highBounce.map((s) => (
                <li key={`${s.workspaceSlug}-${s.email}`} className="text-sm text-amber-700 font-medium">
                  {s.email} — {s.bounceRate.toFixed(1)}% bounce rate ({s.workspaceName})
                </li>
              ))}
            </ul>
          </div>
        )}

        {failedWorkspaces.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4">
            <p className="text-sm text-amber-800">
              Failed to fetch data from {failedWorkspaces.length} workspace{failedWorkspaces.length !== 1 ? "s" : ""}: {failedWorkspaces.join(", ")}. Partial data shown.
            </p>
          </div>
        )}

        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard
            label="Connected Inboxes"
            value={`${connected}/${totalSenders}`}
            trend={disconnected.length > 0 ? "down" : "up"}
            detail={disconnected.length > 0 ? `${disconnected.length} disconnected` : "All connected"}
          />
          <MetricCard
            label="Avg Bounce Rate"
            value={`${avgBounceRate.toFixed(2)}%`}
            trend={bounceTrend}
            detail={bounceTrend === "up" ? "Healthy" : bounceTrend === "warning" ? "Elevated" : "Critical"}
          />
          <MetricCard
            label="Avg Reply Rate"
            value={`${avgReplyRate.toFixed(2)}%`}
            trend={avgReplyRate > 1 ? "up" : "neutral"}
          />
          <MetricCard
            label="Total Emails Sent"
            value={totalSent.toLocaleString()}
          />
        </div>

        {/* Sender Health table */}
        <Card>
          <CardHeader>
            <CardTitle className="font-heading">Sender Health</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Workspace</TableHead>
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
                {paginatedSenders.map((sender) => (
                  <TableRow key={`${sender.workspaceSlug}-${sender.email}`}>
                    <TableCell className="font-medium text-sm">
                      {sender.email}
                    </TableCell>
                    <TableCell className="text-sm">
                      <Link
                        href={`/workspace/${sender.workspaceSlug}/inbox-health`}
                        className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
                      >
                        {sender.workspaceName}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={`text-xs ${sender.status === "Connected" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}
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
                {allSenders.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={9}
                      className="text-center py-8 text-muted-foreground"
                    >
                      No sender emails found across active workspaces
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, totalSenders)} of {totalSenders} senders
            </p>
            <div className="flex items-center gap-2">
              {currentPage > 1 && (
                <Link
                  href={buildPageUrl(currentPage - 1)}
                  className="inline-flex items-center justify-center rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
                >
                  Previous
                </Link>
              )}
              {currentPage < totalPages && (
                <Link
                  href={buildPageUrl(currentPage + 1)}
                  className="inline-flex items-center justify-center rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
                >
                  Next
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
