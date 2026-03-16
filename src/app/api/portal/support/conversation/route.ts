import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getPortalSession } from "@/lib/portal-session";

export async function GET() {
  let session;
  try {
    session = await getPortalSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { workspaceSlug } = session;

  try {
    let conversation = await prisma.supportConversation.findFirst({
      where: { workspaceSlug, status: "open" },
      include: {
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });

    if (!conversation) {
      conversation = await prisma.supportConversation.create({
        data: { workspaceSlug },
        include: {
          messages: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      });
    }

    return NextResponse.json(conversation);
  } catch (error) {
    console.error("Failed to get/create support conversation:", error);
    return NextResponse.json(
      { error: "Failed to load conversation" },
      { status: 500 },
    );
  }
}
