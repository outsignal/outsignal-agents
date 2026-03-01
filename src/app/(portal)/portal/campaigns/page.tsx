import { getPortalSession } from "@/lib/portal-session";
import { listCampaigns } from "@/lib/campaigns/operations";
import { CampaignCard } from "@/components/portal/campaign-card";

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

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-heading font-bold">Campaigns</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Review and approve your campaigns
        </p>
      </div>

      {sorted.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          No campaigns yet. Your team will notify you when campaigns are ready for
          review.
        </div>
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
