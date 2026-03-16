import { redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal-session";
import { listCampaigns } from "@/lib/campaigns/operations";
import { getWorkspaceBySlug } from "@/lib/workspaces";
import { EmailBisonClient } from "@/lib/emailbison/client";
import { CampaignListTable, type MergedCampaign } from "@/components/portal/campaign-list-table";
import { EmptyState } from "@/components/ui/empty-state";
import { PortalRefreshButton } from "@/components/portal/portal-refresh-button";
import { Clock, Megaphone } from "lucide-react";
import type { Campaign as EBCampaign } from "@/lib/emailbison/types";

export default async function PortalCampaignsPage() {
  let session;
  try {
    session = await getPortalSession();
  } catch {
    redirect("/portal/login");
  }
  const { workspaceSlug } = session;

  const [internalCampaigns, workspace] = await Promise.all([
    listCampaigns(workspaceSlug),
    getWorkspaceBySlug(workspaceSlug),
  ]);

  // Fetch EB campaign stats
  let ebCampaigns: EBCampaign[] = [];
  if (workspace?.apiToken) {
    try {
      const client = new EmailBisonClient(workspace.apiToken);
      ebCampaigns = await client.getCampaigns();
    } catch {
      // EB stats unavailable — show campaigns without stats
    }
  }

  // Merge internal campaigns with EB data
  const merged: MergedCampaign[] = internalCampaigns.map((c) => {
    // Find matching EB campaign by emailBisonCampaignId
    // We need to look up the EB campaign ID from the internal campaign
    // Since listCampaigns doesn't include emailBisonCampaignId, we match by name
    const ebMatch = ebCampaigns.find(
      (eb) => eb.name === c.name
    );

    return {
      internalId: c.id,
      ebId: ebMatch?.id ?? null,
      name: c.name,
      type: c.type,
      status: c.status,
      completionPercentage: ebMatch
        ? ebMatch.total_leads > 0
          ? (ebMatch.total_leads_contacted / ebMatch.total_leads) * 100
          : 0
        : 0,
      emailsSent: ebMatch?.emails_sent ?? 0,
      opened: ebMatch?.opened ?? 0,
      uniqueOpens: ebMatch?.unique_opens ?? 0,
      replied: ebMatch?.replied ?? 0,
      uniqueReplies: ebMatch?.unique_replies ?? 0,
      bounced: ebMatch?.bounced ?? 0,
      unsubscribed: ebMatch?.unsubscribed ?? 0,
      interested: ebMatch?.interested ?? 0,
      totalLeadsContacted: ebMatch?.total_leads_contacted ?? 0,
      totalLeads: ebMatch?.total_leads ?? 0,
      openTracking: ebMatch?.open_tracking ?? false,
      tags: ebMatch?.tags?.map((t) => t.name) ?? [],
      updatedAt: c.updatedAt.toISOString(),
    };
  });

  // Sort: pending first, then by updatedAt desc
  merged.sort((a, b) => {
    const aPending = a.status === "pending_approval" ? 0 : 1;
    const bPending = b.status === "pending_approval" ? 0 : 1;
    if (aPending !== bPending) return aPending - bPending;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  const pendingCount = merged.filter((c) => c.status === "pending_approval").length;
  const now = new Date();

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-medium text-foreground">Campaigns</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {pendingCount > 0
              ? `${pendingCount} campaign${pendingCount !== 1 ? "s" : ""} awaiting your review`
              : "Review and manage your campaigns"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            Updated{" "}
            {now.toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
          <PortalRefreshButton />
        </div>
      </div>

      {merged.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="No campaigns yet"
          description="Your campaigns will appear here once they are ready for review. We'll notify you when there's something to approve."
        />
      ) : (
        <CampaignListTable campaigns={merged} />
      )}
    </div>
  );
}
