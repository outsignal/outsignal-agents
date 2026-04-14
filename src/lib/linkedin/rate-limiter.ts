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
 *
 * Exported so filterByBudget can key its in-flight counter on the bucket
 * rather than the raw actionType — a batch containing BOTH "connect" and
 * "connection_request" would otherwise double-approve against a shared
 * daily limit (same bucket, different Map keys).
 */
export const BUDGET_BUCKETS: Record<string, LinkedInActionType[]> = {
  connect: ["connect", "connection_request"],
  connection_request: ["connect", "connection_request"],
  message: ["message"],
  profile_view: ["profile_view", "check_connection"],
  check_connection: ["profile_view", "check_connection"],
};

/**
 * Canonical bucket key for an actionType. Used by filterByBudget to key its
 * in-flight accumulator on the bucket (shared daily limit) rather than on
 * the raw actionType — otherwise a batch containing both `connect` and
 * `connection_request` would get separate Map slots but compete for the
 * same daily limit.
 */
export function bucketKeyFor(actionType: LinkedInActionType): string {
  // Pick the first type in the bucket as the canonical key so all members
  // of a shared bucket collapse to the same Map slot.
  for (const [, types] of Object.entries(BUDGET_BUCKETS)) {
    if (types.includes(actionType)) return types[0];
  }
  // Unknown types (defensive): fall back to the raw actionType.
  return actionType;
}

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
 * Minimum Sender fields needed by checkBudget. Callers that have already
 * loaded the sender row (e.g. getSenderBudget) can pass it in via the
 * optional `sender` argument to skip the PK lookup. Kept as a structural
 * type so we don't have to import the full Prisma Sender model here.
 */
type SenderForBudget = {
  id: string;
  status: string;
  healthStatus: string;
  dailyConnectionLimit: number;
  dailyMessageLimit: number;
  dailyProfileViewLimit: number;
  pendingConnectionCount: number | null;
  acceptanceRate: number | null;
};

/**
 * Return shape of getOrCreateDailyUsage. Callers that have already loaded
 * today's usage row (e.g. getSenderBudget) can thread it through checkBudget
 * via the optional `usage` argument to avoid duplicate findUnique queries.
 */
type DailyUsageForBudget = Awaited<ReturnType<typeof getOrCreateDailyUsage>>;

/**
 * Check if a sender has budget remaining for a given action type.
 * P1 connection actions bypass the daily budget entirely (capped at P1_DAILY_CAP per sender per day).
 *
 * Performance: callers that invoke this for multiple candidates within a
 * single tick (e.g. filterByBudget looping a batch of 10) can pass a
 * `runningCountCache` — a Map keyed by bucket name — so checkBudget skips
 * the running-count DB query and reads the pre-computed count instead.
 * Without the cache, each call would run its own linkedInAction.count
 * query (10 candidates × 3 action types = 30 queries per poll).
 *
 * Callers that have already fetched the sender row can also pass it via
 * `sender` to skip the internal findUnique. getSenderBudget uses this to
 * collapse 4 identical PK lookups (1 outer + 3 inner) into 1.
 *
 * Similarly, callers that have already fetched today's usage row can pass
 * it via `usage` to skip the internal getOrCreateDailyUsage call —
 * getSenderBudget uses this to collapse 4 identical usage lookups (1 outer
 * + 3 inner) into 1.
 */
export async function checkBudget(
  senderId: string,
  actionType: LinkedInActionType,
  priority: number = 5,
  runningCountCache?: Map<string, number>,
  sender?: SenderForBudget,
  usage?: DailyUsageForBudget,
): Promise<BudgetCheckResult> {
  const resolvedSender =
    sender ??
    ((await prisma.sender.findUnique({ where: { id: senderId } })) as SenderForBudget | null);
  if (!resolvedSender) {
    return { allowed: false, remaining: 0, reason: "Sender not found" };
  }

  if (resolvedSender.status !== "active") {
    return { allowed: false, remaining: 0, reason: `Sender is ${resolvedSender.status}` };
  }

  if (resolvedSender.healthStatus !== "healthy") {
    return { allowed: false, remaining: 0, reason: `Account health: ${resolvedSender.healthStatus}` };
  }

  // Withdrawals are unlimited — always allowed (no daily budget gate)
  if (actionType === "withdraw_connection") {
    return { allowed: true, remaining: Infinity };
  }

  // Gate 3: Pending connection count gate (connect/connection_request only)
  if (actionType === "connect" || actionType === "connection_request") {
    const pendingCount = resolvedSender.pendingConnectionCount ?? 0;
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
    resolvedSender.acceptanceRate !== null
  ) {
    totalSentConnections = await prisma.linkedInConnection.count({
      where: { senderId, status: { not: "none" } },
    });
  }

  // Gate 4: Acceptance rate gate (connect/connection_request only, 50+ requests required)
  if (actionType === "connect" || actionType === "connection_request") {
    if (resolvedSender.acceptanceRate !== null && resolvedSender.acceptanceRate < 0.10) {
      if (totalSentConnections !== null && totalSentConnections >= 50) {
        console.log(`[rate-limiter] Sender ${senderId}: acceptance rate gate BLOCKING (${(resolvedSender.acceptanceRate * 100).toFixed(1)}% acceptance rate, ${totalSentConnections} total sent)`);
        return { allowed: false, remaining: 0, reason: `Acceptance rate too low (${(resolvedSender.acceptanceRate * 100).toFixed(1)}%)` };
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
  const resolvedUsage = usage ?? (await getOrCreateDailyUsage(senderId));

  const limitField = ACTION_TYPE_TO_LIMIT_FIELD[actionType];
  const usageField = ACTION_TYPE_TO_USAGE_FIELD[actionType];

  if (!limitField || !usageField) {
    return { allowed: false, remaining: 0, reason: `Unknown action type: ${actionType}` };
  }

  const baseLimit = (resolvedSender as unknown as Record<string, unknown>)[limitField] as number;
  let effectiveLimit = applyJitter(baseLimit, senderId);

  // Apply pending count budget reduction (connect/connection_request only)
  if (actionType === "connect" || actionType === "connection_request") {
    const pendingCount = resolvedSender.pendingConnectionCount ?? 0;
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
    if (resolvedSender.acceptanceRate !== null && totalSentConnections !== null && totalSentConnections >= 50) {
      if (resolvedSender.acceptanceRate >= 0.10 && resolvedSender.acceptanceRate < 0.15) {
        const before = effectiveLimit;
        effectiveLimit = Math.floor(effectiveLimit * 0.7);
        console.log(`[rate-limiter] Sender ${senderId}: acceptance rate gate reducing budget from ${before} to ${effectiveLimit} (${(resolvedSender.acceptanceRate * 100).toFixed(1)}% acceptance rate)`);
      } else if (resolvedSender.acceptanceRate >= 0.15 && resolvedSender.acceptanceRate < 0.25) {
        console.log(`[rate-limiter] Sender ${senderId}: acceptance rate warning — ${(resolvedSender.acceptanceRate * 100).toFixed(1)}% (between 15-25%)`);
      }
    }
  }

  const used = ((resolvedUsage as Record<string, unknown>)[usageField] as number) ?? 0;

  // Belt-and-braces: count running actions across the shared budget bucket
  // as already-consumed. This protects against cross-poll races where a
  // batch has been picked up (markRunning) but not yet completed, so the
  // daily usage counter hasn't been incremented yet. Without this, a second
  // poll tick could approve actions the first tick is still executing.
  //
  // Callers inside a batch loop pass a pre-computed cache keyed by bucket so
  // we don't re-run this count query for every candidate. Cache miss falls
  // through to a direct query — keeping the function safe to call standalone.
  const typesForLimit = BUDGET_BUCKETS[actionType] ?? [actionType];
  const bucketKey = bucketKeyFor(actionType);
  const cachedRunning = runningCountCache?.get(bucketKey);
  const runningCount =
    cachedRunning !== undefined
      ? cachedRunning
      : ((await prisma.linkedInAction.count({
          where: {
            senderId,
            actionType: { in: typesForLimit },
            status: "running",
          },
        })) ?? 0);
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
 *
 * `remaining` mirrors the full checkBudget gate logic so external callers
 * (worker spread math, /api/linkedin/usage, /api/senders/[id]/budget,
 * /api/linkedin/plan) see the SAME effective budget the queue enforces —
 * including pending-count reductions (halved at 1500, capped at 3 at 2000),
 * acceptance-rate reductions, running-action subtraction, and
 * status/health blockers. If the gate blocks the action entirely, remaining
 * is 0.
 *
 * `sent` and `limit` stay raw for UI transparency.
 */
export async function getSenderBudget(senderId: string) {
  const sender = await prisma.sender.findUnique({ where: { id: senderId } });
  if (!sender) return null;

  const usage = await getOrCreateDailyUsage(senderId);

  // Pre-compute running-count per distinct bucket ONCE and share across the
  // 3 checkBudget calls below. Without this, each checkBudget would fire its
  // own linkedInAction.count query for the same sender — 3 identical queries
  // per call. Mirrors the pattern used by filterByBudget in queue.ts.
  const runningCountCache = new Map<string, number>();
  const distinctBuckets = new Map<string, LinkedInActionType[]>();
  for (const types of Object.values(BUDGET_BUCKETS)) {
    distinctBuckets.set(bucketKeyFor(types[0]), types);
  }
  await Promise.all(
    Array.from(distinctBuckets.entries()).map(async ([key, types]) => {
      const count = await prisma.linkedInAction.count({
        where: { senderId, actionType: { in: types }, status: "running" },
      });
      runningCountCache.set(key, count);
    }),
  );

  // Priority 5 = normal priority (no P1 bypass, no warm-lead fast-track).
  // Using priority 5 means remaining reflects the STANDARD daily budget,
  // which is what the worker needs for spread math. P1 slots are reserved
  // for warm leads and must not inflate the spread denominator.
  //
  // Pass the already-fetched sender so checkBudget skips 3 identical PK
  // lookups; pass runningCountCache so it skips 3 identical count queries;
  // pass the already-fetched usage so it skips 3 identical usage lookups.
  const senderForBudget: SenderForBudget = sender;
  const [connBudget, msgBudget, pvBudget] = await Promise.all([
    checkBudget(senderId, "connection_request", 5, runningCountCache, senderForBudget, usage),
    checkBudget(senderId, "message", 5, runningCountCache, senderForBudget, usage),
    checkBudget(senderId, "profile_view", 5, runningCountCache, senderForBudget, usage),
  ]);

  const effectiveRemaining = (result: BudgetCheckResult): number => {
    if (!result.allowed) return 0;
    // checkBudget can return Infinity for the withdraw bypass — clamp to a
    // finite number here so downstream math (spread delay denominator,
    // JSON serialization) never hits NaN/Infinity.
    if (!Number.isFinite(result.remaining)) return 0;
    return Math.max(0, result.remaining);
  };

  return {
    connections: {
      sent: usage.connectionsSent,
      limit: applyJitter(sender.dailyConnectionLimit, senderId),
      remaining: effectiveRemaining(connBudget),
    },
    messages: {
      sent: usage.messagesSent,
      limit: applyJitter(sender.dailyMessageLimit, senderId),
      remaining: effectiveRemaining(msgBudget),
    },
    profileViews: {
      sent: usage.profileViews,
      limit: applyJitter(sender.dailyProfileViewLimit, senderId),
      remaining: effectiveRemaining(pvBudget),
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
