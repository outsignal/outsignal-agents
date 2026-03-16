import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminAuth } from "@/lib/require-admin-auth";

export const dynamic = "force-dynamic";

interface CampaignSnapshot {
  emailsSent: number;
  replied: number;
  interested: number;
  linkedinConnectionsSent: number;
  linkedinMessagesSent: number;
}

interface SignalTypeAgg {
  type: string;
  sent: number;
  replied: number;
  interested: number;
}

export async function GET(request: NextRequest) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const workspace = searchParams.get("workspace") || null;
  const isGlobal = searchParams.get("global") === "true";

  const wsFilter =
    workspace && !isGlobal ? { workspaceSlug: workspace } : {};

  // Fetch signal campaigns
  const signalCampaigns = await prisma.campaign.findMany({
    where: { type: "signal", ...wsFilter },
    select: {
      id: true,
      signalTypes: true,
      workspaceSlug: true,
    },
  });

  if (signalCampaigns.length === 0) {
    return NextResponse.json({
      signalTypes: [],
      comparison: null,
      workspace,
      isGlobal: !workspace || isGlobal,
      message: "No signal campaigns configured",
    });
  }

  // Get campaign IDs for signal campaigns
  const signalCampaignIds = signalCampaigns.map((c) => c.id);

  // Fetch latest CachedMetrics snapshot for each signal campaign
  const snapshotRows = await prisma.cachedMetrics.findMany({
    where: {
      metricType: "campaign_snapshot",
      metricKey: { in: signalCampaignIds },
    },
    orderBy: { date: "desc" },
  });

  // Deduplicate to latest per campaign
  const latestSnapshots = new Map<string, CampaignSnapshot>();
  for (const row of snapshotRows) {
    if (!latestSnapshots.has(row.metricKey)) {
      try {
        latestSnapshots.set(
          row.metricKey,
          JSON.parse(row.data) as CampaignSnapshot
        );
      } catch {
        // Skip malformed
      }
    }
  }

  // Also get reply intent counts per signal campaign
  const signalReplies = await prisma.reply.groupBy({
    by: ["campaignId", "intent"],
    where: {
      campaignId: { in: signalCampaignIds },
      intent: { not: null },
    },
    _count: { id: true },
  });

  // Build interested count per campaign from replies
  const interestedPerCampaign = new Map<string, number>();
  for (const r of signalReplies) {
    if (
      r.campaignId &&
      (r.intent === "interested" || r.intent === "meeting_booked")
    ) {
      interestedPerCampaign.set(
        r.campaignId,
        (interestedPerCampaign.get(r.campaignId) || 0) + r._count.id
      );
    }
  }

  // Aggregate per signal type
  const signalTypeAgg = new Map<string, SignalTypeAgg>();

  for (const campaign of signalCampaigns) {
    let signalTypes: string[] = [];
    if (campaign.signalTypes) {
      try {
        signalTypes = JSON.parse(campaign.signalTypes);
      } catch {
        signalTypes = [];
      }
    }

    const snapshot = latestSnapshots.get(campaign.id);
    if (!snapshot) continue;

    const sent =
      (snapshot.emailsSent || 0) +
      (snapshot.linkedinConnectionsSent || 0) +
      (snapshot.linkedinMessagesSent || 0);
    const replied = snapshot.replied || 0;
    const interested = interestedPerCampaign.get(campaign.id) || 0;

    // Attribute to each signal type in this campaign
    for (const type of signalTypes) {
      if (!signalTypeAgg.has(type)) {
        signalTypeAgg.set(type, { type, sent: 0, replied: 0, interested: 0 });
      }
      const agg = signalTypeAgg.get(type)!;
      agg.sent += sent;
      agg.replied += replied;
      agg.interested += interested;
    }

    // If campaign has no signal types parsed, attribute to "unknown"
    if (signalTypes.length === 0 && sent > 0) {
      if (!signalTypeAgg.has("unknown")) {
        signalTypeAgg.set("unknown", {
          type: "unknown",
          sent: 0,
          replied: 0,
          interested: 0,
        });
      }
      const agg = signalTypeAgg.get("unknown")!;
      agg.sent += sent;
      agg.replied += replied;
      agg.interested += interested;
    }
  }

  // Build ranked signal types (filter < 5 leads, mark 5-9 as lowConfidence)
  const signalTypeResults = Array.from(signalTypeAgg.values())
    .filter((s) => s.sent >= 5)
    .map((s) => ({
      type: s.type,
      sent: s.sent,
      replied: s.replied,
      interested: s.interested,
      replyRate:
        s.sent > 0 ? Math.round((s.replied / s.sent) * 10000) / 100 : 0,
      interestedRate:
        s.sent > 0 ? Math.round((s.interested / s.sent) * 10000) / 100 : 0,
      lowConfidence: s.sent < 10,
    }))
    .sort((a, b) => b.interestedRate - a.interestedRate);

  // Compute static campaign baseline for comparison
  const staticCampaigns = await prisma.campaign.findMany({
    where: {
      type: { not: "signal" },
      ...wsFilter,
    },
    select: { id: true },
  });

  let comparison: {
    signalAvg: {
      replyRate: number;
      interestedRate: number;
      campaigns: number;
    };
    staticAvg: {
      replyRate: number;
      interestedRate: number;
      campaigns: number;
    };
    multiplier: { replyRate: number; interestedRate: number };
  } | null = null;

  if (staticCampaigns.length > 0) {
    const staticIds = staticCampaigns.map((c) => c.id);
    const staticSnapshotRows = await prisma.cachedMetrics.findMany({
      where: {
        metricType: "campaign_snapshot",
        metricKey: { in: staticIds },
      },
      orderBy: { date: "desc" },
    });

    // Deduplicate to latest per campaign
    const staticSnapshots = new Map<string, CampaignSnapshot>();
    for (const row of staticSnapshotRows) {
      if (!staticSnapshots.has(row.metricKey)) {
        try {
          staticSnapshots.set(
            row.metricKey,
            JSON.parse(row.data) as CampaignSnapshot
          );
        } catch {
          // Skip
        }
      }
    }

    // Aggregate static campaign totals
    let staticTotalSent = 0;
    let staticTotalReplied = 0;
    let staticTotalInterested = 0;
    let staticCampaignCount = 0;

    // Get interested counts for static campaigns from replies
    const staticReplies = await prisma.reply.groupBy({
      by: ["campaignId", "intent"],
      where: {
        campaignId: { in: staticIds },
        intent: { in: ["interested", "meeting_booked"] },
      },
      _count: { id: true },
    });

    const staticInterestedPerCampaign = new Map<string, number>();
    for (const r of staticReplies) {
      if (r.campaignId) {
        staticInterestedPerCampaign.set(
          r.campaignId,
          (staticInterestedPerCampaign.get(r.campaignId) || 0) + r._count.id
        );
      }
    }

    for (const [campaignId, snapshot] of staticSnapshots) {
      const sent =
        (snapshot.emailsSent || 0) +
        (snapshot.linkedinConnectionsSent || 0) +
        (snapshot.linkedinMessagesSent || 0);
      if (sent < 10) continue;

      staticTotalSent += sent;
      staticTotalReplied += snapshot.replied || 0;
      staticTotalInterested +=
        staticInterestedPerCampaign.get(campaignId) || 0;
      staticCampaignCount++;
    }

    // Aggregate signal campaign totals
    let signalTotalSent = 0;
    let signalTotalReplied = 0;
    let signalTotalInterested = 0;
    let signalCampaignCount = 0;

    for (const campaign of signalCampaigns) {
      const snapshot = latestSnapshots.get(campaign.id);
      if (!snapshot) continue;
      const sent =
        (snapshot.emailsSent || 0) +
        (snapshot.linkedinConnectionsSent || 0) +
        (snapshot.linkedinMessagesSent || 0);
      if (sent < 10) continue;

      signalTotalSent += sent;
      signalTotalReplied += snapshot.replied || 0;
      signalTotalInterested +=
        interestedPerCampaign.get(campaign.id) || 0;
      signalCampaignCount++;
    }

    if (staticTotalSent > 0 && signalTotalSent > 0) {
      const signalReplyRate =
        Math.round((signalTotalReplied / signalTotalSent) * 10000) / 100;
      const signalInterestedRate =
        Math.round((signalTotalInterested / signalTotalSent) * 10000) / 100;
      const staticReplyRate =
        Math.round((staticTotalReplied / staticTotalSent) * 10000) / 100;
      const staticInterestedRate =
        Math.round((staticTotalInterested / staticTotalSent) * 10000) / 100;

      comparison = {
        signalAvg: {
          replyRate: signalReplyRate,
          interestedRate: signalInterestedRate,
          campaigns: signalCampaignCount,
        },
        staticAvg: {
          replyRate: staticReplyRate,
          interestedRate: staticInterestedRate,
          campaigns: staticCampaignCount,
        },
        multiplier: {
          replyRate:
            staticReplyRate > 0
              ? Math.round((signalReplyRate / staticReplyRate) * 100) / 100
              : 0,
          interestedRate:
            staticInterestedRate > 0
              ? Math.round(
                  (signalInterestedRate / staticInterestedRate) * 100
                ) / 100
              : 0,
        },
      };
    }
  }

  return NextResponse.json({
    signalTypes: signalTypeResults,
    comparison,
    workspace,
    isGlobal: !workspace || isGlobal,
  });
}
