import { NextRequest, NextResponse } from "next/server";
import { verifyWorkerAuth } from "@/lib/linkedin/auth";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";

/**
 * GET /api/linkedin/senders/[id]/credentials
 * Returns decrypted LinkedIn credentials for a sender.
 * Worker-only endpoint — used for auto-login when session expires.
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
        linkedinEmail: true,
        linkedinPassword: true,
        totpSecret: true,
        loginMethod: true,
      },
    });

    if (!sender) {
      return NextResponse.json({ error: "Sender not found" }, { status: 404 });
    }

    if (!sender.linkedinEmail || !sender.linkedinPassword) {
      return NextResponse.json(
        { error: "No credentials stored for this sender" },
        { status: 404 },
      );
    }

    // Decrypt password and optional TOTP secret
    let password: string;
    try {
      password = decrypt(sender.linkedinPassword);
    } catch {
      return NextResponse.json(
        { error: "Failed to decrypt credentials" },
        { status: 500 },
      );
    }

    let totpSecret: string | undefined;
    if (sender.totpSecret) {
      try {
        totpSecret = decrypt(sender.totpSecret);
      } catch {
        // TOTP decrypt failure is non-fatal — login may still work without 2FA
        console.warn(`Failed to decrypt TOTP secret for sender ${id}`);
      }
    }

    return NextResponse.json({
      email: sender.linkedinEmail,
      password,
      totpSecret,
    });
  } catch (error) {
    console.error("Get credentials error:", error);
    return NextResponse.json(
      { error: "Failed to get credentials" },
      { status: 500 },
    );
  }
}
