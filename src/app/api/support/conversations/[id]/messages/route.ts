import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminAuth } from "@/lib/require-admin-auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAdminAuth();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const messages = await prisma.supportMessage.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ messages });
  } catch (error) {
    console.error("Failed to fetch support messages:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAdminAuth();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const { content } = await request.json();

    const message = await prisma.supportMessage.create({
      data: {
        conversationId: id,
        role: "admin",
        content,
      },
    });

    await prisma.supportConversation.update({
      where: { id },
      data: {
        lastMessageAt: new Date(),
        unreadByClient: true,
        unreadByAdmin: false,
      },
    });

    return NextResponse.json(message);
  } catch (error) {
    console.error("Failed to create admin reply:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
