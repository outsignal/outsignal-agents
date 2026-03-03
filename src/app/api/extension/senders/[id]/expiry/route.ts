import { NextRequest, NextResponse } from "next/server";
import { getExtensionSession } from "@/lib/extension-auth";
import { prisma } from "@/lib/db";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * OPTIONS /api/extension/senders/[id]/expiry
 * CORS preflight.
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * POST /api/extension/senders/[id]/expiry
 * Report that the LinkedIn session has expired (detected by the Chrome extension).
 *
 * Requires: Bearer sender-scoped token (must match route [id])
 *
 * Updates sessionStatus=expired, healthStatus=session_expired and creates a
 * SenderHealthEvent for the Phase 13 health check system to pick up.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = getExtensionSession(request);
    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: CORS_HEADERS },
      );
    }

    const { id } = await params;

    // Prevent cross-sender access — token must be scoped to this sender
    if (session.senderId !== id) {
      return NextResponse.json(
        { error: "Forbidden — token is not scoped to this sender" },
        { status: 403, headers: CORS_HEADERS },
      );
    }

    // Update sender status and create health event atomically
    await prisma.$transaction([
      prisma.sender.update({
        where: { id },
        data: {
          sessionStatus: "expired",
          healthStatus: "session_expired",
        },
      }),
      prisma.senderHealthEvent.create({
        data: {
          senderId: id,
          status: "session_expired",
          reason: "session_expired",
          detail:
            "LinkedIn session expired (detected by Chrome extension)",
        },
      }),
    ]);

    return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error("[extension/senders/[id]/expiry] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
