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
import { EmailActivityChart, EmailActivityChartLegend } from "@/components/charts/email-activity-chart";
import type { EmailActivityPoint } from "@/components/charts/email-activity-chart";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Mail, Linkedin, Clock, CalendarDays } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
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
            // ignore — steps might not be available
          }
        }
      }
    } catch {
      // Silently fail — stats are non-critical
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
      // Silently fail — chart is non-critical
    }
  }

  // Status badge config
  const statusConfig: Record<string, { label: string; className: string }> = {
    draft: { label: "Draft", className: "bg-gray-100 text-gray-800" },
    internal_review: { label: "In Review", className: "bg-blue-100 text-blue-800" },
    pending_approval: { label: "Needs Approval", className: "bg-amber-100 text-amber-800" },
    approved: { label: "Approved", className: "bg-emerald-100 text-emerald-800" },
    deployed: { label: "Deployed", className: "bg-purple-100 text-purple-800" },
    active: { label: "Active", className: "bg-emerald-100 text-emerald-800" },
    paused: { label: "Paused", className: "bg-yellow-100 text-yellow-800" },
    completed: { label: "Completed", className: "bg-blue-100 text-blue-800" },
  };
  const config = statusConfig[campaign.status] ?? {
    label: campaign.status,
    className: "bg-gray-100 text-gray-800",
  };

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

        {/* Campaign header card */}
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="text-2xl font-heading font-bold">{campaign.name}</h1>
                  <Badge className={cn("text-xs", config.className)}>
                    {config.label}
                  </Badge>
                </div>
                {campaign.description && (
                  <p className="text-sm text-muted-foreground mt-2">
                    {campaign.description}
                  </p>
                )}
              </div>
            </div>

            {/* Meta row */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-4 pt-4 border-t text-sm text-muted-foreground">
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
          </CardContent>
        </Card>
      </div>

      {/* Performance Stats — 8 KPI cards in 2 rows */}
      {ebCampaign && (
        (() => {
          const sent = ebCampaign.emails_sent;
          const trackingOff = !ebCampaign.open_tracking;
          const bounceRate = sent > 0 ? (ebCampaign.bounced / sent) * 100 : 0;
          const interestedRate = sent > 0 ? (ebCampaign.interested / sent) * 100 : 0;

          return (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-heading">Campaign Performance</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Row 1: High-volume metrics */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <MetricCard
                    label="Emails Sent"
                    value={sent.toLocaleString()}
                    density="compact"
                  />
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
                    label="Interested"
                    value={ebCampaign.interested.toLocaleString()}
                    detail={`${pct(ebCampaign.interested, sent)}% of sent`}
                    trend={interestedRate > 0 ? "up" : undefined}
                    density="compact"
                  />
                </div>
              </CardContent>
            </Card>
          );
        })()
      )}

      {/* Email Activity Chart */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-heading">Email Activity (Last 30 Days)</CardTitle>
              <EmailActivityChartLegend keys={["sent", "replied", "bounced", "interested", "unsubscribed"]} />
            </div>
          </CardHeader>
          <CardContent>
            <EmailActivityChart data={chartData} height={260} />
          </CardContent>
        </Card>
      )}

      {/* Email Sequence Steps */}
      {sequenceSteps.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-heading">Email Sequence</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium w-16">Step</th>
                    <th className="pb-2 pr-4 font-medium">Subject</th>
                    <th className="pb-2 font-medium w-24 text-right">Delay</th>
                  </tr>
                </thead>
                <tbody>
                  {sequenceSteps
                    .sort((a, b) => a.position - b.position)
                    .map((step) => (
                      <tr key={step.id} className="border-b last:border-0">
                        <td className="py-2.5 pr-4 text-muted-foreground">{step.position}</td>
                        <td className="py-2.5 pr-4 font-medium">
                          {step.subject || <span className="text-muted-foreground italic">No subject</span>}
                        </td>
                        <td className="py-2.5 text-right text-muted-foreground">
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
      )}

      {/* Campaign Leads from EmailBison — shown for active/paused/completed campaigns */}
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
