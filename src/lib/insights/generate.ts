import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { prisma } from "@/lib/db";
import { InsightSchema } from "./types";
import { buildDedupKey, filterDuplicates } from "./dedup";
import type { CampaignSnapshot } from "@/lib/analytics/snapshot";

/**
 * Generate AI-powered insights for a workspace.
 * Reads pre-computed CachedMetrics + Reply data, calls LLM, deduplicates,
 * and persists new insights. Returns the count of insights created.
 */
export async function generateInsights(
  workspaceSlug: string,
): Promise<number> {
  // --- 1. Gather analytics data ---

  // a. Campaign snapshots from last 2 weeks
  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
  const twoWeeksAgoStr = twoWeeksAgo.toISOString().slice(0, 10);

  const snapshots = await prisma.cachedMetrics.findMany({
    where: {
      workspace: workspaceSlug,
      metricType: "campaign_snapshot",
      date: { gte: twoWeeksAgoStr },
    },
    orderBy: { date: "desc" },
  });

  const campaignData: Array<{
    campaignId: string;
    date: string;
    snapshot: CampaignSnapshot;
  }> = [];
  for (const s of snapshots) {
    try {
      campaignData.push({
        campaignId: s.metricKey,
        date: s.date,
        snapshot: JSON.parse(s.data) as CampaignSnapshot,
      });
    } catch {
      // skip unparseable entries
    }
  }

  // b. Reply intent/sentiment distribution (last 2 weeks)
  const [intentCounts, sentimentCounts, objectionCounts] = await Promise.all([
    prisma.reply.groupBy({
      by: ["intent"],
      where: {
        workspaceSlug,
        receivedAt: { gte: twoWeeksAgo },
        intent: { not: null },
      },
      _count: { id: true },
    }),
    prisma.reply.groupBy({
      by: ["sentiment"],
      where: {
        workspaceSlug,
        receivedAt: { gte: twoWeeksAgo },
        sentiment: { not: null },
      },
      _count: { id: true },
    }),
    prisma.reply.groupBy({
      by: ["objectionSubtype"],
      where: {
        workspaceSlug,
        receivedAt: { gte: twoWeeksAgo },
        intent: "objection",
        objectionSubtype: { not: null },
      },
      _count: { id: true },
    }),
  ]);

  // c. Body element data (if any)
  const bodyElements = await prisma.cachedMetrics.findMany({
    where: {
      workspace: workspaceSlug,
      metricType: "body_elements",
    },
    take: 20,
  });

  // d. Week-over-week comparison
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const oneWeekAgoStr = oneWeekAgo.toISOString().slice(0, 10);

  // Get latest snapshot per campaign for this week vs last week
  const thisWeekSnapshots = campaignData.filter((s) => s.date >= oneWeekAgoStr);
  const lastWeekSnapshots = campaignData.filter(
    (s) => s.date < oneWeekAgoStr && s.date >= twoWeeksAgoStr,
  );

  const thisWeekAvg = computeAverageRates(thisWeekSnapshots);
  const lastWeekAvg = computeAverageRates(lastWeekSnapshots);

  // --- 2. Build structured prompt ---
  const totalReplies = intentCounts.reduce((s, i) => s + i._count.id, 0);

  const prompt = buildPrompt({
    workspaceSlug,
    campaignData,
    intentCounts: intentCounts.map((i) => ({
      intent: i.intent ?? "unknown",
      count: i._count.id,
    })),
    sentimentCounts: sentimentCounts.map((s) => ({
      sentiment: s.sentiment ?? "unknown",
      count: s._count.id,
    })),
    objectionCounts: objectionCounts.map((o) => ({
      subtype: o.objectionSubtype ?? "unknown",
      count: o._count.id,
    })),
    bodyElements: bodyElements.map((b) => {
      try {
        return { key: b.metricKey, data: JSON.parse(b.data) };
      } catch {
        return null;
      }
    }).filter(Boolean) as Array<{ key: string; data: unknown }>,
    thisWeekAvg,
    lastWeekAvg,
    totalReplies,
  });

  // If there is no data to analyze, skip generation
  if (campaignData.length === 0 && totalReplies === 0) {
    return 0;
  }

  // --- 3. Generate insights via AI ---
  const { object } = await generateObject({
    model: anthropic("claude-haiku-4-5-20251001"),
    schema: InsightSchema,
    prompt,
  });

  // --- 4. Deduplicate ---
  const filtered = await filterDuplicates(object.insights, workspaceSlug);

  if (filtered.length === 0) {
    return 0;
  }

  // --- 5. Persist ---
  const insightsToCreate = filtered.map((insight) => {
    const entityId =
      insight.suggestedAction.params?.campaignId ??
      insight.suggestedAction.params?.campaignName ??
      "global";

    return {
      workspaceSlug,
      category: insight.category,
      observation: insight.observation,
      evidence: JSON.stringify(insight.evidence),
      confidence: insight.confidence,
      priority: insight.priority,
      actionType: insight.suggestedAction.type,
      actionDescription: insight.suggestedAction.description,
      actionParams: insight.suggestedAction.params
        ? JSON.stringify(insight.suggestedAction.params)
        : null,
      dedupKey: buildDedupKey(
        insight.category,
        insight.suggestedAction.type,
        entityId,
      ),
      status: "active",
    };
  });

  await prisma.insight.createMany({ data: insightsToCreate });

  return insightsToCreate.length;
}

// --- Helper functions ---

interface AverageRates {
  replyRate: number;
  openRate: number;
  interestedRate: number;
  bounceRate: number;
  campaignCount: number;
}

function computeAverageRates(
  data: Array<{ snapshot: CampaignSnapshot }>,
): AverageRates {
  if (data.length === 0) {
    return {
      replyRate: 0,
      openRate: 0,
      interestedRate: 0,
      bounceRate: 0,
      campaignCount: 0,
    };
  }

  // Get latest snapshot per campaign (EB stats are cumulative)
  const latestByCampaign = new Map<string, CampaignSnapshot>();
  for (const d of data) {
    const name = d.snapshot.campaignName;
    if (!latestByCampaign.has(name)) {
      latestByCampaign.set(name, d.snapshot);
    }
  }

  const snapshots = Array.from(latestByCampaign.values());
  const count = snapshots.length;

  return {
    replyRate:
      Math.round(
        (snapshots.reduce((s, c) => s + c.replyRate, 0) / count) * 100,
      ) / 100,
    openRate:
      Math.round(
        (snapshots.reduce((s, c) => s + c.openRate, 0) / count) * 100,
      ) / 100,
    interestedRate:
      Math.round(
        (snapshots.reduce((s, c) => s + c.interestedRate, 0) / count) * 100,
      ) / 100,
    bounceRate:
      Math.round(
        (snapshots.reduce((s, c) => s + c.bounceRate, 0) / count) * 100,
      ) / 100,
    campaignCount: count,
  };
}

function buildPrompt(data: {
  workspaceSlug: string;
  campaignData: Array<{
    campaignId: string;
    date: string;
    snapshot: CampaignSnapshot;
  }>;
  intentCounts: Array<{ intent: string; count: number }>;
  sentimentCounts: Array<{ sentiment: string; count: number }>;
  objectionCounts: Array<{ subtype: string; count: number }>;
  bodyElements: Array<{ key: string; data: unknown }>;
  thisWeekAvg: AverageRates;
  lastWeekAvg: AverageRates;
  totalReplies: number;
}): string {
  // Build latest snapshot per campaign for the summary
  const latestByCampaign = new Map<
    string,
    { campaignId: string; snapshot: CampaignSnapshot }
  >();
  for (const d of data.campaignData) {
    if (!latestByCampaign.has(d.snapshot.campaignName)) {
      latestByCampaign.set(d.snapshot.campaignName, {
        campaignId: d.campaignId,
        snapshot: d.snapshot,
      });
    }
  }

  const campaignSummaries = Array.from(latestByCampaign.entries())
    .map(([name, { campaignId, snapshot: s }]) => {
      return `- ${name} (id: ${campaignId}): ${s.emailsSent} sent, ${s.replyRate}% reply rate, ${s.openRate}% open rate, ${s.interestedRate}% interested rate, ${s.bounceRate}% bounce rate, copy strategy: ${s.copyStrategy ?? "none"}, status: ${s.status}`;
    })
    .join("\n");

  const intentSummary = data.intentCounts
    .map((i) => `${i.intent}: ${i.count}`)
    .join(", ");

  const sentimentSummary = data.sentimentCounts
    .map((s) => `${s.sentiment}: ${s.count}`)
    .join(", ");

  const objectionSummary = data.objectionCounts
    .map((o) => `${o.subtype}: ${o.count}`)
    .join(", ");

  const wowChanges: string[] = [];
  if (
    data.lastWeekAvg.campaignCount > 0 &&
    data.thisWeekAvg.campaignCount > 0
  ) {
    const rr = data.thisWeekAvg.replyRate - data.lastWeekAvg.replyRate;
    const or = data.thisWeekAvg.openRate - data.lastWeekAvg.openRate;
    const ir =
      data.thisWeekAvg.interestedRate - data.lastWeekAvg.interestedRate;
    const br = data.thisWeekAvg.bounceRate - data.lastWeekAvg.bounceRate;
    wowChanges.push(
      `Reply rate: ${data.thisWeekAvg.replyRate}% (${rr >= 0 ? "+" : ""}${rr.toFixed(2)}pp vs last week)`,
      `Open rate: ${data.thisWeekAvg.openRate}% (${or >= 0 ? "+" : ""}${or.toFixed(2)}pp vs last week)`,
      `Interested rate: ${data.thisWeekAvg.interestedRate}% (${ir >= 0 ? "+" : ""}${ir.toFixed(2)}pp vs last week)`,
      `Bounce rate: ${data.thisWeekAvg.bounceRate}% (${br >= 0 ? "+" : ""}${br.toFixed(2)}pp vs last week)`,
    );
  }

  return `You are an outbound email campaign analyst. Analyze this workspace data and produce 3-5 actionable insights. Be direct and data-first — lead with numbers, not fluff.

WORKSPACE: ${data.workspaceSlug}
DATA PERIOD: Last 2 weeks
TOTAL REPLIES: ${data.totalReplies}

## Campaign Performance (latest snapshot per campaign)
${campaignSummaries || "No campaign data available."}

## Reply Intent Distribution
${intentSummary || "No reply data."}

## Reply Sentiment Distribution
${sentimentSummary || "No sentiment data."}

## Objection Patterns
${objectionSummary || "No objections recorded."}

## Week-over-Week Changes
${wowChanges.length > 0 ? wowChanges.join("\n") : "Not enough data for week-over-week comparison."}

## Body Element Data
${data.bodyElements.length > 0 ? data.bodyElements.map((b) => `${b.key}: ${JSON.stringify(b.data)}`).join("\n") : "No body element data."}

## Available Action Types
1. pause_campaign — Pause a specific campaign. Use when a campaign has critically poor performance (high bounce rate, very low engagement). Params: { campaignId: string }
2. update_icp_threshold — Change the ICP score threshold for a campaign. Use when ICP targeting seems too loose or too strict. Params: { campaignId: string, newThreshold: string (number as string) }
3. flag_copy_review — Flag a campaign's copy for review. Use when copy performance metrics suggest the messaging needs updating. Params: { campaignId: string }
4. adjust_signal_targeting — Adjust signal targeting parameters. Use when signal-based campaigns show targeting issues. Params: { campaignId: string }

## Confidence Guidelines
- HIGH: 50+ data points supporting the finding AND clear trend (>20% change)
- MEDIUM: 20-49 data points OR moderate trend (10-20% change)
- LOW: <20 data points OR marginal trend (<10% change)

Produce 3-5 insights. Each must include a specific observation with numbers, supporting evidence, a concrete suggested action from the 4 types above, confidence level, and priority (1=highest, 10=lowest).`;
}
