import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // 1. All pending connect/connection_request across the two affected workspaces.
  const pending = await prisma.linkedInAction.findMany({
    where: {
      workspaceSlug: { in: ["blanktag", "lime-recruitment"] },
      actionType: { in: ["connect", "connection_request"] },
      status: "pending",
    },
    select: {
      id: true,
      workspaceSlug: true,
      senderId: true,
      personId: true,
      actionType: true,
      scheduledFor: true,
      createdAt: true,
    },
    orderBy: { scheduledFor: "asc" },
  });

  const byWs = new Map<string, number>();
  for (const p of pending) byWs.set(p.workspaceSlug, (byWs.get(p.workspaceSlug) ?? 0) + 1);
  console.log("All pending connect/connection_request:");
  console.log(Object.fromEntries(byWs));
  console.log(`Total pending: ${pending.length}`);

  // 2. Rows created today or yesterday (the planner re-queue).
  const recentlyCreated = pending.filter(
    (p) => p.createdAt > new Date(Date.now() - 48 * 60 * 60 * 1000),
  );
  console.log(`Pending created in last 48h: ${recentlyCreated.length}`);

  // 3. All non-pending connect/connection_request state from the last 24h for
  //    these workspaces — tells us if worker has been executing.
  const recent = await prisma.linkedInAction.findMany({
    where: {
      workspaceSlug: { in: ["blanktag", "lime-recruitment"] },
      actionType: { in: ["connect", "connection_request"] },
      createdAt: { gt: new Date(Date.now() - 48 * 60 * 60 * 1000) },
    },
    select: {
      id: true,
      workspaceSlug: true,
      status: true,
      scheduledFor: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const byStatus = new Map<string, number>();
  for (const r of recent)
    byStatus.set(
      `${r.workspaceSlug}/${r.status}`,
      (byStatus.get(`${r.workspaceSlug}/${r.status}`) ?? 0) + 1,
    );
  console.log("Status breakdown of last-48h connect/connection_request rows:");
  console.log(Object.fromEntries(byStatus));

  // 4. For every pending row, does it have ANY prior connect/connection_request
  //    at all (no time cutoff)? This shows whether zero-sibling rows exist
  //    (fresh invites) vs all are re-invites.
  const pendingIds = pending.map((p) => p.id);
  if (pendingIds.length === 0) return;

  const priorCounts = await prisma.$queryRaw<
    Array<{ targetId: string; priorCount: bigint }>
  >`
    SELECT target.id AS "targetId",
           (SELECT COUNT(*)
            FROM "LinkedInAction" prior
            WHERE prior."personId" = target."personId"
              AND prior."actionType" IN ('connect', 'connection_request')
              AND prior.id <> target.id) AS "priorCount"
    FROM "LinkedInAction" target
    WHERE target.id = ANY(${pendingIds}::text[])
  `;

  const zeroPrior = priorCounts.filter((p) => Number(p.priorCount) === 0);
  const hasPrior = priorCounts.filter((p) => Number(p.priorCount) > 0);
  console.log(
    `Pending rows with NO prior connect history: ${zeroPrior.length} (fresh invites — do NOT cancel)`,
  );
  console.log(
    `Pending rows WITH prior connect history: ${hasPrior.length} (re-invites — candidates)`,
  );

  if (hasPrior.length > 0) {
    // What's the oldest prior for each?
    const allPriors = await prisma.$queryRaw<
      Array<{
        targetId: string;
        oldestPrior: Date;
        newestPrior: Date;
      }>
    >`
      SELECT target.id AS "targetId",
             MIN(prior."createdAt") AS "oldestPrior",
             MAX(prior."createdAt") AS "newestPrior"
      FROM "LinkedInAction" target
      JOIN "LinkedInAction" prior ON prior."personId" = target."personId"
        AND prior."actionType" IN ('connect', 'connection_request')
        AND prior.id <> target.id
      WHERE target.id = ANY(${hasPrior.map((p) => p.targetId)}::text[])
      GROUP BY target.id
    `;
    const now = Date.now();
    const within21d = allPriors.filter(
      (a) => (now - a.newestPrior.getTime()) / (1000 * 60 * 60 * 24) <= 21,
    );
    const outside21d = allPriors.filter(
      (a) => (now - a.newestPrior.getTime()) / (1000 * 60 * 60 * 24) > 21,
    );
    console.log(
      `Of those with prior: ${within21d.length} have most-recent-prior within 21d (backfill targets)`,
    );
    console.log(
      `Of those with prior: ${outside21d.length} have most-recent-prior OUTSIDE 21d (should NOT be cancelled by backfill)`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
