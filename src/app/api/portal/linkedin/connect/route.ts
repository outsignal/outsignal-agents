import { NextRequest, NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-session";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { canManageSenders } from "@/lib/member-permissions";

/**
 * POST /api/portal/linkedin/connect
 *
 * Initiates a LinkedIn headless login via the Railway worker.
 * Stores encrypted credentials on success for future re-login.
 */
export async function POST(request: NextRequest) {
  // 1. Auth via portal session
  let session;
  try {
    session = await getPortalSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!canManageSenders(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 2. Validate worker env vars
  const WORKER_URL = process.env.LINKEDIN_WORKER_URL;
  const WORKER_SECRET = process.env.WORKER_API_SECRET;

  if (!WORKER_URL || !WORKER_SECRET) {
    return NextResponse.json(
      { error: "LinkedIn worker not configured" },
      { status: 500 }
    );
  }

  // 3. Parse request body
  let body: {
    senderId: string;
    method: "credentials" | "infinite";
    email: string;
    password: string;
    totpSecret?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // 4. Validate required fields
  if (!body.senderId || typeof body.senderId !== "string") {
    return NextResponse.json({ error: "senderId is required" }, { status: 400 });
  }
  if (!body.method || !["credentials", "infinite"].includes(body.method)) {
    return NextResponse.json({ error: "method must be 'credentials' or 'infinite'" }, { status: 400 });
  }
  if (!body.email || typeof body.email !== "string") {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }
  if (!body.password || typeof body.password !== "string") {
    return NextResponse.json({ error: "password is required" }, { status: 400 });
  }

  // 5. Verify sender belongs to this workspace
  const sender = await prisma.sender.findFirst({
    where: { id: body.senderId, workspaceSlug: session.workspaceSlug },
    select: { id: true, proxyUrl: true },
  });
  if (!sender) {
    return NextResponse.json({ error: "Sender not found" }, { status: 404 });
  }

  // 6. Call Railway worker headless login
  try {
    const response = await fetch(`${WORKER_URL}/sessions/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${WORKER_SECRET}`,
      },
      body: JSON.stringify({
        senderId: body.senderId,
        email: body.email,
        password: body.password,
        totpSecret: body.method === "infinite" ? body.totpSecret : undefined,
        proxyUrl: sender.proxyUrl ?? undefined,
      }),
    });

    const responseText = await response.text();
    let result: { success: boolean; error?: string };
    try {
      result = JSON.parse(responseText);
    } catch {
      return NextResponse.json(
        { success: false, error: `Worker returned unexpected response (HTTP ${response.status})` },
        { status: 502 }
      );
    }

    // 7. On success, store encrypted credentials
    if (result.success) {
      const updateData: Record<string, string> = {
        linkedinEmail: body.email,
        linkedinPassword: encrypt(body.password),
        loginMethod: body.method,
      };
      if (body.totpSecret) {
        updateData.totpSecret = encrypt(body.totpSecret);
      }
      await prisma.sender.update({
        where: { id: body.senderId },
        data: updateData,
      });
    }

    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Connection failed" },
      { status: 502 }
    );
  }
}
