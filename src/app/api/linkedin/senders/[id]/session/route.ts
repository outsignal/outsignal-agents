import { NextRequest, NextResponse } from "next/server";
import { verifyWorkerAuth } from "@/lib/linkedin/auth";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";

/**
 * GET /api/linkedin/senders/[id]/session
 * Returns the session status for a sender.
 * Used by the dashboard to poll for login completion.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const sender = await prisma.sender.findUnique({
    where: { id },
    select: {
      sessionStatus: true,
      healthStatus: true,
      lastActiveAt: true,
    },
  });

  if (!sender) {
    return NextResponse.json({ error: "Sender not found" }, { status: 404 });
  }

  return NextResponse.json(sender);
}

/**
 * POST /api/linkedin/senders/[id]/session
 * Save session cookies from the worker after a successful login.
 * Encrypts cookies before storing.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!verifyWorkerAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json();

    if (!body.cookies || !Array.isArray(body.cookies)) {
      return NextResponse.json({ error: "cookies array is required" }, { status: 400 });
    }

    // Encrypt cookies before storing
    const encryptedData = encrypt(JSON.stringify(body.cookies));

    await prisma.sender.update({
      where: { id },
      data: {
        sessionData: encryptedData,
        sessionStatus: "active",
        lastActiveAt: new Date(),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Save session error:", error);
    return NextResponse.json({ error: "Failed to save session" }, { status: 500 });
  }
}
