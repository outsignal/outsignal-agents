import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/require-admin-auth";
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
  isRead?: boolean;
  intent?: string | null;
  sentiment?: string | null;
  workspaceName?: string;
  workspaceSlug?: string;
}

// GET /api/admin/inbox/email/threads — returns replies grouped into threads across all workspaces
// Optional ?workspace= filter to scope to a single workspace
export async function GET(request: NextRequest) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const workspace = searchParams.get("workspace");

    const where: { workspaceSlug?: string } = {};
    if (workspace) {
      where.workspaceSlug = workspace;
    }

    const replies = await prisma.reply.findMany({
      where,
      orderBy: { receivedAt: "desc" },
      take: 200,
    });

    // Build workspace name map for badge display
    const workspaces = await prisma.workspace.findMany({
      select: { slug: true, name: true },
    });
    const wsMap = new Map(workspaces.map((w) => [w.slug, w.name]));

    // Group replies into threads using emailBisonParentId ?? emailBisonReplyId as the thread key
    const threadMap = new Map<number, typeof replies>();

    for (const reply of replies) {
      const threadKey = reply.emailBisonParentId ?? reply.emailBisonReplyId;
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
      const sorted = [...messages].sort(
        (a, b) => a.receivedAt.getTime() - b.receivedAt.getTime()
      );

      const sortedDesc = [...messages].sort(
        (a, b) => b.receivedAt.getTime() - a.receivedAt.getTime()
      );

      const latestMessage = sortedDesc[0];
      const firstInbound = sorted.find((m) => m.direction === "inbound");

      let replyStatus: ReplyStatus;
      if (latestMessage.direction === "outbound") {
        replyStatus = "replied";
      } else if (latestMessage.notifiedAt === null) {
        replyStatus = "new";
      } else {
        replyStatus = "awaiting_reply";
      }

      const lastSnippet = (latestMessage.bodyText ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80);

      // Derive intent and sentiment from the latest inbound message
      const latestInbound = sortedDesc.find((m) => m.direction === "inbound");

      // isRead: false if any inbound message is unread
      const isRead = !messages.some(
        (m) => m.direction === "inbound" && m.isRead === false
      );

      const workspaceSlug = latestMessage.workspaceSlug;

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
        isRead,
        intent: latestInbound?.intent ?? null,
        sentiment: latestInbound?.sentiment ?? null,
        workspaceSlug,
        workspaceName: wsMap.get(workspaceSlug) ?? workspaceSlug,
      });
    }

    threads.sort(
      (a, b) =>
        new Date(b.lastMessageAt).getTime() -
        new Date(a.lastMessageAt).getTime()
    );

    return NextResponse.json({ threads });
  } catch (err) {
    console.error("[GET /api/admin/inbox/email/threads] Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch threads" },
      { status: 500 }
    );
  }
}
