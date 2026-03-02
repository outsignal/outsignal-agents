import { NextRequest, NextResponse } from "next/server";
import { verifyWorkerAuth } from "@/lib/linkedin/auth";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";

/**
 * GET /api/linkedin/senders/[id]/cookies
 * Returns decrypted session cookies for a sender.
 * Worker-only endpoint — used to load Voyager API cookies (li_at + JSESSIONID).
 * Follows the same pattern as the credentials endpoint.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!verifyWorkerAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;

    const sender = await prisma.sender.findUnique({
      where: { id },
      select: {
        id: true,
        sessionData: true,
        sessionStatus: true,
      },
    });

    if (!sender) {
      return NextResponse.json({ error: "Sender not found" }, { status: 404 });
    }

    if (!sender.sessionData) {
      return NextResponse.json({ cookies: null });
    }

    // Decrypt session data
    let cookies: unknown[];
    try {
      const decrypted = decrypt(sender.sessionData);
      cookies = JSON.parse(decrypted);
    } catch {
      return NextResponse.json(
        { error: "Failed to decrypt session data" },
        { status: 500 },
      );
    }

    return NextResponse.json({ cookies });
  } catch (error) {
    console.error("Get cookies error:", error);
    return NextResponse.json(
      { error: "Failed to get cookies" },
      { status: 500 },
    );
  }
}
