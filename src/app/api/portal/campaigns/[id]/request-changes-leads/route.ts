import { NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-session";
import { getCampaign, rejectCampaignLeads } from "@/lib/campaigns/operations";
import { notifyApproval } from "@/lib/notifications";
import { notify } from "@/lib/notify";

export async function POST(
  req: Request,
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

  const body = await req.json();
  const feedback = body.feedback;
  if (!feedback || typeof feedback !== "string" || !feedback.trim()) {
    return NextResponse.json(
      { error: "Feedback text is required" },
      { status: 400 },
    );
  }

  const updated = await rejectCampaignLeads(id, feedback.trim());

  notifyApproval({
    workspaceSlug: session.workspaceSlug,
    campaignId: id,
    campaignName: campaign.name,
    action: "leads_rejected",
    feedback: feedback.trim(),
  }).catch((err) => console.error("Approval notification failed:", err));

  notify({
    type: "approval",
    severity: "warning",
    title: `Lead changes requested: ${campaign.name}`,
    message: feedback.trim() || undefined,
    workspaceSlug: campaign.workspaceSlug,
    metadata: { campaignId: id },
  }).catch(() => {});

  return NextResponse.json({ campaign: updated });
}
