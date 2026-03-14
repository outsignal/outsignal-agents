import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { requireAdminAuth } from "@/lib/require-admin-auth";

function buildWhereClause(params: URLSearchParams): Prisma.ReplyWhereInput {
  const conditions: Prisma.ReplyWhereInput[] = [];

  const workspace = params.get("workspace");
  if (workspace) {
    conditions.push({ workspaceSlug: workspace });
  }

  const campaignId = params.get("campaignId");
  if (campaignId) {
    conditions.push({ campaignId });
  }

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
        cutoff = new Date(0);
    }
    conditions.push({ receivedAt: { gte: cutoff } });
  }

  return conditions.length > 0 ? { AND: conditions } : {};
}

function buildSqlWhereClause(params: URLSearchParams): {
  clause: string;
  values: unknown[];
} {
  const parts: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  const workspace = params.get("workspace");
  if (workspace) {
    parts.push(`"workspaceSlug" = $${paramIndex++}`);
    values.push(workspace);
  }

  const campaignId = params.get("campaignId");
  if (campaignId) {
    parts.push(`"campaignId" = $${paramIndex++}`);
    values.push(campaignId);
  }

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
        cutoff = new Date(0);
    }
    parts.push(`"receivedAt" >= $${paramIndex++}`);
    values.push(cutoff);
  }

  return {
    clause: parts.length > 0 ? `AND ${parts.join(" AND ")}` : "",
    values,
  };
}

export async function GET(request: NextRequest) {
  try {
    await requireAdminAuth();
    const params = request.nextUrl.searchParams;
    const where = buildWhereClause(params);
    const sqlWhere = buildSqlWhereClause(params);

    // Use raw SQL for intent/sentiment distributions to get COALESCE(override, original) behavior
    const intentDistribution = await prisma.$queryRawUnsafe<
      { effective_intent: string; count: number }[]
    >(
      `SELECT COALESCE("overrideIntent", intent) as effective_intent, COUNT(*)::int as count
       FROM "Reply"
       WHERE intent IS NOT NULL ${sqlWhere.clause}
       GROUP BY effective_intent
       ORDER BY count DESC`,
      ...sqlWhere.values,
    );

    const sentimentDistribution = await prisma.$queryRawUnsafe<
      { effective_sentiment: string; count: number }[]
    >(
      `SELECT COALESCE("overrideSentiment", sentiment) as effective_sentiment, COUNT(*)::int as count
       FROM "Reply"
       WHERE sentiment IS NOT NULL ${sqlWhere.clause}
       GROUP BY effective_sentiment
       ORDER BY count DESC`,
      ...sqlWhere.values,
    );

    // Objection subtype distribution (for Insights objection clusters)
    const objectionDistribution = await prisma.$queryRawUnsafe<
      { subtype: string; count: number }[]
    >(
      `SELECT "objectionSubtype" as subtype, COUNT(*)::int as count
       FROM "Reply"
       WHERE "objectionSubtype" IS NOT NULL ${sqlWhere.clause}
       GROUP BY "objectionSubtype"
       ORDER BY count DESC`,
      ...sqlWhere.values,
    );

    // Workspace counts and totals use Prisma for simpler queries
    const [workspaceCounts, totalReplies, classifiedCount, overriddenCount] =
      await Promise.all([
        prisma.reply.groupBy({
          by: ["workspaceSlug"],
          where,
          _count: { _all: true },
          orderBy: { _count: { workspaceSlug: "desc" } },
        }),
        prisma.reply.count({ where }),
        prisma.reply.count({
          where: { ...where, classifiedAt: { not: null } },
        }),
        prisma.reply.count({
          where: { ...where, overriddenAt: { not: null } },
        }),
      ]);

    return NextResponse.json({
      intentDistribution: intentDistribution.map((row) => ({
        intent: row.effective_intent,
        count: row.count,
      })),
      sentimentDistribution: sentimentDistribution.map((row) => ({
        sentiment: row.effective_sentiment,
        count: row.count,
      })),
      workspaceCounts: workspaceCounts.map((row) => ({
        workspace: row.workspaceSlug,
        count: row._count._all,
      })),
      totalReplies,
      classifiedCount,
      unclassifiedCount: totalReplies - classifiedCount,
      overriddenCount,
      objectionDistribution: objectionDistribution.map((row) => ({
        subtype: row.subtype,
        count: row.count,
      })),
    });
  } catch (error) {
    console.error("[GET /api/replies/stats] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch reply stats" },
      { status: 500 },
    );
  }
}
