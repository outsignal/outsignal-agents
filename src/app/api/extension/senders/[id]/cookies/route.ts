import { NextRequest, NextResponse } from "next/server";
import { getExtensionSession, extensionCorsHeaders } from "@/lib/extension-auth";
import { encrypt } from "@/lib/crypto";
import { prisma } from "@/lib/db";

/**
 * OPTIONS /api/extension/senders/[id]/cookies
 * CORS preflight.
 */
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: extensionCorsHeaders(request) });
}

/**
 * POST /api/extension/senders/[id]/cookies
 * Save LinkedIn session cookies captured by the Chrome extension.
 *
 * Requires: Bearer sender-scoped token (must match route [id])
 * Body: { cookies: Array<{ name: string, value: string, domain: string }> }
 *
 * Encrypts cookies before storing. Sets sessionStatus=active, loginMethod=extension.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const cors = extensionCorsHeaders(request);
  try {
    const session = getExtensionSession(request);
    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: cors },
      );
    }

    const { id } = await params;

    // Prevent cross-sender access — token must be scoped to this sender
    if (session.senderId !== id) {
      return NextResponse.json(
        { error: "Forbidden — token is not scoped to this sender" },
        { status: 403, headers: cors },
      );
    }

    const body = await request.json();
    const { cookies, linkedinProfileUrl } = body as {
      cookies?: Array<{ name: string; value: string; domain: string }>;
      linkedinProfileUrl?: string;
    };

    if (!cookies || !Array.isArray(cookies) || cookies.length === 0) {
      return NextResponse.json(
        { error: "cookies array is required and must be non-empty" },
        { status: 400, headers: cors },
      );
    }

    // Warn if li_at is missing (still save all cookies)
    const hasLiAt = cookies.some((c) => c.name === "li_at");

    // Encrypt and store
    const encryptedData = encrypt(JSON.stringify(cookies));

    await prisma.sender.update({
      where: { id },
      data: {
        sessionData: encryptedData,
        sessionStatus: "active",
        loginMethod: "extension",
        lastActiveAt: new Date(),
        healthStatus: "healthy", // Clear any prior session_expired flag
        ...(linkedinProfileUrl ? { linkedinProfileUrl } : {}),
      },
    });

    return NextResponse.json(
      {
        ok: true,
        linkedinConnected: true,
        warnings: hasLiAt ? [] : ["li_at cookie not found in saved cookies"],
      },
      { headers: cors },
    );
  } catch (error) {
    console.error("[extension/senders/[id]/cookies] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: cors },
    );
  }
}
