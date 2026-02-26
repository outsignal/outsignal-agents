/**
 * GET /api/enrichment/costs
 * Returns aggregated cost data from EnrichmentLog for the given date range.
 *
 * Query params:
 * - from  — start date (YYYY-MM-DD), defaults to 30 days ago
 * - to    — end date (YYYY-MM-DD), defaults to today
 * - workspace — optional workspace slug filter
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { todayUtc } from "@/lib/enrichment/costs";

const DEFAULT_DAILY_CAP_USD = 10.0;

function getDailyCap(): number {
  return parseFloat(
    process.env.ENRICHMENT_DAILY_CAP_USD ?? String(DEFAULT_DAILY_CAP_USD)
  );
}

/** Returns a Date set to the start of the given YYYY-MM-DD string in UTC. */
function parseDateUtc(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

/** Returns a Date set to the end of the given YYYY-MM-DD string in UTC. */
function parseDateUtcEnd(dateStr: string): Date {
  return new Date(`${dateStr}T23:59:59.999Z`);
}

/** Returns a YYYY-MM-DD string for N days before today in UTC. */
function daysAgoUtc(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const fromStr = searchParams.get("from") ?? daysAgoUtc(30);
    const toStr = searchParams.get("to") ?? todayUtc();
    const workspaceFilter = searchParams.get("workspace") ?? null;

    const fromDate = parseDateUtc(fromStr);
    const toDate = parseDateUtcEnd(toStr);

    // Base where clause for success records in range
    const baseWhere = {
      status: "success",
      runAt: { gte: fromDate, lte: toDate },
      ...(workspaceFilter ? { workspaceSlug: workspaceFilter } : {}),
    };

    // Run queries in parallel
    const [totalAgg, byProviderGroups, byWorkspaceGroups, byDateRows, todayRow] =
      await Promise.all([
        // 1. Total spend
        prisma.enrichmentLog.aggregate({
          _sum: { costUsd: true },
          _count: true,
          where: baseWhere,
        }),

        // 2. By provider
        prisma.enrichmentLog.groupBy({
          by: ["provider"],
          _sum: { costUsd: true },
          _count: { id: true },
          where: baseWhere,
          orderBy: { _sum: { costUsd: "desc" } },
        }),

        // 3. By workspace
        prisma.enrichmentLog.groupBy({
          by: ["workspaceSlug"],
          _sum: { costUsd: true },
          _count: { id: true },
          where: {
            ...baseWhere,
            workspaceSlug: { not: null },
          },
          orderBy: { _sum: { costUsd: "desc" } },
        }),

        // 4. By date — use DailyCostTotal for efficient date-level aggregation
        prisma.dailyCostTotal.findMany({
          where: { date: { gte: fromStr, lte: toStr } },
          orderBy: { date: "asc" },
        }),

        // 5. Today's spend
        prisma.dailyCostTotal.findUnique({
          where: { date: todayUtc() },
        }),
      ]);

    const dailyCap = getDailyCap();
    const todaySpend = todayRow?.totalUsd ?? 0;
    const totalSpend = totalAgg._sum.costUsd ?? 0;

    const byProvider = byProviderGroups.map((row) => ({
      provider: row.provider,
      totalUsd: row._sum.costUsd ?? 0,
      callCount: row._count.id,
    }));

    const byWorkspace = byWorkspaceGroups.map((row) => ({
      workspace: row.workspaceSlug ?? "unknown",
      totalUsd: row._sum.costUsd ?? 0,
      callCount: row._count.id,
    }));

    const byDate = byDateRows.map((row) => ({
      date: row.date,
      totalUsd: row.totalUsd,
    }));

    return NextResponse.json({
      period: { from: fromStr, to: toStr },
      dailyCap,
      todaySpend,
      capHit: todaySpend >= dailyCap,
      totalSpend,
      byProvider,
      byWorkspace,
      byDate,
    });
  } catch (error) {
    console.error("[enrichment/costs] Failed to aggregate cost data:", error);
    return NextResponse.json(
      { error: "Failed to aggregate cost data" },
      { status: 500 }
    );
  }
}
