import { NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-session";
import { getCampaign } from "@/lib/campaigns/operations";
import { prisma } from "@/lib/db";

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

  const isLinkedInOnly =
    campaign.channels.includes("linkedin") && !campaign.channels.includes("email");

  // ---------------------------------------------------------------------------
  // Email campaign activity: query WebhookEvent table
  // ---------------------------------------------------------------------------
  if (!isLinkedInOnly && campaign.emailBisonCampaignId) {
    try {
      const events = await prisma.webhookEvent.findMany({
        where: {
          workspace: campaign.workspaceSlug,
          campaignId: String(campaign.emailBisonCampaignId),
          eventType: {
            in: [
              "EMAIL_SENT",
              "LEAD_REPLIED",
              "LEAD_INTERESTED",
              "EMAIL_BOUNCED",
              "LEAD_UNSUBSCRIBED",
              "EMAIL_OPENED",
            ],
          },
          isAutomated: false,
        },
        select: {
          id: true,
          eventType: true,
          leadEmail: true,
          receivedAt: true,
        },
        orderBy: { receivedAt: "desc" },
        take: 200,
      });

      // Resolve person details by email
      const emails = [...new Set(events.map((e) => e.leadEmail).filter(Boolean))] as string[];
      const persons =
        emails.length > 0
          ? await prisma.person.findMany({
              where: { email: { in: emails } },
              select: {
                email: true,
                firstName: true,
                lastName: true,
                jobTitle: true,
                company: true,
              },
            })
          : [];
      const personMap = new Map(persons.map((p) => [p.email, p]));

      const data = events.map((evt) => ({
        id: evt.id,
        eventType: evt.eventType,
        leadEmail: evt.leadEmail,
        receivedAt: evt.receivedAt.toISOString(),
        person: evt.leadEmail ? (personMap.get(evt.leadEmail) ?? null) : null,
      }));

      return NextResponse.json({ data, meta: { total: data.length }, type: "email" });
    } catch (err) {
      console.error("[portal/campaigns/activity] WebhookEvent query error:", err);
      return NextResponse.json(
        { error: "Failed to fetch email activity" },
        { status: 500 },
      );
    }
  }

  // ---------------------------------------------------------------------------
  // LinkedIn-only campaign activity: query LinkedInAction table
  // ---------------------------------------------------------------------------
  if (!isLinkedInOnly) {
    return NextResponse.json(
      { error: "No activity data available for this campaign" },
      { status: 400 },
    );
  }

  try {
    const actions = await prisma.linkedInAction.findMany({
      where: {
        campaignName: campaign.name,
        workspaceSlug: campaign.workspaceSlug,
        actionType: { in: ["connection_request", "message", "profile_view"] },
      },
      select: {
        id: true,
        actionType: true,
        status: true,
        completedAt: true,
        scheduledFor: true,
        personId: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    // Resolve person details
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
      scheduledFor: action.scheduledFor.toISOString(),
      createdAt: action.createdAt.toISOString(),
      person: action.personId ? (personMap.get(action.personId) ?? null) : null,
    }));

    return NextResponse.json({ data, meta: { total: data.length }, type: "linkedin" });
  } catch (err) {
    console.error("[portal/campaigns/activity] LinkedIn actions query error:", err);
    return NextResponse.json(
      { error: "Failed to fetch LinkedIn activity" },
      { status: 500 },
    );
  }
}
