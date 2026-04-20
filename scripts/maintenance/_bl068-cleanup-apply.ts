/**
 * BL-068 cleanup — roll back 4 stuck 1210 LinkedIn deploys.
 *
 * Real world (per _bl068-precheck.ts, 2026-04-15T18:00):
 *   - 4 Campaigns in workspace '1210-solutions' with channels=["linkedin"],
 *     status='deployed', but CampaignDeploy.linkedinStatus='failed' with a
 *     Prisma validation error (`position: undefined` — see BL-068).
 *   - None have an emailBisonCampaignId (schema error fired BEFORE any EB call).
 *   - Each Campaign has exactly 1 CampaignDeploy row.
 *
 * Actions (per campaign, wrapped in a single transaction):
 *   1. Flip Campaign.status deployed -> approved  (guard: only if still 'deployed')
 *   2. Flip CampaignDeploy.status failed -> rolled_back, append BL-068 note
 *      (guard: only if still 'failed')
 *
 * NO EB calls — these deploys never created EB artifacts. NO deploy-code edits.
 *
 * Pattern mirrors scripts/maintenance/_bl061-cleanup-apply.ts.
 */
import { prisma } from "@/lib/db";

const DRY_RUN = process.argv.includes("--dry-run");

// Hard-coded from _bl068-precheck.ts output — fail loud if state drifts.
const ROLLBACK_PLAN: Array<{
  campaignId: string;
  campaignName: string;
  deployId: string;
}> = [
  {
    campaignId: "cmneqa5r50003p8rk322w3vc6",
    campaignName: "1210 Solutions - LinkedIn - Industrial/Warehouse - April 2026",
    deployId: "cmo00noqq001dp8j58oixz8jj",
  },
  {
    campaignId: "cmneq1z3i0001p8ef36c814py",
    campaignName: "1210 Solutions - LinkedIn - Green List Priority - April 2026",
    deployId: "cmo00nm600017p8j5snmaqr6u",
  },
  {
    campaignId: "cmneqixvz0003p871m8sw9u7o",
    campaignName: "1210 Solutions - LinkedIn - Facilities/Cleaning - April 2026",
    deployId: "cmo00nl6v0014p8j5noxagu1g",
  },
  {
    campaignId: "cmneq93i80001p8p78pcw4yg9",
    campaignName: "1210 Solutions - LinkedIn - Construction - April 2026",
    deployId: "cmo00njq90011p8j5kyha6eda",
  },
];

const ROLLBACK_ERROR =
  "LinkedIn deploy rolled back 2026-04-15 — see BL-068 (prisma.campaignSequenceRule.createMany failed with position: undefined, linkedin-adapter.ts:106 did not propagate step.position on post-connect rules). No EB artifacts existed (error fired pre-EB). Deploy pipeline being rebuilt — see .planning/project_campaign_deploy_audit.md.";

async function main() {
  console.log(`[bl-068-cleanup] DRY_RUN=${DRY_RUN}`);
  console.log(`[bl-068-cleanup] ${ROLLBACK_PLAN.length} campaigns to roll back\n`);

  const results: Array<{ campaignId: string; action: string; ok: boolean; note?: string }> = [];

  for (const row of ROLLBACK_PLAN) {
    // Fetch current state — fail loud if anything drifted
    const campaign = await prisma.campaign.findUnique({
      where: { id: row.campaignId },
      select: { status: true, name: true, workspaceSlug: true, emailBisonCampaignId: true },
    });
    if (!campaign) {
      console.error(`[FAIL] Campaign ${row.campaignId} not found`);
      results.push({ campaignId: row.campaignId, action: "campaign-missing", ok: false });
      throw new Error(`Campaign missing: ${row.campaignId}`);
    }
    if (campaign.workspaceSlug !== "1210-solutions") {
      console.error(`[FAIL] Campaign ${row.campaignId} wrong workspace: ${campaign.workspaceSlug}`);
      results.push({ campaignId: row.campaignId, action: "wrong-workspace", ok: false, note: campaign.workspaceSlug });
      throw new Error("wrong workspace — refusing to proceed");
    }
    if (campaign.status !== "deployed") {
      console.error(`[FAIL] Campaign ${row.campaignId} status=${campaign.status} (expected 'deployed')`);
      results.push({ campaignId: row.campaignId, action: "status-unexpected", ok: false, note: `status=${campaign.status}` });
      throw new Error(`Campaign status unexpected: ${campaign.status}`);
    }
    if (campaign.emailBisonCampaignId != null) {
      console.error(
        `[FAIL] Campaign ${row.campaignId} has emailBisonCampaignId=${campaign.emailBisonCampaignId} (expected null) — may have EB artifacts, refusing.`,
      );
      results.push({ campaignId: row.campaignId, action: "has-ebid", ok: false, note: `ebId=${campaign.emailBisonCampaignId}` });
      throw new Error("unexpected ebId — stop and investigate");
    }

    const deploy = await prisma.campaignDeploy.findUnique({
      where: { id: row.deployId },
      select: { status: true, linkedinStatus: true, campaignId: true },
    });
    if (!deploy) {
      console.error(`[FAIL] Deploy ${row.deployId} not found`);
      results.push({ campaignId: row.campaignId, action: "deploy-missing", ok: false });
      throw new Error("deploy missing");
    }
    if (deploy.campaignId !== row.campaignId) {
      console.error(`[FAIL] Deploy ${row.deployId} campaignId mismatch: ${deploy.campaignId} vs ${row.campaignId}`);
      results.push({ campaignId: row.campaignId, action: "deploy-mismatch", ok: false });
      throw new Error("deploy/campaign mismatch");
    }
    if (deploy.status !== "failed") {
      console.error(`[FAIL] Deploy ${row.deployId} status=${deploy.status} (expected 'failed')`);
      results.push({ campaignId: row.campaignId, action: "deploy-status-unexpected", ok: false, note: `status=${deploy.status}` });
      throw new Error(`deploy status unexpected: ${deploy.status}`);
    }

    console.log(
      `─── ${row.campaignId}  "${row.campaignName.slice(0, 60)}"\n    BEFORE: campaign=${campaign.status}  deploy=${deploy.status}/${deploy.linkedinStatus}`,
    );

    if (DRY_RUN) {
      console.log(`    [DRY] would flip campaign -> approved, deploy -> rolled_back\n`);
      results.push({ campaignId: row.campaignId, action: "dry", ok: true });
      continue;
    }

    const now = new Date();
    await prisma.$transaction([
      prisma.campaignDeploy.updateMany({
        where: { id: row.deployId, status: "failed" },
        data: { status: "rolled_back", error: ROLLBACK_ERROR, completedAt: now },
      }),
      prisma.campaign.updateMany({
        where: { id: row.campaignId, status: "deployed" },
        data: { status: "approved" },
      }),
    ]);

    // Verify
    const afterC = await prisma.campaign.findUnique({ where: { id: row.campaignId }, select: { status: true } });
    const afterD = await prisma.campaignDeploy.findUnique({ where: { id: row.deployId }, select: { status: true } });
    console.log(`    AFTER:  campaign=${afterC?.status}  deploy=${afterD?.status}\n`);
    results.push({ campaignId: row.campaignId, action: "flipped", ok: true });
  }

  console.log(`================ SUMMARY ================`);
  const ok = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;
  console.log(`Total actions: ${results.length}  (ok=${ok}  fail=${fail})`);
  for (const r of results) {
    console.log(`  ${r.ok ? "OK" : "FAIL"} ${r.campaignId}  action=${r.action}  ${r.note ?? ""}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("FATAL:", e.message ?? e); process.exit(1); });
