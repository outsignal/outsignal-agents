import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { prisma } from "@/lib/db";

const PAGE_SIZE = 20;

// GET /api/deliverability/events?workspace=slug&cursor=eventId
export async function GET(request: NextRequest) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const workspace = request.nextUrl.searchParams.get("workspace");
    const cursor = request.nextUrl.searchParams.get("cursor");

    const where = workspace ? { workspaceSlug: workspace } : {};

    const events = await prisma.emailHealthEvent.findMany({
      take: PAGE_SIZE + 1, // fetch one extra to detect hasMore
      ...(cursor
        ? {
            skip: 1,
            cursor: { id: cursor },
          }
        : {}),
      orderBy: { createdAt: "desc" },
      where,
    });

    const hasMore = events.length === PAGE_SIZE + 1;
    const pageEvents = hasMore ? events.slice(0, PAGE_SIZE) : events;
    const nextCursor =
      hasMore && pageEvents.length > 0
        ? pageEvents[pageEvents.length - 1].id
        : null;

    return NextResponse.json({
      events: pageEvents.map((e) => ({
        id: e.id,
        senderEmail: e.senderEmail,
        senderDomain: e.senderDomain,
        workspaceSlug: e.workspaceSlug,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        reason: e.reason,
        bouncePct: e.bouncePct,
        detail: e.detail,
        createdAt: e.createdAt,
      })),
      hasMore,
      nextCursor,
    });
  } catch (err) {
    console.error("[deliverability/events] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
