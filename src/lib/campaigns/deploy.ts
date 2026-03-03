/**
 * Campaign deploy operations — orchestrates pushing campaign content and leads
 * to EmailBison (email channel) and the LinkedIn action queue (linkedin channel).
 *
 * Entry point: executeDeploy(campaignId, deployId) — fire-and-forget, called
 * after the API route has already returned 202.
 *
 * Exports:
 *   executeDeploy      — run a full deploy (all channels in campaign.channels)
 *   retryDeployChannel — retry a single failed channel on an existing deploy
 *   getDeployHistory   — list all CampaignDeploy records for a campaign
 */

import { prisma } from "@/lib/db";
import { EmailBisonClient } from "@/lib/emailbison/client";
import { enqueueAction } from "@/lib/linkedin/queue";
import { assignSenderForPerson } from "@/lib/linkedin/sender";
import { getCampaign } from "@/lib/campaigns/operations";
import type { LinkedInActionType } from "@/lib/linkedin/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EmailSequenceStep {
  position: number;
  subjectLine?: string;
  subjectVariantB?: string;
  body?: string;
  bodyText?: string;
  delayDays?: number;
  notes?: string;
}

interface LinkedInSequenceStep {
  position: number;
  type: string; // "connect" | "message" | "profile_view"
  body?: string;
  delayDays?: number;
  triggerEvent?: string; // "delay_after_previous" | "email_sent" | "connection_accepted"
  notes?: string;
}

// ---------------------------------------------------------------------------
// Retry helper
// ---------------------------------------------------------------------------

/**
 * Simple retry wrapper with exponential backoff.
 * Default: 3 attempts, delays of 1s, 5s, 15s.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  delays = [1000, 5000, 15000],
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries - 1) {
        const delay = delays[Math.min(attempt, delays.length - 1)];
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Email channel deploy
// ---------------------------------------------------------------------------

async function deployEmailChannel(
  deployId: string,
  campaignId: string,
  campaignName: string,
  workspaceSlug: string,
  emailSequence: EmailSequenceStep[],
  apiToken: string,
): Promise<void> {
  // Mark email channel as running
  await prisma.campaignDeploy.update({
    where: { id: deployId },
    data: { emailStatus: "running" },
  });

  const ebClient = new EmailBisonClient(apiToken);

  try {
    // 1. Create EmailBison campaign
    const ebCampaign = await withRetry(() =>
      ebClient.createCampaign({ name: campaignName }),
    );
    const ebCampaignId = ebCampaign.id;

    // 2. Store emailBisonCampaignId on both CampaignDeploy and Campaign records
    await Promise.all([
      prisma.campaignDeploy.update({
        where: { id: deployId },
        data: { emailBisonCampaignId: ebCampaignId },
      }),
      prisma.campaign.update({
        where: { id: campaignId },
        data: { emailBisonCampaignId: ebCampaignId },
      }),
    ]);

    // 3. Create sequence steps
    let emailStepCount = 0;
    for (const step of emailSequence) {
      await withRetry(() =>
        ebClient.createSequenceStep(ebCampaignId, {
          position: step.position,
          subject: step.subjectLine,
          body: step.body ?? step.bodyText ?? "",
          delay_days: step.delayDays ?? 1,
        }),
      );
      emailStepCount++;
    }

    // 4. Load leads from TargetList — dedup via WebhookEvent check
    const campaign = await getCampaign(campaignId);
    if (!campaign?.targetListId) {
      throw new Error("Campaign has no target list");
    }

    const leads = await prisma.targetListPerson.findMany({
      where: { listId: campaign.targetListId },
      include: {
        person: {
          include: {
            workspaces: { where: { workspace: workspaceSlug } },
          },
        },
      },
    });

    // 5. Push leads (serial with 100ms delay between, dedup check)
    let leadCount = 0;
    for (const entry of leads) {
      const person = entry.person;

      // Outsignal-side dedup: skip if already has EMAIL_SENT event for this workspace
      const alreadyDeployed = await prisma.webhookEvent.findFirst({
        where: {
          workspace: workspaceSlug,
          eventType: "EMAIL_SENT",
          leadEmail: person.email,
        },
        select: { id: true },
      });

      if (alreadyDeployed) {
        continue;
      }

      await withRetry(() =>
        ebClient.createLead({
          email: person.email,
          firstName: person.firstName ?? undefined,
          lastName: person.lastName ?? undefined,
          jobTitle: person.jobTitle ?? undefined,
          company: person.company ?? undefined,
        }),
      );

      leadCount++;

      // Throttle — 100ms between leads
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // 6. Update deploy record with completion
    await prisma.campaignDeploy.update({
      where: { id: deployId },
      data: {
        emailStatus: "complete",
        emailStepCount,
        leadCount,
        emailError: null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.campaignDeploy.update({
      where: { id: deployId },
      data: {
        emailStatus: "failed",
        emailError: message,
      },
    });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// LinkedIn channel deploy
// ---------------------------------------------------------------------------

async function deployLinkedInChannel(
  deployId: string,
  campaignId: string,
  workspaceSlug: string,
  linkedinSequence: LinkedInSequenceStep[],
  hasEmailChannel: boolean,
): Promise<void> {
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

    // Only enqueue first step for fresh deploys.
    // For email+linkedin: only enqueue steps with triggerEvent !== 'email_sent'
    // (email-triggered steps are handled by the webhook in Plan 03).
    // For linkedin-only: enqueue the first step for each lead.
    const firstStep = linkedinSequence.find((s) => s.position === 1) ?? linkedinSequence[0];
    if (!firstStep) {
      await prisma.campaignDeploy.update({
        where: { id: deployId },
        data: { linkedinStatus: "complete", linkedinStepCount: 0 },
      });
      return;
    }

    // For email+linkedin campaigns, skip if the first step is email_sent triggered
    // (the webhook will handle it). Only enqueue delay_after_previous steps.
    const triggerEvent = firstStep.triggerEvent ?? "delay_after_previous";
    const shouldEnqueueFirst =
      !hasEmailChannel || triggerEvent === "delay_after_previous";

    let linkedinStepCount = 0;
    const staggerMinutes = 15; // 15 minutes between leads to avoid burst

    for (let i = 0; i < leads.length; i++) {
      const person = leads[i].person;

      if (!person.linkedinUrl) {
        // No LinkedIn URL — skip silently
        continue;
      }

      // Assign sender
      const sender = await assignSenderForPerson(workspaceSlug, {
        mode: hasEmailChannel ? "email_linkedin" : "linkedin_only",
      });

      if (!sender) {
        console.warn(
          `[deploy] No active sender available for workspace ${workspaceSlug} — skipping lead ${person.email}`,
        );
        continue;
      }

      if (shouldEnqueueFirst) {
        // Stagger: lead i fires at i * 15 minutes from now
        const scheduledFor = new Date(Date.now() + i * staggerMinutes * 60 * 1000);

        await enqueueAction({
          senderId: sender.id,
          personId: person.id,
          workspaceSlug,
          actionType: firstStep.type as LinkedInActionType,
          messageBody: firstStep.body,
          priority: 5,
          scheduledFor,
          campaignName: campaign.name,
          sequenceStepRef: `linkedin_${firstStep.position}`,
        });

        linkedinStepCount++;
      }
    }

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
// Finalize — compute overall status from per-channel outcomes
// ---------------------------------------------------------------------------

async function finalizeDeployStatus(
  deployId: string,
  channels: string[],
): Promise<void> {
  const deploy = await prisma.campaignDeploy.findUniqueOrThrow({
    where: { id: deployId },
    select: { emailStatus: true, linkedinStatus: true },
  });

  const channelStatuses = channels.map((ch) => {
    if (ch === "email") return deploy.emailStatus ?? "skipped";
    if (ch === "linkedin") return deploy.linkedinStatus ?? "skipped";
    return "skipped";
  });

  const allComplete = channelStatuses.every((s) => s === "complete");
  const allFailed = channelStatuses.every((s) => s === "failed");
  const anyFailed = channelStatuses.some((s) => s === "failed");

  let overallStatus: string;
  if (allComplete) {
    overallStatus = "complete";
  } else if (allFailed) {
    overallStatus = "failed";
  } else if (anyFailed) {
    overallStatus = "partial_failure";
  } else {
    overallStatus = "complete";
  }

  await prisma.campaignDeploy.update({
    where: { id: deployId },
    data: {
      status: overallStatus,
      completedAt: new Date(),
    },
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute a full campaign deploy. Fire-and-forget — call this after the API
 * route has returned 202.
 *
 * Pushes email content + leads to EmailBison and/or enqueues LinkedIn actions,
 * depending on campaign.channels. Tracks progress on the CampaignDeploy record.
 */
export async function executeDeploy(
  campaignId: string,
  deployId: string,
): Promise<void> {
  // 1. Mark deploy as running
  await prisma.campaignDeploy.update({
    where: { id: deployId },
    data: { status: "running" },
  });

  try {
    // 2. Load campaign and validate state
    const campaign = await getCampaign(campaignId);
    if (!campaign) {
      throw new Error(`Campaign not found: ${campaignId}`);
    }

    if (campaign.status !== "deployed") {
      throw new Error(
        `Campaign is not in 'deployed' status (got '${campaign.status}'). Deploy aborted.`,
      );
    }

    // 3. Load workspace for API token
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { slug: campaign.workspaceSlug },
      select: { apiToken: true },
    });

    if (!workspace.apiToken) {
      throw new Error(
        `Workspace '${campaign.workspaceSlug}' has no API token configured.`,
      );
    }

    // 4. Parse channels from campaign
    const channels = campaign.channels; // already parsed array from formatCampaignDetail
    const hasEmail = channels.includes("email");
    const hasLinkedIn = channels.includes("linkedin");

    // 5. Run channels (email first if both present)
    if (hasEmail) {
      const emailSequence = (campaign.emailSequence ?? []) as EmailSequenceStep[];
      await deployEmailChannel(
        deployId,
        campaignId,
        campaign.name,
        campaign.workspaceSlug,
        emailSequence,
        workspace.apiToken,
      );
    } else {
      // Mark email as skipped
      await prisma.campaignDeploy.update({
        where: { id: deployId },
        data: { emailStatus: "skipped" },
      });
    }

    if (hasLinkedIn) {
      const linkedinSequence = (campaign.linkedinSequence ?? []) as LinkedInSequenceStep[];
      await deployLinkedInChannel(
        deployId,
        campaignId,
        campaign.workspaceSlug,
        linkedinSequence,
        hasEmail,
      );
    } else {
      await prisma.campaignDeploy.update({
        where: { id: deployId },
        data: { linkedinStatus: "skipped" },
      });
    }

    // 6. Finalize
    await finalizeDeployStatus(deployId, channels);
  } catch (err) {
    // Unexpected top-level failure
    const message = err instanceof Error ? err.message : String(err);

    const current = await prisma.campaignDeploy.findUnique({
      where: { id: deployId },
      select: { status: true },
    });

    // Only overwrite status if it hasn't already been set to a terminal state
    // by a channel-level handler
    if (current && current.status === "running") {
      await prisma.campaignDeploy.update({
        where: { id: deployId },
        data: {
          status: "failed",
          error: message,
          completedAt: new Date(),
        },
      });
    }

    throw err;
  }
}

/**
 * Retry a single failed channel on an existing CampaignDeploy.
 * Resets the channel's status and re-runs only that channel's logic.
 */
export async function retryDeployChannel(
  deployId: string,
  channel: "email" | "linkedin",
): Promise<void> {
  const deploy = await prisma.campaignDeploy.findUniqueOrThrow({
    where: { id: deployId },
    select: {
      campaignId: true,
      campaignName: true,
      workspaceSlug: true,
      channels: true,
    },
  });

  const channels = JSON.parse(deploy.channels) as string[];
  const hasEmail = channels.includes("email");

  // Reset the target channel
  if (channel === "email") {
    await prisma.campaignDeploy.update({
      where: { id: deployId },
      data: { emailStatus: "pending", emailError: null, retryChannel: "email" },
    });
  } else {
    await prisma.campaignDeploy.update({
      where: { id: deployId },
      data: {
        linkedinStatus: "pending",
        linkedinError: null,
        retryChannel: "linkedin",
      },
    });
  }

  // Load workspace API token
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { slug: deploy.workspaceSlug },
    select: { apiToken: true },
  });

  if (!workspace.apiToken) {
    throw new Error(
      `Workspace '${deploy.workspaceSlug}' has no API token configured.`,
    );
  }

  const campaign = await getCampaign(deploy.campaignId);
  if (!campaign) {
    throw new Error(`Campaign not found: ${deploy.campaignId}`);
  }

  if (channel === "email") {
    const emailSequence = (campaign.emailSequence ?? []) as EmailSequenceStep[];
    await deployEmailChannel(
      deployId,
      deploy.campaignId,
      deploy.campaignName,
      deploy.workspaceSlug,
      emailSequence,
      workspace.apiToken,
    );
  } else {
    const linkedinSequence = (campaign.linkedinSequence ?? []) as LinkedInSequenceStep[];
    await deployLinkedInChannel(
      deployId,
      deploy.campaignId,
      deploy.workspaceSlug,
      linkedinSequence,
      hasEmail,
    );
  }

  // Recompute overall status
  await finalizeDeployStatus(deployId, channels);
}

/**
 * Return all deploys for a campaign, newest first.
 */
export async function getDeployHistory(campaignId: string) {
  return prisma.campaignDeploy.findMany({
    where: { campaignId },
    orderBy: { createdAt: "desc" },
  });
}
