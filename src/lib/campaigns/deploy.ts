/**
 * Campaign deploy operations — orchestrates channel deploys via the adapter
 * registry. Individual channel logic lives in EmailAdapter and LinkedInAdapter.
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
import { initAdapters, getAdapter } from "@/lib/channels";
import type { ChannelType } from "@/lib/channels";
import { getCampaign } from "@/lib/campaigns/operations";
import { notifyDeploy, notifyCampaignLive } from "@/lib/notifications";
import { SYSTEM_ADMIN_EMAIL } from "@/lib/audit";

// CAMP-03 audit (Phase 73): emailBisonCampaignId writes moved to EmailAdapter.deploy().
// Remaining raw EB ID references in portal/analytics files are Phase 74/75 scope.

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
 * Dispatches to channel adapters via the registry. Tracks progress on the
 * CampaignDeploy record.
 */
export async function executeDeploy(
  campaignId: string,
  deployId: string,
): Promise<void> {
  initAdapters();

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

    if (campaign.status !== "deployed" && campaign.status !== "active") {
      throw new Error(
        `Campaign is not in 'deployed' or 'active' status (got '${campaign.status}'). Deploy aborted.`,
      );
    }

    // 3. Parse channels from campaign
    const channels = campaign.channels; // already parsed array from formatCampaignDetail

    // 4. Run channels via adapter dispatch (email first if both present)
    for (const channel of ["email", "linkedin"] as const) {
      if (channels.includes(channel)) {
        const adapter = getAdapter(channel);
        await adapter.deploy({
          deployId,
          campaignId,
          campaignName: campaign.name,
          workspaceSlug: campaign.workspaceSlug,
          channels,
        });
      } else {
        const statusField = channel === "email" ? "emailStatus" : "linkedinStatus";
        await prisma.campaignDeploy.update({
          where: { id: deployId },
          data: { [statusField]: "skipped" },
        });
      }
    }

    // 5. Finalize
    await finalizeDeployStatus(deployId, channels);

    // 5b. Auto-transition campaign from "deployed" to "active" on successful deploy
    const finalizedDeploy = await prisma.campaignDeploy.findUniqueOrThrow({
      where: { id: deployId },
      select: { status: true },
    });
    if (finalizedDeploy.status === "complete") {
      // Only transition if still in "deployed" — don't re-activate paused/archived campaigns
      const activated = await prisma.campaign.updateMany({
        where: { id: campaignId, status: "deployed" },
        data: { status: "active" },
      });
      if (activated.count > 0) {
        console.log(
          `[deploy] Auto-transitioned campaign ${campaignId} from 'deployed' to 'active'`,
        );
      }
    }

    // 6. Send deploy completion notification (non-blocking)
    const finalDeploy = await prisma.campaignDeploy.findUnique({ where: { id: deployId } });
    if (finalDeploy) {
      await notifyDeploy({
        workspaceSlug: campaign.workspaceSlug,
        campaignName: campaign.name,
        campaignId,
        status: finalDeploy.status as "complete" | "partial_failure" | "failed",
        leadCount: finalDeploy.leadCount,
        emailStepCount: finalDeploy.emailStepCount,
        linkedinStepCount: finalDeploy.linkedinStepCount,
        emailStatus: finalDeploy.emailStatus,
        linkedinStatus: finalDeploy.linkedinStatus,
        error: finalDeploy.error,
        channels,
      }).catch((err) => console.error("Deploy notification failed:", err));

      // Send client-facing campaign-live notification (not for "failed" — that's admin-only via notifyDeploy)
      const deployStatus = finalDeploy.status as string;
      if (deployStatus === "complete" || deployStatus === "partial_failure") {
        await notifyCampaignLive({
          workspaceSlug: campaign.workspaceSlug,
          campaignName: campaign.name,
          campaignId,
          status: deployStatus as "complete" | "partial_failure",
        }).catch((err) => console.error("Campaign-live notification failed:", err));
      }
    }
  } catch (err) {
    // Unexpected top-level failure.
    //
    // BL-075 (Phase 6.5b Bundle B): atomic Campaign.status rollback on terminal
    // deploy failure. Before this fix, `initiateCampaignDeploy` optimistically
    // flipped Campaign.status approved→deployed (and set deployedAt +
    // emailBisonCampaignId via the adapter's persist step). If the deploy then
    // blew up, only CampaignDeploy.status was flipped to 'failed' — leaving
    // Campaign in a zombie state that looked successful. Commit 184db22c was a
    // one-shot SQL cleanup for that exact drift; this catch is the systemic
    // fix.
    //
    // Design:
    //   1. All writes happen inside a single $transaction (callback form),
    //      matching the style used by saveCampaignSequences in operations.ts.
    //   2. The inflight-sibling check happens INSIDE the tx (serializable with
    //      the write) so a retry enqueuing between the findFirst and the
    //      update can't cause a rollback while the retry is in flight.
    //   3. The Campaign rollback uses updateMany({status:'deployed'}) as the
    //      where-guard — same race-safe optimistic pattern as
    //      deploy-campaign.ts:130-133's forward transition. If Campaign has
    //      already been moved (paused / archived / active by something else),
    //      we silently skip the rollback (count=0) and the audit write.
    //   4. The existing {current.status === 'running'} guard on the
    //      CampaignDeploy write is preserved — a channel-level handler
    //      (email-adapter.ts, linkedin-adapter.ts) may have already written
    //      the terminal state; we MUST NOT clobber that.
    const message = err instanceof Error ? err.message : String(err);

    // Extract [step:N] tag if the failing adapter encoded one (email-adapter
    // convention, see email-adapter.ts:620). Best-effort; null if absent.
    const stepMatch = message.match(/\[step:(\d+)\]/);
    const erroredStep: string | null = stepMatch ? stepMatch[0] : null;

    // Clip the error message for the audit metadata to keep the JSONB small.
    const reason = message.length > 500 ? message.slice(0, 500) : message;

    await prisma.$transaction(async (tx) => {
      const currentDeploy = await tx.campaignDeploy.findUnique({
        where: { id: deployId },
        select: { status: true },
      });

      // 1. CampaignDeploy terminal write — preserve existing guard.
      if (currentDeploy && currentDeploy.status === "running") {
        await tx.campaignDeploy.update({
          where: { id: deployId },
          data: {
            status: "failed",
            error: message,
            completedAt: new Date(),
          },
        });
      }

      // 2. Retry-awareness gate — if another deploy for this campaign is still
      //    in flight (pending|running) it will own the final state. Skip the
      //    Campaign rollback; the eventual retry's own terminal outcome will
      //    be audited by its own catch.
      //
      //    This findFirst runs INSIDE the tx so a sibling enqueuing between
      //    the read and the write can't create a race hole where we roll back
      //    while a retry is actually mid-flight.
      const inflightSibling = await tx.campaignDeploy.findFirst({
        where: {
          campaignId,
          status: { in: ["pending", "running"] },
          id: { not: deployId },
        },
        select: { id: true },
      });

      if (inflightSibling) {
        return;
      }

      // 3. Read Campaign.emailBisonCampaignId BEFORE the rollback so the
      //    audit metadata captures what was cleared.
      const campaignSnapshot = await tx.campaign.findUnique({
        where: { id: campaignId },
        select: { emailBisonCampaignId: true, status: true },
      });
      const clearedEmailBisonCampaignId =
        campaignSnapshot?.emailBisonCampaignId ?? null;

      // 4. Atomic Campaign rollback, guarded by status='deployed'. If
      //    something else has already moved the row (manual pause, etc.),
      //    updateMany returns count=0 and we skip the audit write.
      const rollback = await tx.campaign.updateMany({
        where: { id: campaignId, status: "deployed" },
        data: {
          status: "approved",
          emailBisonCampaignId: null,
          deployedAt: null,
        },
      });

      if (rollback.count === 0) {
        return;
      }

      // 5. Audit the rollback — only on the path where we actually flipped
      //    Campaign state. Retry-sibling case (returned above) is
      //    audit-silent by design.
      await tx.auditLog.create({
        data: {
          action: "campaign.status.auto_rollback_on_deploy_failure",
          entityType: "Campaign",
          entityId: campaignId,
          adminEmail: SYSTEM_ADMIN_EMAIL,
          metadata: {
            fromCampaignStatus: "deployed",
            toCampaignStatus: "approved",
            erroredStep,
            campaignDeployId: deployId,
            clearedEmailBisonCampaignId,
            reason,
          },
        },
      });
    });

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
  initAdapters();

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

  const campaign = await getCampaign(deploy.campaignId);
  if (!campaign) {
    throw new Error(`Campaign not found: ${deploy.campaignId}`);
  }

  const adapter = getAdapter(channel as ChannelType);
  await adapter.deploy({
    deployId,
    campaignId: deploy.campaignId,
    campaignName: deploy.campaignName,
    workspaceSlug: deploy.workspaceSlug,
    channels,
  });

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
