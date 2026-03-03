import { NextRequest, NextResponse } from "next/server";
import { getExtensionSession, createExtensionToken } from "@/lib/extension-auth";
import { prisma } from "@/lib/db";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * OPTIONS /api/extension/select-sender
 * CORS preflight.
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * POST /api/extension/select-sender
 * Convert a workspace-scoped token to a sender-scoped token.
 *
 * Requires: Bearer workspace token (senderId = "")
 * Body: { senderId: string }
 *
 * Returns: { senderToken }
 */
export async function POST(request: NextRequest) {
  try {
    const session = getExtensionSession(request);
    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: CORS_HEADERS },
      );
    }

    const body = await request.json();
    const { senderId } = body as { senderId?: string };

    if (!senderId) {
      return NextResponse.json(
        { error: "senderId is required" },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    // Verify the sender belongs to the token's workspace
    const sender = await prisma.sender.findFirst({
      where: { id: senderId, workspaceSlug: session.workspaceSlug },
      select: { id: true, name: true },
    });

    if (!sender) {
      return NextResponse.json(
        { error: "Sender not found in this workspace" },
        { status: 404, headers: CORS_HEADERS },
      );
    }

    const senderToken = createExtensionToken(session.workspaceSlug, senderId);

    return NextResponse.json({ senderToken }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error("[extension/select-sender] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
