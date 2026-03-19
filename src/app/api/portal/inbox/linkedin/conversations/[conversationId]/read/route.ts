import { NextRequest, NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-session";
import { prisma } from "@/lib/db";

// POST /api/portal/inbox/linkedin/conversations/[conversationId]/read — marks a conversation as read
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  try {
    const { workspaceSlug } = await getPortalSession();
    const { conversationId } = await params;

    // Update only if the conversation belongs to this workspace
    const result = await prisma.linkedInConversation.updateMany({
      where: {
        id: conversationId,
        workspaceSlug,
      },
      data: { unreadCount: 0 },
    });

    if (result.count === 0) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (
      message === "No portal session cookie" ||
      message === "Invalid or expired portal session"
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error(
      "[POST /api/portal/inbox/linkedin/conversations/[conversationId]/read] Error:",
      err,
    );
    return NextResponse.json(
      { error: "Failed to mark conversation as read" },
      { status: 500 },
    );
  }
}

// DELETE /api/portal/inbox/linkedin/conversations/[conversationId]/read — marks as unread
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  try {
    const { workspaceSlug } = await getPortalSession();
    const { conversationId } = await params;

    // Update only if the conversation belongs to this workspace
    const result = await prisma.linkedInConversation.updateMany({
      where: {
        id: conversationId,
        workspaceSlug,
      },
      data: { unreadCount: 1 },
    });

    if (result.count === 0) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (
      message === "No portal session cookie" ||
      message === "Invalid or expired portal session"
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error(
      "[DELETE /api/portal/inbox/linkedin/conversations/[conversationId]/read] Error:",
      err,
    );
    return NextResponse.json(
      { error: "Failed to mark conversation as unread" },
      { status: 500 },
    );
  }
}
