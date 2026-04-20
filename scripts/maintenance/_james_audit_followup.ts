import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const senderId = 'cmmw8mq1q0003p8pyb2snqgys';
  const now = new Date();
  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  console.log('now:', now.toISOString());

  // ALL actions touched today (created, scheduled for today, updated today, completed today)
  const all = await prisma.linkedInAction.findMany({
    where: {
      senderId,
      OR: [
        { completedAt: { gte: todayUTC } },
        { scheduledFor: { gte: todayUTC } },
        { updatedAt: { gte: todayUTC } },
        { createdAt: { gte: todayUTC } },
      ],
    },
    orderBy: [{ scheduledFor: 'asc' }],
  });
  console.log(`\nALL actions touched today: ${all.length}`);
  console.log('id | status | actionType | sched | updated | completed | attempts | createdAt');
  for (const a of all) {
    console.log(`  ${a.id} | ${a.status} | ${a.actionType} | sched=${a.scheduledFor?.toISOString()} | upd=${a.updatedAt.toISOString()} | done=${a.completedAt?.toISOString() || 'null'} | att=${a.attempts} | created=${a.createdAt.toISOString()}`);
  }

  // DailyUsage again — check for changes in the last few min
  const usage = await prisma.linkedInDailyUsage.findFirst({ where: { senderId, date: todayUTC } });
  console.log('\nDAILY USAGE right now:', JSON.stringify(usage, null, 2));

  // Check what the planner scheduled — look at creates in 07:18 window
  const plannerCreates = await prisma.linkedInAction.findMany({
    where: {
      senderId,
      createdAt: { gte: new Date(Date.UTC(2026,3,15,7,15,0)), lte: new Date(Date.UTC(2026,3,15,7,25,0)) },
    },
    orderBy: { scheduledFor: 'asc' },
  });
  console.log(`\nActions created in 07:15-07:25 UTC window (planner run): ${plannerCreates.length}`);
  for (const a of plannerCreates) {
    console.log(`  ${a.id} | ${a.actionType} | status=${a.status} | sched=${a.scheduledFor?.toISOString()} | completed=${a.completedAt?.toISOString() || 'null'} | updated=${a.updatedAt.toISOString()}`);
  }

  // Other create windows — what about 08:18 (batch we saw)?
  const late = await prisma.linkedInAction.findMany({
    where: {
      senderId,
      createdAt: { gte: new Date(Date.UTC(2026,3,15,8,0,0)), lte: new Date(Date.UTC(2026,3,15,8,45,0)) },
    },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`\nActions created 08:00-08:45 UTC (post-backfill): ${late.length}`);
  for (const a of late) {
    console.log(`  ${a.id} | ${a.actionType} | status=${a.status} | sched=${a.scheduledFor?.toISOString()} | created=${a.createdAt.toISOString()} | completed=${a.completedAt?.toISOString() || 'null'}`);
  }

  // Today's LinkedInConnection rows updated today — ground-truth connection sends
  const connectionsUpdated = await prisma.linkedInConnection.findMany({
    where: { senderId, updatedAt: { gte: todayUTC } },
    orderBy: { updatedAt: 'asc' },
  });
  console.log(`\nLinkedInConnection rows updated today: ${connectionsUpdated.length}`);
  for (const c of connectionsUpdated) {
    console.log(`  id=${c.id} | personId=${c.personId} | status=${c.status} | requestSentAt=${c.requestSentAt?.toISOString()} | updated=${c.updatedAt.toISOString()}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
