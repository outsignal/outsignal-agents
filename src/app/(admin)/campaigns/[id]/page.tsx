import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { getCampaign } from "@/lib/campaigns/operations";
import { DeployButton } from "./DeployButton";
import { DeployHistory } from "./DeployHistory";

interface CampaignDetailPageProps {
  params: Promise<{ id: string }>;
}

// ─── Status color map ─────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-zinc-700 text-zinc-300",
  internal_review: "bg-purple-900/60 text-purple-300",
  pending_approval: "bg-amber-900/60 text-amber-300",
  approved: "bg-emerald-900/60 text-emerald-300",
  deployed: "bg-blue-900/60 text-blue-300",
  active: "bg-emerald-900/60 text-emerald-300",
  paused: "bg-yellow-900/60 text-yellow-300",
  completed: "bg-zinc-600 text-zinc-300",
};

export default async function CampaignDetailPage({
  params,
}: CampaignDetailPageProps) {
  const { id } = await params;
  const campaign = await getCampaign(id);

  if (!campaign) notFound();

  // Compute step counts from parsed sequence arrays
  const emailStepCount = Array.isArray(campaign.emailSequence)
    ? campaign.emailSequence.length
    : 0;
  const linkedinStepCount = Array.isArray(campaign.linkedinSequence)
    ? campaign.linkedinSequence.length
    : 0;

  const leadCount = campaign.targetListPeopleCount ?? 0;

  return (
    <div>
      <Header
        title={campaign.name}
        description={campaign.workspaceSlug}
        actions={
          <div className="flex items-center gap-3">
            <Badge
              className={`text-xs capitalize ${STATUS_COLORS[campaign.status] ?? ""}`}
            >
              {campaign.status.replace(/_/g, " ")}
            </Badge>
            <DeployButton
              campaignId={campaign.id}
              campaignName={campaign.name}
              status={campaign.status}
              leadsApproved={campaign.leadsApproved}
              contentApproved={campaign.contentApproved}
              channels={campaign.channels}
              leadCount={leadCount}
              emailStepCount={emailStepCount}
              linkedinStepCount={linkedinStepCount}
            />
          </div>
        }
      />

      <div className="p-6 space-y-6">
        {/* ─── Campaign overview (stats) ─────────────────────────────────────── */}
        <Card density="compact">
          <CardHeader>
            <CardTitle>Overview</CardTitle>
            <CardDescription>Campaign configuration at a glance</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Status</p>
                <p className="text-sm font-semibold capitalize">
                  {campaign.status.replace(/_/g, " ")}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Channels</p>
                <p className="text-sm font-semibold">
                  {campaign.channels.join(", ")}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Target List</p>
                <p className="text-sm font-semibold">
                  {campaign.targetListName ?? "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Leads</p>
                <p className="text-sm font-semibold">
                  {leadCount.toLocaleString()}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ─── Approval status ───────────────────────────────────────────────── */}
        <Card density="compact">
          <CardHeader>
            <CardTitle>Approvals</CardTitle>
            <CardDescription>Lead and content sign-off status</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`h-2 w-2 rounded-full ${campaign.leadsApproved ? "bg-emerald-400" : "bg-zinc-600"}`}
                  />
                  <p className="text-xs font-medium">Leads Approved</p>
                </div>
                <p className="text-xs text-muted-foreground ml-4">
                  {campaign.leadsApproved
                    ? campaign.leadsApprovedAt
                      ? new Date(campaign.leadsApprovedAt).toLocaleDateString()
                      : "Yes"
                    : campaign.leadsFeedback
                      ? `Feedback: ${campaign.leadsFeedback}`
                      : "Pending"}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`h-2 w-2 rounded-full ${campaign.contentApproved ? "bg-emerald-400" : "bg-zinc-600"}`}
                  />
                  <p className="text-xs font-medium">Content Approved</p>
                </div>
                <p className="text-xs text-muted-foreground ml-4">
                  {campaign.contentApproved
                    ? campaign.contentApprovedAt
                      ? new Date(
                          campaign.contentApprovedAt
                        ).toLocaleDateString()
                      : "Yes"
                    : campaign.contentFeedback
                      ? `Feedback: ${campaign.contentFeedback}`
                      : "Pending"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ─── Sequence summary ──────────────────────────────────────────────── */}
        {(emailStepCount > 0 || linkedinStepCount > 0) && (
          <Card density="compact">
            <CardHeader>
              <CardTitle>Sequence</CardTitle>
              <CardDescription>
                Outreach steps configured for this campaign
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                {emailStepCount > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">
                      Email Steps
                    </p>
                    <p className="text-sm font-semibold">{emailStepCount}</p>
                  </div>
                )}
                {linkedinStepCount > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">
                      LinkedIn Steps
                    </p>
                    <p className="text-sm font-semibold">
                      {linkedinStepCount}
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ─── Deploy history ────────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Deploy History</CardTitle>
            <CardDescription>
              All deployments for this campaign
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <DeployHistory campaignId={campaign.id} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
