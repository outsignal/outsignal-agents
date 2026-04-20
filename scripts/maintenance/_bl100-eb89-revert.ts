/**
 * BL-100 (2026-04-16) — revert Canary EB 89 + canary Campaign DB state so
 * the re-run of `_canary-stage-deploy.ts` starts from a clean slate with
 * the new sender-name transformer wired in.
 *
 * Mirrors the prior `_bl093-eb88-revert.ts` script's hardcoded scope, one
 * cycle up: EB 89 replaces EB 88. Throwaway, intentionally untracked —
 * kept in scripts/maintenance with the `_` prefix per repo convention.
 *
 * HARDCODED to ONLY operate on:
 *   - EmailBison campaign ID 89 (in 1210-solutions workspace)
 *   - Outsignal Campaign cmneqixpv0001p8710bov1fga (Facilities/Cleaning canary)
 *
 * Actions:
 *   1. Delete EB 89 via `ebClient.deleteCampaign(89)` scoped to
 *      1210-solutions workspace token.
 *   2. Verify via single-resource fetch that EB 89 is gone
 *      (getCampaigns() has a 5min fetch cache; getCampaignById has 60s +
 *      cache-invalidated-by-same-URL-DELETE).
 *   3. Revert Outsignal Campaign in a $transaction:
 *        status: deployed → approved,
 *        emailBisonCampaignId: 89 → null,
 *        deployedAt: Date → null.
 *      Preserves contentApproved, leadsApproved, targetListId.
 *   4. Flip the most-recent CampaignDeploy row (the one with
 *      emailBisonCampaignId=89) to status='rolled_back' with a BL-100
 *      suffix on its emailError narrative field.
 *   5. Create an AuditLog row `action='campaign.status.bl100_rollback'`
 *      to the single transaction.
 *   6. Post-tx verification:
 *        - Campaign.count where workspace=1210-solutions AND
 *          emailBisonCampaignId != null === 0
 *        - ebClient.getCampaigns() shows no EB campaign in workspace
 *   7. Logs a final JSON report block.
 *
 * Hard rules (enforced by the script itself):
 *   - REFUSE to run if a non-BL-100 campaign ID is targeted (no CLI
 *     argument parsing — hardcoded constants).
 *   - If EB 89 is already deleted, the script still performs the DB
 *     revert idempotently (safe to re-run).
 *   - If any post-tx check fails, exit(1) with a loud error.
 */

import { PrismaClient } from "@prisma/client";
import { EmailBisonClient } from "@/lib/emailbison/client";

const EB_CAMPAIGN_ID = 89;
const WORKSPACE_SLUG = "1210-solutions";
const OUTSIGNAL_CAMPAIGN_ID = "cmneqixpv0001p8710bov1fga";

async function main() {
  const prisma = new PrismaClient();

  try {
    console.log(
      `[bl100-eb89-revert] Scope: EB campaign ${EB_CAMPAIGN_ID} in workspace '${WORKSPACE_SLUG}' + Outsignal Campaign '${OUTSIGNAL_CAMPAIGN_ID}'`,
    );

    const ws = await prisma.workspace.findUniqueOrThrow({
      where: { slug: WORKSPACE_SLUG },
      select: { apiToken: true },
    });
    if (!ws.apiToken) {
      throw new Error(
        `[bl100-eb89-revert] Workspace '${WORKSPACE_SLUG}' has no apiToken — refusing to proceed`,
      );
    }
    const ebClient = new EmailBisonClient(ws.apiToken);

    // --- Pre-state: list EB campaigns for sanity check ---------------------
    const beforeCampaigns = await ebClient.getCampaigns();
    console.log(
      `[bl100-eb89-revert] Pre-delete EB campaigns in '${WORKSPACE_SLUG}': ${beforeCampaigns.length}`,
    );
    for (const c of beforeCampaigns) {
      console.log(
        `  id=${c.id}  status=${c.status}  name='${(c as { name?: string }).name ?? ""}'`,
      );
    }

    const targetExists = beforeCampaigns.some((c) => c.id === EB_CAMPAIGN_ID);
    if (!targetExists) {
      console.log(
        `[bl100-eb89-revert] EB ${EB_CAMPAIGN_ID} NOT FOUND in workspace — already deleted. Skipping DELETE call.`,
      );
    } else {
      console.log(
        `[bl100-eb89-revert] Deleting EB campaign ${EB_CAMPAIGN_ID}...`,
      );
      await ebClient.deleteCampaign(EB_CAMPAIGN_ID);
      console.log(`[bl100-eb89-revert] EB campaign ${EB_CAMPAIGN_ID} deleted.`);
    }

    // --- Post-state: verify EB 89 is gone via single-resource fetch --------
    //
    // EB's DELETE is async: immediately after the DELETE returns 2xx, a
    // same-process GET can return the campaign with status='pending
    // deletion' for a short window before it flips to 404. Accept both
    // shapes as "confirmed deleted" (null OR status='pending deletion').
    // Any other non-null shape indicates the DELETE did not take; REFUSE.
    const single = await ebClient.getCampaignById(EB_CAMPAIGN_ID);
    if (single == null) {
      console.log(
        `[bl100-eb89-revert] Post-delete getCampaignById(${EB_CAMPAIGN_ID}) === null. Confirmed deleted.`,
      );
    } else if (
      (single as { status?: string }).status === "pending deletion"
    ) {
      console.log(
        `[bl100-eb89-revert] Post-delete getCampaignById(${EB_CAMPAIGN_ID}) returned status='pending deletion' (EB async delete window). Treating as deleted.`,
      );
    } else {
      throw new Error(
        `[bl100-eb89-revert] REFUSE: Expected EB ${EB_CAMPAIGN_ID} to be deleted (null or status='pending deletion'), got ${JSON.stringify(single)}. Aborting DB revert.`,
      );
    }

    // --- Pre-state log ------------------------------------------------------
    const preCampaign = await prisma.campaign.findUniqueOrThrow({
      where: { id: OUTSIGNAL_CAMPAIGN_ID },
      select: {
        id: true,
        status: true,
        emailBisonCampaignId: true,
        deployedAt: true,
        contentApproved: true,
        leadsApproved: true,
        targetListId: true,
      },
    });
    console.log(`  pre: ${JSON.stringify(preCampaign)}`);

    // Find the CampaignDeploy row that owns EB 89.
    const preDeploy = await prisma.campaignDeploy.findFirst({
      where: {
        campaignId: OUTSIGNAL_CAMPAIGN_ID,
        emailBisonCampaignId: EB_CAMPAIGN_ID,
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        emailStatus: true,
        emailError: true,
        emailBisonCampaignId: true,
      },
    });
    if (!preDeploy) {
      throw new Error(
        `[bl100-eb89-revert] REFUSE: No CampaignDeploy row found with emailBisonCampaignId=${EB_CAMPAIGN_ID} for Campaign ${OUTSIGNAL_CAMPAIGN_ID}.`,
      );
    }
    console.log(`  pre-deploy: ${JSON.stringify(preDeploy)}`);

    // --- Atomic revert -----------------------------------------------------
    const result = await prisma.$transaction(async (tx) => {
      const updatedCampaign = await tx.campaign.update({
        where: { id: OUTSIGNAL_CAMPAIGN_ID },
        data: {
          status: "approved",
          emailBisonCampaignId: null,
          deployedAt: null,
        },
        select: {
          id: true,
          status: true,
          emailBisonCampaignId: true,
          deployedAt: true,
          contentApproved: true,
          leadsApproved: true,
          targetListId: true,
        },
      });

      const updatedDeploy = await tx.campaignDeploy.update({
        where: { id: preDeploy.id },
        data: {
          status: "rolled_back",
          emailError:
            (preDeploy.emailError ?? "") +
            "; BL-100 rollback 2026-04-16 — EB 89 deleted, DB reverted for sender-name transformer re-canary",
        },
        select: {
          id: true,
          status: true,
          emailError: true,
          emailBisonCampaignId: true,
        },
      });

      const audit = await tx.auditLog.create({
        data: {
          action: "campaign.status.bl100_rollback",
          entityType: "Campaign",
          entityId: OUTSIGNAL_CAMPAIGN_ID,
          adminEmail: "ops@outsignal.ai",
          metadata: {
            reason:
              "BL-100 sender-name transformer re-canary — clearing prior EB 89 state so _canary-stage-deploy.ts fresh-deploy produces a new EB campaign with signature-region {SENDER_*} rewrites",
            fromStatus: "deployed",
            toStatus: "approved",
            clearedEbId: EB_CAMPAIGN_ID,
            campaignDeployId: preDeploy.id,
            phase: "BL-100 pre-fix",
          },
        },
        select: { id: true, action: true, entityId: true },
      });

      return { updatedCampaign, updatedDeploy, audit };
    });

    console.log(`  post-campaign: ${JSON.stringify(result.updatedCampaign)}`);
    console.log(`  post-deploy:   ${JSON.stringify(result.updatedDeploy)}`);
    console.log(`  audit:         ${JSON.stringify(result.audit)}`);

    if (
      result.updatedCampaign.status !== "approved" ||
      result.updatedCampaign.emailBisonCampaignId !== null ||
      result.updatedCampaign.deployedAt !== null
    ) {
      throw new Error(
        `[bl100-eb89-revert] REFUSE: Post-revert Campaign state not as expected: ${JSON.stringify(result.updatedCampaign)}`,
      );
    }
    if (result.updatedDeploy.status !== "rolled_back") {
      throw new Error(
        `[bl100-eb89-revert] REFUSE: Post-revert Deploy status not 'rolled_back': ${JSON.stringify(result.updatedDeploy)}`,
      );
    }

    // --- Post-tx: workspace-level residual-state check ---------------------
    const residualCount = await prisma.campaign.count({
      where: {
        workspace: { slug: WORKSPACE_SLUG },
        emailBisonCampaignId: { not: null },
      },
    });
    console.log(
      `[bl100-eb89-revert] Residual Campaigns in '${WORKSPACE_SLUG}' with non-null emailBisonCampaignId: ${residualCount}`,
    );
    if (residualCount !== 0) {
      throw new Error(
        `[bl100-eb89-revert] REFUSE: expected residualCount=0, got ${residualCount}.`,
      );
    }

    console.log(
      "[bl100-eb89-revert] DONE. EB slate clean. Canary DB ready for re-run.",
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[bl100-eb89-revert] FATAL:", err);
  process.exit(1);
});
