/**
 * BL-077 closure — clean up EmailBison orphan campaigns EB 78 + EB 80 on
 * the 1210-solutions workspace.
 *
 * Context:
 *   - EB 78: legacy orphan forensic artefact from an earlier canary attempt
 *     (pre-BL-076 fix). Never attached to any live Campaign.
 *   - EB 80: stage-only canary attempt on 2026-04-16 that blew up at Step 2
 *     due to emailSequence shape drift (fixed in BL-083). Orphan because
 *     BL-075 auto-rollback cleared Campaign.emailBisonCampaignId to null.
 *
 *   Both are safe to delete — no Campaign row references them after BL-075
 *   auto-rollback (verified via npx tsx pre-flight query).
 *
 *   Root cause of orphan generation was BL-076 (withRetry wrap on
 *   createCampaign creating duplicate EB drafts on transient-error retry),
 *   fixed in commit 3cdd5c4a. The reuse path now keys on preExistingEbId so
 *   a retry inside the same deploy cannot create a second draft. Going
 *   forward orphans of this class should not recur.
 *
 * Behaviour:
 *   - Loads Workspace.apiToken for slug '1210-solutions'.
 *   - Calls EmailBisonClient.deleteCampaign for each orphan ID.
 *   - Treats a 404 (isNotFoundError) as success — the campaign is already
 *     gone.
 *   - Any other non-2xx response → HARD STOP. No retry.
 *
 * Scope hard-locked:
 *   - Only EB IDs in TARGET_EB_IDS.
 *   - Only the 1210-solutions workspace.
 *   - Does NOT touch any Campaign / CampaignDeploy / AuditLog rows.
 */

import { PrismaClient } from "@prisma/client";
import { EmailBisonClient } from "@/lib/emailbison/client";
import { isNotFoundError } from "@/lib/emailbison/errors";

const WORKSPACE_SLUG = "1210-solutions";
const TARGET_EB_IDS: readonly number[] = [78, 80];

async function main() {
  const prisma = new PrismaClient();

  const workspace = await prisma.workspace.findUnique({
    where: { slug: WORKSPACE_SLUG },
    select: { slug: true, apiToken: true },
  });
  if (!workspace) {
    console.error(`[BL-077] Workspace '${WORKSPACE_SLUG}' not found. Aborting.`);
    await prisma.$disconnect();
    process.exit(1);
  }
  if (!workspace.apiToken) {
    console.error(
      `[BL-077] Workspace '${WORKSPACE_SLUG}' has no apiToken. Aborting.`,
    );
    await prisma.$disconnect();
    process.exit(1);
  }

  const ebClient = new EmailBisonClient(workspace.apiToken);

  // Safety double-check: ensure no Campaign / CampaignDeploy row currently
  // points at these EB IDs. If they do, something has regressed since
  // handover — HARD STOP.
  const campaignRefs = await prisma.campaign.findMany({
    where: { emailBisonCampaignId: { in: [...TARGET_EB_IDS] } },
    select: { id: true, name: true, emailBisonCampaignId: true, status: true },
  });
  if (campaignRefs.length > 0) {
    console.error(
      `[BL-077] REFUSE: Active Campaign rows still reference target EB IDs — not orphans. Rows: ${JSON.stringify(campaignRefs)}`,
    );
    await prisma.$disconnect();
    process.exit(1);
  }

  const results: Array<{
    ebId: number;
    status: "deleted" | "not_found" | "error";
    detail?: string;
  }> = [];

  for (const ebId of TARGET_EB_IDS) {
    try {
      await ebClient.deleteCampaign(ebId);
      console.log(`[BL-077] EB ${ebId}: deleted (200 OK).`);
      results.push({ ebId, status: "deleted" });
    } catch (err) {
      if (isNotFoundError(err)) {
        console.log(`[BL-077] EB ${ebId}: already deleted (404).`);
        results.push({ ebId, status: "not_found" });
        continue;
      }
      const detail = err instanceof Error ? err.message : String(err);
      console.error(
        `[BL-077] EB ${ebId}: unexpected error — HARD STOP. Detail: ${detail}`,
      );
      results.push({ ebId, status: "error", detail });
      await prisma.$disconnect();
      process.exit(1);
    }
  }

  console.log("\n=== BL-077 final summary ===");
  for (const r of results) {
    console.log(JSON.stringify(r));
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(`[BL-077] Unhandled error: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
