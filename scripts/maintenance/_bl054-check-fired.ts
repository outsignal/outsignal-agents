import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const fired = await prisma.linkedInAction.findMany({
    where: {
      workspaceSlug: "blanktag",
      actionType: { in: ["connect", "connection_request"] },
      status: { in: ["complete", "running", "failed"] },
      createdAt: { gt: new Date(Date.now() - 48 * 60 * 60 * 1000) },
    },
    select: {
      id: true,
      personId: true,
      status: true,
      scheduledFor: true,
      completedAt: true,
      lastAttemptAt: true,
      result: true,
    },
    orderBy: { scheduledFor: "asc" },
  });
  console.log(`Fired James rows (blanktag) in last 48h: ${fired.length}`);
  for (const f of fired) {
    console.log(
      JSON.stringify(
        {
          id: f.id,
          personId: f.personId,
          status: f.status,
          scheduledFor: f.scheduledFor?.toISOString(),
          completedAt: f.completedAt?.toISOString(),
          lastAttemptAt: f.lastAttemptAt?.toISOString(),
          result: f.result?.slice(0, 500),
        },
        null,
        2,
      ),
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
