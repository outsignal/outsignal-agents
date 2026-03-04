import { NextRequest, NextResponse } from "next/server";
import { verifyWorkerAuth } from "@/lib/linkedin/auth";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";

/**
 * GET /api/linkedin/senders/[id]/cookies
 * Returns decrypted session cookies for a sender.
 * Worker-only endpoint — used to load Voyager API cookies (li_at + JSESSIONID).
 *
 * Cookie format bridge:
 * The Chrome extension saves cookies as a browser array:
 *   [{ name: "li_at", value: "...", domain: ".linkedin.com" }, ...]
 * The worker expects voyager format:
 *   [{ type: "voyager", liAt: "...", jsessionId: "..." }]
 * This endpoint detects the browser array format and transforms it automatically.
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
    let parsed: unknown;
    try {
      const decrypted = decrypt(sender.sessionData);
      parsed = JSON.parse(decrypted);
    } catch {
      return NextResponse.json(
        { error: "Failed to decrypt session data" },
        { status: 500 },
      );
    }

    // Bridge: Chrome extension saves cookies as browser array
    // [{ name: "li_at", value: "...", domain: ".linkedin.com" }, ...]
    // but the worker expects voyager format: { type: "voyager", liAt, jsessionId }
    if (Array.isArray(parsed)) {
      const liAtEntry = parsed.find(
        (c: Record<string, unknown>) => c?.name === "li_at",
      );
      const jsessionEntry = parsed.find(
        (c: Record<string, unknown>) => c?.name === "JSESSIONID",
      );

      const liAt = typeof liAtEntry?.value === "string" ? liAtEntry.value : null;
      const jsessionId = typeof jsessionEntry?.value === "string" ? jsessionEntry.value : null;

      if (!liAt || !jsessionId) {
        return NextResponse.json(
          {
            error: "Session cookies missing required values (li_at or JSESSIONID)",
            detail: { hasLiAt: !!liAt, hasJsessionId: !!jsessionId },
          },
          { status: 422 },
        );
      }

      return NextResponse.json({
        cookies: [{ type: "voyager" as const, liAt, jsessionId }],
      });
    }

    // Already in expected format — return as-is
    return NextResponse.json({ cookies: Array.isArray(parsed) ? parsed : [parsed] });
  } catch (error) {
    console.error("Get cookies error:", error);
    return NextResponse.json(
      { error: "Failed to get cookies" },
      { status: 500 },
    );
  }
}
