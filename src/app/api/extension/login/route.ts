import { NextRequest, NextResponse } from "next/server";
import { validateAdminPassword } from "@/lib/admin-auth";
import { createExtensionToken, extensionCorsHeaders } from "@/lib/extension-auth";
import { prisma } from "@/lib/db";
import { parseJsonBody } from "@/lib/parse-json";
import { rateLimit } from "@/lib/rate-limit";

const loginLimiter = rateLimit({ windowMs: 60_000, max: 5 });

/**
 * OPTIONS /api/extension/login
 * CORS preflight for Chrome extension popup fetch calls.
 */
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: extensionCorsHeaders(request) });
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
  const cors = extensionCorsHeaders(request);

  // Rate limiting — 5 requests per minute per IP
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";
  const { success: rateLimitOk } = loginLimiter(ip);
  if (!rateLimitOk) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: cors },
    );
  }

  try {
    const body = await parseJsonBody<{ email?: string; workspaceSlug?: string; password?: string }>(request);
    if (body instanceof Response) return body;
    const { email, workspaceSlug, password } = body;

    if (!email || !workspaceSlug || !password) {
      return NextResponse.json(
        { error: "email, workspaceSlug, and password are required" },
        { status: 400, headers: cors },
      );
    }

    // Validate password (extension users authenticate with the admin password)
    if (!validateAdminPassword(password)) {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401, headers: cors },
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
        { status: 404, headers: cors },
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
        { status: 400, headers: cors },
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
        { headers: cors },
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
      { headers: cors },
    );
  } catch (error) {
    console.error("[extension/login] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: cors },
    );
  }
}
