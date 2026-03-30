/**
 * blanktag-promote.ts
 *
 * Promotes clean BlankTag contacts into the blanktag workspace.
 * Stages all contacts into DiscoveredPerson, runs deduplicateAndPromote,
 * then tags PersonWorkspace records with 'google-ads-shopify'.
 *
 * Usage: cd /Users/jjay/programs/outsignal-agents && npx tsx /tmp/blanktag-promote.ts
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { readFileSync } from "fs";
import { prisma } from "@/lib/db";
import { stageDiscoveredPeople } from "@/lib/discovery/staging";
import { deduplicateAndPromote } from "@/lib/discovery/promotion";

const WORKSPACE_SLUG = "blanktag";
const RUN_ID = `blanktag-shopify-${Date.now()}`;
const CLEAN_FILE = "/tmp/blanktag-clean-contacts.json";

interface CleanContact {
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  linkedinUrl: string | null;
  location: string | null;
  companyName: string | null;
  companyDomain: string | null;
  source: "prospeo" | "aiark";
}

interface CleanData {
  summary: Record<string, unknown>;
  contacts: CleanContact[];
}

async function main() {
  console.log("Loading clean contacts...");
  const data: CleanData = JSON.parse(readFileSync(CLEAN_FILE, "utf8"));
  const contacts = data.contacts;
  console.log(`Loaded ${contacts.length} clean contacts from ${CLEAN_FILE}`);

  // -------------------------------------------------------------------------
  // Stage all contacts into DiscoveredPerson
  // -------------------------------------------------------------------------
  console.log("\nStaging contacts into DiscoveredPerson...");

  const people = contacts.map((c) => ({
    firstName: c.firstName ?? undefined,
    lastName: c.lastName ?? undefined,
    jobTitle: c.jobTitle ?? undefined,
    linkedinUrl: c.linkedinUrl ?? undefined,
    location: c.location ?? undefined,
    company: c.companyName ?? undefined,
    companyDomain: c.companyDomain ?? undefined,
  }));

  const stagingResult = await stageDiscoveredPeople({
    people,
    discoverySource: "blanktag-pipeline",
    workspaceSlug: WORKSPACE_SLUG,
    searchQuery: JSON.stringify({ pipeline: "blanktag-shopify-google-ads", sources: ["prospeo", "aiark"] }),
    discoveryRunId: RUN_ID,
  });

  console.log(`Staged: ${stagingResult.staged} contacts (runId: ${stagingResult.runId})`);

  // -------------------------------------------------------------------------
  // Deduplicate and promote
  // -------------------------------------------------------------------------
  console.log("\nRunning deduplicateAndPromote...");
  const promoResult = await deduplicateAndPromote(WORKSPACE_SLUG, [RUN_ID]);

  console.log(`Promoted: ${promoResult.promoted}`);
  console.log(`Duplicates: ${promoResult.duplicates}`);
  if (promoResult.duplicateNames.length > 0) {
    console.log(`Sample duplicates: ${promoResult.duplicateNames.join(", ")}`);
  }
  if (promoResult.enrichmentJobId) {
    console.log(`Enrichment job: ${promoResult.enrichmentJobId}`);
  }

  // -------------------------------------------------------------------------
  // Tag PersonWorkspace records
  // -------------------------------------------------------------------------
  if (promoResult.promotedIds.length > 0) {
    console.log("\nTagging PersonWorkspace records...");

    const tagResult = await prisma.personWorkspace.updateMany({
      where: {
        personId: { in: promoResult.promotedIds },
        workspace: WORKSPACE_SLUG,
      },
      data: {
        tags: JSON.stringify(["google-ads-shopify"]),
        status: "promoted",
      },
    });

    console.log(`Tagged: ${tagResult.count} PersonWorkspace records with 'google-ads-shopify'`);
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log("\n" + "=".repeat(50));
  console.log("BLANKTAG PROMOTE SUMMARY");
  console.log("=".repeat(50));
  console.log(`Run ID:        ${RUN_ID}`);
  console.log(`Workspace:     ${WORKSPACE_SLUG}`);
  console.log(`Input:         ${contacts.length} clean contacts`);
  console.log(`Staged:        ${stagingResult.staged}`);
  console.log(`Promoted:      ${promoResult.promoted}`);
  console.log(`Duplicates:    ${promoResult.duplicates}`);
  console.log(`Tagged:        ${promoResult.promotedIds.length}`);
  if (promoResult.enrichmentJobId) {
    console.log(`Enrichment:    ${promoResult.enrichmentJobId} (running in background)`);
  }
  console.log("=".repeat(50));

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Fatal error:", err);
  await prisma.$disconnect();
  process.exit(1);
});
