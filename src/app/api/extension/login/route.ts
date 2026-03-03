import { NextRequest, NextResponse } from "next/server";
import { validateAdminPassword } from "@/lib/admin-auth";
import { createExtensionToken } from "@/lib/extension-auth";
import { prisma } from "@/lib/db";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * OPTIONS /api/extension/login
 * CORS preflight for Chrome extension popup fetch calls.
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * POST /api/extension/login
 * Authenticate the Chrome extension user.
 *
 * Body: { email: string, workspaceSlug: string, password: string }
 *
 * Returns:
 *   - workspaceToken (workspace-scoped, senderId = "")
 *   - senders list for the workspace
 *   - senderToken + selectedSenderId if exactly 1 sender (skip select-sender step)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, workspaceSlug, password } = body as {
      email?: string;
      workspaceSlug?: string;
      password?: string;
    };

    if (!email || !workspaceSlug || !password) {
      return NextResponse.json(
        { error: "email, workspaceSlug, and password are required" },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    // Validate password (extension users authenticate with the admin password)
    if (!validateAdminPassword(password)) {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401, headers: CORS_HEADERS },
      );
    }

    // Verify workspace exists
    const workspace = await prisma.workspace.findUnique({
      where: { slug: workspaceSlug },
      select: { slug: true, name: true },
    });

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404, headers: CORS_HEADERS },
      );
    }

    // Fetch senders for the workspace
    const senders = await prisma.sender.findMany({
      where: { workspaceSlug },
      select: {
        id: true,
        name: true,
        emailAddress: true,
        linkedinProfileUrl: true,
        sessionStatus: true,
        healthStatus: true,
      },
    });

    if (senders.length === 0) {
      return NextResponse.json(
        { error: "No senders configured for this workspace" },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    // Workspace-scoped token (senderId = "" means not yet sender-scoped)
    const workspaceToken = createExtensionToken(workspaceSlug, "");

    // If exactly 1 sender, auto-select and return both tokens
    if (senders.length === 1) {
      const senderToken = createExtensionToken(workspaceSlug, senders[0].id);
      return NextResponse.json(
        {
          workspaceToken,
          senders,
          senderToken,
          selectedSenderId: senders[0].id,
        },
        { headers: CORS_HEADERS },
      );
    }

    // Multiple senders — client calls /api/extension/select-sender next
    return NextResponse.json(
      {
        workspaceToken,
        senders,
        senderToken: null,
        selectedSenderId: null,
      },
      { headers: CORS_HEADERS },
    );
  } catch (error) {
    console.error("[extension/login] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
