import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { prisma } from "@/lib/db";
import { enqueueAction } from "@/lib/linkedin/queue";

/**
 * POST /api/admin/inbox/linkedin/reply
 *
 * Admin version: queues a LinkedIn reply on behalf of any workspace.
 * Body: { workspaceSlug, conversationId, message }
 */
export async function POST(request: NextRequest) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { workspaceSlug, conversationId, message } = body as {
      workspaceSlug?: string;
      conversationId?: string;
      message?: string;
    };

    // Validate required fields
    if (!workspaceSlug || typeof workspaceSlug !== "string") {
      return NextResponse.json(
        { error: "workspaceSlug is required" },
        { status: 400 }
      );
    }
    if (!conversationId || typeof conversationId !== "string" || conversationId.trim() === "") {
      return NextResponse.json(
        { error: "conversationId is required" },
        { status: 400 }
      );
    }
    if (!message || typeof message !== "string" || message.trim() === "") {
      return NextResponse.json(
        { error: "message is required" },
        { status: 400 }
      );
    }

    // Resolve conversation scoped to the specified workspace
    const conv = await prisma.linkedInConversation.findFirst({
      where: { id: conversationId, workspaceSlug },
      select: { senderId: true, personId: true },
    });

    if (!conv) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    if (!conv.personId) {
      return NextResponse.json(
        { error: "Cannot queue reply: lead not matched to a Person record" },
        { status: 422 }
      );
    }

    // Enqueue LinkedIn action with priority 1 (warm lead fast-track)
    const actionId = await enqueueAction({
      senderId: conv.senderId,
      personId: conv.personId,
      workspaceSlug,
      actionType: "message",
      messageBody: message.trim(),
      priority: 1,
      scheduledFor: new Date(),
    });

    return NextResponse.json({ actionId }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/admin/inbox/linkedin/reply] Error:", err);
    return NextResponse.json(
      { error: "Failed to queue message" },
      { status: 500 }
    );
  }
}
