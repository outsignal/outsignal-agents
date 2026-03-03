import { NextRequest, NextResponse } from "next/server";
import { getExtensionSession } from "@/lib/extension-auth";
import { prisma } from "@/lib/db";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

/**
 * OPTIONS /api/extension/status
 * CORS preflight.
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * GET /api/extension/status
 * Returns the sender's connection status for the extension popup to display.
 *
 * Requires: Bearer sender-scoped token
 */
export async function GET(request: NextRequest) {
  try {
    const session = getExtensionSession(request);
    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: CORS_HEADERS },
      );
    }

    if (!session.senderId) {
      return NextResponse.json(
        { error: "Token is workspace-scoped; please select a sender first" },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    const sender = await prisma.sender.findUnique({
      where: { id: session.senderId },
      select: {
        id: true,
        name: true,
        sessionStatus: true,
        healthStatus: true,
        lastActiveAt: true,
      },
    });

    if (!sender) {
      return NextResponse.json(
        { error: "Sender not found" },
        { status: 404, headers: CORS_HEADERS },
      );
    }

    return NextResponse.json({ sender }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error("[extension/status] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
