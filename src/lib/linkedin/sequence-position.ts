/**
 * Sequence Position Tracking — determine where a prospect is in their LinkedIn sequence.
 *
 * Queries LinkedInAction records for a person within a workspace,
 * groups by campaign, and computes position from action statuses.
 */
import { prisma } from "@/lib/db";

export interface SequencePosition {
  campaignName: string;
  totalSteps: number;
  completedSteps: number;
  currentStep: string;
  status: "in_progress" | "waiting_acceptance" | "completed" | "timed_out" | "replied";
}

/**
 * Get the sequence position for a person within a workspace.
 *
 * Returns one SequencePosition per campaign the person is enrolled in.
 * If the person has no LinkedIn actions, returns an empty array.
 */
export async function getSequencePositions(
  personId: string,
  workspaceSlug: string,
): Promise<SequencePosition[]> {
  // Fetch all LinkedIn actions for this person in the workspace
  const actions = await prisma.linkedInAction.findMany({
    where: {
      personId,
      workspaceSlug,
      campaignName: { not: null },
    },
    orderBy: { scheduledFor: "asc" },
    select: {
      id: true,
      actionType: true,
      status: true,
      scheduledFor: true,
      campaignName: true,
      sequenceStepRef: true,
    },
  });

  if (actions.length === 0) return [];

  // Group actions by campaign
  const byCampaign = new Map<string, typeof actions>();
  for (const action of actions) {
    const name = action.campaignName!;
    const list = byCampaign.get(name) ?? [];
    list.push(action);
    byCampaign.set(name, list);
  }

  // Check if the person has replied (LinkedIn inbound message)
  const hasLinkedInReply = await prisma.linkedInMessage.findFirst({
    where: {
      isOutbound: false,
      conversation: {
        personId,
        sender: { workspaceSlug },
      },
    },
  });

  // Check if there is a pending connection
  const connection = await prisma.linkedInConnection.findFirst({
    where: { personId },
    orderBy: { updatedAt: "desc" },
    select: { status: true },
  });

  const results: SequencePosition[] = [];

  for (const [campaignName, campaignActions] of byCampaign) {
    // Look up CampaignSequenceRules to determine total expected steps
    const rules = await prisma.campaignSequenceRule.findMany({
      where: { workspaceSlug, campaignName },
      orderBy: { position: "asc" },
    });

    // Total steps: use rules count if available, otherwise count unique sequence step refs
    const totalSteps = rules.length > 0
      ? rules.length
      : new Set(campaignActions.map((a) => a.sequenceStepRef).filter(Boolean)).size;

    const completedActions = campaignActions.filter((a) => a.status === "complete");
    const pendingActions = campaignActions.filter((a) => a.status === "pending");
    const cancelledActions = campaignActions.filter((a) => a.status === "cancelled");
    const failedActions = campaignActions.filter((a) => a.status === "failed");

    const completedSteps = completedActions.length;

    // Determine status and current step description
    let status: SequencePosition["status"];
    let currentStep: string;

    if (hasLinkedInReply) {
      status = "replied";
      currentStep = "Prospect has replied";
    } else if (
      connection?.status === "pending" &&
      pendingActions.length === 0 &&
      completedSteps > 0
    ) {
      status = "waiting_acceptance";
      currentStep = "Waiting for connection acceptance";
    } else if (
      connection?.status === "failed" ||
      (cancelledActions.length > 0 && pendingActions.length === 0 && completedSteps === 0)
    ) {
      status = "timed_out";
      currentStep = "Connection request timed out or declined";
    } else if (
      pendingActions.length === 0 &&
      completedSteps > 0 &&
      failedActions.length === 0
    ) {
      status = "completed";
      currentStep = `All ${completedSteps} steps completed`;
    } else if (pendingActions.length > 0) {
      status = "in_progress";
      const nextAction = pendingActions[0];
      const scheduledDate = nextAction.scheduledFor.toLocaleDateString("en-GB", {
        month: "short",
        day: "numeric",
      });
      const actionLabel =
        nextAction.actionType === "connect"
          ? "Connection request"
          : nextAction.actionType === "message"
            ? `Message ${completedSteps + 1}`
            : nextAction.actionType === "profile_view"
              ? "Profile view"
              : nextAction.actionType;
      currentStep = `${actionLabel} scheduled for ${scheduledDate}`;
    } else {
      status = "in_progress";
      currentStep = "Sequence in progress";
    }

    results.push({
      campaignName,
      totalSteps: Math.max(totalSteps, completedSteps + pendingActions.length),
      completedSteps,
      currentStep,
      status,
    });
  }

  return results;
}
