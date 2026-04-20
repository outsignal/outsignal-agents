/**
 * Live sanity check: run the new planner dedup SQL against prod with
 * realistic values for blanktag + lime-recruitment. Confirms Postgres
 * accepts the query and returns a plausible unstarted-count.
 *
 * Throwaway.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function checkWorkspace(slug: string) {
  const campaigns = await prisma.campaign.findMany({
    where: {
      workspaceSlug: slug,
      status: { in: ["deployed", "active"] },
      channels: { contains: "linkedin" },
    },
    select: { id: true, name: true, targetListId: true },
  });

  console.log(`\n=== ${slug} — ${campaigns.length} active linkedin campaign(s) ===`);

  for (const c of campaigns) {
    if (!c.targetListId) continue;
    const result = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count
      FROM "TargetListPerson" tlp
      JOIN "Lead" l ON l.id = tlp."personId"
      WHERE tlp."listId" = ${c.targetListId}
        AND l."linkedinUrl" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM "LinkedInAction" la
          WHERE la."personId" = tlp."personId"
            AND la."workspaceSlug" = ${slug}
            AND la."actionType" IN ('profile_view', 'connect', 'connection_request')
            AND (
              (la."actionType" IN ('connect', 'connection_request')
                 AND la."createdAt" > NOW() - INTERVAL '21 days')
              OR (la."actionType" = 'profile_view'
                  AND la."campaignName" = ${c.name}
                  AND la."status" NOT IN ('cancelled', 'expired'))
            )
        )
    `;
    const unstarted = Number(result[0].count);
    console.log(`  ${c.name}: unstarted=${unstarted}`);
  }
}

async function main() {
  await checkWorkspace("blanktag");
  await checkWorkspace("lime-recruitment");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
