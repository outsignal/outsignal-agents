import { notFound } from "next/navigation";
import { getPortalSession } from "@/lib/portal-session";
import { getCampaign, getCampaignLeadSample } from "@/lib/campaigns/operations";
import { CampaignApprovalLeads } from "@/components/portal/campaign-approval-leads";
import { CampaignApprovalContent } from "@/components/portal/campaign-approval-content";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Mail, Linkedin } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export default async function PortalCampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { workspaceSlug } = await getPortalSession();

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
    );
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

  return (
    <div className="space-y-6">
      {/* Back link + header */}
      <div>
        <Link
          href="/portal/campaigns"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Campaigns
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-heading font-bold">{campaign.name}</h1>
          <Badge className={cn("text-xs", config.className)}>{config.label}</Badge>
        </div>
        {campaign.description && (
          <p className="text-sm text-muted-foreground mt-1">{campaign.description}</p>
        )}
        <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground">
          {campaign.channels.includes("email") && (
            <span className="inline-flex items-center gap-1">
              <Mail className="h-3.5 w-3.5" /> Email
            </span>
          )}
          {campaign.channels.includes("linkedin") && (
            <span className="inline-flex items-center gap-1">
              <Linkedin className="h-3.5 w-3.5" /> LinkedIn
            </span>
          )}
        </div>
      </div>

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
