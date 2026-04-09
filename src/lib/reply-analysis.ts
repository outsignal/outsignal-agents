/**
 * Reply Analysis Module
 *
 * Data gathering (Prisma queries) and LLM synthesis for reply analysis.
 * Used by Plan 03 for one-time analysis and weekly cron automation.
 */

import { prisma } from "@/lib/db";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { NOVA_MODEL } from "@/lib/agents/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CampaignBreakdown {
  campaignId: string | null;
  campaignName: string | null;
  replyCount: number;
}

export interface StepBreakdown {
  sequenceStep: number;
  replyCount: number;
}

export interface SentimentBreakdown {
  sentiment: string | null;
  count: number;
}

export interface IntentBreakdown {
  intent: string | null;
  count: number;
}

export interface ObjectionBreakdown {
  objectionSubtype: string | null;
  count: number;
}

export interface SubjectPerformance {
  outboundSubject: string;
  count: number;
}

export interface CampaignMetrics {
  campaignId: string;
  campaignName: string;
  data: Record<string, unknown>;
}

export interface WorkspaceAnalysis {
  slug: string;
  totalReplies: number;
  campaignBreakdown: CampaignBreakdown[];
  stepBreakdown: StepBreakdown[];
  sentimentDistribution: SentimentBreakdown[];
  intentDistribution: IntentBreakdown[];
  objectionBreakdown: ObjectionBreakdown[];
  topSubjectsByPositive: SubjectPerformance[];
  topSubjectsByTotal: SubjectPerformance[];
  cachedMetrics: CampaignMetrics[];
}

export interface WorkspaceReplyStats {
  workspaceSlug: string;
  replyCount: number;
  vertical: string | null;
}

export interface StrategyPerformance {
  copyStrategy: string;
  vertical: string | null;
  replyCount: number;
  campaignCount: number;
}

export interface SubjectLengthCorrelation {
  positive: { avgWordCount: number; sampleSize: number };
  negative: { avgWordCount: number; sampleSize: number };
}

export interface VerticalBenchmark {
  vertical: string;
  workspaceCount: number;
  totalReplies: number;
  avgRepliesPerWorkspace: number;
}

export interface CrossWorkspaceAnalysis {
  workspaceStats: WorkspaceReplyStats[];
  strategyPerformance: StrategyPerformance[];
  universalStepPatterns: StepBreakdown[];
  subjectLengthCorrelation: SubjectLengthCorrelation;
  verticalBenchmarks: VerticalBenchmark[];
}

// ---------------------------------------------------------------------------
// Per-Workspace Analysis
// ---------------------------------------------------------------------------

/**
 * Gather reply analysis data for a single workspace via Prisma queries.
 */
export async function analyzeWorkspace(
  slug: string,
): Promise<WorkspaceAnalysis> {
  const where = { workspaceSlug: slug };

  // Run all queries in parallel
  const [
    totalReplies,
    campaignGroups,
    stepGroups,
    sentimentGroups,
    intentGroups,
    objectionGroups,
    positiveSubjectGroups,
    totalSubjectGroups,
    cachedMetricsRaw,
  ] = await Promise.all([
    // Total reply count
    prisma.reply.count({ where }),

    // Reply count by campaign
    prisma.reply.groupBy({
      by: ["campaignId", "campaignName"],
      where,
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
    }),

    // Reply count by sequence step
    prisma.reply.groupBy({
      by: ["sequenceStep"],
      where: { ...where, sequenceStep: { not: null } },
      _count: { id: true },
      orderBy: { sequenceStep: "asc" },
    }),

    // Sentiment distribution
    prisma.reply.groupBy({
      by: ["sentiment"],
      where,
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
    }),

    // Intent distribution
    prisma.reply.groupBy({
      by: ["intent"],
      where,
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
    }),

    // Objection subtype breakdown
    prisma.reply.groupBy({
      by: ["objectionSubtype"],
      where: { ...where, intent: "objection" },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
    }),

    // Top outbound subjects by positive reply count
    prisma.reply.groupBy({
      by: ["outboundSubject"],
      where: { ...where, sentiment: "positive", outboundSubject: { not: null } },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 10,
    }),

    // Top outbound subjects by total reply count
    prisma.reply.groupBy({
      by: ["outboundSubject"],
      where: { ...where, outboundSubject: { not: null } },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 10,
    }),

    // Cached campaign metrics
    prisma.cachedMetrics.findMany({
      where: {
        workspace: slug,
        metricType: "campaign_snapshot",
      },
      orderBy: { computedAt: "desc" },
    }),
  ]);

  return {
    slug,
    totalReplies,
    campaignBreakdown: campaignGroups.map((g) => ({
      campaignId: g.campaignId,
      campaignName: g.campaignName,
      replyCount: g._count.id,
    })),
    stepBreakdown: stepGroups.map((g) => ({
      sequenceStep: g.sequenceStep!,
      replyCount: g._count.id,
    })),
    sentimentDistribution: sentimentGroups.map((g) => ({
      sentiment: g.sentiment,
      count: g._count.id,
    })),
    intentDistribution: intentGroups.map((g) => ({
      intent: g.intent,
      count: g._count.id,
    })),
    objectionBreakdown: objectionGroups.map((g) => ({
      objectionSubtype: g.objectionSubtype,
      count: g._count.id,
    })),
    topSubjectsByPositive: positiveSubjectGroups.map((g) => ({
      outboundSubject: g.outboundSubject!,
      count: g._count.id,
    })),
    topSubjectsByTotal: totalSubjectGroups.map((g) => ({
      outboundSubject: g.outboundSubject!,
      count: g._count.id,
    })),
    cachedMetrics: cachedMetricsRaw.map((m) => ({
      campaignId: m.metricKey,
      campaignName: m.metricKey,
      data: JSON.parse(m.data) as Record<string, unknown>,
    })),
  };
}

// ---------------------------------------------------------------------------
// Cross-Workspace Analysis
// ---------------------------------------------------------------------------

/**
 * Gather cross-workspace analysis data via Prisma queries.
 */
export async function analyzeCrossWorkspace(): Promise<CrossWorkspaceAnalysis> {
  // Get all workspaces with replies
  const replyGroups = await prisma.reply.groupBy({
    by: ["workspaceSlug"],
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
  });

  // Load workspace verticals for enrichment
  const slugs = replyGroups.map((g) => g.workspaceSlug);
  const workspaces = await prisma.workspace.findMany({
    where: { slug: { in: slugs } },
    select: { slug: true, vertical: true },
  });
  const verticalMap = new Map(workspaces.map((w) => [w.slug, w.vertical]));

  const workspaceStats: WorkspaceReplyStats[] = replyGroups.map((g) => ({
    workspaceSlug: g.workspaceSlug,
    replyCount: g._count.id,
    vertical: verticalMap.get(g.workspaceSlug) ?? null,
  }));

  // Strategy performance: fetch campaigns with strategies and count replies
  const campaignsWithStrategy = await prisma.campaign.findMany({
    where: { copyStrategy: { not: null } },
    select: {
      id: true,
      workspaceSlug: true,
      copyStrategy: true,
    },
  });

  const strategyMap = new Map(
    campaignsWithStrategy.map((c) => [c.id, c]),
  );
  const campaignIds = campaignsWithStrategy.map((c) => c.id);

  const repliesByCampaign = await prisma.reply.groupBy({
    by: ["campaignId"],
    where: { campaignId: { in: campaignIds } },
    _count: { id: true },
  });

  // Aggregate by strategy + vertical
  const strategyAgg = new Map<
    string,
    { replyCount: number; campaignIds: Set<string> }
  >();

  for (const rg of repliesByCampaign) {
    if (!rg.campaignId) continue;
    const campaign = strategyMap.get(rg.campaignId);
    if (!campaign || !campaign.copyStrategy) continue;

    const vertical = verticalMap.get(campaign.workspaceSlug) ?? "Unknown";
    const key = `${campaign.copyStrategy}::${vertical}`;

    const existing = strategyAgg.get(key) ?? {
      replyCount: 0,
      campaignIds: new Set<string>(),
    };
    existing.replyCount += rg._count.id;
    existing.campaignIds.add(rg.campaignId);
    strategyAgg.set(key, existing);
  }

  const strategyPerformance: StrategyPerformance[] = Array.from(
    strategyAgg.entries(),
  ).map(([key, val]) => {
    const [copyStrategy, vertical] = key.split("::");
    return {
      copyStrategy,
      vertical: vertical === "Unknown" ? null : vertical,
      replyCount: val.replyCount,
      campaignCount: val.campaignIds.size,
    };
  });

  // Universal step patterns (across all workspaces)
  const universalSteps = await prisma.reply.groupBy({
    by: ["sequenceStep"],
    where: { sequenceStep: { not: null } },
    _count: { id: true },
    orderBy: { sequenceStep: "asc" },
  });

  const universalStepPatterns: StepBreakdown[] = universalSteps.map((g) => ({
    sequenceStep: g.sequenceStep!,
    replyCount: g._count.id,
  }));

  // Subject line length correlation
  const positiveRepliesWithSubject = await prisma.reply.findMany({
    where: { sentiment: "positive", outboundSubject: { not: null } },
    select: { outboundSubject: true },
  });

  const negativeRepliesWithSubject = await prisma.reply.findMany({
    where: { sentiment: "negative", outboundSubject: { not: null } },
    select: { outboundSubject: true },
  });

  function avgWordCount(
    items: Array<{ outboundSubject: string | null }>,
  ): number {
    if (items.length === 0) return 0;
    const total = items.reduce((sum, item) => {
      const words = (item.outboundSubject ?? "").split(/\s+/).filter(Boolean);
      return sum + words.length;
    }, 0);
    return Math.round((total / items.length) * 10) / 10;
  }

  const subjectLengthCorrelation: SubjectLengthCorrelation = {
    positive: {
      avgWordCount: avgWordCount(positiveRepliesWithSubject),
      sampleSize: positiveRepliesWithSubject.length,
    },
    negative: {
      avgWordCount: avgWordCount(negativeRepliesWithSubject),
      sampleSize: negativeRepliesWithSubject.length,
    },
  };

  // Per-vertical benchmarks
  const verticalAgg = new Map<
    string,
    { workspaceSlugs: Set<string>; totalReplies: number }
  >();

  for (const ws of workspaceStats) {
    const vertical = ws.vertical ?? "Unknown";
    const existing = verticalAgg.get(vertical) ?? {
      workspaceSlugs: new Set<string>(),
      totalReplies: 0,
    };
    existing.workspaceSlugs.add(ws.workspaceSlug);
    existing.totalReplies += ws.replyCount;
    verticalAgg.set(vertical, existing);
  }

  const verticalBenchmarks: VerticalBenchmark[] = Array.from(
    verticalAgg.entries(),
  ).map(([vertical, val]) => ({
    vertical,
    workspaceCount: val.workspaceSlugs.size,
    totalReplies: val.totalReplies,
    avgRepliesPerWorkspace:
      Math.round((val.totalReplies / val.workspaceSlugs.size) * 10) / 10,
  }));

  return {
    workspaceStats,
    strategyPerformance,
    universalStepPatterns,
    subjectLengthCorrelation,
    verticalBenchmarks,
  };
}

// ---------------------------------------------------------------------------
// LLM Synthesis
// ---------------------------------------------------------------------------

/**
 * Synthesize raw analysis data into human-readable insight strings
 * using LLM to identify patterns and produce data-backed observations.
 */
export async function synthesizeInsights(
  workspaceData: WorkspaceAnalysis,
  crossData: CrossWorkspaceAnalysis,
  slug: string,
): Promise<{ globalInsights: string[]; workspaceInsights: string[] }> {
  const vertical =
    crossData.workspaceStats.find((w) => w.workspaceSlug === slug)?.vertical ??
    "Unknown";

  const prompt = `You are a cold outbound performance analyst. Analyze the following reply data and produce specific, data-backed insights.

## Workspace Data (${slug}, vertical: ${vertical})

Total replies: ${workspaceData.totalReplies}

Campaign breakdown:
${workspaceData.campaignBreakdown.map((c) => `- ${c.campaignName ?? c.campaignId ?? "unknown"}: ${c.replyCount} replies`).join("\n")}

Step breakdown:
${workspaceData.stepBreakdown.map((s) => `- Step ${s.sequenceStep}: ${s.replyCount} replies`).join("\n")}

Sentiment: ${workspaceData.sentimentDistribution.map((s) => `${s.sentiment ?? "unclassified"}: ${s.count}`).join(", ")}

Intent: ${workspaceData.intentDistribution.map((i) => `${i.intent ?? "unclassified"}: ${i.count}`).join(", ")}

Objections: ${workspaceData.objectionBreakdown.map((o) => `${o.objectionSubtype ?? "other"}: ${o.count}`).join(", ") || "none"}

Top subjects (positive replies): ${workspaceData.topSubjectsByPositive.map((s) => `"${s.outboundSubject}" (${s.count})`).join(", ") || "none with outbound data"}

Top subjects (all replies): ${workspaceData.topSubjectsByTotal.map((s) => `"${s.outboundSubject}" (${s.count})`).join(", ") || "none with outbound data"}

## Cross-Workspace Data

Workspaces with replies:
${crossData.workspaceStats.map((w) => `- ${w.workspaceSlug} (${w.vertical ?? "no vertical"}): ${w.replyCount} replies`).join("\n")}

Strategy performance:
${crossData.strategyPerformance.map((s) => `- ${s.copyStrategy} in ${s.vertical ?? "unknown"}: ${s.replyCount} replies across ${s.campaignCount} campaigns`).join("\n") || "no strategy data"}

Universal step patterns:
${crossData.universalStepPatterns.map((s) => `- Step ${s.sequenceStep}: ${s.replyCount} replies`).join("\n")}

Subject line length:
- Positive replies: avg ${crossData.subjectLengthCorrelation.positive.avgWordCount} words (n=${crossData.subjectLengthCorrelation.positive.sampleSize})
- Negative replies: avg ${crossData.subjectLengthCorrelation.negative.avgWordCount} words (n=${crossData.subjectLengthCorrelation.negative.sampleSize})

Vertical benchmarks:
${crossData.verticalBenchmarks.map((v) => `- ${v.vertical}: ${v.totalReplies} total replies across ${v.workspaceCount} workspaces (avg ${v.avgRepliesPerWorkspace}/workspace)`).join("\n")}

---

Produce two lists:

1. GLOBAL INSIGHTS (5-10): Cross-client patterns. Format each as: [Vertical: {vertical}] -- {pattern with specific numbers}
2. WORKSPACE INSIGHTS (5-10): Insights specific to ${slug}. Format each as: ${slug}: {copy insight with specific numbers}

Focus on:
- Which strategies work best (if strategy data available)
- Which sequence steps generate the most replies
- Subject line patterns (length, what generates positive vs negative replies)
- Objection patterns
- Sentiment trends
- Vertical comparison benchmarks

Be specific with numbers. Do not make generic observations. If data is insufficient for a category, skip it rather than guessing.

Return as JSON: { "globalInsights": ["..."], "workspaceInsights": ["..."] }`;

  const result = await generateText({
    model: anthropic("claude-sonnet-4-6"),
    prompt,
  });

  try {
    // Extract JSON from the response (handle potential markdown code fences)
    let jsonStr = result.text.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr) as {
      globalInsights: string[];
      workspaceInsights: string[];
    };

    return {
      globalInsights: Array.isArray(parsed.globalInsights)
        ? parsed.globalInsights
        : [],
      workspaceInsights: Array.isArray(parsed.workspaceInsights)
        ? parsed.workspaceInsights
        : [],
    };
  } catch (err) {
    console.error("[reply-analysis] Failed to parse LLM synthesis:", err);
    return { globalInsights: [], workspaceInsights: [] };
  }
}
