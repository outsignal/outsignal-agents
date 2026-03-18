import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";

/**
 * POST /api/linkedin/senders/[id]/reconnect
 * Admin endpoint to paste fresh li_at + JSESSIONID cookies for a sender.
 * Encrypts and saves cookies, sets session as active.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { requireAdminAuth } = await import("@/lib/require-admin-auth");
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json();

    const { liAt, jsessionId } = body;
    if (!liAt || !jsessionId) {
      return NextResponse.json(
        { error: "Both liAt and jsessionId are required" },
        { status: 400 },
      );
    }

    // Verify sender exists
    const sender = await prisma.sender.findUnique({
      where: { id },
      select: { id: true, sessionStatus: true },
    });
    if (!sender) {
      return NextResponse.json({ error: "Sender not found" }, { status: 404 });
    }

    // Encrypt cookies in the same format the worker expects
    const cookies = [{ type: "voyager", liAt, jsessionId: jsessionId.replace(/^"|"$/g, "") }];
    const encryptedData = encrypt(JSON.stringify(cookies));

    const now = new Date();
    await prisma.sender.update({
      where: { id },
      data: {
        sessionData: encryptedData,
        sessionStatus: "active",
        healthStatus: "healthy",
        lastActiveAt: now,
        lastKeepaliveAt: now,
        sessionConnectedAt: now,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Reconnect session error:", error);
    return NextResponse.json({ error: "Failed to reconnect session" }, { status: 500 });
  }
}
