/**
 * Bootstrap pending connection counts.
 *
 * One-time migration script to initialize Sender.pendingConnectionCount
 * by counting LinkedInConnection records with status="pending" for each
 * active sender.
 *
 * Usage: npx tsx scripts/bootstrap-pending-counts.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const senders = await prisma.sender.findMany({
    where: { status: "active" },
    select: { id: true, name: true, workspaceSlug: true, pendingConnectionCount: true },
  });

  console.log(`Found ${senders.length} active senders`);

  let updated = 0;

  for (const sender of senders) {
    const count = await prisma.linkedInConnection.count({
      where: {
        senderId: sender.id,
        status: "pending",
      },
    });

    await prisma.sender.update({
      where: { id: sender.id },
      data: {
        pendingConnectionCount: count,
        pendingCountUpdatedAt: new Date(),
      },
    });

    console.log(
      `[${sender.workspaceSlug}] ${sender.name}: ${sender.pendingConnectionCount} -> ${count} pending connections`,
    );
    updated++;
  }

  console.log(`\nDone. Updated ${updated} senders.`);
}

main()
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
