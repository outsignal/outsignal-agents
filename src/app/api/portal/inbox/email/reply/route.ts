import { NextRequest, NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-session";
import { prisma } from "@/lib/db";
import { EmailBisonClient } from "@/lib/emailbison/client";
import { EmailBisonError } from "@/lib/emailbison/types";

// POST /api/portal/inbox/email/reply — send a reply via EmailBison and persist as outbound Reply
export async function POST(request: NextRequest) {
  try {
    const { workspaceSlug } = await getPortalSession();

    const body = await request.json();
    const { replyId, message } = body as { replyId: string; message: string };

    // Validate message is non-empty
    if (!message || typeof message !== "string" || message.trim() === "") {
      return NextResponse.json(
        { error: "Message cannot be empty" },
        { status: 400 },
      );
    }

    // Validate replyId is present
    if (!replyId || typeof replyId !== "string") {
      return NextResponse.json(
        { error: "replyId is required" },
        { status: 400 },
      );
    }

    // Look up the Reply record
    const replyRecord = await prisma.reply.findFirst({
      where: { id: replyId, workspaceSlug, deletedAt: null },
      select: {
        emailBisonReplyId: true,
        ebSenderEmailId: true,
        leadEmail: true,
        emailBisonParentId: true,
      },
    });

    if (!replyRecord) {
      return NextResponse.json(
        { error: "Reply not found" },
        { status: 404 },
      );
    }

    // Validate required EB fields for sending
    if (!replyRecord.emailBisonReplyId || !replyRecord.ebSenderEmailId) {
      return NextResponse.json(
        { error: "Cannot send: missing sender data for this reply" },
        { status: 422 },
      );
    }

    // Get the workspace's EmailBison token (stored as apiToken)
    const workspace = await prisma.workspace.findUnique({
      where: { slug: workspaceSlug },
      select: { apiToken: true },
    });

    if (!workspace?.apiToken) {
      return NextResponse.json(
        { error: "Cannot send: workspace has no EmailBison token configured" },
        { status: 422 },
      );
    }

    // Send via EmailBison
    const ebClient = new EmailBisonClient(workspace.apiToken);
    const result = await ebClient.sendReply(replyRecord.emailBisonReplyId, {
      message: message.trim(),
      sender_email_id: replyRecord.ebSenderEmailId,
      reply_all: true, // Per Phase 33 spike: requires reply_all or to_emails
    });

    if (!result.data.success) {
      return NextResponse.json(
        { error: "Failed to send reply" },
        { status: 422 },
      );
    }

    // Persist the sent message as a new outbound Reply record
    const sentMsg = result.data.reply!;
    await prisma.reply.create({
      data: {
        workspaceSlug,
        senderEmail:
          sentMsg.primary_to_email_address ??
          replyRecord.leadEmail ??
          "unknown",
        senderName: null,
        subject: sentMsg.subject ?? null,
        bodyText: sentMsg.text_body ?? message.trim(),
        htmlBody: sentMsg.html_body ?? null,
        receivedAt: new Date(sentMsg.date_received ?? sentMsg.created_at),
        emailBisonReplyId: sentMsg.id,
        emailBisonParentId:
          sentMsg.parent_id ?? replyRecord.emailBisonReplyId,
        ebSenderEmailId: sentMsg.sender_email_id,
        leadEmail: replyRecord.leadEmail ?? null,
        source: "portal_send",
        direction: "outbound",
        interested: false,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof EmailBisonError) {
      return NextResponse.json(
        { error: "Failed to send reply via email provider" },
        { status: err.statusCode },
      );
    }

    const message = err instanceof Error ? err.message : "Unauthorized";
    if (
      message === "No portal session cookie" ||
      message === "Invalid or expired portal session"
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("[POST /api/portal/inbox/email/reply] Error:", err);
    return NextResponse.json(
      { error: "Failed to send reply" },
      { status: 500 },
    );
  }
}
