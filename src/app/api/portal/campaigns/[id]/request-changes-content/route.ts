import { NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-session";
import { getCampaign, rejectCampaignContent } from "@/lib/campaigns/operations";

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

  const updated = await rejectCampaignContent(id, feedback.trim());

  return NextResponse.json({ campaign: updated });
}
