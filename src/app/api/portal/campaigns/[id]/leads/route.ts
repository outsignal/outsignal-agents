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

  // LinkedIn-only path: return people from the target list with derived status
  const isLinkedInOnly =
    campaign.channels.includes("linkedin") && !campaign.channels.includes("email");
  if (!campaign.emailBisonCampaignId && isLinkedInOnly) {
    if (!campaign.targetListId) {
      return NextResponse.json({ data: [], meta: { total: 0 } });
    }
    try {
      const entries = await prisma.targetListPerson.findMany({
        where: { listId: campaign.targetListId },
        include: {
          person: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              jobTitle: true,
              company: true,
              linkedinUrl: true,
            },
          },
        },
        orderBy: { addedAt: "asc" },
      });

      if (entries.length === 0) {
        return NextResponse.json({ data: [], meta: { total: 0 } });
      }

      // Get all personIds from the target list
      const personIds = entries.map((e) => e.personId);

      // Find which people have LinkedIn actions for this campaign
      const actions = await prisma.linkedInAction.findMany({
        where: {
          campaignName: campaign.name,
          workspaceSlug: campaign.workspaceSlug,
          personId: { in: personIds },
        },
        select: {
          personId: true,
          actionType: true,
          status: true,
        },
      });

      // Build a map: personId -> set of completed action types
      const actionMap = new Map<string, { hasContact: boolean; hasConnect: boolean }>();
      for (const action of actions) {
        if (!action.personId) continue;
        const existing = actionMap.get(action.personId) ?? { hasContact: false, hasConnect: false };
        if (action.status === "complete") {
          if (action.actionType === "connection_request") existing.hasConnect = true;
          if (action.actionType === "message") existing.hasContact = true;
          if (action.actionType === "profile_view") existing.hasContact = true;
        } else if (action.status === "pending" || action.status === "running") {
          // Any pending/running action means they have been contacted (action queued)
          existing.hasContact = true;
        }
        actionMap.set(action.personId, existing);
      }

      // Check replies for these people
      const replies = await prisma.reply.findMany({
        where: {
          campaignId: campaign.id,
          workspaceSlug: campaign.workspaceSlug,
        },
        select: { senderEmail: true },
      });

      // Build a set of emails with replies (LinkedIn replies come via email notification)
      const replierEmails = new Set(replies.map((r) => r.senderEmail.toLowerCase()));

      const data = entries.map((entry) => {
        const person = entry.person;
        const actInfo = actionMap.get(entry.personId);
        const hasReplied = person.email ? replierEmails.has(person.email.toLowerCase()) : false;

        let leadStatus: "pending" | "contacted" | "connected" | "replied";
        if (hasReplied) {
          leadStatus = "replied";
        } else if (actInfo?.hasConnect) {
          leadStatus = "connected";
        } else if (actInfo?.hasContact) {
          leadStatus = "contacted";
        } else {
          leadStatus = "pending";
        }

        return {
          id: entry.id,
          personId: person.id,
          firstName: person.firstName,
          lastName: person.lastName,
          email: person.email,
          jobTitle: person.jobTitle,
          company: person.company,
          linkedinUrl: person.linkedinUrl,
          status: leadStatus,
          addedAt: entry.addedAt.toISOString(),
        };
      });

      return NextResponse.json({ data, meta: { total: data.length } });
    } catch (err) {
      console.error("[portal/campaigns/leads] LinkedIn target list query error:", err);
      return NextResponse.json(
        { error: "Failed to fetch campaign leads" },
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
