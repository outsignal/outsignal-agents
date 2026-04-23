/**
 * deploy-campaign.ts
 *
 * Shared helper that initiates a campaign deploy. Extracted from the non-retry
 * branch of `src/app/api/campaigns/[id]/deploy/route.ts` (BL-061) so both the
 * HTTP route and the `scripts/cli/campaign-deploy.ts` CLI drive the same code
 * path.
 *
 * Responsibilities:
 *   1. Load the campaign via `getCampaign`
 *   2. Validate `leadsApproved && contentApproved`
 *   3. Atomic status transition `approved -> deployed` (prevents double-deploy)
 *   4. Create a CampaignDeploy row with per-channel pending/skipped statuses
 *   5. Fire `tasks.trigger('campaign-deploy', { campaignId, deployId })`
 *   6. Write an AuditLog row for the admin who initiated the deploy
 *
 * Dry-run mode short-circuits after step 2: validation only, no mutations and
 * no trigger fire. Callers get back what WOULD happen (beforeStatus/channels).
 *
 * The retry branch from the route is intentionally NOT extracted — it is
 * route-specific (reads `?retry=` query param) and has no CLI analogue.
 */

import { tasks } from "@trigger.dev/sdk/v3";
import { prisma } from "@/lib/db";
import { getCampaign } from "@/lib/campaigns/operations";
import { auditLog } from "@/lib/audit";

export type DeployFailureCode =
  | "not_found"
  | "missing_approvals"
  | "already_deployed"
  | "not_approved";

export interface InitiateDeployArgs {
  campaignId: string;
  adminEmail: string;
  /** If true, validate only — do not mutate state, do not fire the task. */
  dryRun?: boolean;
  /** If true, allow partial EmailBison uploads instead of failing closed. */
  allowPartial?: boolean;
}

export type InitiateDeployResult =
  | {
      ok: true;
      dryRun: boolean;
      /** Null when dryRun=true (no row created). */
      deployId: string | null;
      beforeStatus: string;
      /** In dry-run this is what the status WOULD become ('deployed'). */
      afterStatus: string;
      channels: string[];
      campaignName: string;
      workspaceSlug: string;
    }
  | {
      ok: false;
      code: DeployFailureCode;
      reason: string;
      /** Present when we managed to load the campaign before failing. */
      campaignName?: string;
      workspaceSlug?: string;
      beforeStatus?: string;
    };

/**
 * Initiate a campaign deploy. Mirrors the non-retry branch of
 * `POST /api/campaigns/[id]/deploy` exactly so callers (the route + the CLI)
 * stay in lock-step.
 */
export async function initiateCampaignDeploy(
  args: InitiateDeployArgs,
): Promise<InitiateDeployResult> {
  const { campaignId, adminEmail } = args;
  const dryRun = args.dryRun === true;
  const allowPartial = args.allowPartial === true;

  const campaign = await getCampaign(campaignId);
  if (!campaign) {
    return {
      ok: false,
      code: "not_found",
      reason: `Campaign ${campaignId} not found`,
    };
  }

  if (!campaign.leadsApproved || !campaign.contentApproved) {
    return {
      ok: false,
      code: "missing_approvals",
      reason:
        "Both leads and content must be approved before deploying " +
        `(leadsApproved=${campaign.leadsApproved}, contentApproved=${campaign.contentApproved})`,
      campaignName: campaign.name,
      workspaceSlug: campaign.workspaceSlug,
      beforeStatus: campaign.status,
    };
  }

  // `channels` is always a string[] after formatCampaignDetail (defaults to ["email"]).
  const channels: string[] = campaign.channels;

  if (dryRun) {
    // Validation-only path: do not mutate, do not fire the task. Report the
    // transition that WOULD occur.
    if (campaign.status !== "approved") {
      return {
        ok: false,
        code:
          campaign.status === "deployed" || campaign.status === "active"
            ? "already_deployed"
            : "not_approved",
        reason: `Campaign is not in 'approved' status (current: '${campaign.status}')`,
        campaignName: campaign.name,
        workspaceSlug: campaign.workspaceSlug,
        beforeStatus: campaign.status,
      };
    }
    return {
      ok: true,
      dryRun: true,
      deployId: null,
      beforeStatus: "approved",
      afterStatus: "deployed",
      channels,
      campaignName: campaign.name,
      workspaceSlug: campaign.workspaceSlug,
    };
  }

  // Atomic transition approved -> deployed. Blocks double-deploys.
  const transitionResult = await prisma.campaign.updateMany({
    where: { id: campaignId, status: "approved" },
    data: { status: "deployed", deployedAt: new Date() },
  });
  if (transitionResult.count === 0) {
    return {
      ok: false,
      code:
        campaign.status === "deployed" || campaign.status === "active"
          ? "already_deployed"
          : "not_approved",
      reason: `Campaign is not in 'approved' status (current: '${campaign.status}')`,
      campaignName: campaign.name,
      workspaceSlug: campaign.workspaceSlug,
      beforeStatus: campaign.status,
    };
  }

  const deploy = await prisma.campaignDeploy.create({
    data: {
      campaignId,
      campaignName: campaign.name,
      workspaceSlug: campaign.workspaceSlug,
      status: "pending",
      channels: JSON.stringify(channels),
      emailStatus: channels.includes("email") ? "pending" : "skipped",
      linkedinStatus: channels.includes("linkedin") ? "pending" : "skipped",
    },
  });

  await tasks.trigger("campaign-deploy", {
    campaignId,
    deployId: deploy.id,
    allowPartial,
  });

  auditLog({
    action: "campaign.deploy",
    entityType: "Campaign",
    entityId: campaignId,
    adminEmail,
    metadata: {
      campaignName: campaign.name,
      workspaceSlug: campaign.workspaceSlug,
      channels,
      deployId: deploy.id,
      allowPartial,
    },
  });

  return {
    ok: true,
    dryRun: false,
    deployId: deploy.id,
    beforeStatus: "approved",
    afterStatus: "deployed",
    channels,
    campaignName: campaign.name,
    workspaceSlug: campaign.workspaceSlug,
  };
}

/**
 * Map a helper failure code to the HTTP status code that the API route
 * returned before the refactor. Keeps route responses byte-identical.
 */
export function deployFailureHttpStatus(code: DeployFailureCode): number {
  switch (code) {
    case "not_found":
      return 404;
    case "missing_approvals":
      return 400;
    case "already_deployed":
    case "not_approved":
      return 409;
  }
}
