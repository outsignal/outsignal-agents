import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { prisma } from "@/lib/db";
import { EmailBisonClient } from "@/lib/emailbison/client";
import { EmailBisonError } from "@/lib/emailbison/types";

// POST /api/admin/inbox/email/reply — send a reply via EmailBison on behalf of a workspace
export async function POST(request: NextRequest) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { workspaceSlug, replyId, message } = body as {
      workspaceSlug?: string;
      replyId?: string;
      message?: string;
    };

    // Validate required fields
    if (!workspaceSlug || typeof workspaceSlug !== "string") {
      return NextResponse.json(
        { error: "workspaceSlug is required" },
        { status: 400 }
      );
    }
    if (!message || typeof message !== "string" || message.trim() === "") {
      return NextResponse.json(
        { error: "Message cannot be empty" },
        { status: 400 }
      );
    }
    if (!replyId || typeof replyId !== "string") {
      return NextResponse.json(
        { error: "replyId is required" },
        { status: 400 }
      );
    }

    // Look up the Reply record (admin can access across workspaces)
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
      return NextResponse.json({ error: "Reply not found" }, { status: 404 });
    }

    if (!replyRecord.emailBisonReplyId || !replyRecord.ebSenderEmailId) {
      return NextResponse.json(
        { error: "Cannot send: missing sender data for this reply" },
        { status: 422 }
      );
    }

    // Get workspace EmailBison token
    const workspace = await prisma.workspace.findUnique({
      where: { slug: workspaceSlug },
      select: { apiToken: true },
    });

    if (!workspace?.apiToken) {
      return NextResponse.json(
        { error: "Workspace not connected to EmailBison" },
        { status: 400 }
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
        { status: 422 }
      );
    }

    // Persist the sent message as a new outbound Reply record
    const sentMsg = result.data.reply!;
    const created = await prisma.reply.create({
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
        source: "admin_send",
        direction: "outbound",
        interested: false,
      },
    });

    return NextResponse.json({ success: true, replyId: created.id });
  } catch (err) {
    if (err instanceof EmailBisonError) {
      return NextResponse.json(
        { error: "Failed to send reply via email provider" },
        { status: err.statusCode }
      );
    }
    console.error("[POST /api/admin/inbox/email/reply] Error:", err);
    return NextResponse.json(
      { error: "Failed to send reply" },
      { status: 500 }
    );
  }
}
