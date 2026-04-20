/**
 * BL-085 Fix C — delete orphan EB 82 in 1210-solutions, scan for other orphans.
 *
 * Plan:
 *   1. Delete EB 82 via ebClient.deleteCampaign(82).
 *   2. Verify via getCampaign(82) → expect not-found (isNotFoundError helper
 *      covers both EmailBisonApiError/HTTP-404 and EmailBisonError/200-empty).
 *   3. List all EB campaigns in 1210-solutions via GET /campaigns.
 *   4. Join against our Campaign table (emailBisonCampaignId column) to find
 *      any EB campaign that we don't have a pointer to → those are orphans.
 *   5. Report EB 82 status + orphan list. Do NOT auto-delete additional
 *      orphans unless confirmed in planning — report first.
 *
 * HARD RULES:
 *   - Only touches 1210-solutions workspace.
 *   - Only deletes EB 82 by ID, no bulk ops.
 *   - Uses the shared EmailBisonClient, not raw fetch.
 */

import { PrismaClient } from "@prisma/client";
import { EmailBisonClient } from "@/lib/emailbison/client";
import { isNotFoundError } from "@/lib/emailbison/errors";

const WORKSPACE_SLUG = "1210-solutions";
const ORPHAN_EB_ID = 82;

async function main() {
  const prisma = new PrismaClient();

  try {
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { slug: WORKSPACE_SLUG },
      select: { apiToken: true },
    });
    if (!workspace.apiToken) {
      throw new Error(`Workspace '${WORKSPACE_SLUG}' has no apiToken`);
    }
    const ebClient = new EmailBisonClient(workspace.apiToken);

    // ---- Step 1: delete EB 82 -----------------------------------------
    console.log(`[bl085-cleanup] Deleting orphan EB campaign ${ORPHAN_EB_ID}...`);
    let deleteOk = false;
    let deleteErrorMsg: string | null = null;
    try {
      await ebClient.deleteCampaign(ORPHAN_EB_ID);
      deleteOk = true;
      console.log(`[bl085-cleanup] Delete call succeeded.`);
    } catch (err) {
      deleteErrorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[bl085-cleanup] Delete failed: ${deleteErrorMsg}`);
    }

    // ---- Step 2: verify EB 82 is gone ---------------------------------
    console.log(`[bl085-cleanup] Verifying EB ${ORPHAN_EB_ID} is gone...`);
    let verifyResult: "not_found_confirmed" | "still_exists" | "verify_error" =
      "verify_error";
    let verifyErrorMsg: string | null = null;
    try {
      await ebClient.getCampaign(ORPHAN_EB_ID);
      verifyResult = "still_exists";
      console.warn(
        `[bl085-cleanup] EB ${ORPHAN_EB_ID} STILL EXISTS after delete call.`,
      );
    } catch (err) {
      if (isNotFoundError(err)) {
        verifyResult = "not_found_confirmed";
        console.log(`[bl085-cleanup] EB ${ORPHAN_EB_ID} confirmed deleted (not-found).`);
      } else {
        verifyErrorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[bl085-cleanup] Verify GET errored: ${verifyErrorMsg}`);
      }
    }

    // ---- Step 3: scan for other orphans --------------------------------
    console.log(`[bl085-cleanup] Scanning all EB campaigns in ${WORKSPACE_SLUG}...`);
    const allEbCampaigns = await ebClient.getCampaigns();
    console.log(`[bl085-cleanup] Got ${allEbCampaigns.length} EB campaigns total.`);

    // Fetch every Outsignal Campaign row with a non-null EB ID (across all
    // workspaces — a Campaign could theoretically reference an EB ID from
    // another workspace. In practice the apiToken is per-workspace and so
    // is the EB resource, but scope defensively).
    const ourCampaigns = await prisma.campaign.findMany({
      where: {
        workspaceSlug: WORKSPACE_SLUG,
        emailBisonCampaignId: { not: null },
      },
      select: { id: true, emailBisonCampaignId: true, name: true, status: true },
    });
    const ourEbIds = new Set(
      ourCampaigns.map((c) => c.emailBisonCampaignId).filter((v): v is number => v != null),
    );
    console.log(
      `[bl085-cleanup] Our Campaign table has ${ourEbIds.size} EB-pointer rows for ${WORKSPACE_SLUG}.`,
    );

    // Also check CampaignDeploy — a failed/incomplete deploy could have
    // written the EB ID there before rollback cleared it from Campaign.
    const ourDeploys = await prisma.campaignDeploy.findMany({
      where: {
        workspaceSlug: WORKSPACE_SLUG,
        emailBisonCampaignId: { not: null },
      },
      select: {
        id: true,
        campaignId: true,
        emailBisonCampaignId: true,
        status: true,
      },
    });
    const deployEbIds = new Set(
      ourDeploys.map((d) => d.emailBisonCampaignId).filter((v): v is number => v != null),
    );
    console.log(
      `[bl085-cleanup] Our CampaignDeploy table has ${deployEbIds.size} EB-pointer rows for ${WORKSPACE_SLUG}.`,
    );

    const knownEbIds = new Set<number>([...ourEbIds, ...deployEbIds]);

    type Orphan = {
      ebId: number;
      name?: string | null;
      status?: string | null;
      leadsCount?: number | null;
    };
    const orphans: Orphan[] = [];
    for (const ebCampaign of allEbCampaigns) {
      if (!knownEbIds.has(ebCampaign.id)) {
        orphans.push({
          ebId: ebCampaign.id,
          name: ebCampaign.name ?? null,
          status: ebCampaign.status ?? null,
          leadsCount: null,
        });
      }
    }

    console.log(
      `[bl085-cleanup] Orphan scan complete. Found ${orphans.length} orphan(s) (EB campaigns not referenced by our Campaign or CampaignDeploy tables).`,
    );

    // ---- Report -------------------------------------------------------
    const report = {
      workspace: WORKSPACE_SLUG,
      orphanEbId: ORPHAN_EB_ID,
      deleteOk,
      deleteErrorMsg,
      verifyResult,
      verifyErrorMsg,
      totalEbCampaigns: allEbCampaigns.length,
      knownEbIds: [...knownEbIds].sort((a, b) => a - b),
      orphans,
    };

    console.log("\n===== BL-085 ORPHAN CLEANUP REPORT =====");
    console.log(JSON.stringify(report, null, 2));
    console.log("===== END REPORT =====\n");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[bl085-cleanup] FATAL:", err);
  process.exit(1);
});
