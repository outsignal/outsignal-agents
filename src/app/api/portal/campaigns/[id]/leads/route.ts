import { NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-session";
import { getCampaign } from "@/lib/campaigns/operations";
import { getWorkspaceBySlug } from "@/lib/workspaces";
import { EmailBisonClient } from "@/lib/emailbison/client";

export async function GET(
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

  if (!campaign.emailBisonCampaignId) {
    return NextResponse.json(
      { error: "Campaign has no EmailBison campaign linked" },
      { status: 400 },
    );
  }

  const workspace = await getWorkspaceBySlug(session.workspaceSlug);
  if (!workspace?.apiToken) {
    return NextResponse.json(
      { error: "Workspace not configured" },
      { status: 400 },
    );
  }

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 25));

  try {
    const client = new EmailBisonClient(workspace.apiToken);
    const response = await client.getCampaignLeads(
      campaign.emailBisonCampaignId,
      page,
      limit,
    );

    return NextResponse.json({
      data: response.data,
      meta: response.meta,
    });
  } catch (err) {
    console.error("[portal/campaigns/leads] EB API error:", err);
    return NextResponse.json(
      { error: "Failed to fetch campaign leads" },
      { status: 502 },
    );
  }
}
