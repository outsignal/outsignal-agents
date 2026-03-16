import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminAuth } from "@/lib/require-admin-auth";

export async function GET(request: NextRequest) {
  try {
    const session = await requireAdminAuth();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const count = await prisma.supportConversation.count({
      where: { unreadByAdmin: true, status: "open" },
    });

    return NextResponse.json({ count });
  } catch (error) {
    console.error("Failed to fetch unread count:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
