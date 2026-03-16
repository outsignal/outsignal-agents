import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getPortalSession } from "@/lib/portal-session";

export async function POST(request: NextRequest) {
  let session;
  try {
    session = await getPortalSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { workspaceSlug } = session;

  try {
    const { conversationId } = await request.json();

    if (!conversationId) {
      return NextResponse.json(
        { error: "conversationId is required" },
        { status: 400 },
      );
    }

    const conversation = await prisma.supportConversation.findFirst({
      where: { id: conversationId, workspaceSlug },
    });

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    }

    await prisma.supportConversation.update({
      where: { id: conversationId },
      data: { unreadByClient: false },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to mark conversation as read:", error);
    return NextResponse.json(
      { error: "Failed to mark as read" },
      { status: 500 },
    );
  }
}
