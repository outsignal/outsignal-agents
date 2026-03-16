import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getPortalSession } from "@/lib/portal-session";
import { generateAutoResponse } from "@/lib/support/auto-respond";

export async function GET(request: NextRequest) {
  let session;
  try {
    session = await getPortalSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { workspaceSlug } = session;

  try {
    const { searchParams } = request.nextUrl;
    const conversationId = searchParams.get("conversationId");
    const cursor = searchParams.get("cursor");

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

    const messages = await prisma.supportMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take: 50,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    const nextCursor =
      messages.length === 50 ? messages[messages.length - 1].id : null;

    return NextResponse.json({ messages, nextCursor });
  } catch (error) {
    console.error("Failed to fetch support messages:", error);
    return NextResponse.json(
      { error: "Failed to load messages" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  let session;
  try {
    session = await getPortalSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { workspaceSlug } = session;

  try {
    const { conversationId, content } = await request.json();

    if (!conversationId || !content) {
      return NextResponse.json(
        { error: "conversationId and content are required" },
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

    const clientMessage = await prisma.supportMessage.create({
      data: { conversationId, role: "client", content },
    });

    await prisma.supportConversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date(), unreadByAdmin: true },
    });

    const aiResponse = await generateAutoResponse(conversationId, content);

    return NextResponse.json({ clientMessage, aiResponse });
  } catch (error) {
    console.error("Failed to send support message:", error);
    return NextResponse.json(
      { error: "Failed to send message" },
      { status: 500 },
    );
  }
}
