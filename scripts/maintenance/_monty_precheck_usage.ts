import { prisma } from "@/lib/db";

async function main() {
  const since = new Date("2026-04-14T14:47:00Z");
  const now = new Date();

  // Daily usage today (2026-04-15 UTC)
  const todayStart = new Date("2026-04-15T00:00:00Z");

  const usage = await (prisma as any).linkedInDailyUsage.findMany({
    where: { date: { gte: todayStart } },
    orderBy: { senderId: "asc" }
  }).catch(() => null);
  if (usage) {
    console.log("== LinkedInDailyUsage today ==");
    for (const u of usage) console.log(JSON.stringify(u));
  } else console.log("(no LinkedInDailyUsage model found)");

  // Failed actions since fix
  const failed = await (prisma as any).linkedInAction.groupBy({
    by: ["status", "type"],
    where: { updatedAt: { gte: since } },
    _count: true
  }).catch(() => null);
  console.log("\n== LinkedInAction status × type since 14:47 UTC 2026-04-14 ==");
  if (failed) for (const r of failed) console.log(JSON.stringify(r));

  // Stuck running
  const stuckRunning = await (prisma as any).linkedInAction.count({
    where: {
      status: "running",
      updatedAt: { lt: new Date(now.getTime() - 30 * 60 * 1000) }
    }
  }).catch(() => null);
  console.log(`\nStuck-running actions (>30min): ${stuckRunning}`);

  // Recent failures — look at failure reasons
  const recentFails = await (prisma as any).linkedInAction.findMany({
    where: { status: "failed", updatedAt: { gte: since } },
    select: { id: true, type: true, senderId: true, result: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
    take: 10
  }).catch(() => []);
  console.log(`\nRecent failures sample (${recentFails.length}):`);
  for (const f of recentFails) console.log(JSON.stringify(f));
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
