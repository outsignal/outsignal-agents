import { notFound, redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal-session";
import { getCampaign, getCampaignLeadSample } from "@/lib/campaigns/operations";
import { getWorkspaceBySlug } from "@/lib/workspaces";
import { EmailBisonClient } from "@/lib/emailbison/client";
import type { Campaign as EBCampaign, SequenceStep } from "@/lib/emailbison/types";
import { CampaignApprovalLeads } from "@/components/portal/campaign-approval-leads";
import { CampaignApprovalContent } from "@/components/portal/campaign-approval-content";
import { CampaignDetailTabs } from "@/components/portal/campaign-detail-tabs";
import { StatusBadge } from "@/components/ui/status-badge";
import type { EmailActivityPoint } from "@/components/charts/email-activity-chart";
import { ArrowLeft, Mail, Linkedin, Clock, CalendarDays } from "lucide-react";
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
              <h1 className="text-xl font-medium text-foreground">{campaign.name}</h1>
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

      {/* Campaign Detail Tabs */}
      <CampaignDetailTabs
        ebCampaign={ebCampaign}
        chartData={chartData}
        openTracking={ebCampaign?.open_tracking ?? false}
        campaignId={campaign.id}
        ebCampaignId={campaign.emailBisonCampaignId}
        sequenceSteps={sequenceSteps}
        hasPerformanceData={hasPerformanceData}
      />

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
