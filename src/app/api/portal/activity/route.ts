import { NextRequest, NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-session";
import { prisma } from "@/lib/db";
import { initAdapters, getAdapter } from "@/lib/channels";
import type { ChannelType } from "@/lib/channels";
import { buildRef } from "@/lib/channels/helpers";

interface ActivityItem {
  id: string;
  channel: "email" | "linkedin";
  actionType:
    | "send"
    | "open"
    | "reply"
    | "bounce"
    | "connect"
    | "message"
    | "profile_view"
    | "connected";
  status: "queued" | "in_progress" | "complete" | "failed";
  personName: string | null;
  personCompany: string | null;
  personLinkedinUrl: string | null;
  personEmail: string | null;
  campaignName: string | null;
  preview: string | null;
  timestamp: string;
}

const STATUS_MAP: Record<string, ActivityItem["status"] | null> = {
  pending: "queued",
  running: "in_progress",
  complete: "complete",
  cancelled: null,
  expired: null,
  failed: null,
};

function truncate(text: string | null | undefined, max: number): string | null {
  if (!text) return null;
  return text.length > max ? text.slice(0, max) + "..." : text;
}

function personFullName(
  firstName: string | null | undefined,
  lastName: string | null | undefined
): string | null {
  const parts = [firstName, lastName].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : null;
}

export async function GET(request: NextRequest) {
  let workspaceSlug: string;
  try {
    const session = await getPortalSession();
    workspaceSlug = session.workspaceSlug;
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Parse query params
  const { searchParams } = request.nextUrl;
  const channel = searchParams.get("channel") || "all";
  const status = searchParams.get("status") || "all";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const limit = Math.min(
    100,
    Math.max(1, parseInt(searchParams.get("limit") || "25", 10) || 25)
  );

  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const from = searchParams.get("from")
    ? new Date(searchParams.get("from")!)
    : defaultFrom;
  const to = searchParams.get("to") ? new Date(searchParams.get("to")!) : now;

  // Validate dates
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return NextResponse.json(
      { error: "Invalid date format for 'from' or 'to'" },
      { status: 400 }
    );
  }

  // Bootstrap adapters before getAdapter() calls
  initAdapters();

  try {
    const items: ActivityItem[] = [];

    // -------------------------------------------------------------------------
    // Campaign-scoped activity — fetched via channel adapters.
    // Replaces direct LinkedInAction and Reply/webhookEvent Prisma queries.
    // Per Phase 74 research: adapter.getActions() covers campaign-scoped data.
    // -------------------------------------------------------------------------

    // Load active campaigns for the workspace
    const campaigns = await prisma.campaign.findMany({
      where: { workspaceSlug, status: { not: "archived" } },
      select: {
        id: true,
        name: true,
        channels: true,
        emailBisonCampaignId: true,
      },
    });

    // Fetch campaign-scoped actions via adapters (one call per campaign × channel)
    const campaignActionsNested = await Promise.all(
      campaigns.flatMap((campaign) => {
        let channelList: string[] = [];
        try {
          channelList = JSON.parse(campaign.channels) as string[];
        } catch {
          channelList = ["email"];
        }
        // Apply channel filter from query params
        if (channel !== "all") {
          channelList = channelList.filter((ch) => ch === channel);
        }
        return channelList.map(async (ch) => {
          const ref = buildRef(campaign, workspaceSlug);
          const adapter = getAdapter(ch as ChannelType);
          return adapter.getActions(ref);
        });
      })
    );
    const campaignActions = campaignActionsNested.flat();

    // Collect personIds from LinkedIn campaign actions for batch person lookup
    const liPersonIds = [
      ...new Set(
        campaignActions
          .filter((a) => a.channel === "linkedin" && a.personId)
          .map((a) => a.personId!)
      ),
    ];
    const liPersonMap = new Map<
      string,
      {
        id: string;
        firstName: string | null;
        lastName: string | null;
        company: string | null;
        linkedinUrl: string | null;
        email: string | null;
      }
    >();
    if (liPersonIds.length > 0) {
      const persons = await prisma.person.findMany({
        where: { id: { in: liPersonIds } },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          company: true,
          linkedinUrl: true,
          email: true,
        },
      });
      for (const p of persons) liPersonMap.set(p.id, p);
    }

    // Map campaign adapter actions to ActivityItem shape
    for (const action of campaignActions) {
      const mappedStatus =
        action.channel === "linkedin"
          ? STATUS_MAP[action.status] ?? null
          : ("complete" as const);
      if (mappedStatus === null) continue; // skip cancelled/expired/failed

      // Apply date range filter (adapters return all — we filter here)
      const ts = action.performedAt;
      if (ts < from || ts > to) continue;

      if (action.channel === "linkedin") {
        const person = action.personId ? liPersonMap.get(action.personId) : undefined;
        items.push({
          id: action.id,
          channel: "linkedin",
          actionType: action.actionType as ActivityItem["actionType"],
          status: mappedStatus,
          personName: person
            ? personFullName(person.firstName, person.lastName)
            : action.personName ?? null,
          personCompany: person?.company ?? null,
          personLinkedinUrl: person?.linkedinUrl ?? null,
          personEmail: person?.email ?? action.personEmail ?? null,
          campaignName: action.campaignName ?? null,
          preview: truncate(action.detail, 100),
          timestamp: ts.toISOString(),
        });
      } else {
        // Email adapter actions
        items.push({
          id: action.id,
          channel: "email",
          actionType: action.actionType as ActivityItem["actionType"],
          status: mappedStatus,
          personName: action.personName ?? null,
          personCompany: null,
          personLinkedinUrl: null,
          personEmail: action.personEmail ?? null,
          campaignName: action.campaignName ?? null,
          preview: truncate(action.detail, 100),
          timestamp: ts.toISOString(),
        });
      }
    }

    // -------------------------------------------------------------------------
    // Non-campaign LinkedIn activity — outside adapter scope, kept as direct queries.
    // Per Phase 74 research: adapter.getActions() covers campaign-scoped data only.
    // LinkedIn messages (LinkedInMessage) and connection accepts (LinkedInConnection)
    // are workspace-level events with no campaign affiliation.
    // -------------------------------------------------------------------------

    if (channel !== "email") {
      const [linkedinMessages, linkedinConnections] = await Promise.all([
        // LinkedIn inbound messages (replies received)
        prisma.linkedInMessage.findMany({
          where: {
            isOutbound: false,
            deliveredAt: { gte: from, lte: to },
            conversation: { workspaceSlug },
          },
          include: {
            conversation: {
              select: {
                workspaceSlug: true,
                personId: true,
                participantName: true,
                participantProfileUrl: true,
              },
            },
          },
          orderBy: { deliveredAt: "desc" },
        }),

        // LinkedIn connections accepted
        prisma.linkedInConnection.findMany({
          where: {
            status: "connected",
            connectedAt: { not: null, gte: from, lte: to },
            sender: { workspaceSlug },
          },
          include: {
            sender: { select: { workspaceSlug: true } },
          },
        }),
      ]);

      // Map LinkedIn inbound messages to activity items
      if (linkedinMessages.length > 0) {
        const msgPersonIds = [
          ...new Set(
            linkedinMessages
              .map((m) => m.conversation.personId)
              .filter(Boolean) as string[]
          ),
        ];
        const msgPersons =
          msgPersonIds.length > 0
            ? await prisma.person.findMany({
                where: { id: { in: msgPersonIds } },
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  company: true,
                  linkedinUrl: true,
                  email: true,
                },
              })
            : [];
        const msgPersonMap = new Map(msgPersons.map((p) => [p.id, p]));

        for (const msg of linkedinMessages) {
          const person = msg.conversation.personId
            ? msgPersonMap.get(msg.conversation.personId)
            : undefined;
          items.push({
            id: msg.id,
            channel: "linkedin",
            actionType: "reply",
            status: "complete",
            personName:
              msg.conversation.participantName ?? msg.senderName ?? null,
            personCompany: person?.company ?? null,
            personLinkedinUrl:
              msg.conversation.participantProfileUrl ??
              person?.linkedinUrl ??
              null,
            personEmail: null,
            campaignName: null,
            preview: truncate(msg.body, 100),
            timestamp: msg.deliveredAt.toISOString(),
          });
        }
      }

      // Map LinkedIn accepted connections to activity items
      if (linkedinConnections.length > 0) {
        const connPersonIds = [
          ...new Set(linkedinConnections.map((c) => c.personId)),
        ];
        const connPersons = await prisma.person.findMany({
          where: { id: { in: connPersonIds } },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            company: true,
            linkedinUrl: true,
            email: true,
          },
        });
        const connPersonMap = new Map(connPersons.map((p) => [p.id, p]));

        for (const conn of linkedinConnections) {
          const person = connPersonMap.get(conn.personId);
          items.push({
            id: conn.id,
            channel: "linkedin",
            actionType: "connected",
            status: "complete",
            personName: person
              ? personFullName(person.firstName, person.lastName)
              : null,
            personCompany: person?.company ?? null,
            personLinkedinUrl: person?.linkedinUrl ?? null,
            personEmail: person?.email ?? null,
            campaignName: null,
            preview: null,
            timestamp: conn.connectedAt!.toISOString(),
          });
        }
      }
    }

    // Apply status filter
    let filtered = items;
    if (status !== "all") {
      if (status === "queued") {
        filtered = items.filter((i) => i.status === "queued");
      } else if (status === "complete") {
        filtered = items.filter((i) => i.status === "complete");
      }
    }

    // Sort by timestamp descending
    filtered.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    // Paginate
    const total = filtered.length;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const paginatedItems = filtered.slice(start, start + limit);

    return NextResponse.json({
      items: paginatedItems,
      total,
      page,
      totalPages,
    });
  } catch (err) {
    console.error("[GET /api/portal/activity] Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch activity" },
      { status: 500 }
    );
  }
}
