/**
 * LinkedIn channel adapter — wraps existing Prisma queries behind the
 * ChannelAdapter interface.
 *
 * This is a thin facade. Zero new business logic. All query patterns
 * are copied from existing code (snapshot.ts, deploy.ts, etc.).
 */

import { prisma } from "@/lib/db";
import { chainActions } from "@/lib/linkedin/chain";
import { applyTimingJitter } from "@/lib/linkedin/jitter";
import { assignSenderForPerson } from "@/lib/linkedin/sender";
import { createSequenceRulesForCampaign } from "@/lib/linkedin/sequencing";
import { getCampaign } from "@/lib/campaigns/operations";
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

// ---------------------------------------------------------------------------
// Local types for LinkedIn deploy
// ---------------------------------------------------------------------------

interface LinkedInSequenceStep {
  position: number;
  type: string; // "connect" | "message" | "profile_view"
  body?: string;
  delayDays?: number;
  triggerEvent?: string; // "delay_after_previous" | "email_sent" | "connection_accepted"
  notes?: string;
}

export class LinkedInAdapter implements ChannelAdapter {
  readonly channel = CHANNEL_TYPES.LINKEDIN;

  // ---------------------------------------------------------------------------
  // deploy — full LinkedIn channel deploy (moved from deploy.ts in Phase 73)
  // ---------------------------------------------------------------------------

  async deploy(params: DeployParams): Promise<void> {
    const { deployId, campaignId, workspaceSlug, channels } = params;

    // Mark linkedin channel as running
    await prisma.campaignDeploy.update({
      where: { id: deployId },
      data: { linkedinStatus: "running" },
    });

    try {
      const campaign = await getCampaign(campaignId);
      if (!campaign?.targetListId) {
        throw new Error("Campaign has no target list");
      }

      const leads = await prisma.targetListPerson.findMany({
        where: { listId: campaign.targetListId },
        include: { person: true },
      });

      const linkedinSequence = (campaign.linkedinSequence ?? []) as LinkedInSequenceStep[];

      if (linkedinSequence.length === 0) {
        await prisma.campaignDeploy.update({
          where: { id: deployId },
          data: { linkedinStatus: "complete", linkedinStepCount: 0 },
        });
        // Still call createSequenceRulesForCampaign with empty array to clean up
        // any stale rules from a previous deploy (idempotent redeploy support)
        await createSequenceRulesForCampaign({
          workspaceSlug,
          campaignName: campaign.name,
          linkedinSequence: [],
        });
        return;
      }

      // ── Connection gate split ────────────────────────────────────────────
      // Split the sequence at the connect step. Pre-connect steps (profile_view,
      // connect) are scheduled immediately via chainActions. Post-connect steps
      // (follow-up messages) become CampaignSequenceRules triggered by
      // connection_accepted — they are NOT pre-scheduled.
      const sorted = [...linkedinSequence].sort((a, b) => a.position - b.position);

      // Ensure profile_view is the first step (industry standard warm-up)
      if (sorted.length > 0 && sorted[0].type !== "profile_view") {
        sorted.unshift({ position: 0, type: "profile_view", delayDays: 0 });
      }

      const connectIndex = sorted.findLastIndex((step) => step.type === "connect" || step.type === "connection_request");

      const preConnectSteps = connectIndex >= 0
        ? sorted.slice(0, connectIndex + 1)
        : sorted; // No connect step — all steps are pre-connect
      const postConnectSteps = connectIndex >= 0
        ? sorted.slice(connectIndex + 1)
        : []; // No connect step — no post-connect steps

      let linkedinStepCount = 0;
      const STAGGER_BASE_MS = 15 * 60 * 1000; // 15 minutes between leads (jittered +-20%)

      for (let i = 0; i < leads.length; i++) {
        const person = leads[i].person;

        if (!person.linkedinUrl) {
          // No LinkedIn URL — skip silently
          continue;
        }

        // Assign sender — mode depends on whether email channel is also being deployed
        const sender = await assignSenderForPerson(workspaceSlug, {
          mode: channels.includes("email") ? "email_linkedin" : "linkedin_only",
        });

        if (!sender) {
          console.warn(
            `[deploy] No active sender available for workspace ${workspaceSlug} — skipping lead ${person.email}`,
          );
          continue;
        }

        // Stagger: lead i fires at i * ~15 minutes (jittered 12-18 min) from now
        const scheduledFor = new Date(Date.now() + i * applyTimingJitter(STAGGER_BASE_MS));

        // Schedule ONLY pre-connect steps (profile_view + connect) via chainActions
        const actionIds = await chainActions({
          senderId: sender.id,
          personId: person.id,
          workspaceSlug,
          sequence: preConnectSteps.map((step) => ({
            position: step.position,
            type: step.type,
            body: step.body,
            delayDays: step.delayDays,
          })),
          baseScheduledFor: scheduledFor,
          priority: 5,
          campaignName: campaign.name,
        });

        console.log(
          `[deploy] Split sequence: ${preConnectSteps.length} pre-connect, ${postConnectSteps.length} post-connect rules for ${person.email}`,
        );
        linkedinStepCount++;
      }

      // Create CampaignSequenceRules for post-connect follow-up messages.
      // These fire when connection_accepted is detected by the connection-poller.
      // Always called (even if postConnectSteps is empty) to clean up stale rules
      // from a previous deploy (idempotent redeploy support).
      const postConnectRules = postConnectSteps.map((step, idx) => ({
        position: step.position,
        type: step.type,
        body: step.body,
        delayHours: (step.delayDays ?? (idx === 0 ? 1 : 2)) * 24,
        triggerEvent: "connection_accepted" as const,
      }));

      await createSequenceRulesForCampaign({
        workspaceSlug,
        campaignName: campaign.name,
        linkedinSequence: postConnectRules,
      });

      await prisma.campaignDeploy.update({
        where: { id: deployId },
        data: {
          linkedinStatus: "complete",
          linkedinStepCount,
          linkedinError: null,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.campaignDeploy.update({
        where: { id: deployId },
        data: {
          linkedinStatus: "failed",
          linkedinError: message,
        },
      });
      throw err;
    }
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
