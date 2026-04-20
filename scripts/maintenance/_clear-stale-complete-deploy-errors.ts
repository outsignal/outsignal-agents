/**
 * Clear stale CampaignDeploy.error values on rows that are already complete.
 *
 * Why this exists:
 * - Before the 2026-04-18 finalizeDeployStatus fix, successful retries could
 *   end with status='complete' while preserving an old top-level `error`
 *   string from a prior failed attempt.
 * - Channel-specific fields (`emailError`, `linkedinError`) are left alone.
 *   This script only clears the stale overall `error` field.
 *
 * Usage:
 *   npx tsx scripts/maintenance/_clear-stale-complete-deploy-errors.ts
 *   npx tsx scripts/maintenance/_clear-stale-complete-deploy-errors.ts --apply
 */

import { prisma } from "@/lib/db";

const APPLY = process.argv.includes("--apply");

async function main() {
  const rows = await prisma.campaignDeploy.findMany({
    where: {
      status: "complete",
      error: { not: null },
    },
    orderBy: [{ workspaceSlug: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      workspaceSlug: true,
      campaignId: true,
      campaignName: true,
      status: true,
      emailStatus: true,
      linkedinStatus: true,
      error: true,
      createdAt: true,
      completedAt: true,
    },
  });

  console.log(
    `[clear-stale-complete-deploy-errors] found ${rows.length} complete deploy row(s) with stale error text.`,
  );

  for (const row of rows) {
    console.log(
      `- ${row.id} | ${row.workspaceSlug} | ${row.status} | email=${row.emailStatus ?? "-"} linkedin=${row.linkedinStatus ?? "-"} | ${row.campaignName}`,
    );
  }

  if (!APPLY) {
    console.log(
      "[clear-stale-complete-deploy-errors] dry-run only. Re-run with --apply to clear CampaignDeploy.error on these rows.",
    );
    return;
  }

  const result = await prisma.campaignDeploy.updateMany({
    where: {
      id: { in: rows.map((row) => row.id) },
      status: "complete",
      error: { not: null },
    },
    data: {
      error: null,
    },
  });

  console.log(
    `[clear-stale-complete-deploy-errors] APPLIED: cleared stale error on ${result.count} row(s).`,
  );
}

main()
  .catch(async (err) => {
    console.error(
      "[clear-stale-complete-deploy-errors] failed:",
      err instanceof Error ? err.message : String(err),
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
