import { NextRequest, NextResponse } from "next/server";
import { createExtensionToken, extensionCorsHeaders } from "@/lib/extension-auth";
import { prisma } from "@/lib/db";
import { parseJsonBody } from "@/lib/parse-json";
import { rateLimit } from "@/lib/rate-limit";

const extensionAuthLimiter = rateLimit({ windowMs: 60_000, max: 5 });
/**
 * OPTIONS /api/extension/auth
 * CORS preflight for Chrome extension popup fetch calls.
 */
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: extensionCorsHeaders(request) });
}

/**
 * POST /api/extension/auth
 * Authenticate the Chrome extension using a per-sender invite token.
 *
 * Body: { token: string }
 *
 * Returns:
 *   - senderToken: sender-scoped extension auth token
 *   - senderId: the resolved sender's ID
 *   - senderName: display name
 *   - workspaceSlug
 */
export async function POST(request: NextRequest) {
  const cors = extensionCorsHeaders(request);
  try {
    // Rate limiting — 5 requests per minute per IP
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      "unknown";
    const { success: rateLimitOk } = extensionAuthLimiter(ip);
    if (!rateLimitOk) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429, headers: { ...cors, "Retry-After": "60" } },
      );
    }

    const body = await parseJsonBody<{ token?: string }>(request);
    if (body instanceof Response) return body;
    const { token } = body;

    if (!token || typeof token !== "string" || token.trim() === "") {
      return NextResponse.json(
        { error: "token is required" },
        { status: 400, headers: cors },
      );
    }

    const sender = await prisma.sender.findUnique({
      where: { inviteToken: token.trim() },
      select: {
        id: true,
        name: true,
        workspaceSlug: true,
        sessionStatus: true,
        healthStatus: true,
        lastActiveAt: true,
      },
    });

    if (!sender) {
      return NextResponse.json(
        { error: "Invalid invite token" },
        { status: 401, headers: cors },
      );
    }

    const senderToken = createExtensionToken(sender.workspaceSlug, sender.id);

    return NextResponse.json(
      {
        senderToken,
        senderId: sender.id,
        senderName: sender.name,
        workspaceSlug: sender.workspaceSlug,
        sender: {
          sessionStatus: sender.sessionStatus,
          healthStatus: sender.healthStatus,
          lastActiveAt: sender.lastActiveAt,
        },
      },
      { headers: cors },
    );
  } catch (error) {
    console.error("[extension/auth] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: cors },
    );
  }
}

