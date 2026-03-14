import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { getCampaign } from "@/lib/campaigns/operations";
import { prisma } from "@/lib/db";
import { DeployButton } from "./DeployButton";
import { DeployHistory } from "./DeployHistory";
import { SignalStatusButton } from "./SignalStatusButton";

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
  archived: "bg-zinc-800 text-zinc-400",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function CampaignDetailPage({
  params,
}: CampaignDetailPageProps) {
  const { id } = await params;

  // Fetch campaign and signal lead count in parallel
  const [campaign, signalLeadCount] = await Promise.all([
    getCampaign(id),
    prisma.signalCampaignLead
      .count({ where: { campaignId: id, outcome: "added" } })
      .catch(() => 0),
  ]);

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
      <Breadcrumb
        items={[
          { label: "Campaigns", href: "/campaigns" },
          { label: campaign.name },
        ]}
      />
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
            {campaign.type === "signal" ? (
              (campaign.status === "active" || campaign.status === "paused") && (
                <SignalStatusButton
                  campaignId={campaign.id}
                  currentStatus={campaign.status}
                />
              )
            ) : (
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
            )}
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

        {/* ─── Signal campaign stats ─────────────────────────────────────────── */}
        {campaign.type === "signal" && (
          <Card className="border-zinc-800 bg-zinc-900">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-zinc-400">Signal Stats</CardTitle>
              <CardDescription>
                Signal matching configuration and live metrics
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <div>
                  <p className="text-xs text-zinc-500">Signal Types</p>
                  <p className="text-sm text-zinc-200">
                    {campaign.signalTypes && campaign.signalTypes.length > 0
                      ? campaign.signalTypes.join(", ")
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Daily Lead Cap</p>
                  <p className="text-sm text-zinc-200">{campaign.dailyLeadCap}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">ICP Threshold</p>
                  <p className="text-sm text-zinc-200">{campaign.icpScoreThreshold}/100</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Last Processed</p>
                  <p className="text-sm text-zinc-200">
                    {campaign.lastSignalProcessedAt
                      ? formatDate(new Date(campaign.lastSignalProcessedAt))
                      : "Never"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Leads Added</p>
                  <p className="text-sm text-zinc-200">{signalLeadCount.toLocaleString()}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ─── Deploy history (static campaigns only) ────────────────────────── */}
        {campaign.type !== "signal" && (
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
        )}
      </div>
    </div>
  );
}
