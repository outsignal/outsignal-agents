import { NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-session";
import { prisma } from "@/lib/db";

// POST /api/portal/inbox/email/mark-all-read — marks all unread inbound emails as read
export async function POST() {
  try {
    const { workspaceSlug } = await getPortalSession();

    const result = await prisma.reply.updateMany({
      where: {
        workspaceSlug,
        direction: "inbound",
        isRead: false,
        deletedAt: null,
      },
      data: { isRead: true },
    });

    return NextResponse.json({ updated: result.count });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (
      message === "No portal session cookie" ||
      message === "Invalid or expired portal session"
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[POST /api/portal/inbox/email/mark-all-read] Error:", err);
    return NextResponse.json({ error: "Failed to mark all as read" }, { status: 500 });
  }
}
