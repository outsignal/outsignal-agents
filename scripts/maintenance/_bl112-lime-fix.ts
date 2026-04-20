/**
 * BL-112 (2026-04-17) — Lime campaign lead re-sort + EB cleanup.
 *
 * Context: 5 Lime email campaigns were deployed to EmailBison but leads
 * were mis-sorted. Factory Manager and Shift Manager title leads ended up
 * in the E1 list instead of E4 and E5 lists.
 *
 * Tasks:
 *   1. Delete EB campaigns 98, 99, 100, 102 (EB 101 is excluded — presumably correct)
 *   2. Revert all 5 Campaign DB rows: status='approved', emailBisonCampaignId=null, deployedAt=null
 *   3. Re-sort leads: move Factory Manager people from E1->E4, Shift Manager from E1->E5
 *   4. Verify zero overlap between E1/E4 and E1/E5 lists
 *
 * HARDCODED scope — only operates on the 5 Lime campaigns listed below.
 */

import { PrismaClient } from "@prisma/client";
import { EmailBisonClient } from "@/lib/emailbison/client";

const WORKSPACE_SLUG = "lime-recruitment";

// Campaign IDs (Outsignal DB)
const CAMPAIGN_IDS = {
  E1: "cmnpwzv9e010np8itsf3f35oy", // Manufacturing+Warehousing
  E2: "cmnpwzwi5011sp8itj20w1foq", // Transportation+Logistics
  E3: "cmnpwzxmg012gp8itxv4dvmyb", // Engineering
  E4: "cmnpwzym5014op8it2cpupfwx", // Factory Manager
  E5: "cmnpx037s01dcp8itzzilfdfb", // Shift Manager
};

// EB campaign IDs to delete (101 is excluded)
const EB_IDS_TO_DELETE = [98, 99, 100, 102];

const ALL_CAMPAIGN_IDS = Object.values(CAMPAIGN_IDS);

async function main() {
  const prisma = new PrismaClient();

  try {
    // ---- Step 0: Get workspace API token ----
    console.log("\n=== Step 0: Fetching workspace API token ===");
    const workspace = await prisma.workspace.findUnique({
      where: { slug: WORKSPACE_SLUG },
      select: { apiToken: true, slug: true },
    });
    if (!workspace?.apiToken) {
      throw new Error(`Workspace ${WORKSPACE_SLUG} not found or has no apiToken`);
    }
    console.log(`  Workspace: ${workspace.slug}, apiToken: ${workspace.apiToken.slice(0, 8)}...`);

    const ebClient = new EmailBisonClient(workspace.apiToken);

    // ---- Task 1: Delete EB campaigns 98, 99, 100, 102 ----
    console.log("\n=== Task 1: Delete EB campaigns ===");
    for (const ebId of EB_IDS_TO_DELETE) {
      try {
        await ebClient.deleteCampaign(ebId);
        console.log(`  Deleted EB campaign ${ebId}`);
      } catch (err: unknown) {
        // If already deleted (404), that is fine — idempotent
        const is404 =
          err instanceof Error &&
          (err.message.includes("404") || err.message.includes("not found"));
        if (is404) {
          console.log(`  EB campaign ${ebId} already deleted (404) — skipping`);
        } else {
          console.error(`  FAILED to delete EB campaign ${ebId}:`, err);
          throw err;
        }
      }
    }
    console.log("  EB deletion complete.");

    // ---- Task 2: Revert DB state for all 5 campaigns ----
    console.log("\n=== Task 2: Revert DB state (all 5 campaigns) ===");
    await prisma.$transaction(async (tx) => {
      for (const [label, id] of Object.entries(CAMPAIGN_IDS)) {
        const before = await tx.campaign.findUnique({
          where: { id },
          select: { id: true, name: true, status: true, emailBisonCampaignId: true, deployedAt: true },
        });
        if (!before) {
          throw new Error(`Campaign ${label} (${id}) not found`);
        }
        console.log(`  ${label} before: status=${before.status}, ebId=${before.emailBisonCampaignId}, deployedAt=${before.deployedAt}`);

        await tx.campaign.update({
          where: { id },
          data: {
            status: "approved",
            emailBisonCampaignId: null,
            deployedAt: null,
          },
        });
        console.log(`  ${label} reverted to: status=approved, ebId=null, deployedAt=null`);
      }

      // Audit log
      await tx.auditLog.create({
        data: {
          action: "campaign.status.bl112_lime_revert",
          entityType: "Campaign",
          entityId: CAMPAIGN_IDS.E1, // primary affected entity
          adminEmail: "system@outsignal.ai",
          metadata: {
            task: "BL-112: Revert 5 Lime campaigns for lead re-sort",
            workspaceSlug: WORKSPACE_SLUG,
            campaignIds: ALL_CAMPAIGN_IDS,
            ebIdsDeleted: EB_IDS_TO_DELETE,
          },
        },
      });
      console.log("  AuditLog written.");
    });
    console.log("  DB revert complete.");

    // ---- Task 3: Re-sort leads ----
    console.log("\n=== Task 3: Re-sort leads (Factory Manager -> E4, Shift Manager -> E5) ===");

    // Get target list IDs for E1, E4, E5
    const campaigns = await prisma.campaign.findMany({
      where: { id: { in: [CAMPAIGN_IDS.E1, CAMPAIGN_IDS.E4, CAMPAIGN_IDS.E5] } },
      select: { id: true, name: true, targetListId: true },
    });

    const campaignMap = new Map(campaigns.map((c) => [c.id, c]));
    const e1 = campaignMap.get(CAMPAIGN_IDS.E1);
    const e4 = campaignMap.get(CAMPAIGN_IDS.E4);
    const e5 = campaignMap.get(CAMPAIGN_IDS.E5);

    if (!e1?.targetListId || !e4?.targetListId || !e5?.targetListId) {
      throw new Error(
        `Missing targetListId: E1=${e1?.targetListId}, E4=${e4?.targetListId}, E5=${e5?.targetListId}`
      );
    }

    console.log(`  E1 list: ${e1.targetListId} (${e1.name})`);
    console.log(`  E4 list: ${e4.targetListId} (${e4.name})`);
    console.log(`  E5 list: ${e5.targetListId} (${e5.name})`);

    // Find Factory Manager people in E1
    const factoryManagersInE1 = await prisma.targetListPerson.findMany({
      where: {
        listId: e1.targetListId,
        person: {
          jobTitle: { contains: "Factory Manager", mode: "insensitive" },
        },
      },
      include: { person: { select: { id: true, firstName: true, lastName: true, jobTitle: true } } },
    });
    console.log(`  Found ${factoryManagersInE1.length} Factory Manager leads in E1`);

    // Find Shift Manager people in E1
    const shiftManagersInE1 = await prisma.targetListPerson.findMany({
      where: {
        listId: e1.targetListId,
        person: {
          jobTitle: { contains: "Shift Manager", mode: "insensitive" },
        },
      },
      include: { person: { select: { id: true, firstName: true, lastName: true, jobTitle: true } } },
    });
    console.log(`  Found ${shiftManagersInE1.length} Shift Manager leads in E1`);

    // Move Factory Managers: E1 -> E4
    if (factoryManagersInE1.length > 0) {
      console.log(`\n  Moving ${factoryManagersInE1.length} Factory Managers from E1 to E4...`);
      await prisma.$transaction(async (tx) => {
        // Create entries in E4 (skip duplicates)
        const e4Creates = factoryManagersInE1.map((tlp) => ({
          listId: e4.targetListId!,
          personId: tlp.person.id,
        }));
        const created = await tx.targetListPerson.createMany({
          data: e4Creates,
          skipDuplicates: true,
        });
        console.log(`    Created ${created.count} entries in E4 list`);

        // Delete from E1
        const deleted = await tx.targetListPerson.deleteMany({
          where: {
            id: { in: factoryManagersInE1.map((tlp) => tlp.id) },
          },
        });
        console.log(`    Deleted ${deleted.count} entries from E1 list`);
      });
    }

    // Move Shift Managers: E1 -> E5
    if (shiftManagersInE1.length > 0) {
      console.log(`\n  Moving ${shiftManagersInE1.length} Shift Managers from E1 to E5...`);
      await prisma.$transaction(async (tx) => {
        const e5Creates = shiftManagersInE1.map((tlp) => ({
          listId: e5.targetListId!,
          personId: tlp.person.id,
        }));
        const created = await tx.targetListPerson.createMany({
          data: e5Creates,
          skipDuplicates: true,
        });
        console.log(`    Created ${created.count} entries in E5 list`);

        const deleted = await tx.targetListPerson.deleteMany({
          where: {
            id: { in: shiftManagersInE1.map((tlp) => tlp.id) },
          },
        });
        console.log(`    Deleted ${deleted.count} entries from E1 list`);
      });
    }

    console.log("\n  Lead re-sort complete.");

    // ---- Task 4: Verify overlap matrix ----
    console.log("\n=== Task 4: Verify overlap matrix ===");

    // E1 person IDs
    const e1People = await prisma.targetListPerson.findMany({
      where: { listId: e1.targetListId },
      select: { personId: true },
    });
    const e1PersonIds = new Set(e1People.map((p) => p.personId));

    // E4 person IDs
    const e4People = await prisma.targetListPerson.findMany({
      where: { listId: e4.targetListId },
      select: { personId: true },
    });
    const e4PersonIds = new Set(e4People.map((p) => p.personId));

    // E5 person IDs
    const e5People = await prisma.targetListPerson.findMany({
      where: { listId: e5.targetListId },
      select: { personId: true },
    });
    const e5PersonIds = new Set(e5People.map((p) => p.personId));

    // Compute overlaps
    const e1_e4_overlap = [...e1PersonIds].filter((id) => e4PersonIds.has(id));
    const e1_e5_overlap = [...e1PersonIds].filter((id) => e5PersonIds.has(id));

    // Check E4 exclusivity: no Factory Manager should be in E1
    const factoryManagersStillInE1 = await prisma.targetListPerson.count({
      where: {
        listId: e1.targetListId,
        person: {
          jobTitle: { contains: "Factory Manager", mode: "insensitive" },
        },
      },
    });

    const shiftManagersStillInE1 = await prisma.targetListPerson.count({
      where: {
        listId: e1.targetListId,
        person: {
          jobTitle: { contains: "Shift Manager", mode: "insensitive" },
        },
      },
    });

    console.log("\n  --- Overlap Matrix ---");
    console.log(`  E1 (Manufacturing+Warehousing): ${e1PersonIds.size} leads`);
    console.log(`  E4 (Factory Manager):           ${e4PersonIds.size} leads`);
    console.log(`  E5 (Shift Manager):             ${e5PersonIds.size} leads`);
    console.log(`  E1 ∩ E4 overlap:  ${e1_e4_overlap.length} (expected: 0)`);
    console.log(`  E1 ∩ E5 overlap:  ${e1_e5_overlap.length} (expected: 0)`);
    console.log(`  Factory Managers still in E1: ${factoryManagersStillInE1} (expected: 0)`);
    console.log(`  Shift Managers still in E1:   ${shiftManagersStillInE1} (expected: 0)`);

    const allClear =
      e1_e4_overlap.length === 0 &&
      e1_e5_overlap.length === 0 &&
      factoryManagersStillInE1 === 0 &&
      shiftManagersStillInE1 === 0;

    if (allClear) {
      console.log("\n  PASS: All overlap checks passed. Lead re-sort is clean.");
    } else {
      console.error("\n  FAIL: Overlap detected! Manual investigation needed.");
      if (e1_e4_overlap.length > 0) {
        console.error(`    E1/E4 overlap person IDs: ${e1_e4_overlap.slice(0, 5).join(", ")}...`);
      }
      if (e1_e5_overlap.length > 0) {
        console.error(`    E1/E5 overlap person IDs: ${e1_e5_overlap.slice(0, 5).join(", ")}...`);
      }
      process.exit(1);
    }

    // Final summary
    console.log("\n=== BL-112 Complete ===");
    console.log(JSON.stringify({
      ebCampaignsDeleted: EB_IDS_TO_DELETE,
      dbCampaignsReverted: ALL_CAMPAIGN_IDS.length,
      factoryManagersMoved: factoryManagersInE1.length,
      shiftManagersMoved: shiftManagersInE1.length,
      finalCounts: {
        E1: e1PersonIds.size,
        E4: e4PersonIds.size,
        E5: e5PersonIds.size,
      },
      overlapE1E4: e1_e4_overlap.length,
      overlapE1E5: e1_e5_overlap.length,
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("BL-112 FATAL:", err);
  process.exit(1);
});
