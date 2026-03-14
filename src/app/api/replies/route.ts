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
    const page = Math.max(1, parseInt(params.get("page") ?? "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(params.get("limit") ?? "50", 10)));
    const skip = (page - 1) * limit;

    // Build where clause
    const conditions: Prisma.ReplyWhereInput[] = [];

    // Workspace filter
    const workspace = params.get("workspace");
    if (workspace) {
      conditions.push({ workspaceSlug: workspace });
    }

    // Intent filter (supports comma-separated multi-select)
    const intent = params.get("intent");
    if (intent) {
      const intents = intent.split(",").map((i) => i.trim()).filter(Boolean);
      if (intents.length === 1) {
        conditions.push({ intent: intents[0] });
      } else if (intents.length > 1) {
        conditions.push({ intent: { in: intents } });
      }
    }

    // Sentiment filter
    const sentiment = params.get("sentiment");
    if (sentiment) {
      conditions.push({ sentiment });
    }

    // Campaign filter
    const campaignId = params.get("campaignId");
    if (campaignId) {
      conditions.push({ campaignId });
    }

    // Search filter (senderEmail, senderName, subject, bodyText)
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
    const range = params.get("range") ?? "all";
    if (range !== "all") {
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
          cutoff = new Date(0); // fallback: all time
      }
      conditions.push({ receivedAt: { gte: cutoff } });
    }

    const where: Prisma.ReplyWhereInput =
      conditions.length > 0 ? { AND: conditions } : {};

    // Execute queries in parallel
    const [replies, total] = await Promise.all([
      prisma.reply.findMany({
        where,
        orderBy: { receivedAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.reply.count({ where }),
    ]);

    // Add effective intent/sentiment computed fields
    const enrichedReplies = replies.map((reply) => ({
      ...reply,
      effectiveIntent: reply.overrideIntent ?? reply.intent,
      effectiveSentiment: reply.overrideSentiment ?? reply.sentiment,
    }));

    return NextResponse.json({
      replies: enrichedReplies,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      limit,
    });
  } catch (error) {
    console.error("[GET /api/replies] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch replies" },
      { status: 500 },
    );
  }
}
