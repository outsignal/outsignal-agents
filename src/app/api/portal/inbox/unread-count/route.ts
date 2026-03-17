import { NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-session";
import { prisma } from "@/lib/db";

// GET /api/portal/inbox/unread-count — returns unread counts for nav badge polling
export async function GET() {
  try {
    const { workspaceSlug } = await getPortalSession();

    const [emailCount, linkedinAgg] = await Promise.all([
      prisma.reply.count({
        where: {
          workspaceSlug,
          direction: "inbound",
          isRead: false,
          deletedAt: null,
        },
      }),
      prisma.linkedInConversation.aggregate({
        _sum: { unreadCount: true },
        where: { workspaceSlug },
      }),
    ]);

    const linkedinCount = linkedinAgg._sum.unreadCount ?? 0;
    const total = emailCount + linkedinCount;

    return NextResponse.json({ email: emailCount, linkedin: linkedinCount, total });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unauthorized";
    if (
      message === "No portal session cookie" ||
      message === "Invalid or expired portal session"
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[GET /api/portal/inbox/unread-count] Error:", err);
    return NextResponse.json({ error: "Failed to fetch unread count" }, { status: 500 });
  }
}
