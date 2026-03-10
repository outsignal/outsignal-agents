/**
 * Seed EmailBison campaigns for the Outsignal workspace into local Campaign table.
 *
 * Fetches real campaigns from EmailBison API, maps statuses to our enum,
 * and creates Campaign records. Idempotent — skips campaigns that already
 * exist by emailBisonCampaignId.
 *
 * Usage: node scripts/seed-outsignal-campaigns.js
 */

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

// Outsignal workspace API token (from database Workspace record)
const API_TOKEN = "15|9ElM1eQU9zqr2pAYmlr8z3cGK09ewn08lWM9XDS8edc1826c";
const BASE_URL = "https://app.outsignal.ai/api";
const WORKSPACE_SLUG = "outsignal";

/**
 * Map EmailBison campaign status to our Campaign status enum.
 *
 * Our statuses: draft | internal_review | pending_approval | approved | deployed | active | paused | completed
 * EmailBison statuses: active | paused | draft | completed
 *
 * For seeding, we want some variety to test the portal UI:
 * - active -> "active" (live campaigns)
 * - paused -> "paused" (paused campaigns)
 * - completed -> "completed" (finished campaigns)
 * - draft -> "draft" (not started)
 *
 * We'll also override a couple to "pending_approval" for testing amber highlighting.
 */
function mapStatus(ebStatus, campaignId) {
  // Force 2 paused campaigns into "pending_approval" for testing variety
  // Pick campaign IDs 3 and 4 (the two [UK] Roofing Contractors that are paused)
  if (campaignId === 3 || campaignId === 4) {
    return "pending_approval";
  }

  // Force one paused campaign to "internal_review" for more status variety
  if (campaignId === 2) {
    return "internal_review";
  }

  switch (ebStatus) {
    case "active":
      return "active";
    case "paused":
      return "paused";
    case "completed":
      return "completed";
    case "draft":
      return "draft";
    default:
      return "draft";
  }
}

async function fetchCampaigns() {
  const res = await fetch(`${BASE_URL}/campaigns?page=1`, {
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`EmailBison API error ${res.status}: ${await res.text()}`);
  }

  const json = await res.json();
  return json.data;
}

async function main() {
  console.log("Fetching campaigns from EmailBison API...");
  const ebCampaigns = await fetchCampaigns();
  console.log(`Found ${ebCampaigns.length} campaigns in EmailBison.\n`);

  // Check which campaigns already exist by emailBisonCampaignId
  const existing = await prisma.campaign.findMany({
    where: { workspaceSlug: WORKSPACE_SLUG },
    select: { emailBisonCampaignId: true, name: true },
  });
  const existingIds = new Set(
    existing
      .filter((c) => c.emailBisonCampaignId !== null)
      .map((c) => c.emailBisonCampaignId)
  );
  // Track all names in use (existing + newly created this run)
  const usedNames = new Set(existing.map((c) => c.name));

  let created = 0;
  let skipped = 0;

  for (const eb of ebCampaigns) {
    if (existingIds.has(eb.id)) {
      console.log(`  SKIP: "${eb.name}" (emailBisonCampaignId=${eb.id} already exists)`);
      skipped++;
      continue;
    }

    const status = mapStatus(eb.status, eb.id);

    // Check for name collision (our schema has @@unique([workspaceSlug, name]))
    // Append EB campaign ID to disambiguate duplicates
    let campaignName = eb.name;
    if (usedNames.has(campaignName)) {
      campaignName = `${eb.name.trim()} (#${eb.id})`;
    }

    const campaign = await prisma.campaign.create({
      data: {
        name: campaignName,
        workspaceSlug: WORKSPACE_SLUG,
        description: `EmailBison outbound campaign. ${eb.total_leads} leads, ${eb.emails_sent} emails sent, ${eb.unique_replies} replies.`,
        status,
        channels: JSON.stringify(["email"]),
        emailBisonCampaignId: eb.id,
        emailBisonSequenceId: eb.sequence_id,
        createdAt: new Date(eb.created_at),
        updatedAt: new Date(eb.updated_at),
        // Set publishedAt for non-draft campaigns (they were live at some point)
        publishedAt: status !== "draft" ? new Date(eb.created_at) : null,
        // Set deployedAt for active/paused/completed campaigns
        deployedAt:
          ["active", "paused", "completed"].includes(status)
            ? new Date(eb.created_at)
            : null,
      },
    });

    usedNames.add(campaignName);
    console.log(
      `  CREATE: "${campaign.name}" | status=${status} | ebId=${eb.id} | dbId=${campaign.id}`
    );
    created++;
  }

  console.log(`\n--- Summary ---`);
  console.log(`Created: ${created}`);
  console.log(`Skipped: ${skipped}`);

  // Final count
  const total = await prisma.campaign.count({
    where: { workspaceSlug: WORKSPACE_SLUG },
  });
  console.log(`Total campaigns for outsignal workspace: ${total}`);

  // Status breakdown
  const statusBreakdown = await prisma.campaign.groupBy({
    by: ["status"],
    where: { workspaceSlug: WORKSPACE_SLUG },
    _count: true,
  });
  console.log("\nStatus breakdown:");
  for (const s of statusBreakdown) {
    console.log(`  ${s.status}: ${s._count}`);
  }
}

main()
  .catch((e) => {
    console.error("ERROR:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
