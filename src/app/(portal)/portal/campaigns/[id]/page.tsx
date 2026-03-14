import { notFound, redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal-session";
import { getCampaign, getCampaignLeadSample } from "@/lib/campaigns/operations";
import { getWorkspaceBySlug } from "@/lib/workspaces";
import { EmailBisonClient } from "@/lib/emailbison/client";
import type { Campaign as EBCampaign } from "@/lib/emailbison/types";
import { CampaignApprovalLeads } from "@/components/portal/campaign-approval-leads";
import { CampaignApprovalContent } from "@/components/portal/campaign-approval-content";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Mail, Linkedin, Clock, CalendarDays } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

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

  // Fetch EmailBison campaign stats if campaign has been deployed
  let ebCampaign: EBCampaign | null = null;
  const hasPerformanceData = ["active", "paused", "completed"].includes(campaign.status);
  if (hasPerformanceData && campaign.emailBisonCampaignId) {
    try {
      const workspace = await getWorkspaceBySlug(workspaceSlug);
      if (workspace?.apiToken) {
        const client = new EmailBisonClient(workspace.apiToken);
        const allCampaigns = await client.getCampaigns();
        ebCampaign = allCampaigns.find((c) => c.id === campaign.emailBisonCampaignId) ?? null;
      }
    } catch {
      // Silently fail — stats are non-critical
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

      {/* Performance Stats */}
      {ebCampaign && (
        (() => {
          const openRate = ebCampaign.emails_sent > 0
            ? (ebCampaign.unique_opens / ebCampaign.emails_sent) * 100
            : 0;
          const replyRate = ebCampaign.emails_sent > 0
            ? (ebCampaign.replied / ebCampaign.emails_sent) * 100
            : 0;
          const bounceRate = ebCampaign.emails_sent > 0
            ? (ebCampaign.bounced / ebCampaign.emails_sent) * 100
            : 0;

          return (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-heading">Campaign Performance</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <MetricCard
                    label="Emails Sent"
                    value={ebCampaign.emails_sent.toLocaleString()}
                    density="compact"
                  />
                  <MetricCard
                    label="Opens"
                    value={ebCampaign.unique_opens.toLocaleString()}
                    detail={`${openRate.toFixed(1)}% open rate`}
                    density="compact"
                  />
                  <MetricCard
                    label="Replies"
                    value={ebCampaign.replied.toLocaleString()}
                    detail={`${replyRate.toFixed(1)}% reply rate`}
                    trend={replyRate > 3 ? "up" : undefined}
                    density="compact"
                  />
                  <MetricCard
                    label="Bounces"
                    value={ebCampaign.bounced.toLocaleString()}
                    detail={`${bounceRate.toFixed(1)}% bounce rate`}
                    trend={bounceRate > 5 ? "warning" : undefined}
                    density="compact"
                  />
                </div>
              </CardContent>
            </Card>
          );
        })()
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
      />
    </div>
  );
}
