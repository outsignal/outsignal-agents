/**
 * Account-level rate limiter for LinkedIn actions.
 *
 * Enforces daily limits per sender, tracks usage via LinkedInDailyUsage,
 * handles warm-up progression, and reserves budget for priority 1 actions.
 */
import { prisma } from "@/lib/db";
import type { BudgetCheckResult, LinkedInActionType, WarmupLimits } from "./types";
import { ACTION_TYPE_TO_LIMIT_FIELD, ACTION_TYPE_TO_USAGE_FIELD } from "./types";

/** Priority 1 budget reservation — hold back this fraction of daily connections for warm leads */
const PRIORITY_RESERVE_FRACTION = 0.2;

/** Daily volume randomisation — actual limit = base ± this fraction */
const VOLUME_JITTER_FRACTION = 0.2;

/**
 * Warm-up schedule: maps warmup day ranges to daily connection limits.
 * Messages and profile views scale proportionally.
 */
const WARMUP_SCHEDULE: Array<{ maxDay: number; connections: number; messages: number; profileViews: number }> = [
  { maxDay: 7, connections: 5, messages: 10, profileViews: 15 },
  { maxDay: 14, connections: 8, messages: 15, profileViews: 25 },
  { maxDay: 21, connections: 12, messages: 25, profileViews: 40 },
  { maxDay: Infinity, connections: 15, messages: 30, profileViews: 50 },
];

/**
 * Get the warm-up limits for a given day.
 */
export function getWarmupLimits(warmupDay: number): WarmupLimits {
  if (warmupDay <= 0) {
    return { connections: 5, messages: 10, profileViews: 15 };
  }
  const tier = WARMUP_SCHEDULE.find((t) => warmupDay <= t.maxDay)!;
  return {
    connections: tier.connections,
    messages: tier.messages,
    profileViews: tier.profileViews,
  };
}

/**
 * Get today's date as a Date object truncated to midnight UTC.
 */
function todayUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Apply daily volume jitter to a limit. Returns a value within ±20% of the base.
 * Uses a deterministic seed (senderId + date) so the same sender gets the same
 * jittered limit within a single day.
 */
function applyJitter(baseLimit: number, senderId: string): number {
  // Simple deterministic hash from senderId + today's date
  const today = todayUTC().toISOString().slice(0, 10);
  const seed = `${senderId}:${today}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  // Normalise to [-1, 1] range
  const factor = ((hash % 1000) / 1000) * VOLUME_JITTER_FRACTION;
  return Math.max(1, Math.round(baseLimit * (1 + factor)));
}

/**
 * Get or create today's usage record for a sender.
 */
async function getOrCreateDailyUsage(senderId: string) {
  const today = todayUTC();

  const existing = await prisma.linkedInDailyUsage.findUnique({
    where: { senderId_date: { senderId, date: today } },
  });

  if (existing) return existing;

  return prisma.linkedInDailyUsage.create({
    data: { senderId, date: today },
  });
}

/**
 * Check if a sender has budget remaining for a given action type.
 * Accounts for priority reservation on connection budget.
 */
export async function checkBudget(
  senderId: string,
  actionType: LinkedInActionType,
  priority: number = 5,
): Promise<BudgetCheckResult> {
  const sender = await prisma.sender.findUnique({ where: { id: senderId } });
  if (!sender) {
    return { allowed: false, remaining: 0, reason: "Sender not found" };
  }

  if (sender.status !== "active") {
    return { allowed: false, remaining: 0, reason: `Sender is ${sender.status}` };
  }

  if (sender.healthStatus !== "healthy") {
    return { allowed: false, remaining: 0, reason: `Account health: ${sender.healthStatus}` };
  }

  const usage = await getOrCreateDailyUsage(senderId);

  const limitField = ACTION_TYPE_TO_LIMIT_FIELD[actionType];
  const usageField = ACTION_TYPE_TO_USAGE_FIELD[actionType];

  if (!limitField || !usageField) {
    return { allowed: false, remaining: 0, reason: `Unknown action type: ${actionType}` };
  }

  const baseLimit = (sender as Record<string, unknown>)[limitField] as number;
  const jitteredLimit = applyJitter(baseLimit, senderId);
  const used = (usage as Record<string, unknown>)[usageField] as number;

  let effectiveLimit = jitteredLimit;

  // For connections, reserve a portion for priority 1 actions
  if (actionType === "connect" && priority > 1) {
    const reserved = Math.ceil(jitteredLimit * PRIORITY_RESERVE_FRACTION);
    effectiveLimit = jitteredLimit - reserved;
  }

  const remaining = Math.max(0, effectiveLimit - used);

  if (remaining <= 0) {
    return {
      allowed: false,
      remaining: 0,
      reason: `Daily ${actionType} limit reached (${used}/${effectiveLimit})`,
    };
  }

  return { allowed: true, remaining };
}

/**
 * Consume one unit of budget for a sender's action type.
 * Call this AFTER successfully executing the action.
 */
export async function consumeBudget(
  senderId: string,
  actionType: LinkedInActionType,
): Promise<void> {
  const today = todayUTC();
  const usageField = ACTION_TYPE_TO_USAGE_FIELD[actionType];

  if (!usageField) return;

  await prisma.linkedInDailyUsage.upsert({
    where: { senderId_date: { senderId, date: today } },
    create: {
      senderId,
      date: today,
      [usageField]: 1,
    },
    update: {
      [usageField]: { increment: 1 },
    },
  });
}

/**
 * Get the full budget status for a sender (all action types).
 */
export async function getSenderBudget(senderId: string) {
  const sender = await prisma.sender.findUnique({ where: { id: senderId } });
  if (!sender) return null;

  const usage = await getOrCreateDailyUsage(senderId);

  return {
    connections: {
      sent: usage.connectionsSent,
      limit: applyJitter(sender.dailyConnectionLimit, senderId),
      remaining: Math.max(0, applyJitter(sender.dailyConnectionLimit, senderId) - usage.connectionsSent),
    },
    messages: {
      sent: usage.messagesSent,
      limit: applyJitter(sender.dailyMessageLimit, senderId),
      remaining: Math.max(0, applyJitter(sender.dailyMessageLimit, senderId) - usage.messagesSent),
    },
    profileViews: {
      sent: usage.profileViews,
      limit: applyJitter(sender.dailyProfileViewLimit, senderId),
      remaining: Math.max(0, applyJitter(sender.dailyProfileViewLimit, senderId) - usage.profileViews),
    },
  };
}

/**
 * Progress warm-up for a sender. Call daily.
 * Increments warmupDay, updates daily limits based on the schedule,
 * but only if acceptance rate isn't declining.
 */
export async function progressWarmup(senderId: string): Promise<void> {
  const sender = await prisma.sender.findUnique({ where: { id: senderId } });
  if (!sender || sender.warmupDay <= 0) return;

  // Don't increase if acceptance rate is below 20%
  if (sender.acceptanceRate !== null && sender.acceptanceRate < 0.2) {
    return;
  }

  const newDay = sender.warmupDay + 1;
  const limits = getWarmupLimits(newDay);

  await prisma.sender.update({
    where: { id: senderId },
    data: {
      warmupDay: newDay,
      dailyConnectionLimit: limits.connections,
      dailyMessageLimit: limits.messages,
      dailyProfileViewLimit: limits.profileViews,
    },
  });
}
