import { NextRequest, NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-session";
import { prisma } from "@/lib/db";

type ReplyStatus = "awaiting_reply" | "replied" | "new";

interface ThreadSummary {
  threadId: number;
  leadEmail: string;
  leadName: string | null;
  subject: string | null;
  lastSnippet: string;
  lastMessageAt: string;
  messageCount: number;
  interested: boolean;
  replyStatus: ReplyStatus;
  hasAiSuggestion: boolean;
  isRead: boolean;
  intent: string | null;
  sentiment: string | null;
}

// GET /api/portal/inbox/email/threads — returns replies grouped into threads
export async function GET(request: NextRequest) {
  try {
    const { workspaceSlug } = await getPortalSession();

    const { searchParams } = new URL(request.url);
    const cursor = searchParams.get("cursor");

    const where: {
      workspaceSlug: string;
      deletedAt: null;
      receivedAt?: { lt: Date };
    } = { workspaceSlug, deletedAt: null };

    if (cursor) {
      where.receivedAt = { lt: new Date(cursor) };
    }

    const replies = await prisma.reply.findMany({
      where,
      orderBy: { receivedAt: "desc" },
      take: 200,
    });

    // Group replies into threads using emailBisonParentId ?? emailBisonReplyId as the thread key
    const threadMap = new Map<number, typeof replies>();

    for (const reply of replies) {
      // Determine the thread root ID
      const threadKey = reply.emailBisonParentId ?? reply.emailBisonReplyId;

      // Skip replies with no EB ID — can't group them
      if (threadKey == null) continue;

      const existing = threadMap.get(threadKey);
      if (existing) {
        existing.push(reply);
      } else {
        threadMap.set(threadKey, [reply]);
      }
    }

    const threads: ThreadSummary[] = [];

    for (const [threadId, messages] of threadMap.entries()) {
      // Sort by receivedAt ascending for context building
      const sorted = [...messages].sort(
        (a, b) => a.receivedAt.getTime() - b.receivedAt.getTime(),
      );

      // Sort by receivedAt descending to get latest first
      const sortedDesc = [...messages].sort(
        (a, b) => b.receivedAt.getTime() - a.receivedAt.getTime(),
      );

      const latestMessage = sortedDesc[0];
      const firstInbound = sorted.find((m) => m.direction === "inbound");

      // Derive replyStatus from latest message
      let replyStatus: ReplyStatus;
      if (latestMessage.direction === "outbound") {
        replyStatus = "replied";
      } else if (latestMessage.notifiedAt === null) {
        replyStatus = "new";
      } else {
        replyStatus = "awaiting_reply";
      }

      // Build snippet from latest message bodyText
      const lastSnippet = (latestMessage.bodyText ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80);

      // Derive intent/sentiment from latest inbound reply (prefer overrides)
      const latestInbound = sortedDesc.find((m) => m.direction === "inbound");
      const threadIntent = latestInbound?.overrideIntent ?? latestInbound?.intent ?? null;
      const threadSentiment = latestInbound?.overrideSentiment ?? latestInbound?.sentiment ?? null;

      threads.push({
        threadId,
        leadEmail:
          firstInbound?.leadEmail ??
          firstInbound?.senderEmail ??
          latestMessage.leadEmail ??
          latestMessage.senderEmail ??
          "",
        leadName: firstInbound?.senderName ?? null,
        subject: latestMessage.subject ?? null,
        lastSnippet,
        lastMessageAt: latestMessage.receivedAt.toISOString(),
        messageCount: messages.length,
        interested: messages.some((m) => m.interested),
        replyStatus,
        hasAiSuggestion: messages.some((m) => m.aiSuggestedReply != null),
        isRead: messages.filter((m) => m.direction === "inbound").every((m) => m.isRead),
        intent: threadIntent,
        sentiment: threadSentiment,
      });
    }

    // Sort threads by lastMessageAt desc (most recent first)
    threads.sort(
      (a, b) =>
        new Date(b.lastMessageAt).getTime() -
        new Date(a.lastMessageAt).getTime(),
    );

    // Pagination: include nextCursor if we fetched exactly 200 replies (may be more)
    const nextCursor =
      replies.length === 200
        ? threads[threads.length - 1]?.lastMessageAt
        : null;

    return NextResponse.json({ threads, nextCursor });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unauthorized";
    if (
      message === "No portal session cookie" ||
      message === "Invalid or expired portal session"
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[GET /api/portal/inbox/email/threads] Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch threads" },
      { status: 500 },
    );
  }
}
