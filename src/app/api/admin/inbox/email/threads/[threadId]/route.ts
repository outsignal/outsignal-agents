import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { prisma } from "@/lib/db";

interface OutboundContextMessage {
  id: "outbound-context";
  direction: "outbound";
  subject: string | null;
  bodyText: string | null;
  htmlBody: null;
  senderEmail: string | null;
  receivedAt: null;
  isOutboundContext: true;
  intent: null;
  sentiment: null;
  interested: false;
  aiSuggestedReply: null;
  ebSenderEmailId: null;
  emailBisonReplyId: null;
  senderName: null;
}

interface ReplyMessage {
  id: string;
  direction: string;
  senderEmail: string;
  senderName: string | null;
  subject: string | null;
  bodyText: string;
  htmlBody: string | null;
  receivedAt: string;
  intent: string | null;
  sentiment: string | null;
  interested: boolean;
  aiSuggestedReply: string | null;
  ebSenderEmailId: number | null;
  emailBisonReplyId: number | null;
  isOutboundContext: false;
}

type Message = OutboundContextMessage | ReplyMessage;

// GET /api/admin/inbox/email/threads/[threadId] — returns all messages in a thread (cross-workspace)
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { threadId: threadIdParam } = await params;
    const threadId = parseInt(threadIdParam, 10);
    if (isNaN(threadId)) {
      return NextResponse.json({ error: "Invalid threadId" }, { status: 400 });
    }

    // Fetch all replies in the thread — no workspace scope (admin can see all)
    const replies = await prisma.reply.findMany({
      where: {
        deletedAt: null,
        OR: [
          { emailBisonReplyId: threadId },
          { emailBisonParentId: threadId },
        ],
      },
      orderBy: { receivedAt: "asc" },
    });

    if (replies.length === 0) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    const messages: Message[] = [];

    const firstInbound = replies.find((r) => r.direction === "inbound");

    // Prepend outbound context message if available
    if (firstInbound && (firstInbound.outboundSubject || firstInbound.outboundBody)) {
      const outboundContext: OutboundContextMessage = {
        id: "outbound-context",
        direction: "outbound",
        subject: firstInbound.outboundSubject ?? null,
        bodyText: firstInbound.outboundBody ?? null,
        htmlBody: null,
        senderEmail: null,
        receivedAt: null,
        isOutboundContext: true,
        intent: null,
        sentiment: null,
        interested: false,
        aiSuggestedReply: null,
        ebSenderEmailId: null,
        emailBisonReplyId: null,
        senderName: null,
      };
      messages.push(outboundContext);
    }

    for (const reply of replies) {
      const msg: ReplyMessage = {
        id: reply.id,
        direction: reply.direction,
        senderEmail: reply.senderEmail,
        senderName: reply.senderName ?? null,
        subject: reply.subject ?? null,
        bodyText: reply.bodyText,
        htmlBody: reply.htmlBody ?? null,
        receivedAt: reply.receivedAt.toISOString(),
        intent: reply.intent ?? null,
        sentiment: reply.sentiment ?? null,
        interested: reply.interested,
        aiSuggestedReply: reply.aiSuggestedReply ?? null,
        ebSenderEmailId: reply.ebSenderEmailId ?? null,
        emailBisonReplyId: reply.emailBisonReplyId ?? null,
        isOutboundContext: false,
      };
      messages.push(msg);
    }

    const leadEmail =
      firstInbound?.leadEmail ??
      firstInbound?.senderEmail ??
      replies[0].senderEmail;
    const leadName = firstInbound?.senderName ?? null;
    const subject = replies[replies.length - 1]?.subject ?? null;
    const interested = replies.some((r) => r.interested);

    // Get workspace info for "Replying as" banner
    const workspaceSlug = replies[0].workspaceSlug;
    const workspace = await prisma.workspace.findUnique({
      where: { slug: workspaceSlug },
      select: { name: true },
    });
    const workspaceName = workspace?.name ?? workspaceSlug;

    // Cross-channel lookup via personId
    let crossChannel: { type: "linkedin"; conversationId: string } | null = null;
    const personId = firstInbound?.personId ?? null;
    if (personId) {
      const liConvo = await prisma.linkedInConversation.findFirst({
        where: { workspaceSlug, personId },
        select: { id: true },
      });
      if (liConvo) {
        crossChannel = { type: "linkedin", conversationId: liConvo.id };
      }
    }

    return NextResponse.json({
      messages,
      threadMeta: { leadEmail, leadName, subject, interested },
      crossChannel,
      workspaceSlug,
      workspaceName,
    });
  } catch (err) {
    console.error("[GET /api/admin/inbox/email/threads/[threadId]] Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch thread" },
      { status: 500 }
    );
  }
}
