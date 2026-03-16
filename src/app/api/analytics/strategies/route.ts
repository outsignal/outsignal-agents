import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminAuth } from "@/lib/require-admin-auth";

export const dynamic = "force-dynamic";

interface CampaignSnapshot {
  emailsSent: number;
  linkedinConnectionsSent: number;
  linkedinMessagesSent: number;
  replied: number;
  replyRate: number;
  openRate: number;
  bounceRate: number;
  interestedRate: number;
  copyStrategy: string | null;
  campaignName: string;
}

function getDateRange(period: string): { gte?: string; lte?: string } {
  if (period === "all") return {};
  const now = new Date();
  const lte = now.toISOString().slice(0, 10);
  if (period === "24h") {
    return { gte: lte, lte };
  }
  const days = period === "7d" ? 7 : 30;
  const start = new Date(now);
  start.setDate(start.getDate() - days);
  return { gte: start.toISOString().slice(0, 10), lte };
}

export async function GET(request: NextRequest) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const workspace = searchParams.get("workspace") || undefined;
  const period = searchParams.get("period") || "30d";

  if (!["24h", "7d", "30d", "all"].includes(period)) {
    return NextResponse.json(
      { error: "Invalid period. Use 24h, 7d, 30d, or all." },
      { status: 400 }
    );
  }

  const dateRange = getDateRange(period);

  const where: Record<string, unknown> = {
    metricType: "campaign_snapshot",
  };
  if (workspace) where.workspace = workspace;
  if (dateRange.gte || dateRange.lte) {
    where.date = {};
    if (dateRange.gte) (where.date as Record<string, string>).gte = dateRange.gte;
    if (dateRange.lte) (where.date as Record<string, string>).lte = dateRange.lte;
  }

  const rows = await prisma.cachedMetrics.findMany({
    where,
    orderBy: { date: "desc" },
  });

  // Take latest snapshot per campaign
  const latestPerCampaign = new Map<string, CampaignSnapshot>();
  for (const row of rows) {
    if (!latestPerCampaign.has(row.metricKey)) {
      try {
        latestPerCampaign.set(
          row.metricKey,
          JSON.parse(row.data) as CampaignSnapshot
        );
      } catch {
        // Skip malformed
      }
    }
  }

  // Group by copyStrategy, only include campaigns with 10+ sends
  const strategyGroups = new Map<
    string,
    {
      replyRates: number[];
      openRates: number[];
      bounceRates: number[];
      interestedRates: number[];
      totalSent: number;
      totalReplied: number;
      campaignCount: number;
    }
  >();

  for (const data of latestPerCampaign.values()) {
    const totalSent =
      (data.emailsSent || 0) +
      (data.linkedinConnectionsSent || 0) +
      (data.linkedinMessagesSent || 0);
    if (totalSent < 10) continue;

    const strategy = data.copyStrategy || "Unknown";
    if (!strategyGroups.has(strategy)) {
      strategyGroups.set(strategy, {
        replyRates: [],
        openRates: [],
        bounceRates: [],
        interestedRates: [],
        totalSent: 0,
        totalReplied: 0,
        campaignCount: 0,
      });
    }

    const group = strategyGroups.get(strategy)!;
    group.replyRates.push(data.replyRate || 0);
    group.openRates.push(data.openRate || 0);
    group.bounceRates.push(data.bounceRate || 0);
    group.interestedRates.push(data.interestedRate || 0);
    group.totalSent += data.emailsSent || 0;
    group.totalReplied += data.replied || 0;
    group.campaignCount += 1;
  }

  // Compute averages and build response
  const strategies = Array.from(strategyGroups.entries()).map(
    ([strategy, group]) => {
      const avg = (arr: number[]) =>
        arr.length > 0
          ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100
          : 0;

      return {
        strategy,
        campaignCount: group.campaignCount,
        avgReplyRate: avg(group.replyRates),
        avgOpenRate: avg(group.openRates),
        avgBounceRate: avg(group.bounceRates),
        avgInterestedRate: avg(group.interestedRates),
        totalSent: group.totalSent,
        totalReplied: group.totalReplied,
        isBest: false,
      };
    }
  );

  // Sort by avgReplyRate descending
  strategies.sort((a, b) => b.avgReplyRate - a.avgReplyRate);

  // Mark the top performer
  if (strategies.length > 0) {
    strategies[0].isBest = true;
  }

  return NextResponse.json({
    strategies,
    period,
    filters: { workspace: workspace || null },
  });
}
