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
  // OOO fields (only present when filter=auto)
  oooUntil?: string | null;
  oooReason?: string | null;
  reengagementStatus?: string | null;
  reengagementDate?: string | null;
}

// GET /api/portal/inbox/email/threads — returns replies grouped into threads
export async function GET(request: NextRequest) {
  try {
    const { workspaceSlug } = await getPortalSession();

    const { searchParams } = new URL(request.url);
    const cursor = searchParams.get("cursor");
    const filter = searchParams.get("filter"); // "auto" | "real" | null

    const isAutoFilter = filter === "auto";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = { workspaceSlug, deletedAt: null };

    if (cursor) {
      where.receivedAt = { lt: new Date(cursor) };
    }

    // Apply intent filter at the Prisma query level
    if (isAutoFilter) {
      where.intent = { in: ["out_of_office", "auto_reply"] };
    } else {
      // Default: exclude auto-replies but include unclassified (null intent)
      where.OR = [
        { intent: { notIn: ["out_of_office", "auto_reply"] } },
        { intent: null },
      ];
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

    // When filter=auto, enrich threads with OOO data from Person + OooReengagement
    if (isAutoFilter && threads.length > 0) {
      const uniqueEmails = [...new Set(threads.map((t) => t.leadEmail).filter(Boolean))];

      const [people, reengagements] = await Promise.all([
        prisma.person.findMany({
          where: { email: { in: uniqueEmails } },
          select: { email: true, oooUntil: true, oooReason: true, oooDetectedAt: true },
        }),
        prisma.oooReengagement.findMany({
          where: { personEmail: { in: uniqueEmails }, workspaceSlug },
          orderBy: { createdAt: "desc" },
          distinct: ["personEmail"],
          select: { personEmail: true, status: true, oooUntil: true },
        }),
      ]);

      const personMap = new Map(people.map((p) => [p.email, p]));
      const reengagementMap = new Map(reengagements.map((r) => [r.personEmail, r]));

      for (const thread of threads) {
        const person = personMap.get(thread.leadEmail);
        const reengagement = reengagementMap.get(thread.leadEmail);

        thread.oooUntil = person?.oooUntil?.toISOString() ?? null;
        thread.oooReason = person?.oooReason ?? null;
        thread.reengagementStatus = reengagement?.status ?? null;
        thread.reengagementDate = reengagement?.oooUntil?.toISOString() ?? null;
      }
    }

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
