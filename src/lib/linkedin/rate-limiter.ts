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

/** Per-account warmup schedule jitter — tier boundaries shift ± this many days */
const TIER_BOUNDARY_JITTER_DAYS = 2;

/** Per-account warmup schedule jitter — base limits vary ± this fraction */
const BASE_LIMIT_JITTER_FRACTION = 0.15;

/**
 * Warm-up schedule: maps warmup day ranges to daily connection limits.
 * Messages and profile views scale proportionally.
 * These are the base values — actual per-account values are jittered by getAccountWarmupSchedule.
 */
const WARMUP_SCHEDULE: Array<{ maxDay: number; connections: number; messages: number; profileViews: number }> = [
  { maxDay: 7, connections: 5, messages: 5, profileViews: 10 },
  { maxDay: 14, connections: 8, messages: 10, profileViews: 20 },
  { maxDay: 21, connections: 12, messages: 20, profileViews: 30 },
  { maxDay: Infinity, connections: 20, messages: 30, profileViews: 50 },
];

/**
 * Deterministic hash of a string, returning a signed 32-bit integer.
 */
function deterministicHash(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return hash;
}

/**
 * Get a per-account warmup schedule with jittered tier boundaries and base limits.
 * Uses a deterministic hash of the senderId so results are stable for each account.
 */
export function getAccountWarmupSchedule(
  senderId: string,
): Array<{ maxDay: number; connections: number; messages: number; profileViews: number }> {
  return WARMUP_SCHEDULE.map((tier, index) => {
    // Jitter tier boundary (skip the final Infinity tier)
    let maxDay = tier.maxDay;
    if (maxDay !== Infinity) {
      const boundaryHash = deterministicHash(`${senderId}:boundary:${index}`);
      // Map hash to [-TIER_BOUNDARY_JITTER_DAYS, +TIER_BOUNDARY_JITTER_DAYS]
      const jitterDays = (boundaryHash % (TIER_BOUNDARY_JITTER_DAYS * 2 + 1));
      maxDay = Math.max(maxDay + jitterDays, (index === 0 ? 3 : WARMUP_SCHEDULE[index - 1].maxDay + 2));
    }

    // Jitter base limits ±15%
    const limitHash = deterministicHash(`${senderId}:limits:${index}`);
    const limitFactor = 1 + ((limitHash % 1000) / 1000) * BASE_LIMIT_JITTER_FRACTION * 2 - BASE_LIMIT_JITTER_FRACTION;

    return {
      maxDay,
      connections: Math.max(1, Math.round(tier.connections * limitFactor)),
      messages: Math.max(1, Math.round(tier.messages * limitFactor)),
      profileViews: Math.max(1, Math.round(tier.profileViews * limitFactor)),
    };
  });
}

/**
 * Get the warm-up limits for a given day.
 * When senderId is provided, uses a per-account jittered schedule to avoid
 * identical ramp patterns across accounts.
 */
export function getWarmupLimits(warmupDay: number, senderId?: string): WarmupLimits {
  if (warmupDay <= 0) {
    return { connections: 5, messages: 10, profileViews: 15 };
  }

  const schedule = senderId ? getAccountWarmupSchedule(senderId) : WARMUP_SCHEDULE;
  const tier = schedule.find((t) => warmupDay <= t.maxDay)!;
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
  const today = todayUTC().toISOString().slice(0, 10);
  const hash = deterministicHash(`${senderId}:${today}`);
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

  // Idempotency: only advance once per calendar day.
  // warmupDay should equal (days since warmupStartedAt) + 1
  if (sender.warmupStartedAt) {
    const daysSinceStart = Math.floor(
      (Date.now() - sender.warmupStartedAt.getTime()) / (24 * 60 * 60 * 1000)
    );
    const expectedDay = daysSinceStart + 1;
    if (sender.warmupDay >= expectedDay) return;
  }

  // Don't increase if acceptance rate is below 20%
  if (sender.acceptanceRate !== null && sender.acceptanceRate < 0.2) {
    return;
  }

  const newDay = sender.warmupDay + 1;
  const limits = getWarmupLimits(newDay, senderId);

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
