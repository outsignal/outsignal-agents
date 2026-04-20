/**
 * Phase 6a-rollback — clean up failed email canary deploy.
 *
 * Context: Phase 6a canary deploy on Campaign cmneqixpv0001p8710bov1fga
 * (1210-solutions workspace) got through Step 1 (createCampaign → EB 79)
 * and Step 2 (persist emailBisonCampaignId + deployedAt), then failed at
 * Step 3 (UPSERT_SEQUENCE_STEPS) with EB 422 "title/sequence_steps required"
 * — pre-existing createSequenceStep batch shape bug. Campaign is now in a
 * bad state (status=deployed, ebId=79, deployedAt set) with orphan EB
 * campaign 79 on the EB side. LinkedIn canary cmneqixvz was never touched
 * by the 6a run (correct fail-fast) and stays untouched here.
 *
 * Scope — EXACT:
 *  (1) EB delete campaign 79 via EmailBisonClient.deleteCampaign; verify 404
 *  (2) Single Prisma $transaction:
 *        UPDATE Campaign cmneqixpv   status deployed→approved, ebId 79→null, deployedAt→null
 *        UPDATE CampaignDeploy cmo16w3r9 status failed→rolled_back, append error suffix
 *        INSERT AuditLog row with phase6a_rollback metadata
 *  (3) Post-tx verification + collateral check
 *  (4) NO commit, NO push (DB-only, no tracked files expected to change)
 *
 * Mirrors Phase 0 + Phase 5.5 pattern.
 *
 * Dry-run: npx tsx scripts/maintenance/_phase-6a-rollback-email-canary.ts
 * Execute: npx tsx scripts/maintenance/_phase-6a-rollback-email-canary.ts --execute
 */
import { prisma } from "@/lib/db";
import { EmailBisonClient, EmailBisonApiError } from "@/lib/emailbison/client";

const CAMPAIGN_ID = "cmneqixpv0001p8710bov1fga";
const DEPLOY_ID = "cmo16w3r90001zxlvxr1x5yop";
const EB_CAMPAIGN_ID = 79;
const LINKEDIN_CANARY_ID = "cmneqixvz0003p871m8sw9u7o";
const WORKSPACE_SLUG = "1210-solutions";

const ERROR_SUFFIX =
  " --- Phase 6a-rollback 2026-04-16 — EB campaign 79 deleted, DB reverted to approved ready for Phase 6.5 fix of createSequenceStep batch shape";

async function main() {
  const execute = process.argv.includes("--execute");
  const mode = execute ? "EXECUTE" : "DRY-RUN";
  console.log(`\n=== Phase 6a-rollback (${mode}) ===\n`);

  // ---------------------------------------------------------------------------
  // Preflight — read current state, HARD STOP on any deviation from brief
  // ---------------------------------------------------------------------------
  const campaign = await prisma.campaign.findUnique({
    where: { id: CAMPAIGN_ID },
    select: {
      id: true,
      status: true,
      emailBisonCampaignId: true,
      deployedAt: true,
      contentApproved: true,
      leadsApproved: true,
      targetListId: true,
      workspace: { select: { slug: true, apiToken: true } },
    },
  });
  if (!campaign) throw new Error(`Campaign ${CAMPAIGN_ID} not found`);

  const deploy = await prisma.campaignDeploy.findUnique({
    where: { id: DEPLOY_ID },
    select: {
      id: true,
      status: true,
      error: true,
      emailStatus: true,
      emailBisonCampaignId: true,
      campaignId: true,
      channels: true,
    },
  });
  if (!deploy) throw new Error(`CampaignDeploy ${DEPLOY_ID} not found`);

  const linkedinCanary = await prisma.campaign.findUnique({
    where: { id: LINKEDIN_CANARY_ID },
    select: {
      id: true,
      status: true,
      emailBisonCampaignId: true,
      deployedAt: true,
      updatedAt: true,
    },
  });
  if (!linkedinCanary)
    throw new Error(`LinkedIn canary ${LINKEDIN_CANARY_ID} not found`);

  console.log("Pre-state:");
  console.log(
    `  Campaign ${campaign.id}: status=${campaign.status} ebId=${campaign.emailBisonCampaignId} deployedAt=${campaign.deployedAt?.toISOString()} contentApproved=${campaign.contentApproved} leadsApproved=${campaign.leadsApproved} targetListId=${campaign.targetListId} workspace=${campaign.workspace.slug}`,
  );
  console.log(
    `  Deploy   ${deploy.id}: status=${deploy.status} emailStatus=${deploy.emailStatus} ebId=${deploy.emailBisonCampaignId} campaignId=${deploy.campaignId}`,
  );
  console.log(
    `  LinkedIn ${linkedinCanary.id} (MUST BE UNCHANGED): status=${linkedinCanary.status} ebId=${linkedinCanary.emailBisonCampaignId} deployedAt=${linkedinCanary.deployedAt}`,
  );
  const linkedInInitialUpdatedAt = linkedinCanary.updatedAt;

  // HARD STOP gates — brief-specified preconditions
  if (campaign.status !== "deployed") {
    throw new Error(
      `EXPECTED Campaign status=deployed, got ${campaign.status}. STOP — state already changed since brief was written.`,
    );
  }
  if (campaign.emailBisonCampaignId !== EB_CAMPAIGN_ID) {
    throw new Error(
      `EXPECTED Campaign.emailBisonCampaignId=${EB_CAMPAIGN_ID}, got ${campaign.emailBisonCampaignId}. STOP.`,
    );
  }
  if (!campaign.deployedAt) {
    throw new Error(`EXPECTED Campaign.deployedAt non-null, got null. STOP.`);
  }
  if (deploy.status !== "failed") {
    throw new Error(
      `EXPECTED Deploy status=failed, got ${deploy.status}. STOP.`,
    );
  }
  if (deploy.campaignId !== CAMPAIGN_ID) {
    throw new Error(
      `Deploy ${DEPLOY_ID} campaignId mismatch: got ${deploy.campaignId}, expected ${CAMPAIGN_ID}. STOP.`,
    );
  }
  if (campaign.workspace.slug !== WORKSPACE_SLUG) {
    throw new Error(
      `Workspace slug mismatch: got ${campaign.workspace.slug}, expected ${WORKSPACE_SLUG}. STOP.`,
    );
  }
  if (!campaign.workspace.apiToken) {
    throw new Error(
      `Workspace ${WORKSPACE_SLUG} has no apiToken — cannot call EB. STOP.`,
    );
  }

  // ---------------------------------------------------------------------------
  // Step 1 — EB delete campaign 79
  // ---------------------------------------------------------------------------
  console.log(`\n[6a-r.1] EB delete campaign ${EB_CAMPAIGN_ID}`);
  const client = new EmailBisonClient(campaign.workspace.apiToken);

  // Pre-delete: confirm campaign 79 exists on EB (sanity — else nothing to delete)
  let preDeleteExists = false;
  try {
    const c = await client.getCampaign(EB_CAMPAIGN_ID);
    preDeleteExists = true;
    console.log(
      `  Pre-delete verify: EB ${EB_CAMPAIGN_ID} EXISTS (status=${c.status}, name="${c.name}")`,
    );
  } catch (e) {
    const err = e as EmailBisonApiError;
    if (err.isRecordNotFound || err.status === 404) {
      console.log(
        `  Pre-delete verify: EB ${EB_CAMPAIGN_ID} already NOT FOUND (404). Skipping delete.`,
      );
    } else {
      throw new Error(
        `Pre-delete GET failed with non-404: status=${err.status} message=${err.message}. STOP — cannot confirm EB state.`,
      );
    }
  }

  if (!execute) {
    console.log(`  DRY-RUN: would DELETE /api/campaigns/${EB_CAMPAIGN_ID}`);
  } else if (preDeleteExists) {
    try {
      await client.deleteCampaign(EB_CAMPAIGN_ID);
      console.log(`  DELETE ${EB_CAMPAIGN_ID}: success (no body)`);
    } catch (e) {
      const err = e as Error;
      console.error(`  DELETE ${EB_CAMPAIGN_ID} FAILED:`, err.message);
      throw new Error(
        `EB delete failed — STOP per brief. Error: ${err.message}`,
      );
    }

    // Verify 404 post-delete
    try {
      const c = await client.getCampaign(EB_CAMPAIGN_ID);
      throw new Error(
        `Post-delete verify: EB ${EB_CAMPAIGN_ID} STILL EXISTS (status=${c.status}). STOP — EB did not honour delete.`,
      );
    } catch (e) {
      const err = e as EmailBisonApiError;
      if (err.isRecordNotFound || err.status === 404) {
        console.log(
          `  Post-delete verify: EB ${EB_CAMPAIGN_ID} returns 404 (record_not_found=${err.isRecordNotFound}) ✓`,
        );
      } else {
        throw new Error(
          `Post-delete GET returned non-404 error: status=${err.status}. STOP.`,
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Step 2 — Dry-run count WHERE-match sanity + $transaction
  // ---------------------------------------------------------------------------
  console.log(`\n[6a-r.2] DB mutation dry-run count`);
  const campaignMatch = await prisma.campaign.count({
    where: {
      id: CAMPAIGN_ID,
      status: "deployed",
      emailBisonCampaignId: EB_CAMPAIGN_ID,
    },
  });
  const deployMatch = await prisma.campaignDeploy.count({
    where: { id: DEPLOY_ID, status: "failed" },
  });
  console.log(
    `  WHERE matches: Campaign=${campaignMatch} (expect 1), CampaignDeploy=${deployMatch} (expect 1)`,
  );

  if (campaignMatch !== 1) {
    throw new Error(
      `Campaign WHERE match count=${campaignMatch}, expected 1. STOP.`,
    );
  }
  if (deployMatch !== 1) {
    throw new Error(
      `CampaignDeploy WHERE match count=${deployMatch}, expected 1. STOP.`,
    );
  }

  const newErrorText = (deploy.error ?? "") + ERROR_SUFFIX;

  console.log("\n  Planned updates:");
  console.log(
    `    Campaign ${CAMPAIGN_ID}: status deployed→approved, emailBisonCampaignId 79→null, deployedAt ${campaign.deployedAt?.toISOString()}→null`,
  );
  console.log(
    `    CampaignDeploy ${DEPLOY_ID}: status failed→rolled_back, error (append suffix, new length=${newErrorText.length})`,
  );
  console.log(
    `    AuditLog INSERT: action=campaign.status.phase6a_rollback entityType=Campaign entityId=${CAMPAIGN_ID} adminEmail=ops@outsignal.ai`,
  );

  if (!execute) {
    console.log(
      "\n[6a-r.2] Dry-run complete. Re-run with --execute to apply.\n",
    );
    return;
  }

  const txStart = new Date();
  console.log(`\n  Executing $transaction at ${txStart.toISOString()}...`);

  const result = await prisma.$transaction(async (tx) => {
    const updatedCampaign = await tx.campaign.update({
      where: { id: CAMPAIGN_ID },
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
      },
    });

    const updatedDeploy = await tx.campaignDeploy.update({
      where: { id: DEPLOY_ID },
      data: {
        status: "rolled_back",
        error: newErrorText,
      },
      select: { id: true, status: true, error: true },
    });

    const audit = await tx.auditLog.create({
      data: {
        action: "campaign.status.phase6a_rollback",
        entityType: "Campaign",
        entityId: CAMPAIGN_ID,
        adminEmail: "ops@outsignal.ai",
        metadata: {
          reason:
            "Phase 6a canary failed with EB 422 title/sequence_steps required (createSequenceStep shape bug) — reverting state so Phase 6.5 fix can retry cleanly",
          phase: "Phase 6a-rollback",
          deletedEbCampaignId: EB_CAMPAIGN_ID,
          originalDeployId: DEPLOY_ID,
          fromCampaignStatus: "deployed",
          toCampaignStatus: "approved",
          fromDeployStatus: "failed",
          toDeployStatus: "rolled_back",
        },
      },
    });

    return { updatedCampaign, updatedDeploy, audit };
  });

  console.log(`  $transaction committed.`);
  console.log(`    Campaign: status=${result.updatedCampaign.status} ebId=${result.updatedCampaign.emailBisonCampaignId} deployedAt=${result.updatedCampaign.deployedAt}`);
  console.log(`    Deploy: status=${result.updatedDeploy.status}`);
  console.log(`    AuditLog: ${result.audit.id}`);

  // ---------------------------------------------------------------------------
  // Step 3 — Post-rollback verification
  // ---------------------------------------------------------------------------
  console.log(`\n[6a-r.3] Post-rollback verification`);

  const postCampaign = await prisma.campaign.findUnique({
    where: { id: CAMPAIGN_ID },
    select: {
      id: true,
      status: true,
      emailBisonCampaignId: true,
      deployedAt: true,
      contentApproved: true,
      leadsApproved: true,
    },
  });
  const checks = [
    ["status=approved", postCampaign?.status === "approved"],
    ["emailBisonCampaignId=null", postCampaign?.emailBisonCampaignId === null],
    ["deployedAt=null", postCampaign?.deployedAt === null],
    ["contentApproved=true", postCampaign?.contentApproved === true],
    ["leadsApproved=true", postCampaign?.leadsApproved === true],
  ] as const;
  console.log(`  Campaign ${CAMPAIGN_ID}:`);
  let allPass = true;
  for (const [label, ok] of checks) {
    console.log(`    ${ok ? "✓" : "✗"} ${label}`);
    if (!ok) allPass = false;
  }
  if (!allPass) throw new Error("Campaign post-state check FAILED");

  const postDeploy = await prisma.campaignDeploy.findUnique({
    where: { id: DEPLOY_ID },
    select: { id: true, status: true, error: true },
  });
  const suffixPresent = postDeploy?.error?.includes(ERROR_SUFFIX.trim()) ?? false;
  console.log(`  Deploy ${DEPLOY_ID}:`);
  console.log(`    ${postDeploy?.status === "rolled_back" ? "✓" : "✗"} status=rolled_back (actual: ${postDeploy?.status})`);
  console.log(`    ${suffixPresent ? "✓" : "✗"} error suffix appended`);
  if (postDeploy?.status !== "rolled_back" || !suffixPresent) {
    throw new Error("Deploy post-state check FAILED");
  }

  // EB re-check
  let ebFinalNotFound = false;
  try {
    const c = await client.getCampaign(EB_CAMPAIGN_ID);
    console.log(
      `    ✗ EB ${EB_CAMPAIGN_ID}: still EXISTS (status=${c.status}) — UNEXPECTED`,
    );
  } catch (e) {
    const err = e as EmailBisonApiError;
    if (err.isRecordNotFound || err.status === 404) {
      ebFinalNotFound = true;
      console.log(`  EB ${EB_CAMPAIGN_ID}: returns 404 ✓`);
    } else {
      console.log(
        `  EB ${EB_CAMPAIGN_ID}: unexpected error status=${err.status} message=${err.message}`,
      );
    }
  }
  if (!ebFinalNotFound) throw new Error(`EB ${EB_CAMPAIGN_ID} is still findable — STOP`);

  // LinkedIn canary UNCHANGED sanity
  const linkedinFinal = await prisma.campaign.findUnique({
    where: { id: LINKEDIN_CANARY_ID },
    select: {
      id: true,
      status: true,
      emailBisonCampaignId: true,
      deployedAt: true,
      updatedAt: true,
    },
  });
  const linkedinStable =
    linkedinFinal?.status === "approved" &&
    linkedinFinal?.emailBisonCampaignId === null &&
    linkedinFinal?.updatedAt.getTime() < txStart.getTime();
  console.log(`  LinkedIn canary ${LINKEDIN_CANARY_ID}:`);
  console.log(`    ${linkedinFinal?.status === "approved" ? "✓" : "✗"} status=approved`);
  console.log(
    `    ${linkedinFinal?.emailBisonCampaignId === null ? "✓" : "✗"} emailBisonCampaignId=null`,
  );
  console.log(
    `    ${linkedinFinal && linkedinFinal.updatedAt.getTime() < txStart.getTime() ? "✓" : "✗"} updatedAt (${linkedinFinal?.updatedAt.toISOString()}) < tx start (${txStart.toISOString()})`,
  );
  console.log(
    `    ${linkedinFinal?.updatedAt.getTime() === linkedInInitialUpdatedAt.getTime() ? "✓" : "✗"} updatedAt UNCHANGED vs preflight`,
  );
  if (!linkedinStable)
    throw new Error("LinkedIn canary has been touched — STOP");

  // Collateral — Campaigns updated in window [txStart - 5s, now]
  const collateralWindowStart = new Date(txStart.getTime() - 5_000);
  const recentlyUpdated = await prisma.campaign.findMany({
    where: { updatedAt: { gte: collateralWindowStart } },
    select: { id: true, status: true, updatedAt: true },
  });
  console.log(
    `\n  Collateral: Campaigns with updatedAt >= ${collateralWindowStart.toISOString()} → count=${recentlyUpdated.length}`,
  );
  for (const r of recentlyUpdated) {
    const inScope = r.id === CAMPAIGN_ID;
    console.log(
      `    ${inScope ? "(in-scope)" : "!! OUT-OF-SCOPE !!"} ${r.id} status=${r.status} updatedAt=${r.updatedAt.toISOString()}`,
    );
  }
  if (recentlyUpdated.length !== 1 || recentlyUpdated[0].id !== CAMPAIGN_ID) {
    throw new Error(
      `Collateral check FAILED: expected exactly 1 Campaign (cmneqixpv), got ${recentlyUpdated.length}`,
    );
  }
  console.log(`  Collateral check ✓ (exactly 1 Campaign row touched, in-scope)`);

  console.log("\n=== Phase 6a-rollback COMPLETE ===\n");
}

main()
  .catch((e) => {
    console.error("\nFATAL:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
