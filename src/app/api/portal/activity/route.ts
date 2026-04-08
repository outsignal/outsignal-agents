import { NextRequest, NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-session";
import { prisma } from "@/lib/db";

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

  try {
    const items: ActivityItem[] = [];

    // Fetch LinkedIn actions, email replies, LinkedIn messages, and connections in parallel
    const [linkedInActions, replies, linkedinMessages, linkedinConnections] = await Promise.all([
      // LinkedIn actions — exclude profile_view and failed
      channel === "email"
        ? Promise.resolve([])
        : prisma.linkedInAction.findMany({
            where: {
              workspaceSlug,
              actionType: { notIn: ["check_connection"] },
              status: { notIn: ["failed", "cancelled", "expired"] },
              OR: [
                { scheduledFor: { gte: from, lte: to } },
                { completedAt: { gte: from, lte: to } },
              ],
            },
            orderBy: { scheduledFor: "desc" },
          }),

      // Email replies
      channel === "linkedin"
        ? Promise.resolve([])
        : prisma.reply.findMany({
            where: {
              workspaceSlug,
              receivedAt: { gte: from, lte: to },
              deletedAt: null,
            },
            include: {
              person: {
                select: {
                  firstName: true,
                  lastName: true,
                  email: true,
                  company: true,
                  linkedinUrl: true,
                },
              },
            },
            orderBy: { receivedAt: "desc" },
          }),

      // LinkedIn inbound messages (replies received)
      channel === "email"
        ? Promise.resolve([])
        : prisma.linkedInMessage.findMany({
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
      channel === "email"
        ? Promise.resolve([])
        : prisma.linkedInConnection.findMany({
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

    // Collect unique personIds from LinkedIn actions for batch lookup
    if (linkedInActions.length > 0) {
      const personIds = [
        ...new Set(linkedInActions.map((a) => a.personId).filter((id): id is string => id !== null)),
      ];
      const persons = await prisma.person.findMany({
        where: { id: { in: personIds } },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          company: true,
          linkedinUrl: true,
          email: true,
        },
      });
      const personMap = new Map(persons.map((p) => [p.id, p]));

      for (const action of linkedInActions) {
        const mappedStatus = STATUS_MAP[action.status];
        if (mappedStatus === null) continue; // skip cancelled/expired/failed

        const person = action.personId ? personMap.get(action.personId) : undefined;
        items.push({
          id: action.id,
          channel: "linkedin",
          actionType: action.actionType as ActivityItem["actionType"],
          status: mappedStatus,
          personName: person
            ? personFullName(person.firstName, person.lastName)
            : null,
          personCompany: person?.company ?? null,
          personLinkedinUrl: person?.linkedinUrl ?? null,
          personEmail: person?.email ?? null,
          campaignName: action.campaignName ?? null,
          preview: truncate(action.messageBody, 100),
          timestamp: (
            action.completedAt ?? action.scheduledFor
          ).toISOString(),
        });
      }
    }

    // Map replies to activity items
    for (const reply of replies) {
      const isOutbound = reply.direction === "outbound";
      // For outbound sends, show the recipient (lead) info, not the sender account
      const displayName = isOutbound
        ? (reply.person
            ? personFullName(reply.person.firstName, reply.person.lastName)
            : null) ?? reply.leadEmail
        : reply.senderName ?? null;
      const displayEmail = isOutbound
        ? reply.leadEmail ?? reply.person?.email ?? null
        : reply.senderEmail;
      items.push({
        id: reply.id,
        channel: "email",
        actionType: isOutbound ? "send" : "reply",
        status: "complete",
        personName: displayName,
        personCompany: reply.person?.company ?? null,
        personLinkedinUrl: reply.person?.linkedinUrl ?? null,
        personEmail: displayEmail,
        campaignName: reply.campaignName ?? null,
        preview: truncate(reply.bodyText, 100),
        timestamp: reply.receivedAt.toISOString(),
      });
    }

    // Map LinkedIn inbound messages to activity items
    if (linkedinMessages.length > 0) {
      // Batch-fetch Person records for messages that have a personId
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
