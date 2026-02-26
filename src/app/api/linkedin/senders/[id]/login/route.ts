import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { getPortalSession } from "@/lib/portal-session";

const WORKER_URL = process.env.LINKEDIN_WORKER_URL;
const WORKER_SECRET = process.env.WORKER_API_SECRET;

/**
 * POST /api/linkedin/senders/[id]/login
 * Initiate a headless LinkedIn login via the Railway worker.
 * Called from the portal by authenticated clients.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getPortalSession();
    const { id } = await params;

    // Verify the sender belongs to this workspace
    const sender = await prisma.sender.findUnique({
      where: { id },
      select: { id: true, workspaceSlug: true, proxyUrl: true },
    });

    if (!sender || sender.workspaceSlug !== session.workspaceSlug) {
      return NextResponse.json({ error: "Sender not found" }, { status: 404 });
    }

    if (!WORKER_URL || !WORKER_SECRET) {
      return NextResponse.json(
        { error: "LinkedIn worker is not configured" },
        { status: 500 },
      );
    }

    const body = await request.json();
    const { email, password, totpSecret, verificationCode, method } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: "email and password are required" },
        { status: 400 },
      );
    }

    // Store encrypted credentials on the sender
    const updateData: Record<string, string> = {
      linkedinEmail: email,
      linkedinPassword: encrypt(password),
      loginMethod: method || "credentials",
    };

    if (totpSecret) {
      updateData.totpSecret = encrypt(totpSecret);
    }

    await prisma.sender.update({
      where: { id },
      data: updateData,
    });

    // Call the worker's headless login endpoint
    const workerResponse = await fetch(`${WORKER_URL}/sessions/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${WORKER_SECRET}`,
      },
      body: JSON.stringify({
        senderId: id,
        email,
        password,
        totpSecret: totpSecret || undefined,
        verificationCode: verificationCode || undefined,
      }),
    });

    const workerResult = await workerResponse.json();

    if (!workerResponse.ok) {
      return NextResponse.json(
        { success: false, error: workerResult.error || "Worker login failed" },
        { status: 200 },
      );
    }

    return NextResponse.json(workerResult);
  } catch (error) {
    console.error("Login API error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Login failed" },
      { status: 200 },
    );
  }
}
