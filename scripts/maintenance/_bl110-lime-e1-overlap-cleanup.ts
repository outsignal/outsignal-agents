/**
 * BL-110 (2026-04-17) — Remove 9 edge-case overlapping leads from E1's target list.
 *
 * Context: After BL-112 re-sort, 9 people remain in BOTH E1 AND E4/E5 with
 * adjacent titles (Factory Supervisor, Site Manager, Shift Production Manager,
 * Night Shift Manager, Senior Shift Operations Manager). These were not caught
 * by the title-exact re-sort because their titles differ from the primary
 * "Factory Manager" / "Shift Manager" buckets.
 *
 * Action: Delete TargetListPerson records from E1's list for people who also
 * appear in E4 or E5 and whose jobTitle contains one of the overlap terms.
 * People remain in E4/E5 untouched.
 *
 * HARDCODED scope — only operates on the 3 Lime campaigns listed below.
 */

import { PrismaClient } from "@prisma/client";

const CAMPAIGN_IDS = {
  E1: "cmnpwzv9e010np8itsf3f35oy", // Manufacturing+Warehousing
  E4: "cmnpwzym5014op8it2cpupfwx", // Factory Manager
  E5: "cmnpx037s01dcp8itzzilfdfb", // Shift Manager
};

const OVERLAP_TITLE_TERMS = [
  "Factory Supervisor",
  "Site Manager",
  "Shift Production Manager",
  "Night Shift Manager",
  "Senior Shift Operations Manager",
];

async function main() {
  const prisma = new PrismaClient();

  try {
    // ---- Step 1: Get target list IDs for E1, E4, E5 ----
    console.log("\n=== Step 1: Fetching target list IDs ===");
    const campaigns = await prisma.campaign.findMany({
      where: { id: { in: Object.values(CAMPAIGN_IDS) } },
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

    console.log(`  E1 "${e1.name}" -> list ${e1.targetListId}`);
    console.log(`  E4 "${e4.name}" -> list ${e4.targetListId}`);
    console.log(`  E5 "${e5.name}" -> list ${e5.targetListId}`);

    // ---- Step 2: Find overlapping people ----
    console.log("\n=== Step 2: Finding overlapping people ===");

    // Get all personIds in E4 and E5 target lists
    const e4e5People = await prisma.targetListPerson.findMany({
      where: {
        listId: { in: [e4.targetListId, e5.targetListId] },
      },
      select: { personId: true, listId: true },
    });

    const e4PersonIds = new Set(
      e4e5People.filter((p) => p.listId === e4.targetListId).map((p) => p.personId)
    );
    const e5PersonIds = new Set(
      e4e5People.filter((p) => p.listId === e5.targetListId).map((p) => p.personId)
    );

    console.log(`  E4 list has ${e4PersonIds.size} people`);
    console.log(`  E5 list has ${e5PersonIds.size} people`);

    // Get E1 people who are also in E4 or E5
    const e4e5AllIds = new Set([...e4PersonIds, ...e5PersonIds]);

    const e1PeopleInOverlap = await prisma.targetListPerson.findMany({
      where: {
        listId: e1.targetListId,
        personId: { in: [...e4e5AllIds] },
      },
      select: {
        id: true,
        personId: true,
        person: {
          select: {
            firstName: true,
            lastName: true,
            jobTitle: true,
          },
        },
      },
    });

    console.log(`  E1 people also in E4/E5: ${e1PeopleInOverlap.length}`);

    // Filter to those with matching overlap titles
    const toRemove = e1PeopleInOverlap.filter((tlp) => {
      const title = tlp.person.jobTitle ?? "";
      return OVERLAP_TITLE_TERMS.some((term) =>
        title.toLowerCase().includes(term.toLowerCase())
      );
    });

    console.log(`  Matching overlap title terms: ${toRemove.length}`);

    if (toRemove.length === 0) {
      console.log("\n  No overlapping people found. Nothing to do.");
      return;
    }

    // ---- Step 3: Log and delete ----
    console.log("\n=== Step 3: Removing from E1 list ===");

    for (const tlp of toRemove) {
      const name = `${tlp.person.firstName ?? ""} ${tlp.person.lastName ?? ""}`.trim();
      const title = tlp.person.jobTitle ?? "(no title)";
      const inE4 = e4PersonIds.has(tlp.personId);
      const inE5 = e5PersonIds.has(tlp.personId);
      const otherLists = [inE4 ? "E4" : null, inE5 ? "E5" : null]
        .filter(Boolean)
        .join(", ");

      console.log(`  Removing: ${name} | ${title} | also in: ${otherLists}`);
    }

    const idsToDelete = toRemove.map((tlp) => tlp.id);
    const result = await prisma.targetListPerson.deleteMany({
      where: { id: { in: idsToDelete } },
    });

    console.log(`\n=== Done: ${result.count} TargetListPerson records removed from E1 ===`);

    // ---- Step 4: Verify ----
    console.log("\n=== Step 4: Verification ===");
    const e1Count = await prisma.targetListPerson.count({
      where: { listId: e1.targetListId },
    });
    console.log(`  E1 list now has ${e1Count} people`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
