import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';

const prisma = new PrismaClient();

function deterministicHash(input: string): number {
  const hash = createHash('sha256').update(input).digest();
  return hash.readUInt32BE(0);
}

function todayUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function applyJitter(baseLimit: number, senderId: string): number {
  const today = todayUTC().toISOString().slice(0, 10);
  const hash = deterministicHash(`${senderId}:${today}`);
  const factor = ((hash % 1000) / 1000) * 0.2;
  return Math.max(1, Math.round(baseLimit * (1 + factor)));
}

async function main() {
  const senderId = 'cmmw8mq1q0003p8pyb2snqgys';
  const sender = await prisma.sender.findUniqueOrThrow({ where: { id: senderId } });
  console.log('dailyConnectionLimit (base):', sender.dailyConnectionLimit);
  console.log('dailyMessageLimit (base):', sender.dailyMessageLimit);
  console.log('dailyProfileViewLimit (base):', sender.dailyProfileViewLimit);
  console.log('pendingConnectionCount:', sender.pendingConnectionCount);
  console.log('acceptanceRate:', sender.acceptanceRate);
  console.log('warmupStartDate:', sender.warmupStartDate);
  console.log('linkedinTier:', sender.linkedinTier);

  const today = todayUTC().toISOString().slice(0,10);
  console.log('\ntoday:', today);
  console.log('jittered connection limit today:', applyJitter(sender.dailyConnectionLimit, senderId));
  console.log('jittered message limit today:', applyJitter(sender.dailyMessageLimit, senderId));
  console.log('jittered profile_view limit today:', applyJitter(sender.dailyProfileViewLimit, senderId));
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
