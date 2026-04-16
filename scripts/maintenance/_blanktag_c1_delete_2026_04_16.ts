/**
 * BlankTag C1 base hard-delete — 2026-04-16
 *
 * Throwaway maintenance script (underscore-prefixed). Runs with `npx tsx`.
 *
 * PM-authorised Tier 3 hard delete of Campaign cmmwei70q0007zxgpvyhwwmua
 * ('BlankTag - LinkedIn - C1 - UK Shopify + Google Ads'). This is the
 * never-deployed base campaign whose linkedinSequence JSON contains 6 pos=2
 * messages with no variantKey — a latent deploy-path bug. PM chose
 * delete-over-rewrite as the cleanup path. See decisions.md entry at
 * 2026-04-16T20:55:00Z for the latent-bug context and at
 * 2026-04-16T00:00:00Z for the triage authorising this script.
 *
 * Safety model:
 *   - Hardcoded target ID + expected identity fields. No CLI args.
 *   - Identity asserts: name/workspaceSlug/emailBisonCampaignId/deployedAt
 *     must match. If the ID is ever recycled onto a different row, every
 *     assert fails and the script aborts before opening any transaction.
 *   - Pre-flight zero-footprint check covers every known referencing model:
 *     deploys, signalLeads, costLogs (all counted via `include` on the same
 *     fetch), CampaignSequenceRule (keyed by workspaceSlug+campaignName, the
 *     actual FK — the brief's `{ campaignId: ... }` shape is not on the
 *     schema; documented deviation), LinkedInAction (keyed by campaignName),
 *     and child Campaigns (parentCampaignId self-reference, no `@relation`
 *     so not enforced at DB level but enforced here in app code).
 *   - If ANY count is non-zero the script aborts BEFORE opening the
 *     transaction. No partial writes possible.
 *   - The AuditLog snapshot is created FIRST in the same transaction as the
 *     delete so they commit or roll back as a unit. The `linkedinSequence`
 *     JSON is preserved verbatim in the metadata for reversibility.
 *   - Idempotent on second run: if the Campaign is already gone the script
 *     prints "not found, nothing to do" and exits 0.
 *
 * Run:  `npx tsx scripts/maintenance/_blanktag_c1_delete_2026_04_16.ts`
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { prisma } from "@/lib/db";

const CAMPAIGN_ID = "cmmwei70q0007zxgpvyhwwmua";
const EXPECTED_NAME = "BlankTag - LinkedIn - C1 - UK Shopify + Google Ads";
const EXPECTED_WORKSPACE_SLUG = "blanktag";

function die(msg: string): never {
  console.error(`ABORT — ${msg}`);
  throw new Error(msg);
}

async function main() {
  console.log("=".repeat(80));
  console.log(
    `BlankTag C1 hard-delete (2026-04-16) — target Campaign ${CAMPAIGN_ID}`,
  );
  console.log("=".repeat(80));

  // Step 1: Resolve the campaign (with all enforced-FK relations included).
  const campaign = await prisma.campaign.findUnique({
    where: { id: CAMPAIGN_ID },
    include: { deploys: true, signalLeads: true, costLogs: true },
  });

  if (!campaign) {
    console.log(
      `[OK] Campaign ${CAMPAIGN_ID} not found — already deleted or never existed. Nothing to do.`,
    );
    console.log("DONE");
    await prisma.$disconnect();
    process.exit(0);
  }

  console.log("\n[PRE-STATE]");
  console.log(`  id:                   ${campaign.id}`);
  console.log(`  name:                 '${campaign.name}'`);
  console.log(`  workspaceSlug:        ${campaign.workspaceSlug}`);
  console.log(`  status:               ${campaign.status}`);
  console.log(`  emailBisonCampaignId: ${campaign.emailBisonCampaignId}`);
  console.log(`  deployedAt:           ${campaign.deployedAt}`);
  console.log(`  parentCampaignId:     ${campaign.parentCampaignId}`);
  console.log(`  targetListId:         ${campaign.targetListId}`);
  console.log(`  channels:             ${campaign.channels}`);

  // Step 2: Identity asserts — abort if anything does not match.
  console.log("\n[IDENTITY ASSERTS]");
  if (campaign.name !== EXPECTED_NAME) {
    console.log(`  name:                 FAIL — got '${campaign.name}'`);
    die(`name mismatch: expected '${EXPECTED_NAME}' got '${campaign.name}'`);
  }
  console.log(`  name:                 OK`);
  if (campaign.workspaceSlug !== EXPECTED_WORKSPACE_SLUG) {
    console.log(`  workspaceSlug:        FAIL — got '${campaign.workspaceSlug}'`);
    die(
      `workspaceSlug mismatch: expected '${EXPECTED_WORKSPACE_SLUG}' got '${campaign.workspaceSlug}'`,
    );
  }
  console.log(`  workspaceSlug:        OK`);
  if (campaign.emailBisonCampaignId !== null) {
    console.log(
      `  emailBisonCampaignId: FAIL — got ${campaign.emailBisonCampaignId}`,
    );
    die(
      `emailBisonCampaignId mismatch: expected null got ${campaign.emailBisonCampaignId}`,
    );
  }
  console.log(`  emailBisonCampaignId: OK`);
  if (campaign.deployedAt !== null) {
    console.log(`  deployedAt:           FAIL — got ${campaign.deployedAt}`);
    die(
      `deployedAt mismatch: expected null got ${String(campaign.deployedAt)}`,
    );
  }
  console.log(`  deployedAt:           OK`);

  // Step 3: Pre-flight zero-footprint counts.
  //
  // Note on CampaignSequenceRule: schema keys rules by
  // (workspaceSlug, campaignName), NOT by campaignId. The brief literally
  // asked for `{ campaignId: CAMPAIGN_ID }` which would 500 at validate-time.
  // Using the actual FK surrogate — documented deviation, same intent.
  const ruleCount = await prisma.campaignSequenceRule.count({
    where: {
      workspaceSlug: EXPECTED_WORKSPACE_SLUG,
      campaignName: EXPECTED_NAME,
    },
  });
  const linkedInActionCount = await prisma.linkedInAction.count({
    where: { campaignName: EXPECTED_NAME },
  });
  const childCampaignCount = await prisma.campaign.count({
    where: { parentCampaignId: CAMPAIGN_ID },
  });

  const counts = {
    deploys: campaign.deploys.length,
    signalLeads: campaign.signalLeads.length,
    costLogs: campaign.costLogs.length,
    campaignSequenceRules: ruleCount,
    linkedInActionsByName: linkedInActionCount,
    childCampaigns: childCampaignCount,
  };

  console.log("\n[PRE-FLIGHT ZERO-FOOTPRINT COUNTS]");
  for (const [k, v] of Object.entries(counts)) {
    console.log(`  ${k.padEnd(22)} ${v}`);
  }

  const nonZero = Object.entries(counts).filter(([, v]) => v !== 0);
  if (nonZero.length > 0) {
    console.log("\nABORT — non-zero footprint:");
    for (const [k, v] of nonZero) {
      console.log(`  ${k} = ${v}`);
    }
    console.log(
      "No transaction opened. Campaign row left intact. Script exit 1.",
    );
    console.log("ABORTED");
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log("\n[PRE-FLIGHT] all zero — safe to proceed.");

  // Step 4: Transaction — AuditLog snapshot FIRST, delete SECOND, both atomic.
  //
  // Full scalar-field snapshot preserved in metadata for reversibility. The
  // linkedinSequence JSON is the load-bearing payload the PM cited (6 pos=2
  // entries). Keep it as raw stringified JSON — do not parse/re-serialise.
  const snapshot = {
    id: campaign.id,
    name: campaign.name,
    workspaceSlug: campaign.workspaceSlug,
    description: campaign.description,
    status: campaign.status,
    channels: campaign.channels,
    targetListId: campaign.targetListId,
    emailSequence: campaign.emailSequence,
    linkedinSequence: campaign.linkedinSequence,
    copyStrategy: campaign.copyStrategy,
    connectionTimeoutDays: campaign.connectionTimeoutDays,
    leadsApproved: campaign.leadsApproved,
    leadsFeedback: campaign.leadsFeedback,
    leadsApprovedAt: campaign.leadsApprovedAt?.toISOString() ?? null,
    contentApproved: campaign.contentApproved,
    contentFeedback: campaign.contentFeedback,
    contentApprovedAt: campaign.contentApprovedAt?.toISOString() ?? null,
    emailBisonCampaignId: campaign.emailBisonCampaignId,
    emailBisonSequenceId: campaign.emailBisonSequenceId,
    type: campaign.type,
    parentCampaignId: campaign.parentCampaignId,
    icpCriteria: campaign.icpCriteria,
    signalTypes: campaign.signalTypes,
    dailyLeadCap: campaign.dailyLeadCap,
    icpScoreThreshold: campaign.icpScoreThreshold,
    signalEmailBisonCampaignId: campaign.signalEmailBisonCampaignId,
    lastSignalProcessedAt: campaign.lastSignalProcessedAt?.toISOString() ?? null,
    createdAt: campaign.createdAt.toISOString(),
    updatedAt: campaign.updatedAt.toISOString(),
    publishedAt: campaign.publishedAt?.toISOString() ?? null,
    deployedAt: campaign.deployedAt?.toISOString() ?? null,
  };

  const metadata = {
    reason:
      "BlankTag C1 base hard delete — never-deployed latent-bug campaign (6 pos=2 linkedinSequence entries with no variantKey). PM pre-authorised cleanup path per brief 2026-04-16. Full pre-delete snapshot below for reversibility.",
    workspaceSlug: EXPECTED_WORKSPACE_SLUG,
    preFlightCounts: counts,
    snapshot,
  };

  const adminEmail =
    process.env.SYSTEM_ADMIN_EMAIL ?? "system@outsignal.ai";

  console.log("\n[TRANSACTION] creating AuditLog snapshot + deleting campaign...");

  const txResult = await prisma.$transaction(async (tx) => {
    const audit = await tx.auditLog.create({
      data: {
        action: "campaign.hard_delete",
        entityType: "Campaign",
        entityId: CAMPAIGN_ID,
        adminEmail,
        metadata: JSON.parse(JSON.stringify(metadata)),
      },
      select: { id: true, action: true, entityType: true, entityId: true },
    });

    const deleted = await tx.campaign.delete({
      where: { id: CAMPAIGN_ID },
      select: { id: true, name: true },
    });

    return { audit, deleted };
  });

  console.log(
    `  [AUDIT]   id=${txResult.audit.id} action=${txResult.audit.action} entityType=${txResult.audit.entityType} entityId=${txResult.audit.entityId}`,
  );
  console.log(
    `  [DELETE]  id=${txResult.deleted.id} name='${txResult.deleted.name}'`,
  );

  // Step 5: Post-delete verification.
  console.log("\n[POST-DELETE VERIFICATION]");
  const postCheck = await prisma.campaign.findUnique({
    where: { id: CAMPAIGN_ID },
  });
  if (postCheck !== null) {
    console.log(
      `  Campaign still exists after delete! ${JSON.stringify(postCheck)}`,
    );
    die("post-delete verification: Campaign row still present");
  }
  console.log(`  Campaign findUnique === null                  OK`);

  const auditVerify = await prisma.auditLog.findUnique({
    where: { id: txResult.audit.id },
    select: { id: true, action: true, entityId: true, entityType: true, createdAt: true },
  });
  if (!auditVerify) {
    die(`post-delete verification: AuditLog ${txResult.audit.id} not found`);
  }
  console.log(
    `  AuditLog fetch-back: id=${auditVerify.id} action=${auditVerify.action} entityType=${auditVerify.entityType} entityId=${auditVerify.entityId} createdAt=${auditVerify.createdAt.toISOString()}`,
  );

  console.log("\n=== SUMMARY ===");
  console.log(`Campaign deleted:   ${CAMPAIGN_ID} ('${EXPECTED_NAME}')`);
  console.log(`AuditLog created:   ${txResult.audit.id}`);
  console.log(`Pre-flight counts:  ${JSON.stringify(counts)}`);
  console.log(`adminEmail used:    ${adminEmail}`);
  console.log("\nDONE");

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("SCRIPT ERROR:", err);
  try {
    await prisma.$disconnect();
  } catch {
    /* noop */
  }
  process.exit(1);
});
