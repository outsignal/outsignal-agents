/**
 * Account-level rate limiter for LinkedIn actions.
 *
 * Enforces daily limits per sender, tracks usage via LinkedInDailyUsage,
 * handles warm-up progression, and reserves budget for priority 1 actions.
 */
import { prisma } from "@/lib/db";
import type { BudgetCheckResult, CircuitBreakerResult, LinkedInActionType, WarmupLimits } from "./types";
import { ACTION_TYPE_TO_LIMIT_FIELD, ACTION_TYPE_TO_USAGE_FIELD } from "./types";

/**
 * Action types that share a daily budget bucket. checkBudget counts
 * running actions across every type in the bucket so a mid-flight connect
 * consumes the same limit as a mid-flight connection_request.
 */
const BUDGET_BUCKETS: Record<string, LinkedInActionType[]> = {
  connect: ["connect", "connection_request"],
  connection_request: ["connect", "connection_request"],
  message: ["message"],
  profile_view: ["profile_view", "check_connection"],
  check_connection: ["profile_view", "check_connection"],
};

/** Circuit breaker threshold — trip after this many consecutive failures */
const CIRCUIT_BREAKER_THRESHOLD = 5;

/** Maximum P1 connection actions per sender per day before falling through to normal budget */
const P1_DAILY_CAP = 5;

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
 * P1 connection actions bypass the daily budget entirely (capped at P1_DAILY_CAP per sender per day).
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

  // Withdrawals are unlimited — always allowed (no daily budget gate)
  if (actionType === "withdraw_connection") {
    return { allowed: true, remaining: Infinity };
  }

  // Gate 3: Pending connection count gate (connect/connection_request only)
  if (actionType === "connect" || actionType === "connection_request") {
    const pendingCount = sender.pendingConnectionCount ?? 0;
    if (pendingCount >= 2500) {
      console.log(`[rate-limiter] Sender ${senderId}: pending count gate BLOCKING (${pendingCount} pending connections)`);
      return { allowed: false, remaining: 0, reason: "Pending connection cap (2500+)" };
    }
  }

  // Pre-fetch total sent count for acceptance rate gates (used by Gate 4 and budget reduction)
  // Hoisted to avoid duplicate queries.
  let totalSentConnections: number | null = null;
  if (
    (actionType === "connect" || actionType === "connection_request") &&
    sender.acceptanceRate !== null
  ) {
    totalSentConnections = await prisma.linkedInConnection.count({
      where: { senderId, status: { not: "none" } },
    });
  }

  // Gate 4: Acceptance rate gate (connect/connection_request only, 50+ requests required)
  if (actionType === "connect" || actionType === "connection_request") {
    if (sender.acceptanceRate !== null && sender.acceptanceRate < 0.10) {
      if (totalSentConnections !== null && totalSentConnections >= 50) {
        console.log(`[rate-limiter] Sender ${senderId}: acceptance rate gate BLOCKING (${(sender.acceptanceRate * 100).toFixed(1)}% acceptance rate, ${totalSentConnections} total sent)`);
        return { allowed: false, remaining: 0, reason: `Acceptance rate too low (${(sender.acceptanceRate * 100).toFixed(1)}%)` };
      }
    }
  }

  // Gate 5: P1 connection actions bypass daily budget (capped at P1_DAILY_CAP/day)
  if (
    priority === 1 &&
    (actionType === "connect" || actionType === "connection_request")
  ) {
    const today = todayUTC();
    const p1CompletedToday = await prisma.linkedInAction.count({
      where: {
        senderId,
        priority: 1,
        status: "complete",
        completedAt: { gte: today },
      },
    });

    if (p1CompletedToday < P1_DAILY_CAP) {
      return { allowed: true, remaining: P1_DAILY_CAP - p1CompletedToday };
    }
    // P1 cap exceeded — fall through to normal budget check
  }

  // Gate 6: Daily budget check
  const usage = await getOrCreateDailyUsage(senderId);

  const limitField = ACTION_TYPE_TO_LIMIT_FIELD[actionType];
  const usageField = ACTION_TYPE_TO_USAGE_FIELD[actionType];

  if (!limitField || !usageField) {
    return { allowed: false, remaining: 0, reason: `Unknown action type: ${actionType}` };
  }

  const baseLimit = (sender as Record<string, unknown>)[limitField] as number;
  let effectiveLimit = applyJitter(baseLimit, senderId);

  // Apply pending count budget reduction (connect/connection_request only)
  if (actionType === "connect" || actionType === "connection_request") {
    const pendingCount = sender.pendingConnectionCount ?? 0;
    if (pendingCount >= 2000) {
      const before = effectiveLimit;
      effectiveLimit = Math.min(effectiveLimit, 3);
      console.log(`[rate-limiter] Sender ${senderId}: pending count gate reducing budget from ${before} to ${effectiveLimit} (${pendingCount} pending connections)`);
    } else if (pendingCount >= 1500) {
      const before = effectiveLimit;
      effectiveLimit = Math.floor(effectiveLimit / 2);
      console.log(`[rate-limiter] Sender ${senderId}: pending count gate reducing budget from ${before} to ${effectiveLimit} (${pendingCount} pending connections)`);
    }

    // Apply acceptance rate budget reduction (15-25% warning only logged, 10-15% reduces by 30%)
    if (sender.acceptanceRate !== null && totalSentConnections !== null && totalSentConnections >= 50) {
      if (sender.acceptanceRate >= 0.10 && sender.acceptanceRate < 0.15) {
        const before = effectiveLimit;
        effectiveLimit = Math.floor(effectiveLimit * 0.7);
        console.log(`[rate-limiter] Sender ${senderId}: acceptance rate gate reducing budget from ${before} to ${effectiveLimit} (${(sender.acceptanceRate * 100).toFixed(1)}% acceptance rate)`);
      } else if (sender.acceptanceRate >= 0.15 && sender.acceptanceRate < 0.25) {
        console.log(`[rate-limiter] Sender ${senderId}: acceptance rate warning — ${(sender.acceptanceRate * 100).toFixed(1)}% (between 15-25%)`);
      }
    }
  }

  const used = ((usage as Record<string, unknown>)[usageField] as number) ?? 0;

  // Belt-and-braces: count running actions across the shared budget bucket
  // as already-consumed. This protects against cross-poll races where a
  // batch has been picked up (markRunning) but not yet completed, so the
  // daily usage counter hasn't been incremented yet. Without this, a second
  // poll tick could approve actions the first tick is still executing.
  const typesForLimit = BUDGET_BUCKETS[actionType] ?? [actionType];
  const runningCount =
    (await prisma.linkedInAction.count({
      where: {
        senderId,
        actionType: { in: typesForLimit },
        status: "running",
      },
    })) ?? 0;
  const effectiveUsage = used + runningCount;
  const remaining = Math.max(0, effectiveLimit - effectiveUsage);

  if (remaining <= 0) {
    return {
      allowed: false,
      remaining: 0,
      reason: `Daily ${actionType} limit reached (${effectiveUsage}/${effectiveLimit}${runningCount > 0 ? `, ${runningCount} running` : ""})`,
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

/**
 * Check the circuit breaker for a sender. Trips when the last
 * CIRCUIT_BREAKER_THRESHOLD actions all failed (within the last 24 hours).
 * This prevents systematic failures (session expired, IP blocked) from
 * burning through the entire daily budget.
 *
 * The circuit resets naturally when a successful action breaks the
 * consecutive failure streak.
 */
export async function checkCircuitBreaker(
  senderId: string,
): Promise<CircuitBreakerResult> {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const recentActions = await prisma.linkedInAction.findMany({
    where: {
      senderId,
      lastAttemptAt: { gte: twentyFourHoursAgo },
      status: { in: ["complete", "failed"] },
    },
    orderBy: { lastAttemptAt: "desc" },
    take: CIRCUIT_BREAKER_THRESHOLD,
    select: { status: true, result: true },
  });

  // Not enough recent actions to evaluate
  if (recentActions.length < CIRCUIT_BREAKER_THRESHOLD) {
    return { tripped: false, consecutiveFailures: recentActions.filter((a) => a.status === "failed").length };
  }

  const allFailed = recentActions.every((a) => a.status === "failed");

  if (allFailed) {
    // Extract the most recent error for context
    let lastError = "unknown";
    try {
      const parsed = JSON.parse(recentActions[0].result ?? "{}");
      lastError = parsed.error ?? "unknown";
    } catch {
      // ignore parse errors
    }

    return {
      tripped: true,
      reason: `Last ${CIRCUIT_BREAKER_THRESHOLD} actions all failed (last error: ${lastError})`,
      consecutiveFailures: CIRCUIT_BREAKER_THRESHOLD,
    };
  }

  const consecutiveFailures = recentActions.findIndex((a) => a.status !== "failed");
  return {
    tripped: false,
    consecutiveFailures: consecutiveFailures === -1 ? recentActions.length : consecutiveFailures,
  };
}
