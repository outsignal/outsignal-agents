import { NextRequest, NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-session";
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

// GET /api/portal/inbox/email/threads/[threadId] — returns all messages in a thread
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  try {
    const { workspaceSlug } = await getPortalSession();
    const { threadId: threadIdParam } = await params;

    const threadId = parseInt(threadIdParam, 10);
    if (isNaN(threadId)) {
      return NextResponse.json(
        { error: "Invalid threadId" },
        { status: 400 },
      );
    }

    // Fetch all replies that belong to this thread
    const replies = await prisma.reply.findMany({
      where: {
        workspaceSlug,
        deletedAt: null,
        OR: [
          { emailBisonReplyId: threadId },
          { emailBisonParentId: threadId },
        ],
      },
      orderBy: { receivedAt: "asc" },
    });

    if (replies.length === 0) {
      return NextResponse.json(
        { error: "Thread not found" },
        { status: 404 },
      );
    }

    const messages: Message[] = [];

    // Find first inbound reply for outbound context
    const firstInbound = replies.find((r) => r.direction === "inbound");

    // Prepend outbound context message if we have the outbound email content
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

    // Map each reply to message object
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

    // Build thread meta from first inbound reply
    const leadEmail =
      firstInbound?.leadEmail ??
      firstInbound?.senderEmail ??
      replies[0].senderEmail;
    const leadName = firstInbound?.senderName ?? null;
    const subject = replies[replies.length - 1]?.subject ?? null;
    const interested = replies.some((r) => r.interested);

    // Cross-channel: check if this person also has a LinkedIn conversation
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
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unauthorized";
    if (
      message === "No portal session cookie" ||
      message === "Invalid or expired portal session"
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error(
      "[GET /api/portal/inbox/email/threads/[threadId]] Error:",
      err,
    );
    return NextResponse.json(
      { error: "Failed to fetch thread" },
      { status: 500 },
    );
  }
}
