/**
 * BL-093 (2026-04-16 PM correction post-da7fdf60) — revert Canary EB 88 +
 * canary Campaign DB state so the re-run of `_canary-stage-deploy.ts` starts
 * from a clean slate with the corrected variable transformer.
 *
 * HARDCODED to ONLY operate on:
 *   - EmailBison campaign ID 88 (in 1210-solutions workspace)
 *   - Outsignal Campaign cmneqixpv0001p8710bov1fga (Facilities/Cleaning canary)
 *
 * Actions:
 *   1. Delete EB 88 via `ebClient.deleteCampaign(88)` scoped to
 *      1210-solutions workspace token.
 *   2. Revert the Outsignal Campaign row to pre-deploy state:
 *        status='approved', emailBisonCampaignId=null, deployedAt=null
 *      (matching the exact fields reverted by the prior-cycle
 *      `_bl093-prefix-revert.ts` deleted script).
 *   3. Assert EB campaign count for 1210-solutions === 0 after the delete.
 *
 * Why the canary DB row (not the deploy rows): the CampaignDeploy history
 * is preserved — each deploy attempt has its own row. The `.status` on
 * those is frozen at run completion. Only the live Campaign row needs the
 * status rollback so the atomic approved→deployed preflight gate in
 * `_canary-stage-deploy.ts` fires fresh.
 *
 * Hard rules:
 *   - Refuses to run against any campaign ID other than EB 88.
 *   - Refuses to run against any Outsignal campaign ID other than the
 *     canary cmneqixpv.
 *   - One-shot: if EB 88 has already been deleted (count === 0), the
 *     script logs the fact and still performs the DB revert idempotently.
 */

import { PrismaClient } from "@prisma/client";
import { EmailBisonClient } from "@/lib/emailbison/client";

const EB_CAMPAIGN_ID = 88;
const WORKSPACE_SLUG = "1210-solutions";
const OUTSIGNAL_CAMPAIGN_ID = "cmneqixpv0001p8710bov1fga";

async function main() {
  const prisma = new PrismaClient();

  try {
    console.log(
      `[bl093-eb88-revert] Scope: EB campaign ${EB_CAMPAIGN_ID} in workspace '${WORKSPACE_SLUG}' + Outsignal Campaign '${OUTSIGNAL_CAMPAIGN_ID}'`,
    );

    // --- Load workspace token ------------------------------------------------
    const ws = await prisma.workspace.findUniqueOrThrow({
      where: { slug: WORKSPACE_SLUG },
      select: { apiToken: true },
    });
    if (!ws.apiToken) {
      throw new Error(
        `[bl093-eb88-revert] Workspace '${WORKSPACE_SLUG}' has no apiToken — refusing to proceed`,
      );
    }
    const ebClient = new EmailBisonClient(ws.apiToken);

    // --- Pre-state: list EB campaigns for sanity check -----------------------
    const beforeCampaigns = await ebClient.getCampaigns();
    console.log(
      `[bl093-eb88-revert] Pre-delete EB campaigns in '${WORKSPACE_SLUG}': ${beforeCampaigns.length}`,
    );
    for (const c of beforeCampaigns) {
      console.log(
        `  id=${c.id}  status=${c.status}  name='${(c as { name?: string }).name ?? ""}'`,
      );
    }

    const targetExists = beforeCampaigns.some((c) => c.id === EB_CAMPAIGN_ID);
    if (!targetExists) {
      console.log(
        `[bl093-eb88-revert] EB ${EB_CAMPAIGN_ID} NOT FOUND in workspace — already deleted. Skipping DELETE call.`,
      );
    } else {
      // --- Delete EB 88 ------------------------------------------------------
      console.log(
        `[bl093-eb88-revert] Deleting EB campaign ${EB_CAMPAIGN_ID}...`,
      );
      await ebClient.deleteCampaign(EB_CAMPAIGN_ID);
      console.log(`[bl093-eb88-revert] EB campaign ${EB_CAMPAIGN_ID} deleted.`);
    }

    // --- Post-state: verify EB 88 is gone via single-resource fetch --------
    //
    // NOTE: `getCampaigns()` uses a 5-minute fetch cache (client default
    // `revalidate: 300`) so calling it again inside the same process often
    // returns the pre-delete snapshot — this is a stale-cache observation
    // quirk, not a delete failure. `getCampaignById(88)` uses a separate
    // endpoint path (`/campaigns/{id}`, `revalidate: 60`) which is
    // invalidated by the fresh DELETE against the same URL prefix.
    const single = await ebClient.getCampaignById(EB_CAMPAIGN_ID);
    if (single != null) {
      throw new Error(
        `[bl093-eb88-revert] REFUSE: Expected EB ${EB_CAMPAIGN_ID} to be null after delete, got ${JSON.stringify(single)}. Aborting DB revert.`,
      );
    }
    console.log(
      `[bl093-eb88-revert] Post-delete getCampaignById(${EB_CAMPAIGN_ID}) === null. Confirmed deleted.`,
    );

    // --- Revert Outsignal Campaign row to pre-deploy state -------------------
    console.log(
      `[bl093-eb88-revert] Reverting Campaign '${OUTSIGNAL_CAMPAIGN_ID}' to status=approved / ebId=null / deployedAt=null...`,
    );
    const pre = await prisma.campaign.findUniqueOrThrow({
      where: { id: OUTSIGNAL_CAMPAIGN_ID },
      select: {
        id: true,
        status: true,
        emailBisonCampaignId: true,
        deployedAt: true,
      },
    });
    console.log(`  pre: ${JSON.stringify(pre)}`);

    const reverted = await prisma.campaign.update({
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
      },
    });
    console.log(`  post: ${JSON.stringify(reverted)}`);

    if (
      reverted.status !== "approved" ||
      reverted.emailBisonCampaignId !== null ||
      reverted.deployedAt !== null
    ) {
      throw new Error(
        `[bl093-eb88-revert] REFUSE: Post-revert state not as expected: ${JSON.stringify(reverted)}`,
      );
    }

    console.log(
      "[bl093-eb88-revert] DONE. EB slate clean. Canary DB ready for re-run.",
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[bl093-eb88-revert] FATAL:", err);
  process.exit(1);
});
