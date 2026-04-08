import { NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-session";
import { getCampaign } from "@/lib/campaigns/operations";
import { getWorkspaceBySlug } from "@/lib/workspaces";
import { EmailBisonClient } from "@/lib/emailbison/client";
import { prisma } from "@/lib/db";

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

  // LinkedIn-only path: no EmailBison campaign — query LinkedInAction instead
  const isLinkedInOnly =
    campaign.channels.includes("linkedin") && !campaign.channels.includes("email");
  if (!campaign.emailBisonCampaignId && isLinkedInOnly) {
    try {
      const actions = await prisma.linkedInAction.findMany({
        where: {
          campaignName: campaign.name,
          workspaceSlug: campaign.workspaceSlug,
        },
        select: {
          id: true,
          actionType: true,
          status: true,
          completedAt: true,
          personId: true,
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      });

      // Resolve person details for actions that have a personId
      const personIds = [...new Set(actions.map((a) => a.personId).filter(Boolean))] as string[];
      const persons =
        personIds.length > 0
          ? await prisma.person.findMany({
              where: { id: { in: personIds } },
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                jobTitle: true,
                company: true,
              },
            })
          : [];
      const personMap = new Map(persons.map((p) => [p.id, p]));

      const data = actions.map((action) => ({
        id: action.id,
        actionType: action.actionType,
        status: action.status,
        completedAt: action.completedAt?.toISOString() ?? null,
        person: action.personId ? (personMap.get(action.personId) ?? null) : null,
      }));

      return NextResponse.json({ data, meta: { total: data.length } });
    } catch (err) {
      console.error("[portal/campaigns/leads] LinkedIn actions query error:", err);
      return NextResponse.json(
        { error: "Failed to fetch LinkedIn actions" },
        { status: 500 },
      );
    }
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
