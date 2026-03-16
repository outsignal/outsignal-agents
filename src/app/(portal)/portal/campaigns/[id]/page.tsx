import { notFound, redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal-session";
import { getCampaign, getCampaignLeadSample } from "@/lib/campaigns/operations";
import { getWorkspaceBySlug } from "@/lib/workspaces";
import { EmailBisonClient } from "@/lib/emailbison/client";
import type { Campaign as EBCampaign, SequenceStep } from "@/lib/emailbison/types";
import { CampaignApprovalLeads } from "@/components/portal/campaign-approval-leads";
import { CampaignApprovalContent } from "@/components/portal/campaign-approval-content";
import { CampaignLeadsTable } from "@/components/portal/campaign-leads-table";
import { MetricCard } from "@/components/dashboard/metric-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmailActivityChart, EmailActivityChartLegend } from "@/components/charts/email-activity-chart";
import type { EmailActivityPoint } from "@/components/charts/email-activity-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Mail, Linkedin, Clock, CalendarDays, Send, Eye, MessageSquare, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { prisma } from "@/lib/db";

export default async function PortalCampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let session;
  try {
    session = await getPortalSession();
  } catch {
    redirect("/portal/login");
  }
  const { workspaceSlug } = session;

  const campaign = await getCampaign(id);
  if (!campaign || campaign.workspaceSlug !== workspaceSlug) {
    notFound();
  }

  // Fetch lead sample if campaign has a target list
  let leadSample: Awaited<ReturnType<typeof getCampaignLeadSample>> | null = null;
  if (campaign.targetListId) {
    leadSample = await getCampaignLeadSample(
      campaign.targetListId,
      workspaceSlug,
      500, // fetch up to 500 leads so clients can paginate through them
    );
  }

  // Fetch EmailBison campaign stats + sequence steps if campaign has been deployed
  let ebCampaign: EBCampaign | null = null;
  let sequenceSteps: SequenceStep[] = [];
  const hasPerformanceData = ["active", "paused", "completed"].includes(campaign.status);
  if (hasPerformanceData && campaign.emailBisonCampaignId) {
    try {
      const workspace = await getWorkspaceBySlug(workspaceSlug);
      if (workspace?.apiToken) {
        const client = new EmailBisonClient(workspace.apiToken);
        ebCampaign = await client.getCampaignById(campaign.emailBisonCampaignId);

        if (ebCampaign) {
          try {
            sequenceSteps = await client.getSequenceSteps(ebCampaign.id);
          } catch {
            // ignore -- steps might not be available
          }
        }
      }
    } catch {
      // Silently fail -- stats are non-critical
    }
  }

  // Fetch chart data from WebhookEvent table (last 30 days, filtered by campaign)
  let chartData: EmailActivityPoint[] = [];
  if (hasPerformanceData && campaign.emailBisonCampaignId) {
    try {
      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - 30);

      const chartEvents = await prisma.webhookEvent.findMany({
        where: {
          workspace: workspaceSlug,
          campaignId: String(campaign.emailBisonCampaignId),
          receivedAt: { gte: sinceDate },
          eventType: {
            in: [
              "EMAIL_SENT",
              "LEAD_REPLIED",
              "LEAD_INTERESTED",
              "EMAIL_BOUNCED",
              "LEAD_UNSUBSCRIBED",
            ],
          },
          isAutomated: false,
        },
        select: { receivedAt: true, eventType: true },
        orderBy: { receivedAt: "asc" },
      });

      const buckets = new Map<string, EmailActivityPoint>();
      for (const evt of chartEvents) {
        const dateKey = evt.receivedAt.toISOString().slice(0, 10);
        if (!buckets.has(dateKey)) {
          buckets.set(dateKey, { date: dateKey, sent: 0, replied: 0, bounced: 0, interested: 0, unsubscribed: 0 });
        }
        const bucket = buckets.get(dateKey)!;
        switch (evt.eventType) {
          case "EMAIL_SENT":
            bucket.sent = (bucket.sent ?? 0) + 1;
            break;
          case "LEAD_REPLIED":
            bucket.replied = (bucket.replied ?? 0) + 1;
            break;
          case "EMAIL_BOUNCED":
            bucket.bounced = (bucket.bounced ?? 0) + 1;
            break;
          case "LEAD_INTERESTED":
            bucket.interested = (bucket.interested ?? 0) + 1;
            break;
          case "LEAD_UNSUBSCRIBED":
            bucket.unsubscribed = (bucket.unsubscribed ?? 0) + 1;
            break;
        }
      }
      chartData = Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date));
    } catch {
      // Silently fail -- chart is non-critical
    }
  }

  const formatDate = (date: Date) =>
    date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  const formatDateTime = (date: Date) =>
    `${formatDate(date)} at ${date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;

  const pct = (numerator: number, denominator: number) =>
    denominator > 0 ? ((numerator / denominator) * 100).toFixed(1) : "0.0";

  // Compute campaign-level stats for the hero metric cards
  const sent = ebCampaign?.emails_sent ?? 0;
  const opens = ebCampaign?.unique_opens ?? 0;
  const replies = ebCampaign?.unique_replies ?? 0;
  const bounced = ebCampaign?.bounced ?? 0;
  const openTracking = ebCampaign?.open_tracking ?? false;

  return (
    <div className="p-6 space-y-6">
      {/* Back link + header */}
      <div>
        <Link
          href="/portal/campaigns"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Campaigns
        </Link>

        {/* Campaign header */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-heading font-bold text-foreground">{campaign.name}</h1>
              <StatusBadge status={campaign.status} type="campaign" />
            </div>
            {campaign.description && (
              <p className="text-sm text-muted-foreground mt-2">
                {campaign.description}
              </p>
            )}
          </div>
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-4 text-sm text-muted-foreground">
          {campaign.channels.includes("email") && (
            <span className="inline-flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5" /> Email
            </span>
          )}
          {campaign.channels.includes("linkedin") && (
            <span className="inline-flex items-center gap-1.5">
              <Linkedin className="h-3.5 w-3.5" /> LinkedIn
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5" />
            Created {formatDate(campaign.createdAt)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            Last updated {formatDateTime(campaign.updatedAt)}
          </span>
        </div>
      </div>

      {/* Campaign KPI Metrics Row */}
      {ebCampaign && (
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-3">Performance</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              label="Emails Sent"
              value={sent.toLocaleString()}
              icon={Send}
              density="compact"
            />
            <MetricCard
              label="Opens"
              value={openTracking ? opens.toLocaleString() : "N/A"}
              detail={
                openTracking
                  ? `${pct(opens, sent)}% open rate`
                  : "Tracking disabled"
              }
              icon={Eye}
              density="compact"
            />
            <MetricCard
              label="Replies"
              value={replies.toLocaleString()}
              detail={`${pct(replies, sent)}% reply rate`}
              trend={sent > 0 && (replies / sent) * 100 > 3 ? "up" : undefined}
              icon={MessageSquare}
              density="compact"
            />
            <MetricCard
              label="Bounced"
              value={bounced.toLocaleString()}
              detail={`${pct(bounced, sent)}% bounce rate`}
              trend={sent > 0 && (bounced / sent) * 100 > 5 ? "warning" : undefined}
              icon={AlertTriangle}
              density="compact"
            />
          </div>
        </div>
      )}

      {/* Detailed Performance Stats */}
      {ebCampaign && (
        (() => {
          const trackingOff = !ebCampaign.open_tracking;
          const bounceRate = sent > 0 ? (ebCampaign.bounced / sent) * 100 : 0;
          const interestedRate = sent > 0 ? (ebCampaign.interested / sent) * 100 : 0;

          return (
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-3">Detailed Stats</p>
              <Card>
                <CardContent className="pt-5 space-y-3">
                  {/* Row 1: High-volume metrics */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <MetricCard
                      label="People Contacted"
                      value={ebCampaign.total_leads_contacted.toLocaleString()}
                      density="compact"
                    />
                    <MetricCard
                      label="Total Opens"
                      value={trackingOff ? "N/A" : ebCampaign.opened.toLocaleString()}
                      density="compact"
                    />
                    <MetricCard
                      label="Unique Opens"
                      value={trackingOff ? "N/A" : ebCampaign.unique_opens.toLocaleString()}
                      detail={trackingOff ? "Tracking off" : `${pct(ebCampaign.unique_opens, sent)}% of sent`}
                      density="compact"
                    />
                    <MetricCard
                      label="Interested"
                      value={ebCampaign.interested.toLocaleString()}
                      detail={`${pct(ebCampaign.interested, sent)}% of sent`}
                      trend={interestedRate > 0 ? "up" : undefined}
                      density="compact"
                    />
                  </div>
                  {/* Row 2: Outcome metrics */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <MetricCard
                      label="Unique Replies"
                      value={ebCampaign.unique_replies.toLocaleString()}
                      detail={`${pct(ebCampaign.unique_replies, sent)}% of sent`}
                      density="compact"
                    />
                    <MetricCard
                      label="Unsubscribed"
                      value={ebCampaign.unsubscribed.toLocaleString()}
                      detail={`${pct(ebCampaign.unsubscribed, sent)}% of sent`}
                      density="compact"
                    />
                    <MetricCard
                      label="Bounced"
                      value={ebCampaign.bounced.toLocaleString()}
                      detail={`${pct(ebCampaign.bounced, sent)}% of sent`}
                      trend={bounceRate > 5 ? "warning" : undefined}
                      density="compact"
                    />
                    <MetricCard
                      label="Completion"
                      value={`${ebCampaign.completion_percentage.toFixed(0)}`}
                      suffix="%"
                      density="compact"
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
          );
        })()
      )}

      {/* Email Activity Chart */}
      {chartData.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-3">Activity</p>
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-heading text-foreground">Email Activity (Last 30 Days)</CardTitle>
                <EmailActivityChartLegend keys={["sent", "replied", "bounced", "interested", "unsubscribed"]} />
              </div>
            </CardHeader>
            <CardContent>
              <EmailActivityChart data={chartData} height={280} />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Email Sequence Steps */}
      {sequenceSteps.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-3">Sequence</p>
          <Card>
            <CardContent className="pt-5">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="pb-2 pr-4 font-medium w-16">Step</th>
                      <th className="pb-2 pr-4 font-medium">Subject</th>
                      <th className="pb-2 font-medium w-24 text-right">Delay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sequenceSteps
                      .sort((a, b) => a.position - b.position)
                      .map((step) => (
                        <tr key={step.id} className="border-b border-border last:border-0 hover:bg-muted">
                          <td className="py-2.5 pr-4 font-mono text-muted-foreground">{step.position}</td>
                          <td className="py-2.5 pr-4 font-medium text-foreground">
                            {step.subject || <span className="text-muted-foreground italic">No subject</span>}
                          </td>
                          <td className="py-2.5 text-right font-mono text-muted-foreground">
                            {step.delay_days != null
                              ? step.delay_days === 0
                                ? "Immediate"
                                : `${step.delay_days}d`
                              : "\u2014"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Campaign Leads from EmailBison -- shown for active/paused/completed campaigns */}
      {hasPerformanceData && campaign.emailBisonCampaignId && (
        <CampaignLeadsTable
          campaignId={campaign.id}
          ebCampaignId={campaign.emailBisonCampaignId}
        />
      )}

      {/* Leads Section */}
      <CampaignApprovalLeads
        campaignId={campaign.id}
        leads={leadSample?.leads ?? []}
        totalCount={leadSample?.totalCount ?? 0}
        leadsApproved={campaign.leadsApproved}
        leadsFeedback={campaign.leadsFeedback}
        isPending={campaign.status === "pending_approval"}
      />

      {/* Content Section */}
      <CampaignApprovalContent
        campaignId={campaign.id}
        emailSequence={campaign.emailSequence as unknown[] | null}
        linkedinSequence={campaign.linkedinSequence as unknown[] | null}
        channels={campaign.channels}
        contentApproved={campaign.contentApproved}
        contentFeedback={campaign.contentFeedback}
        isPending={campaign.status === "pending_approval"}
        ebSequenceSteps={sequenceSteps}
      />
    </div>
  );
}
