/**
 * Backfill script: copy verified emails from enrichmentData JSON to Person.email.
 *
 * BL-016: The enrichment waterfall verified emails and stored them in
 * Person.enrichmentData JSON but failed to write them to Person.email.
 * This script recovers those emails.
 *
 * Usage:
 *   npx tsx scripts/backfill-enrichment-emails.ts                    # dry-run, all workspaces
 *   npx tsx scripts/backfill-enrichment-emails.ts --workspace rise   # dry-run, Rise only
 *   npx tsx scripts/backfill-enrichment-emails.ts --apply            # actually write changes
 *   npx tsx scripts/backfill-enrichment-emails.ts --apply --workspace yoopknows
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const workspaceIdx = args.indexOf("--workspace");
  const workspaceSlug =
    workspaceIdx !== -1 && args[workspaceIdx + 1]
      ? args[workspaceIdx + 1]
      : null;

  console.log(`Mode: ${apply ? "APPLY (will write changes)" : "DRY-RUN (read-only)"}`);
  if (workspaceSlug) {
    console.log(`Workspace filter: ${workspaceSlug}`);
  }
  console.log("");

  // Build the where clause: email IS NULL and enrichmentData is not null
  // If workspace filter, join through PersonWorkspace
  let personIds: string[] | null = null;

  if (workspaceSlug) {
    // Find the workspace
    const workspace = await prisma.workspace.findUnique({
      where: { slug: workspaceSlug },
      select: { id: true, name: true },
    });
    if (!workspace) {
      console.error(`Workspace "${workspaceSlug}" not found.`);
      process.exit(1);
    }
    console.log(`Workspace: ${workspace.name} (${workspaceSlug})`);

    // Get person IDs in this workspace
    const links = await prisma.personWorkspace.findMany({
      where: { workspaceId: workspace.id },
      select: { personId: true },
    });
    personIds = links.map((l) => l.personId);
    console.log(`People in workspace: ${personIds.length}`);
  }

  // Find all people with null email and non-null enrichmentData
  const whereClause: Record<string, unknown> = {
    email: null,
    enrichmentData: { not: null },
  };
  if (personIds !== null) {
    whereClause.id = { in: personIds };
  }

  const candidates = await prisma.person.findMany({
    where: whereClause as any,
    select: {
      id: true,
      email: true,
      enrichmentData: true,
      firstName: true,
      lastName: true,
    },
  });

  console.log(`Candidates (email IS NULL, enrichmentData IS NOT NULL): ${candidates.length}`);

  let found = 0;
  let updated = 0;
  let errors = 0;
  const toUpdate: Array<{ id: string; email: string; name: string }> = [];

  for (const person of candidates) {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(person.enrichmentData as string);
    } catch {
      // Invalid JSON — skip
      continue;
    }

    const email = data?.email;
    const status = data?.emailVerificationStatus;

    if (
      typeof email === "string" &&
      email.length > 0 &&
      (status === "valid" || status === "deliverable")
    ) {
      found++;
      const name = [person.firstName, person.lastName].filter(Boolean).join(" ") || "(unnamed)";
      toUpdate.push({ id: person.id, email, name });
    }
  }

  console.log(`\nFound ${found} people with verified emails in enrichmentData but null Person.email.`);

  if (found === 0) {
    console.log("Nothing to do.");
    await prisma.$disconnect();
    return;
  }

  // Show preview (first 10)
  console.log("\nPreview (first 10):");
  for (const entry of toUpdate.slice(0, 10)) {
    console.log(`  ${entry.name} -> ${entry.email}`);
  }
  if (toUpdate.length > 10) {
    console.log(`  ... and ${toUpdate.length - 10} more`);
  }

  if (!apply) {
    console.log(`\nDry-run complete. Run with --apply to write ${found} emails.`);
    await prisma.$disconnect();
    return;
  }

  // Apply updates
  console.log(`\nApplying ${found} updates...`);

  for (const entry of toUpdate) {
    try {
      await prisma.person.update({
        where: { id: entry.id },
        data: { email: entry.email },
      });
      updated++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Unique constraint violation — another person already has this email
      if (msg.includes("Unique constraint")) {
        console.warn(`  SKIP (duplicate): ${entry.email} for ${entry.name} (${entry.id})`);
      } else {
        console.error(`  ERROR: ${entry.email} for ${entry.name} (${entry.id}): ${msg}`);
      }
      errors++;
    }
  }

  console.log(`\nDone.`);
  console.log(`  Total found:   ${found}`);
  console.log(`  Updated:       ${updated}`);
  console.log(`  Errors/skips:  ${errors}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
