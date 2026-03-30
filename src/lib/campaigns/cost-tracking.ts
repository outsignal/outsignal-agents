/**
 * Pipeline cost logging and aggregation.
 *
 * Tracks per-stage costs (discovery, enrichment, verification) for campaigns.
 * Provides cost-per-lead calculation.
 */

import { prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CostBreakdown {
  discovery: number;
  enrichment: number;
  verification: number;
  total: number;
  leadCount: number;
  costPerLead: number | null; // null if leadCount is 0
}

// ---------------------------------------------------------------------------
// logPipelineCost
// ---------------------------------------------------------------------------

/**
 * Log a pipeline cost entry to the PipelineCostLog table.
 */
export async function logPipelineCost(params: {
  campaignId?: string;
  workspaceSlug: string;
  stage: "discovery" | "enrichment" | "verification";
  provider: string;
  costUsd: number;
  itemCount: number;
}): Promise<void> {
  await prisma.pipelineCostLog.create({
    data: {
      campaignId: params.campaignId ?? null,
      workspaceSlug: params.workspaceSlug,
      stage: params.stage,
      provider: params.provider,
      costUsd: params.costUsd,
      itemCount: params.itemCount,
    },
  });
}

// ---------------------------------------------------------------------------
// getCampaignCostBreakdown
// ---------------------------------------------------------------------------

/**
 * Aggregate costs by stage for a campaign and compute cost-per-lead.
 *
 * costPerLead = total / leadCount (from TargetListPerson count)
 * Returns null for costPerLead if leadCount is 0.
 */
export async function getCampaignCostBreakdown(
  campaignId: string,
): Promise<CostBreakdown> {
  // Get cost aggregations by stage
  const costLogs = await prisma.pipelineCostLog.groupBy({
    by: ["stage"],
    where: { campaignId },
    _sum: { costUsd: true },
  });

  const stageMap: Record<string, number> = {};
  for (const entry of costLogs) {
    stageMap[entry.stage] = entry._sum.costUsd ?? 0;
  }

  const discovery = stageMap["discovery"] ?? 0;
  const enrichment = stageMap["enrichment"] ?? 0;
  const verification = stageMap["verification"] ?? 0;
  const total = discovery + enrichment + verification;

  // Get lead count from the campaign's target list
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: {
      targetListId: true,
    },
  });

  let leadCount = 0;
  if (campaign?.targetListId) {
    leadCount = await prisma.targetListPerson.count({
      where: { listId: campaign.targetListId },
    });
  }

  return {
    discovery,
    enrichment,
    verification,
    total,
    leadCount,
    costPerLead: leadCount > 0 ? total / leadCount : null,
  };
}
