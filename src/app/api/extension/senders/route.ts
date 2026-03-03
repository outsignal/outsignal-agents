import { NextRequest, NextResponse } from "next/server";
import { getExtensionSession } from "@/lib/extension-auth";
import { prisma } from "@/lib/db";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

/**
 * OPTIONS /api/extension/senders
 * CORS preflight.
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * GET /api/extension/senders
 * Returns all senders for the token's workspace.
 *
 * Requires: Bearer token (workspace-scoped or sender-scoped)
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

    const senders = await prisma.sender.findMany({
      where: { workspaceSlug: session.workspaceSlug },
      select: {
        id: true,
        name: true,
        emailAddress: true,
        linkedinProfileUrl: true,
        sessionStatus: true,
        healthStatus: true,
      },
    });

    return NextResponse.json({ senders }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error("[extension/senders] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
