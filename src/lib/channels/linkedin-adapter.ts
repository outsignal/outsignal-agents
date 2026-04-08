/**
 * LinkedIn channel adapter — wraps existing Prisma queries behind the
 * ChannelAdapter interface.
 *
 * This is a thin facade. Zero new business logic. All query patterns
 * are copied from existing code (snapshot.ts, deploy.ts, etc.).
 */

import { prisma } from "@/lib/db";
import {
  CHANNEL_TYPES,
  LINKEDIN_ACTION_TYPES,
  LINKEDIN_ACTION_STATUSES,
  CONNECTION_REQUEST_TYPES,
} from "./constants";
import type {
  ChannelAdapter,
  CampaignChannelRef,
  DeployParams,
  DeployResult,
  UnifiedMetrics,
  UnifiedLead,
  UnifiedAction,
  UnifiedStep,
} from "./types";

export class LinkedInAdapter implements ChannelAdapter {
  readonly channel = CHANNEL_TYPES.LINKEDIN;

  // ---------------------------------------------------------------------------
  // deploy — stub until Phase 73 wiring
  // ---------------------------------------------------------------------------

  async deploy(_params: DeployParams): Promise<DeployResult> {
    throw new Error(
      "LinkedIn deploy wiring is Phase 73 — use deployLinkedInChannel() directly until then",
    );
  }

  // ---------------------------------------------------------------------------
  // pause — cancel all pending actions for the campaign
  // ---------------------------------------------------------------------------

  async pause(ref: CampaignChannelRef): Promise<void> {
    await prisma.linkedInAction.updateMany({
      where: {
        campaignName: ref.campaignName,
        workspaceSlug: ref.workspaceSlug,
        status: LINKEDIN_ACTION_STATUSES.PENDING,
      },
      data: { status: LINKEDIN_ACTION_STATUSES.CANCELLED },
    });
  }

  // ---------------------------------------------------------------------------
  // resume — no-op for LinkedIn (actions are one-shot)
  // ---------------------------------------------------------------------------

  async resume(_ref: CampaignChannelRef): Promise<void> {
    console.warn(
      "LinkedIn campaigns cannot be resumed — actions are one-shot. Re-deploy to create new actions.",
    );
  }

  // ---------------------------------------------------------------------------
  // getMetrics — same query pattern as snapshot.ts lines ~131-169
  // ---------------------------------------------------------------------------

  async getMetrics(ref: CampaignChannelRef): Promise<UnifiedMetrics> {
    const [
      connectionsSent,
      messagesSent,
      profileViews,
      connectionsAccepted,
    ] = await Promise.all([
      prisma.linkedInAction.count({
        where: {
          workspaceSlug: ref.workspaceSlug,
          campaignName: ref.campaignName,
          actionType: { in: [...CONNECTION_REQUEST_TYPES] },
          status: LINKEDIN_ACTION_STATUSES.COMPLETE,
        },
      }),
      prisma.linkedInAction.count({
        where: {
          workspaceSlug: ref.workspaceSlug,
          campaignName: ref.campaignName,
          actionType: LINKEDIN_ACTION_TYPES.MESSAGE,
          status: LINKEDIN_ACTION_STATUSES.COMPLETE,
        },
      }),
      prisma.linkedInAction.count({
        where: {
          workspaceSlug: ref.workspaceSlug,
          campaignName: ref.campaignName,
          actionType: LINKEDIN_ACTION_TYPES.PROFILE_VIEW,
          status: LINKEDIN_ACTION_STATUSES.COMPLETE,
        },
      }),
      // Preserve existing fragile pattern from snapshot.ts — flagged for future improvement
      prisma.linkedInAction.count({
        where: {
          workspaceSlug: ref.workspaceSlug,
          campaignName: ref.campaignName,
          actionType: { in: [...CONNECTION_REQUEST_TYPES] },
          status: LINKEDIN_ACTION_STATUSES.COMPLETE,
          result: { contains: '"accepted"' },
        },
      }),
    ]);

    const sent = connectionsSent + messagesSent;
    const acceptRate =
      connectionsSent > 0
        ? Math.round((connectionsAccepted / connectionsSent) * 100) / 100
        : 0;

    return {
      channel: CHANNEL_TYPES.LINKEDIN,
      sent,
      replied: 0, // LinkedIn replies are tracked separately
      replyRate: 0,
      connectionsSent,
      connectionsAccepted,
      acceptRate,
      messagesSent,
      profileViews,
    };
  }

  // ---------------------------------------------------------------------------
  // getLeads — distinct people with LinkedIn actions for the campaign
  // ---------------------------------------------------------------------------

  async getLeads(ref: CampaignChannelRef): Promise<UnifiedLead[]> {
    const actions = await prisma.linkedInAction.findMany({
      where: {
        campaignName: ref.campaignName,
        workspaceSlug: ref.workspaceSlug,
      },
      select: { personId: true },
      distinct: ["personId"],
    });

    const personIds = actions
      .map((a) => a.personId)
      .filter((id): id is string => id != null);

    if (personIds.length === 0) return [];

    const people = await prisma.person.findMany({
      where: { id: { in: personIds } },
    });

    // Get latest action status for each person
    const latestActions = await prisma.linkedInAction.findMany({
      where: {
        campaignName: ref.campaignName,
        workspaceSlug: ref.workspaceSlug,
        personId: { in: personIds },
      },
      orderBy: { createdAt: "desc" },
      distinct: ["personId"],
      select: { personId: true, status: true },
    });

    const statusByPersonId = new Map(
      latestActions.map((a) => [a.personId, a.status]),
    );

    return people.map((person) => ({
      id: person.id,
      email: person.email ?? undefined,
      linkedInUrl: person.linkedinUrl ?? undefined,
      name:
        [person.firstName, person.lastName].filter(Boolean).join(" ") ||
        undefined,
      company: person.company ?? undefined,
      title: person.jobTitle ?? undefined,
      channel: CHANNEL_TYPES.LINKEDIN,
      status: statusByPersonId.get(person.id) ?? "unknown",
      addedAt: person.createdAt,
    }));
  }

  // ---------------------------------------------------------------------------
  // getActions — all LinkedIn actions for the campaign
  // ---------------------------------------------------------------------------

  async getActions(ref: CampaignChannelRef): Promise<UnifiedAction[]> {
    const actions = await prisma.linkedInAction.findMany({
      where: {
        campaignName: ref.campaignName,
        workspaceSlug: ref.workspaceSlug,
      },
      orderBy: { createdAt: "desc" },
    });

    return actions.map((action) => ({
      id: action.id,
      channel: CHANNEL_TYPES.LINKEDIN,
      actionType: action.actionType,
      status: action.status,
      personId: action.personId ?? undefined,
      detail: action.messageBody ?? undefined,
      performedAt: action.createdAt,
      campaignName: action.campaignName ?? undefined,
    }));
  }

  // ---------------------------------------------------------------------------
  // getSequenceSteps — CampaignSequenceRules + Campaign.linkedinSequence fallback
  // ---------------------------------------------------------------------------

  async getSequenceSteps(ref: CampaignChannelRef): Promise<UnifiedStep[]> {
    // Primary: CampaignSequenceRules
    const rules = await prisma.campaignSequenceRule.findMany({
      where: {
        workspaceSlug: ref.workspaceSlug,
        campaignName: ref.campaignName,
      },
      orderBy: { position: "asc" },
    });

    if (rules.length > 0) {
      return rules.map((rule) => ({
        stepNumber: rule.position,
        channel: CHANNEL_TYPES.LINKEDIN,
        type: rule.actionType,
        delayDays: Math.ceil(rule.delayMinutes / (60 * 24)),
        messageBody: rule.messageTemplate ?? undefined,
        triggerEvent: rule.triggerEvent ?? undefined,
      }));
    }

    // Fallback: Campaign.linkedinSequence JSON field
    const campaign = await prisma.campaign.findFirst({
      where: {
        name: ref.campaignName,
        workspaceSlug: ref.workspaceSlug,
      },
      select: { linkedinSequence: true },
    });

    if (!campaign?.linkedinSequence) return [];

    try {
      const steps = JSON.parse(campaign.linkedinSequence) as Array<{
        position?: number;
        type?: string;
        body?: string;
        delayDays?: number;
      }>;

      return steps.map((step, index) => ({
        stepNumber: step.position ?? index + 1,
        channel: CHANNEL_TYPES.LINKEDIN,
        type: step.type ?? "message",
        delayDays: step.delayDays ?? 0,
        messageBody: step.body ?? undefined,
      }));
    } catch {
      return [];
    }
  }
}
