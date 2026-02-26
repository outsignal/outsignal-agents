import { NextRequest, NextResponse } from "next/server";
import { verifyWorkerAuth } from "@/lib/linkedin/auth";
import { createSender, getSendersForWorkspace } from "@/lib/linkedin/sender";
import { decrypt } from "@/lib/crypto";

/**
 * GET /api/linkedin/senders?workspace=rise
 * List senders for a workspace.
 * Decrypts sessionData before returning so the worker gets plain cookies.
 */
export async function GET(request: NextRequest) {
  if (!verifyWorkerAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const workspaceSlug = request.nextUrl.searchParams.get("workspace");
    if (!workspaceSlug) {
      return NextResponse.json({ error: "workspace is required" }, { status: 400 });
    }

    const senders = await getSendersForWorkspace(workspaceSlug);

    // Decrypt sessionData for each sender before sending to worker
    const decryptedSenders = senders.map((sender) => {
      if (sender.sessionData) {
        try {
          return { ...sender, sessionData: decrypt(sender.sessionData) };
        } catch {
          // If decryption fails, return null (session likely corrupted)
          return { ...sender, sessionData: null, sessionStatus: "expired" };
        }
      }
      return sender;
    });

    return NextResponse.json({ senders: decryptedSenders });
  } catch (error) {
    console.error("List senders error:", error);
    return NextResponse.json({ error: "Failed to list senders" }, { status: 500 });
  }
}

/**
 * POST /api/linkedin/senders
 * Create a new sender.
 */
export async function POST(request: NextRequest) {
  if (!verifyWorkerAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const sender = await createSender({
      workspaceSlug: body.workspaceSlug,
      name: body.name,
      emailAddress: body.emailAddress,
      emailSenderName: body.emailSenderName,
      linkedinProfileUrl: body.linkedinProfileUrl,
      linkedinTier: body.linkedinTier,
      proxyUrl: body.proxyUrl,
    });

    return NextResponse.json({ sender });
  } catch (error) {
    console.error("Create sender error:", error);
    return NextResponse.json({ error: "Failed to create sender" }, { status: 500 });
  }
}
