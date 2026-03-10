import { prisma } from "@/lib/db";
import type { Insight } from "@prisma/client";

interface ActionResult {
  before: string;
  after: string;
  outcome: string;
}

/**
 * Execute the suggested action for an approved insight.
 * Returns before/after audit trail stored as executionResult on the Insight.
 */
export async function executeAction(insight: Insight): Promise<ActionResult> {
  const params = parseActionParams(insight.actionParams);

  switch (insight.actionType) {
    case "pause_campaign":
      return executePauseCampaign(params);
    case "update_icp_threshold":
      return executeUpdateIcpThreshold(params);
    case "flag_copy_review":
      return executeFlagCopyReview(params, insight.workspaceSlug);
    case "adjust_signal_targeting":
      return executeAdjustSignalTargeting(params);
    default:
      throw new Error(`Unknown action type: ${insight.actionType}`);
  }
}

function parseActionParams(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

// --- Action implementations ---

async function executePauseCampaign(
  params: Record<string, string>,
): Promise<ActionResult> {
  const campaignId = params.campaignId;
  if (!campaignId) {
    throw new Error("pause_campaign requires campaignId in actionParams");
  }

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
  });

  if (!campaign) {
    throw new Error(`Campaign not found: ${campaignId}`);
  }

  const before = campaign.status;

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: "paused" },
  });

  return {
    before: `Status: ${before}`,
    after: "Status: paused",
    outcome:
      "Campaign paused locally. Verify pause in EmailBison dashboard.",
  };
}

async function executeUpdateIcpThreshold(
  params: Record<string, string>,
): Promise<ActionResult> {
  const newThreshold = params.newThreshold;
  if (!newThreshold) {
    throw new Error(
      "update_icp_threshold requires newThreshold in actionParams",
    );
  }

  // ICP threshold is part of the workspace's icpCriteriaPrompt (a text field).
  // Rather than modifying the prompt directly, we record the recommendation.
  // The insight itself IS the recommendation -- mark as executed.
  return {
    before: "No threshold set",
    after: `Recommended threshold: ${newThreshold}`,
    outcome:
      "Recommendation recorded. Admin should update ICP criteria prompt.",
  };
}

async function executeFlagCopyReview(
  params: Record<string, string>,
  workspaceSlug: string,
): Promise<ActionResult> {
  const campaignId = params.campaignId ?? params.campaignName ?? "unknown";
  const reason = params.reason ?? "AI-recommended review based on performance metrics";

  // Store a CachedMetrics entry as a persistent flag
  await prisma.cachedMetrics.upsert({
    where: {
      workspace_metricType_metricKey_date: {
        workspace: workspaceSlug,
        metricType: "copy_review_flag",
        metricKey: campaignId,
        date: new Date().toISOString().slice(0, 10),
      },
    },
    create: {
      workspace: workspaceSlug,
      metricType: "copy_review_flag",
      metricKey: campaignId,
      date: new Date().toISOString().slice(0, 10),
      data: JSON.stringify({ reason, flaggedAt: new Date().toISOString() }),
    },
    update: {
      data: JSON.stringify({ reason, flaggedAt: new Date().toISOString() }),
      computedAt: new Date(),
    },
  });

  return {
    before: "Not flagged",
    after: "Flagged for copy review",
    outcome: "Campaign flagged. Review copy in analytics.",
  };
}

async function executeAdjustSignalTargeting(
  params: Record<string, string>,
): Promise<ActionResult> {
  const adjustment =
    params.adjustment ?? params.suggestion ?? "See insight details";

  // This is a recommendation, not an auto-execute action.
  // The insight record itself captures the recommendation.
  return {
    before: "Current targeting",
    after: `Recommended: ${adjustment}`,
    outcome: "Signal targeting recommendation recorded.",
  };
}
