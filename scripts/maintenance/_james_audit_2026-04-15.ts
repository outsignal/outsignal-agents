import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Find James's sender(s) — BlankTag workspace
  const senders = await prisma.sender.findMany({
    where: {
      OR: [
        { name: { contains: 'James', mode: 'insensitive' } },
        { emailAddress: { contains: 'james', mode: 'insensitive' } },
        { linkedinEmail: { contains: 'james', mode: 'insensitive' } },
      ],
      workspaceSlug: 'blanktag',
    },
  });
  console.log('SENDERS:', senders.length);
  for (const s of senders) {
    console.log(`  id=${s.id} name="${s.name}" emailAddr=${s.emailAddress} liEmail=${s.linkedinEmail} liProfile=${s.linkedinProfileUrl} tier=${s.linkedinTier} sessionStatus=${s.sessionStatus}`);
  }

  const james =
    senders.find(s => /bessey|saldanha/i.test(s.name || '')) ||
    senders.find(s => s.linkedinProfileUrl) ||
    senders[0];
  if (!james) { console.log('NO JAMES FOUND'); return; }
  console.log('\nUSING SENDER:', james.id, james.name);

  // Today date (UTC) — DailyUsage.date is @db.Date so midnight UTC
  const now = new Date();
  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const tomorrowUTC = new Date(todayUTC);
  tomorrowUTC.setUTCDate(tomorrowUTC.getUTCDate() + 1);
  console.log('CURRENT TIME UTC:', now.toISOString(), '| todayUTC boundary:', todayUTC.toISOString());

  const usage = await prisma.linkedInDailyUsage.findFirst({
    where: { senderId: james.id, date: todayUTC },
  });
  console.log('\nDAILY USAGE (today UTC):', JSON.stringify(usage, null, 2));

  const completedActions = await prisma.linkedInAction.findMany({
    where: {
      senderId: james.id,
      status: 'complete',
      completedAt: { gte: todayUTC, lt: tomorrowUTC },
    },
    orderBy: { completedAt: 'asc' },
  });
  console.log(`\nCOMPLETED today: ${completedActions.length}`);
  for (const a of completedActions) {
    const delta = a.completedAt && a.scheduledFor
      ? Math.round((a.completedAt.getTime() - a.scheduledFor.getTime()) / 60000)
      : null;
    console.log(`  ${a.id} | ${a.actionType} | person=${a.personId} | sched=${a.scheduledFor?.toISOString()} | done=${a.completedAt?.toISOString()} | delta=${delta}min | attempts=${a.attempts} | pri=${a.priority}`);
  }

  const byType: Record<string, number> = {};
  for (const a of completedActions) byType[a.actionType] = (byType[a.actionType] || 0) + 1;
  console.log('\nBY TYPE (completed today):', byType);

  const activeActions = await prisma.linkedInAction.findMany({
    where: { senderId: james.id, status: { in: ['pending', 'running'] } },
    orderBy: { scheduledFor: 'asc' },
  });
  console.log(`\nACTIVE (pending/running): ${activeActions.length}`);
  for (const a of activeActions) {
    console.log(`  ${a.id} | ${a.status} | ${a.actionType} | person=${a.personId} | sched=${a.scheduledFor?.toISOString()} | attempts=${a.attempts} | pri=${a.priority}`);
  }

  const cancelledToday = await prisma.linkedInAction.findMany({
    where: {
      senderId: james.id,
      status: 'cancelled',
      updatedAt: { gte: todayUTC },
    },
    orderBy: { updatedAt: 'asc' },
  });
  console.log(`\nCANCELLED (updated today): ${cancelledToday.length}`);
  for (const a of cancelledToday) {
    console.log(`  ${a.id} | ${a.actionType} | sched=${a.scheduledFor?.toISOString()} | cancelledAt=${a.updatedAt.toISOString()} | result=${(a.result || '').slice(0,120)}`);
  }

  // Any failed today
  const failedToday = await prisma.linkedInAction.findMany({
    where: {
      senderId: james.id,
      status: 'failed',
      updatedAt: { gte: todayUTC },
    },
    orderBy: { updatedAt: 'asc' },
  });
  console.log(`\nFAILED (updated today): ${failedToday.length}`);
  for (const a of failedToday) {
    console.log(`  ${a.id} | ${a.actionType} | sched=${a.scheduledFor?.toISOString()} | updated=${a.updatedAt.toISOString()} | result=${(a.result || '').slice(0,120)}`);
  }

  // All actions created today for james
  const createdToday = await prisma.linkedInAction.count({
    where: { senderId: james.id, createdAt: { gte: todayUTC } },
  });
  console.log(`\nACTIONS CREATED today (any status): ${createdToday}`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
