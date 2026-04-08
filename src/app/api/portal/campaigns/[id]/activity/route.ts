import { NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-session";
import { getCampaign } from "@/lib/campaigns/operations";
import { initAdapters, getAdapter } from "@/lib/channels";
import { buildRef } from "@/lib/channels/helpers";
import type { ChannelType } from "@/lib/channels/constants";

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

  initAdapters();
  const ref = buildRef(campaign, session.workspaceSlug);

  const url = new URL(req.url);
  const take = Math.min(200, Math.max(1, Number(url.searchParams.get("take")) || 200));
  const skip = Math.max(0, Number(url.searchParams.get("skip")) || 0);

  try {
    if (campaign.channels.length === 0) {
      return NextResponse.json({ data: [], meta: { total: 0 } });
    }

    // Fetch actions from all campaign channels and merge
    const actionsPerChannel = await Promise.all(
      campaign.channels.map((ch: string) =>
        getAdapter(ch as ChannelType).getActions(ref)
      )
    );

    const allActions = actionsPerChannel
      .flat()
      .sort((a, b) => b.performedAt.getTime() - a.performedAt.getTime());

    // Apply pagination
    const paginated = allActions.slice(skip, skip + take);

    // Serialise dates for JSON response
    const data = paginated.map((action) => ({
      ...action,
      performedAt: action.performedAt.toISOString(),
    }));

    return NextResponse.json({ data, meta: { total: allActions.length } });
  } catch (err) {
    console.error("[portal/campaigns/activity] Adapter error:", err);
    return NextResponse.json(
      { error: "Failed to fetch campaign activity" },
      { status: 500 },
    );
  }
}
