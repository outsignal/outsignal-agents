/**
 * BL-104 (2026-04-16) — revert Canary EB 91 + canary Campaign DB state so
 * the re-run of `_canary-stage-deploy.ts` starts from a clean slate with
 * the polished normaliser (trailing brackets + domain truncation + trim +
 * warn + ampersand) wired into the EB wire boundary.
 *
 * Mirrors the prior `_bl100-eb89-revert.ts` script's hardcoded scope, one
 * cycle up: EB 91 replaces EB 89 (and EB 90 was consumed by the BL-103
 * normaliser-base canary; EB 91 was the post-BL-103 stage that PM flagged
 * with the 5 edge cases this cycle addresses). Throwaway, intentionally
 * untracked — kept in scripts/maintenance with the `_` prefix per repo
 * convention.
 *
 * HARDCODED to ONLY operate on:
 *   - EmailBison campaign ID 91 (in 1210-solutions workspace)
 *   - Outsignal Campaign cmneqixpv0001p8710bov1fga (Facilities/Cleaning canary)
 *
 * Actions:
 *   1. Delete EB 91 via `ebClient.deleteCampaign(91)` scoped to
 *      1210-solutions workspace token.
 *   2. Verify via single-resource fetch that EB 91 is gone (EB async delete
 *      window — accept status='pending deletion' as "confirmed deleted"
 *      per BL-078 / BL-100 precedent).
 *   3. Revert Outsignal Campaign in a $transaction:
 *        status: deployed → approved,
 *        emailBisonCampaignId: 91 → null,
 *        deployedAt: Date → null.
 *      Preserves contentApproved, leadsApproved, targetListId.
 *   4. Flip the most-recent CampaignDeploy row (the one with
 *      emailBisonCampaignId=91) to status='rolled_back' with a BL-104
 *      suffix on its emailError narrative field (optional — non-blocker
 *      if no matching row found per brief).
 *   5. Create an AuditLog row `action='campaign.status.bl104_canary_revert'`
 *      in the same transaction.
 *   6. Post-tx verification:
 *        - Campaign.count where workspace=1210-solutions AND
 *          emailBisonCampaignId != null === 0
 *   7. Logs a final JSON report block.
 *
 * Hard rules (enforced by the script itself):
 *   - REFUSE to run if a non-BL-104 campaign ID is targeted (no CLI
 *     argument parsing — hardcoded constants).
 *   - If EB 91 is already deleted, the script still performs the DB
 *     revert idempotently (safe to re-run).
 *   - If Campaign.update returns count=0 (already reverted by a parallel
 *     session), log loudly and exit 1 per brief's STOP conditions.
 */

import { PrismaClient } from "@prisma/client";
import { EmailBisonClient } from "@/lib/emailbison/client";

const EB_CAMPAIGN_ID = 91;
const WORKSPACE_SLUG = "1210-solutions";
const OUTSIGNAL_CAMPAIGN_ID = "cmneqixpv0001p8710bov1fga";

async function main() {
  const prisma = new PrismaClient();

  try {
    console.log(
      `[bl104-prefix-revert] Scope: EB campaign ${EB_CAMPAIGN_ID} in workspace '${WORKSPACE_SLUG}' + Outsignal Campaign '${OUTSIGNAL_CAMPAIGN_ID}'`,
    );

    const ws = await prisma.workspace.findUniqueOrThrow({
      where: { slug: WORKSPACE_SLUG },
      select: { apiToken: true },
    });
    if (!ws.apiToken) {
      throw new Error(
        `[bl104-prefix-revert] Workspace '${WORKSPACE_SLUG}' has no apiToken — refusing to proceed`,
      );
    }
    const ebClient = new EmailBisonClient(ws.apiToken);

    // --- Pre-state: list EB campaigns for sanity check ---------------------
    const beforeCampaigns = await ebClient.getCampaigns();
    console.log(
      `[bl104-prefix-revert] Pre-delete EB campaigns in '${WORKSPACE_SLUG}': ${beforeCampaigns.length}`,
    );
    for (const c of beforeCampaigns) {
      console.log(
        `  id=${c.id}  status=${c.status}  name='${(c as { name?: string }).name ?? ""}'`,
      );
    }

    const targetExists = beforeCampaigns.some((c) => c.id === EB_CAMPAIGN_ID);
    if (!targetExists) {
      console.log(
        `[bl104-prefix-revert] EB ${EB_CAMPAIGN_ID} NOT FOUND in workspace — already deleted. Skipping DELETE call.`,
      );
    } else {
      console.log(
        `[bl104-prefix-revert] Deleting EB campaign ${EB_CAMPAIGN_ID}...`,
      );
      await ebClient.deleteCampaign(EB_CAMPAIGN_ID);
      console.log(
        `[bl104-prefix-revert] EB campaign ${EB_CAMPAIGN_ID} deleted.`,
      );
    }

    // --- Post-state: verify EB 91 is gone via single-resource fetch --------
    //
    // EB's DELETE is async: immediately after the DELETE returns 2xx, a
    // same-process GET can return the campaign with status='pending
    // deletion' for a short window before it flips to 404. Accept both
    // shapes as "confirmed deleted" (null OR status='pending deletion').
    // Any other non-null shape indicates the DELETE did not take; REFUSE.
    const single = await ebClient.getCampaignById(EB_CAMPAIGN_ID);
    if (single == null) {
      console.log(
        `[bl104-prefix-revert] Post-delete getCampaignById(${EB_CAMPAIGN_ID}) === null. Confirmed deleted.`,
      );
    } else if ((single as { status?: string }).status === "pending deletion") {
      console.log(
        `[bl104-prefix-revert] Post-delete getCampaignById(${EB_CAMPAIGN_ID}) returned status='pending deletion' (EB async delete window). Treating as deleted.`,
      );
    } else {
      throw new Error(
        `[bl104-prefix-revert] REFUSE: Expected EB ${EB_CAMPAIGN_ID} to be deleted (null or status='pending deletion'), got ${JSON.stringify(single)}. Aborting DB revert.`,
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

    // Find the CampaignDeploy row that owns EB 91 (optional — not a blocker).
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
      console.log(
        `[bl104-prefix-revert] No CampaignDeploy row with emailBisonCampaignId=${EB_CAMPAIGN_ID} — skipping deploy narrative update (non-blocker).`,
      );
    } else {
      console.log(`  pre-deploy: ${JSON.stringify(preDeploy)}`);
    }

    // Brief's STOP condition — if Campaign was already reverted by another
    // session (status=approved + ebId=null), there's nothing to do.
    if (
      preCampaign.status === "approved" &&
      preCampaign.emailBisonCampaignId === null &&
      preCampaign.deployedAt === null
    ) {
      console.log(
        `[bl104-prefix-revert] Campaign already reverted by another session. Nothing to do. Exiting 0.`,
      );
      return;
    }

    const clearedEbId = preCampaign.emailBisonCampaignId;
    const clearedDeployedAt = preCampaign.deployedAt?.toISOString() ?? null;
    const fromStatus = preCampaign.status;

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

      let updatedDeploy: {
        id: string;
        status: string;
        emailError: string | null;
        emailBisonCampaignId: number | null;
      } | null = null;
      if (preDeploy) {
        updatedDeploy = await tx.campaignDeploy.update({
          where: { id: preDeploy.id },
          data: {
            status: "rolled_back",
            emailError:
              (preDeploy.emailError ?? "") +
              "; BL-104 rollback 2026-04-16 — EB 91 deleted, DB reverted for normaliser polish re-canary",
          },
          select: {
            id: true,
            status: true,
            emailError: true,
            emailBisonCampaignId: true,
          },
        });
      }

      const audit = await tx.auditLog.create({
        data: {
          action: "campaign.status.bl104_canary_revert",
          entityType: "Campaign",
          entityId: OUTSIGNAL_CAMPAIGN_ID,
          adminEmail: "ops@outsignal.ai",
          metadata: {
            reason:
              "BL-104 pre-fix — re-stage after normaliser polish (trailing brackets + domain truncation + trim + warn + ampersand)",
            fromStatus,
            toStatus: "approved",
            clearedEmailBisonCampaignId: clearedEbId,
            clearedDeployedAt,
            campaignDeployId: preDeploy?.id ?? null,
            phase: "BL-104 pre-fix",
          },
        },
        select: { id: true, action: true, entityId: true },
      });

      return { updatedCampaign, updatedDeploy, audit };
    });

    console.log(`  post-campaign: ${JSON.stringify(result.updatedCampaign)}`);
    if (result.updatedDeploy) {
      console.log(`  post-deploy:   ${JSON.stringify(result.updatedDeploy)}`);
    }
    console.log(`  audit:         ${JSON.stringify(result.audit)}`);

    if (
      result.updatedCampaign.status !== "approved" ||
      result.updatedCampaign.emailBisonCampaignId !== null ||
      result.updatedCampaign.deployedAt !== null
    ) {
      throw new Error(
        `[bl104-prefix-revert] REFUSE: Post-revert Campaign state not as expected: ${JSON.stringify(result.updatedCampaign)}`,
      );
    }
    if (result.updatedDeploy && result.updatedDeploy.status !== "rolled_back") {
      throw new Error(
        `[bl104-prefix-revert] REFUSE: Post-revert Deploy status not 'rolled_back': ${JSON.stringify(result.updatedDeploy)}`,
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
      `[bl104-prefix-revert] Residual Campaigns in '${WORKSPACE_SLUG}' with non-null emailBisonCampaignId: ${residualCount}`,
    );
    if (residualCount !== 0) {
      throw new Error(
        `[bl104-prefix-revert] REFUSE: expected residualCount=0, got ${residualCount}.`,
      );
    }

    // --- Post-tx: workspace-level EB campaign count ------------------------
    const afterCampaigns = await ebClient.getCampaigns();
    console.log(
      `[bl104-prefix-revert] Post-delete EB campaigns in '${WORKSPACE_SLUG}': ${afterCampaigns.length}`,
    );
    // EB async delete window — count may still include the campaign with
    // status='pending deletion'. Accept non-zero only if all remaining
    // campaigns are in that state.
    const nonPendingDelete = afterCampaigns.filter(
      (c) => (c as { status?: string }).status !== "pending deletion",
    );
    if (nonPendingDelete.length !== 0) {
      throw new Error(
        `[bl104-prefix-revert] REFUSE: Expected 0 non-pending-deletion EB campaigns, got ${nonPendingDelete.length}: ${JSON.stringify(nonPendingDelete.map((c) => c.id))}`,
      );
    }

    console.log(
      "[bl104-prefix-revert] DONE. EB slate clean. Canary DB ready for re-run.",
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[bl104-prefix-revert] FATAL:", err);
  process.exit(1);
});
