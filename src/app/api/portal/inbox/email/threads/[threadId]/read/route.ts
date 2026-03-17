import { NextRequest, NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-session";
import { prisma } from "@/lib/db";

// POST /api/portal/inbox/email/threads/[threadId]/read — marks all inbound replies in a thread as read
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  try {
    const { workspaceSlug } = await getPortalSession();
    const { threadId: threadIdStr } = await params;
    const threadId = parseInt(threadIdStr, 10);

    if (isNaN(threadId)) {
      return NextResponse.json({ error: "Invalid threadId" }, { status: 400 });
    }

    // Mark all inbound replies in this thread as read.
    // Thread root may be referenced as emailBisonParentId (for replies) or
    // as emailBisonReplyId (the root message itself).
    await prisma.reply.updateMany({
      where: {
        workspaceSlug,
        direction: "inbound",
        isRead: false,
        deletedAt: null,
        OR: [
          { emailBisonParentId: threadId },
          { emailBisonReplyId: threadId },
        ],
      },
      data: { isRead: true },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (
      message === "No portal session cookie" ||
      message === "Invalid or expired portal session"
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[POST /api/portal/inbox/email/threads/[threadId]/read] Error:", err);
    return NextResponse.json({ error: "Failed to mark thread as read" }, { status: 500 });
  }
}
