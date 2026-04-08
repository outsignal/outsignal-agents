import { NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-session";
import { getCampaign } from "@/lib/campaigns/operations";
import { initAdapters, getAdapter } from "@/lib/channels";
import { buildRef } from "@/lib/channels/helpers";
import type { ChannelType } from "@/lib/channels/constants";

export async function GET(
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

  initAdapters();
  const ref = buildRef(campaign, session.workspaceSlug);

  try {
    if (campaign.channels.length === 0) {
      return NextResponse.json({ data: [], meta: { total: 0 } });
    }

    // Fetch leads from all channels and merge (most campaigns are single-channel)
    const leadsPerChannel = await Promise.all(
      campaign.channels.map((ch: string) =>
        getAdapter(ch as ChannelType).getLeads(ref)
      )
    );

    const leads = leadsPerChannel
      .flat()
      .sort((a, b) => {
        // Sort by addedAt desc (most recently added first)
        const aTime = a.addedAt ? a.addedAt.getTime() : 0;
        const bTime = b.addedAt ? b.addedAt.getTime() : 0;
        return bTime - aTime;
      });

    return NextResponse.json({ data: leads, meta: { total: leads.length } });
  } catch (err) {
    console.error("[portal/campaigns/leads] Adapter error:", err);
    return NextResponse.json(
      { error: "Failed to fetch campaign leads" },
      { status: 500 },
    );
  }
}
