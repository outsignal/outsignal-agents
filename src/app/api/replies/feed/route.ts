import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { requireAdminAuth } from "@/lib/require-admin-auth";

export async function GET(request: NextRequest) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const params = request.nextUrl.searchParams;

    // Pagination
    const limit = Math.min(
      100,
      Math.max(1, parseInt(params.get("limit") ?? "50", 10)),
    );

    // Build where clause
    const conditions: Prisma.ReplyWhereInput[] = [];

    // Workspace filter
    const workspace = params.get("workspace");
    if (workspace) {
      conditions.push({ workspaceSlug: workspace });
    }

    // Since param for polling (ISO timestamp)
    const since = params.get("since");
    if (since) {
      const sinceDate = new Date(since);
      if (!isNaN(sinceDate.getTime())) {
        conditions.push({ receivedAt: { gt: sinceDate } });
      }
    }

    // Intent filter (comma-separated)
    const intent = params.get("intent");
    if (intent) {
      const intents = intent
        .split(",")
        .map((i) => i.trim())
        .filter(Boolean);
      if (intents.length === 1) {
        conditions.push({
          OR: [
            { overrideIntent: intents[0] },
            { intent: intents[0], overrideIntent: null },
          ],
        });
      } else if (intents.length > 1) {
        conditions.push({
          OR: [
            { overrideIntent: { in: intents } },
            { intent: { in: intents }, overrideIntent: null },
          ],
        });
      }
    }

    // Sentiment filter (comma-separated)
    const sentiment = params.get("sentiment");
    if (sentiment) {
      const sentiments = sentiment
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (sentiments.length === 1) {
        conditions.push({
          OR: [
            { overrideSentiment: sentiments[0] },
            { sentiment: sentiments[0], overrideSentiment: null },
          ],
        });
      } else if (sentiments.length > 1) {
        conditions.push({
          OR: [
            { overrideSentiment: { in: sentiments } },
            { sentiment: { in: sentiments }, overrideSentiment: null },
          ],
        });
      }
    }

    // Search filter
    const search = params.get("search");
    if (search) {
      conditions.push({
        OR: [
          { senderEmail: { contains: search, mode: "insensitive" } },
          { senderName: { contains: search, mode: "insensitive" } },
          { subject: { contains: search, mode: "insensitive" } },
          { bodyText: { contains: search, mode: "insensitive" } },
        ],
      });
    }

    // Date range filter
    const range = params.get("range");
    if (range && range !== "all") {
      const now = new Date();
      let cutoff: Date;
      switch (range) {
        case "24h":
          cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case "7d":
          cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case "30d":
          cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        default:
          cutoff = new Date(0);
      }
      conditions.push({ receivedAt: { gte: cutoff } });
    }

    // Exclude soft-deleted replies
    conditions.push({ deletedAt: null });

    const where: Prisma.ReplyWhereInput =
      conditions.length > 0 ? { AND: conditions } : {};

    // Fetch replies with workspace info
    const replies = await prisma.reply.findMany({
      where,
      orderBy: { receivedAt: "desc" },
      take: limit,
      select: {
        id: true,
        workspaceSlug: true,
        senderEmail: true,
        senderName: true,
        subject: true,
        bodyText: true,
        receivedAt: true,
        campaignName: true,
        campaignId: true,
        sequenceStep: true,
        intent: true,
        sentiment: true,
        objectionSubtype: true,
        classificationSummary: true,
        classifiedAt: true,
        overrideIntent: true,
        overrideSentiment: true,
        overrideObjSubtype: true,
        overriddenAt: true,
        outboundSubject: true,
        outboundBody: true,
        source: true,
        personId: true,
      },
    });

    // Get workspace names for each unique slug
    const slugs = [...new Set(replies.map((r) => r.workspaceSlug))];
    const workspaces = await prisma.workspace.findMany({
      where: { slug: { in: slugs } },
      select: { slug: true, name: true },
    });
    const workspaceMap = new Map(workspaces.map((w) => [w.slug, w.name]));

    // Enrich replies
    const enrichedReplies = replies.map((reply) => ({
      ...reply,
      workspaceName: workspaceMap.get(reply.workspaceSlug) ?? reply.workspaceSlug,
      effectiveIntent: reply.overrideIntent ?? reply.intent,
      effectiveSentiment: reply.overrideSentiment ?? reply.sentiment,
      portalUrl: `https://portal.outsignal.ai/portal/${reply.workspaceSlug}/inbox`,
    }));

    // Workspace stats: per-workspace reply count (7d), sentiment distribution, avg response time
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const allWorkspaces = await prisma.workspace.findMany({
      where: { status: "active" },
      select: { slug: true, name: true },
    });

    const [replyCountsByWorkspace, sentimentCounts] = await Promise.all([
      prisma.reply.groupBy({
        by: ["workspaceSlug"],
        where: {
          receivedAt: { gte: sevenDaysAgo },
          deletedAt: null,
        },
        _count: { _all: true },
      }),
      prisma.$queryRaw<
        { workspace_slug: string; eff_sentiment: string; cnt: number }[]
      >`
        SELECT
          "workspaceSlug" as workspace_slug,
          COALESCE("overrideSentiment", sentiment) as eff_sentiment,
          COUNT(*)::int as cnt
        FROM "Reply"
        WHERE "receivedAt" >= ${sevenDaysAgo}
          AND "deletedAt" IS NULL
          AND sentiment IS NOT NULL
        GROUP BY "workspaceSlug", eff_sentiment
      `,
    ]);

    // Build per-workspace stats
    const countMap = new Map(
      replyCountsByWorkspace.map((r) => [r.workspaceSlug, r._count._all]),
    );

    const sentimentMap = new Map<
      string,
      { positive: number; neutral: number; negative: number }
    >();
    for (const row of sentimentCounts) {
      if (!sentimentMap.has(row.workspace_slug)) {
        sentimentMap.set(row.workspace_slug, {
          positive: 0,
          neutral: 0,
          negative: 0,
        });
      }
      const entry = sentimentMap.get(row.workspace_slug)!;
      if (row.eff_sentiment === "positive") entry.positive = row.cnt;
      else if (row.eff_sentiment === "neutral") entry.neutral = row.cnt;
      else if (row.eff_sentiment === "negative") entry.negative = row.cnt;
    }

    const workspaceStats = allWorkspaces
      .map((ws) => ({
        slug: ws.slug,
        name: ws.name,
        replyCount7d: countMap.get(ws.slug) ?? 0,
        sentiment: sentimentMap.get(ws.slug) ?? {
          positive: 0,
          neutral: 0,
          negative: 0,
        },
      }))
      .filter((ws) => ws.replyCount7d > 0)
      .sort((a, b) => b.replyCount7d - a.replyCount7d);

    return NextResponse.json({
      replies: enrichedReplies,
      workspaceStats,
    });
  } catch (error) {
    console.error("[GET /api/replies/feed] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch reply feed" },
      { status: 500 },
    );
  }
}
