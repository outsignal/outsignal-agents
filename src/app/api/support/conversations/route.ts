import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminAuth } from "@/lib/require-admin-auth";

export async function GET(request: NextRequest) {
  try {
    const session = await requireAdminAuth();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = request.nextUrl;
    const status = searchParams.get("status");

    const conversations = await prisma.supportConversation.findMany({
      where: status ? { status } : undefined,
      include: {
        workspace: { select: { name: true, slug: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { lastMessageAt: "desc" },
    });

    return NextResponse.json({ conversations });
  } catch (error) {
    console.error("Failed to list support conversations:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
