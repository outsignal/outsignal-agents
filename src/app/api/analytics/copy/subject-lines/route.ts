import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import type { CampaignSnapshot } from "@/lib/analytics/snapshot";

export const dynamic = "force-dynamic";

interface EmailSequenceStep {
  position: number;
  subjectLine?: string;
  subjectVariantB?: string;
  body?: string;
  delayDays?: number;
  notes?: string;
}

type SortField = "openRate" | "replyRate" | "sends";
const VALID_SORTS = new Set<string>(["openRate", "replyRate", "sends"]);

interface SubjectLineEntry {
  text: string;
  campaignCount: number;
  campaignName: string | null;
  step: number | null;
  totalSends: number;
  openRate: number;
  replyRate: number;
  isVariantB: boolean;
}

export async function GET(request: NextRequest) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const workspace = searchParams.get("workspace") || undefined;
  const vertical = searchParams.get("vertical") || undefined;
  const view = searchParams.get("view") === "per-campaign" ? "per-campaign" : "global";
  const sort: SortField = VALID_SORTS.has(searchParams.get("sort") || "")
    ? (searchParams.get("sort") as SortField)
    : "replyRate";
  const order = searchParams.get("order") === "asc" ? "asc" : "desc";

  // Build where clause for campaign_snapshot rows
  const where: Record<string, unknown> = {
    metricType: "campaign_snapshot",
  };
  if (workspace) where.workspace = workspace;

  const rows = await prisma.cachedMetrics.findMany({
    where,
    orderBy: { date: "desc" },
  });

  // Take latest snapshot per campaign (metricKey = campaignId)
  const latestPerCampaign = new Map<
    string,
    { workspace: string; data: CampaignSnapshot }
  >();
  for (const row of rows) {
    if (!latestPerCampaign.has(row.metricKey)) {
      try {
        const parsed = JSON.parse(row.data) as CampaignSnapshot;
        latestPerCampaign.set(row.metricKey, {
          workspace: row.workspace,
          data: parsed,
        });
      } catch {
        // Skip malformed rows
      }
    }
  }

  // Vertical filter: look up workspace verticals
  let verticalFilter: string | undefined = vertical;
  const workspaceVerticals = new Map<string, string | null>();
  if (vertical) {
    const workspaces = await prisma.workspace.findMany({
      select: { slug: true, vertical: true },
    });
    for (const ws of workspaces) {
      workspaceVerticals.set(ws.slug, ws.vertical);
    }
  }

  // Load campaign records for emailSequence
  const campaignIds = Array.from(latestPerCampaign.keys());
  const campaigns = await prisma.campaign.findMany({
    where: { id: { in: campaignIds } },
    select: {
      id: true,
      emailSequence: true,
      workspaceSlug: true,
    },
  });
  const campaignMap = new Map(campaigns.map((c) => [c.id, c]));

  // Build per-step subject line entries
  const perCampaignEntries: SubjectLineEntry[] = [];

  for (const [campaignId, { workspace: ws, data }] of latestPerCampaign) {
    // Minimum 10 sends threshold
    if ((data.emailsSent || 0) < 10) continue;

    // Vertical filter
    if (verticalFilter) {
      const wsVertical = workspaceVerticals.get(ws);
      if (wsVertical !== verticalFilter) continue;
    }

    const campaign = campaignMap.get(campaignId);
    if (!campaign?.emailSequence) continue;

    let steps: EmailSequenceStep[];
    try {
      steps = JSON.parse(campaign.emailSequence) as EmailSequenceStep[];
    } catch {
      continue;
    }

    // Build step reply rate map from stepStats
    const stepRepliedMap = new Map<number, number>();
    if (data.stepStats) {
      for (const ss of data.stepStats) {
        stepRepliedMap.set(ss.step, ss.replied);
      }
    }

    for (const step of steps) {
      if (!step.subjectLine) continue;

      const stepReplied = stepRepliedMap.get(step.position) ?? 0;
      const stepReplyRate =
        data.emailsSent > 0
          ? Math.round((stepReplied / data.emailsSent) * 100 * 100) / 100
          : 0;

      // Main subject line
      perCampaignEntries.push({
        text: step.subjectLine,
        campaignCount: 1,
        campaignName: data.campaignName,
        step: step.position,
        totalSends: data.emailsSent || 0,
        openRate: data.openRate || 0,
        replyRate: stepReplyRate,
        isVariantB: false,
      });

      // Variant B if present
      if (step.subjectVariantB) {
        perCampaignEntries.push({
          text: step.subjectVariantB,
          campaignCount: 1,
          campaignName: data.campaignName,
          step: step.position,
          totalSends: data.emailsSent || 0,
          openRate: data.openRate || 0,
          replyRate: stepReplyRate,
          isVariantB: true,
        });
      }
    }
  }

  let result: SubjectLineEntry[];

  if (view === "global") {
    // Deduplicate identical subject lines, aggregate metrics
    const grouped = new Map<
      string,
      {
        originalText: string;
        totalSends: number;
        weightedOpenRate: number;
        weightedReplyRate: number;
        campaignCount: number;
        isVariantB: boolean;
      }
    >();

    for (const entry of perCampaignEntries) {
      const key = entry.text.toLowerCase().trim();
      const existing = grouped.get(key);
      if (existing) {
        existing.weightedOpenRate += entry.openRate * entry.totalSends;
        existing.weightedReplyRate += entry.replyRate * entry.totalSends;
        existing.totalSends += entry.totalSends;
        existing.campaignCount += 1;
        if (entry.isVariantB) existing.isVariantB = true;
      } else {
        grouped.set(key, {
          originalText: entry.text,
          totalSends: entry.totalSends,
          weightedOpenRate: entry.openRate * entry.totalSends,
          weightedReplyRate: entry.replyRate * entry.totalSends,
          campaignCount: 1,
          isVariantB: entry.isVariantB,
        });
      }
    }

    result = [];
    for (const [, agg] of grouped) {
      result.push({
        text: agg.originalText,
        campaignCount: agg.campaignCount,
        campaignName: null,
        step: null,
        totalSends: agg.totalSends,
        openRate:
          agg.totalSends > 0
            ? Math.round((agg.weightedOpenRate / agg.totalSends) * 100) / 100
            : 0,
        replyRate:
          agg.totalSends > 0
            ? Math.round((agg.weightedReplyRate / agg.totalSends) * 100) / 100
            : 0,
        isVariantB: agg.isVariantB,
      });
    }
  } else {
    result = perCampaignEntries;
  }

  // Sort
  result.sort((a, b) => {
    let aVal: number;
    let bVal: number;
    if (sort === "sends") {
      aVal = a.totalSends;
      bVal = b.totalSends;
    } else {
      aVal = a[sort];
      bVal = b[sort];
    }
    return order === "asc" ? aVal - bVal : bVal - aVal;
  });

  return NextResponse.json({
    subjectLines: result,
    total: result.length,
    view,
    filters: {
      workspace: workspace || null,
      vertical: verticalFilter || null,
    },
  });
}
