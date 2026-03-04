import { getPortalSession } from "@/lib/portal-session";
import { listCampaigns } from "@/lib/campaigns/operations";
import { CampaignCard } from "@/components/portal/campaign-card";
import { EmptyState } from "@/components/ui/empty-state";
import { PortalRefreshButton } from "@/components/portal/portal-refresh-button";
import { Megaphone, Clock } from "lucide-react";

export default async function PortalCampaignsPage() {
  const { workspaceSlug } = await getPortalSession();
  const campaigns = await listCampaigns(workspaceSlug);

  // Sort: pending_approval with unapproved items first, then rest by updatedAt desc
  const pending = campaigns.filter(
    (c) =>
      c.status === "pending_approval" &&
      (!c.leadsApproved || !c.contentApproved),
  );
  const rest = campaigns.filter(
    (c) =>
      !(
        c.status === "pending_approval" &&
        (!c.leadsApproved || !c.contentApproved)
      ),
  );
  const sorted = [...pending, ...rest];

  const now = new Date();
  const pendingCount = pending.length;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold">Campaigns</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {pendingCount > 0
              ? `${pendingCount} campaign${pendingCount !== 1 ? "s" : ""} awaiting your review`
              : "Review and approve your campaigns"}
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

      {sorted.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="No campaigns yet"
          description="Your campaigns will appear here once they are ready for review. We'll notify you when there's something to approve."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sorted.map((campaign) => (
            <CampaignCard key={campaign.id} campaign={campaign} />
          ))}
        </div>
      )}
    </div>
  );
}
