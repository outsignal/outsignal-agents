import { NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-session";
import { getCampaign, approveCampaignContent } from "@/lib/campaigns/operations";
import { notifyApproval } from "@/lib/notifications";
import { notify } from "@/lib/notify";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let session;
  try {
    session = await getPortalSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const campaign = await getCampaign(id);
  if (!campaign) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (campaign.workspaceSlug !== session.workspaceSlug) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const updated = await approveCampaignContent(id);

  const action = updated.status === "approved" ? "both_approved" : "content_approved";

  notifyApproval({
    workspaceSlug: session.workspaceSlug,
    campaignId: id,
    campaignName: campaign.name,
    action,
    feedback: null,
  }).catch((err) => console.error("Approval notification failed:", err));

  notify({
    type: "approval",
    severity: "info",
    title: `Content approved: ${campaign.name}`,
    workspaceSlug: campaign.workspaceSlug,
    metadata: { campaignId: id },
  }).catch(() => {});

  return NextResponse.json({ campaign: updated });
}
