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
import { EmailBisonClient } from "@/lib/emailbison/client";

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
 * Options for executeDeploy.
 *
 * skipResume — stage the EB campaign through Step 8 but do NOT run Step 9
 *   (resumeCampaign / launch) or Step 10 (verify status). The EB campaign
 *   is left in DRAFT for manual PM review in the EmailBison UI. On
 *   successful stage-deploy, Campaign.status STAYS at 'deployed' (no auto
 *   transition to 'active'). Used for canary stage-then-launch flows where
 *   the PM wants to inspect the EB state before launch.
 */
export interface ExecuteDeployOptions {
  skipResume?: boolean;
}

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
  opts?: ExecuteDeployOptions,
): Promise<void> {
  initAdapters();

  // 1. Mark deploy as running — state-machine-guarded to support Trigger.dev
  // retries.
  //
  // BL-076 (Phase 6.5b Bundle C): this task is configured with
  // retry.maxAttempts=2 (see trigger/campaign-deploy.ts). On a terminal
  // failure the outer catch runs Bundle B's atomic rollback — which flips
  // CampaignDeploy.status 'running'→'failed' AND clears Campaign.status /
  // Campaign.emailBisonCampaignId / Campaign.deployedAt. Trigger.dev then
  // re-invokes executeDeploy with the same (campaignId, deployId) payload
  // for the retry attempt.
  //
  // The retry path needs to (a) transition CampaignDeploy 'failed'→'running'
  // cleanly (terminal→non-terminal is only legal for this exact Trigger.dev
  // retry case, and we must clear error/completedAt so the row doesn't show
  // stale state), and (b) restore Campaign.emailBisonCampaignId +
  // Campaign.status before the status guard below fires. The anchor we use
  // is CampaignDeploy.emailBisonCampaignId — EmailAdapter Step 2 writes it
  // immediately after createCampaign returns, BEFORE any step that can fail
  // non-idempotently. So if the prior attempt got past Step 1, that column
  // holds the EB ID we want the retry to reuse.
  //
  // First attempt (happy path): current status='pending', no restore needed,
  // flip to 'running' via updateMany guarded on status='pending'.
  //
  // Retry attempt: current status='failed', CampaignDeploy.emailBisonCampaignId
  // set, Campaign state possibly rolled back by Bundle B. Restore Campaign
  // state from CampaignDeploy then flip CampaignDeploy 'failed'→'running'
  // with error/completedAt cleared.
  const currentDeploy = await prisma.campaignDeploy.findUniqueOrThrow({
    where: { id: deployId },
    select: {
      status: true,
      emailBisonCampaignId: true,
    },
  });

  if (currentDeploy.status === "pending") {
    // Normal first attempt — standard transition.
    await prisma.campaignDeploy.updateMany({
      where: { id: deployId, status: "pending" },
      data: { status: "running" },
    });
  } else if (
    currentDeploy.status === "failed" &&
    currentDeploy.emailBisonCampaignId != null
  ) {
    // Trigger.dev retry re-entry. Step 1 of the prior attempt persisted
    // emailBisonCampaignId; restore Campaign state that Bundle B's rollback
    // may have cleared, then transition the row back to 'running'.
    //
    // Wrap the two writes in a $transaction so a concurrent observer never
    // sees Campaign restored while CampaignDeploy still shows 'failed', or
    // vice versa.
    const restoredEbId = currentDeploy.emailBisonCampaignId;
    await prisma.$transaction(async (tx) => {
      // Restore Campaign — only if it is CURRENTLY rolled-back (status=
      // 'approved' with null emailBisonCampaignId). This idempotent guard
      // means a retry whose prior attempt's Bundle B rollback DIDN'T fire
      // (e.g. the rollback tx itself failed) still works without double-
      // restoring.
      await tx.campaign.updateMany({
        where: {
          id: campaignId,
          status: "approved",
          emailBisonCampaignId: null,
        },
        data: {
          status: "deployed",
          emailBisonCampaignId: restoredEbId,
          deployedAt: new Date(),
        },
      });

      // Flip CampaignDeploy 'failed'→'running' with stale fields cleared.
      // Guarded on status='failed' so a concurrent finalize can't clobber.
      await tx.campaignDeploy.updateMany({
        where: { id: deployId, status: "failed" },
        data: {
          status: "running",
          error: null,
          completedAt: null,
        },
      });
    });

    console.log(
      `[deploy] BL-076 retry re-entry: restored Campaign ${campaignId} (emailBisonCampaignId=${restoredEbId}, status=deployed) + flipped CampaignDeploy ${deployId} 'failed'→'running' for Trigger.dev retry.`,
    );
  } else {
    // Defensive guard — refuse to re-run on any other status. Legitimate
    // states at entry are exactly 'pending' (fresh) or 'failed' (retry).
    // 'running' implies concurrent task invocation; 'complete' / terminal
    // implies a successful run we shouldn't re-run.
    throw new Error(
      `CampaignDeploy ${deployId} is in an unexpected status for executeDeploy entry: '${currentDeploy.status}' (emailBisonCampaignId=${currentDeploy.emailBisonCampaignId}). Refusing to proceed.`,
    );
  }

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
          skipResume: opts?.skipResume === true,
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

    // 5b. Auto-transition campaign from "deployed" to "active" on successful deploy.
    //
    // skipResume stage-deploy path: Step 9 (resumeCampaign) and Step 10
    // (verifyStatus) were intentionally skipped by the adapter, so the EB
    // campaign is still in DRAFT. Flipping Campaign.status to 'active' here
    // would lie about the state — leave it at 'deployed' until the PM
    // launches manually (either via EB UI + a follow-up executeDeploy
    // without skipResume, or via a direct resumeCampaign call).
    const finalizedDeploy = await prisma.campaignDeploy.findUniqueOrThrow({
      where: { id: deployId },
      select: { status: true },
    });
    if (finalizedDeploy.status === "complete" && opts?.skipResume !== true) {
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
    } else if (finalizedDeploy.status === "complete" && opts?.skipResume === true) {
      console.log(
        `[deploy] skipResume=true — Campaign ${campaignId} staying at 'deployed' (EB campaign left in DRAFT for manual PM review).`,
      );
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
      // Gated behind skipResume: staged deploys leave the EB campaign in DRAFT, so
      // firing the "campaign is live" notification would be a lie. Symmetric to the
      // deployed→active auto-transition gate above.
      const deployStatus = finalDeploy.status as string;
      if (
        (deployStatus === "complete" || deployStatus === "partial_failure") &&
        opts?.skipResume !== true
      ) {
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
    //
    // BL-107 (2026-04-17): orphan EB draft cleanup. When terminal failure
    // occurs AFTER Step 1 createCampaign but BEFORE the campaign is resumed
    // (e.g. Step 4 lead upload 422'd on Green List Priority on 2026-04-17
    // pre-BL-108), the EB draft would linger indefinitely — DB rollback
    // cleared Campaign.emailBisonCampaignId but EB itself held the orphan
    // until manually deleted (see decisions log 2026-04-17T02:30:00Z, where
    // EB 93 was cleaned up via an ad-hoc ebClient.deleteCampaign call
    // after the Green List failure). The rollback now deletes the EB
    // campaign itself.
    //
    // Key design points:
    //   - EB delete runs BEFORE the $transaction. Prisma $transaction has a
    //     wall-clock timeout (default 5s) — an EB request timeout or slow
    //     response would abort the whole tx, losing the DB rollback. EB
    //     calls belong outside.
    //   - The EB delete is wrapped in its own try/catch. DB consistency is
    //     the priority — if EB delete fails (network blip, 500, whatever),
    //     the DB rollback MUST still run. A lingering EB draft is a lesser
    //     evil than a DB row stuck in `deployed` with a dangling EB ID.
    //   - Only fires on the path where we actually need to roll back: post
    //     inflight-sibling check. We match the tx's retry-awareness gate by
    //     doing the sibling check OUTSIDE the tx first (best-effort — the
    //     in-tx gate still runs as the final authoritative check before
    //     the DB rollback commits).
    //   - Accepts EB's async delete semantic per BL-078/BL-100: the API
    //     returns 200 with status='pending deletion', which the client's
    //     deleteCampaign method treats as success. Only hard 4xx/5xx
    //     errors from the DELETE hit our catch.
    const message = err instanceof Error ? err.message : String(err);

    // Extract [step:N] tag if the failing adapter encoded one (email-adapter
    // convention, see email-adapter.ts:620). Best-effort; null if absent.
    const stepMatch = message.match(/\[step:(\d+)\]/);
    const erroredStep: string | null = stepMatch ? stepMatch[0] : null;

    // Clip the error message for the audit metadata to keep the JSONB small.
    const reason = message.length > 500 ? message.slice(0, 500) : message;

    // --------------------------------------------------------------------
    // BL-107 pre-tx EB orphan delete
    //
    // Read Campaign snapshot + workspace API token OUTSIDE the tx. We need
    // both to construct an EmailBisonClient and issue the DELETE. Best-
    // effort check for an inflight sibling so we skip the EB delete when a
    // retry is clearly in flight (the retry will own the EB campaign).
    // --------------------------------------------------------------------
    let ebOrphanDeleted = false;
    let ebOrphanDeleteError: string | null = null;
    let preTxEbCampaignId: number | null = null;

    try {
      const preTxSnapshot = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: {
          emailBisonCampaignId: true,
          workspace: { select: { apiToken: true } },
        },
      });

      const siblingExists = await prisma.campaignDeploy.findFirst({
        where: {
          campaignId,
          status: { in: ["pending", "running"] },
          id: { not: deployId },
        },
        select: { id: true },
      });

      preTxEbCampaignId = preTxSnapshot?.emailBisonCampaignId ?? null;
      const apiToken = preTxSnapshot?.workspace?.apiToken ?? null;

      if (!siblingExists && preTxEbCampaignId != null && apiToken) {
        try {
          const ebClient = new EmailBisonClient(apiToken);
          await ebClient.deleteCampaign(preTxEbCampaignId);
          ebOrphanDeleted = true;
          console.log(
            `[deploy] BL-107: deleted orphan EB campaign ${preTxEbCampaignId} for Campaign ${campaignId} (deployId=${deployId}) post terminal failure`,
          );
        } catch (ebErr) {
          const ebMsg = ebErr instanceof Error ? ebErr.message : String(ebErr);
          ebOrphanDeleteError =
            ebMsg.length > 500 ? ebMsg.slice(0, 500) : ebMsg;
          console.warn(
            `[deploy] BL-107: failed to delete orphan EB campaign ${preTxEbCampaignId} for Campaign ${campaignId}: ${ebMsg}. DB rollback will still proceed.`,
          );
        }
      }
    } catch (snapshotErr) {
      // If the snapshot read itself fails, log and proceed with the DB
      // rollback anyway. The in-tx read will still get the authoritative
      // clearedEmailBisonCampaignId value for the audit metadata.
      console.warn(
        `[deploy] BL-107: pre-tx snapshot read failed, skipping EB orphan delete: ${
          snapshotErr instanceof Error ? snapshotErr.message : String(snapshotErr)
        }`,
      );
    }

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
            // BL-107: record whether the EB draft was successfully cleaned
            // up as part of this rollback. `ebOrphanDeleted=false` with a
            // non-null error means manual intervention may be needed to
            // clear the lingering draft from EB.
            ebOrphanDeleted,
            ebOrphanDeleteError,
            ebOrphanCampaignId: preTxEbCampaignId,
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
