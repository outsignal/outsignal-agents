/**
 * LinkedIn action queue — DB-backed priority queue for LinkedIn automation.
 *
 * Actions are enqueued with a priority (1 = warm lead, 5 = normal) and a
 * scheduledFor timestamp. The worker polls getNextBatch() to retrieve
 * ready actions in priority order, respecting the sender's daily budget.
 */
import { prisma } from "@/lib/db";
import { WITHDRAWAL_COOLDOWN_MS } from "./types";
import type { EnqueueActionParams, LinkedInActionType } from "./types";
import { isTerminalActionError } from "./action-errors";
import {
  BUDGET_BUCKETS,
  bucketKeyFor,
  checkBudget,
  checkCircuitBreaker,
} from "./rate-limiter";

/**
 * Enqueue a LinkedIn action. Returns the action ID.
 */
export async function enqueueAction(params: EnqueueActionParams): Promise<string> {
  const {
    senderId,
    personId,
    workspaceSlug,
    actionType,
    messageBody,
    priority = 5,
    scheduledFor = new Date(),
    campaignName,
    emailBisonLeadId,
    sequenceStepRef,
    parentActionId,
    linkedInConversationId,
    variantKey,
  } = params;

  // Cross-campaign dedup: skip if this person already has an active or recently
  // completed action of the same type in this workspace (any campaign).
  // - Pending/running: always block (action is in-flight)
  // - Completed within last 30 days: block (recent outreach, don't double-tap)
  // - Completed 30+ days ago: allow (campaign finished, ok to re-target)
  // Portal replies (linkedInConversationId set) bypass dedup entirely.
  if (personId && !linkedInConversationId) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const existing = await prisma.linkedInAction.findFirst({
      where: {
        personId,
        workspaceSlug,
        actionType,
        OR: [
          { status: { in: ["pending", "running"] } },
          { status: "complete", completedAt: { gte: thirtyDaysAgo } },
        ],
      },
      select: { id: true },
    });

    if (existing) {
      return existing.id;
    }
  }

  const action = await prisma.linkedInAction.create({
    data: {
      senderId,
      personId: personId ?? null,
      workspaceSlug,
      actionType,
      messageBody: messageBody ?? null,
      priority,
      scheduledFor,
      status: "pending",
      campaignName: campaignName ?? null,
      emailBisonLeadId: emailBisonLeadId ?? null,
      sequenceStepRef: sequenceStepRef ?? null,
      parentActionId: parentActionId ?? null,
      linkedInConversationId: linkedInConversationId ?? null,
      variantKey: variantKey ?? null,
    },
  });

  return action.id;
}

/**
 * Action type groups — each group has its OWN independent daily budget.
 * profile_view/check_connection: 10-50/day (prerequisite actions)
 * connect/connection_request: 5-20/day (actual outreach)
 * message: separate daily limit (follow-ups after accept)
 */
const CONNECTION_TYPES: LinkedInActionType[] = ["connect", "connection_request"];
const VIEW_TYPES: LinkedInActionType[] = ["profile_view", "check_connection"];
const MESSAGE_TYPES: LinkedInActionType[] = ["message"];
const WITHDRAWAL_TYPES: LinkedInActionType[] = ["withdraw_connection"];

/**
 * Get the next batch of ready actions for a sender, respecting:
 * - Independent per-type budgets (each type has its own daily limit via checkBudget)
 * - Per-type cap per poll cycle to avoid executing too many in one burst
 * - Priority ordering within each type (lower number = higher priority)
 * - scheduledFor <= now
 *
 * The perTypeLimit controls how many of each type to return per poll cycle
 * (e.g. 5 means up to 5 connections + 5 views + 5 messages = 15 total).
 * The worker polls frequently, so we process a reasonable chunk each cycle.
 */
export async function getNextBatch(
  senderId: string,
  perTypeLimit: number = 5,
): Promise<Array<{
  id: string;
  personId: string | null;
  actionType: LinkedInActionType;
  messageBody: string | null;
  priority: number;
  workspaceSlug: string;
  campaignName: string | null;
  linkedInConversationId: string | null;
}>> {
  // Circuit breaker: stop serving actions if the sender has too many consecutive failures
  const circuitBreaker = await checkCircuitBreaker(senderId);
  if (circuitBreaker.tripped) {
    console.warn(`[Queue] Circuit breaker tripped for sender ${senderId}: ${circuitBreaker.reason}`);
    return [];
  }

  const now = new Date();

  const baseWhere = {
    senderId,
    status: "pending" as const,
    scheduledFor: { lte: now },
  };

  const orderBy = [
    { priority: "asc" as const },
    { scheduledFor: "asc" as const },
  ];

  const selectFields = {
    id: true,
    personId: true,
    actionType: true,
    messageBody: true,
    priority: true,
    workspaceSlug: true,
    campaignName: true,
    linkedInConversationId: true,
  };

  // Query each type group independently — they don't compete for the same pool
  const [connectionActions, viewActions, messageActions, withdrawalActions] = await Promise.all([
    prisma.linkedInAction.findMany({
      where: { ...baseWhere, actionType: { in: CONNECTION_TYPES } },
      orderBy,
      take: perTypeLimit * 2, // fetch extra for budget filtering
      select: selectFields,
    }),
    prisma.linkedInAction.findMany({
      where: { ...baseWhere, actionType: { in: VIEW_TYPES } },
      orderBy,
      take: perTypeLimit * 2,
      select: selectFields,
    }),
    prisma.linkedInAction.findMany({
      where: { ...baseWhere, actionType: { in: MESSAGE_TYPES } },
      orderBy,
      take: perTypeLimit * 2,
      select: selectFields,
    }),
    prisma.linkedInAction.findMany({
      where: { ...baseWhere, actionType: { in: WITHDRAWAL_TYPES } },
      orderBy,
      take: perTypeLimit * 2,
      select: selectFields,
    }),
  ]);

  // Pre-compute the running-action count per budget bucket ONCE per poll
  // tick. Without this, checkBudget would run `linkedInAction.count` on every
  // iteration of filterByBudget — 10 candidates × 3 action types = 30 queries
  // per poll. We build a cache keyed by bucket name (so `connect` and
  // `connection_request` share a slot — they share a daily limit) and pass
  // it into every checkBudget call inside the loop.
  //
  // Bucket keys come from `bucketKeyFor` so the cache stays aligned with
  // checkBudget's internal bucket derivation. Distinct bucket keys appear
  // once: connect-bucket, profile_view-bucket, message.
  const runningCountCache = new Map<string, number>();
  const distinctBuckets = new Map<string, LinkedInActionType[]>();
  for (const types of Object.values(BUDGET_BUCKETS)) {
    distinctBuckets.set(bucketKeyFor(types[0]), types);
  }
  await Promise.all(
    Array.from(distinctBuckets.entries()).map(async ([key, types]) => {
      const count = await prisma.linkedInAction.count({
        where: {
          senderId,
          actionType: { in: types },
          status: "running",
        },
      });
      runningCountCache.set(key, count);
    }),
  );

  // Budget-filter each group independently against its own daily limit.
  //
  // Tracks in-flight consumption inside the filter loop to prevent a
  // same-tick race: checkBudget reads committed DB state only, so a batch
  // with remaining=1 would otherwise approve every candidate in the loop
  // (all reading the same "remaining=1" value) and overshoot the daily
  // limit. James Bessey-Saldanha sent 8/6 connections in one day due to
  // this race (2026-04-14).
  //
  // Keying by BUCKET (not raw actionType): `connect` and `connection_request`
  // share `dailyConnectionLimit` via BUDGET_BUCKETS. A batch containing both
  // types would otherwise get separate Map slots but compete for the same
  // underlying limit — `connect` takes 1, `connection_request` takes 1, both
  // pass because neither type-slot sees the other's consumption. The bucket
  // key collapses them to a single counter.
  const filterByBudget = async (
    actions: typeof connectionActions,
    limit: number,
  ) => {
    const filtered: typeof actions = [];
    const inFlightByBucket = new Map<string, number>();
    for (const action of actions) {
      if (filtered.length >= limit) break;
      const bucketKey = bucketKeyFor(action.actionType as LinkedInActionType);
      const budget = await checkBudget(
        senderId,
        action.actionType as LinkedInActionType,
        action.priority,
        runningCountCache,
      );
      const alreadyTakenThisTick = inFlightByBucket.get(bucketKey) ?? 0;
      if (budget.allowed && budget.remaining > alreadyTakenThisTick) {
        filtered.push(action);
        inFlightByBucket.set(bucketKey, alreadyTakenThisTick + 1);
      }
    }
    return filtered;
  };

  const [filteredConnections, filteredViews, filteredMessages, filteredWithdrawals] = await Promise.all([
    filterByBudget(connectionActions, perTypeLimit),
    filterByBudget(viewActions, perTypeLimit),
    filterByBudget(messageActions, perTypeLimit),
    filterByBudget(withdrawalActions, perTypeLimit),
  ]);

  // Merge all approved actions — no shared pool, no redistribution needed
  const result = [...filteredConnections, ...filteredViews, ...filteredMessages, ...filteredWithdrawals];

  // Sort by priority for execution order
  result.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return 0;
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return result as any;
}

/**
 * Atomically claim the next ready batch for a sender.
 *
 * Race fix: `getNextBatch()` is a read-only candidate selector. Two workers
 * can read the same pending rows concurrently. Claiming must therefore be a
 * compare-and-swap on each action (`status: "pending" -> "running"`), and
 * only successfully claimed rows should be returned to the caller.
 */
export async function claimNextBatch(
  senderId: string,
  perTypeLimit: number = 5,
): Promise<Array<{
  id: string;
  personId: string | null;
  actionType: LinkedInActionType;
  messageBody: string | null;
  priority: number;
  workspaceSlug: string;
  campaignName: string | null;
  linkedInConversationId: string | null;
}>> {
  const candidates = await getNextBatch(senderId, perTypeLimit);
  if (candidates.length === 0) return [];

  const claimed: typeof candidates = [];
  const claimedAt = new Date();

  for (const action of candidates) {
    const update = await prisma.linkedInAction.updateMany({
      where: {
        id: action.id,
        senderId,
        status: "pending",
      },
      data: {
        status: "running",
        attempts: { increment: 1 },
        lastAttemptAt: claimedAt,
      },
    });

    if (update.count === 1) {
      claimed.push(action);
    }
  }

  return claimed;
}

/**
 * Mark an action as running (worker has picked it up).
 */
export async function markRunning(actionId: string): Promise<boolean> {
  const updated = await prisma.linkedInAction.updateMany({
    where: { id: actionId, status: "pending" },
    data: {
      status: "running",
      attempts: { increment: 1 },
      lastAttemptAt: new Date(),
    },
  });
  return updated.count === 1;
}

/**
 * Mark an action as complete with optional result data.
 *
 * Post-completion hooks:
 * - connection_request/connect: increment Sender.pendingConnectionCount
 * - withdraw_connection (withdrawal_pre_retry): schedule retry after 21-day cooldown
 * - withdraw_connection (withdrawal_final): decrement pending count
 */
export async function markComplete(
  actionId: string,
  result?: string,
): Promise<{ transitionedFromRunning: boolean }> {
  return prisma.$transaction(async (tx) => {
    const action = await tx.linkedInAction.findUniqueOrThrow({
      where: { id: actionId },
    });

    const completedAt = new Date();
    const transition = await tx.linkedInAction.updateMany({
      where: { id: actionId, status: "running" },
      data: {
        status: "complete",
        completedAt,
        result: result ?? null,
      },
    });

    const transitionedFromRunning = transition.count === 1;

    if (!transitionedFromRunning) {
      return { transitionedFromRunning: false };
    }

    // Post-completion hook: track pending connection count for new connection requests
    if (
      action.actionType === "connect" ||
      action.actionType === "connection_request"
    ) {
      await tx.sender.update({
        where: { id: action.senderId },
        data: {
          pendingConnectionCount: { increment: 1 },
          pendingCountUpdatedAt: new Date(),
        },
      });
    }

    // Post-completion hook: withdrawal lifecycle callbacks
    if (action.actionType === "withdraw_connection") {
      if (action.sequenceStepRef === "withdrawal_pre_retry") {
        const stillPending = await tx.linkedInConnection.count({
          where: {
            senderId: action.senderId,
            personId: action.personId!,
            status: "pending",
          },
        });

        if (stillPending > 0) {
          await tx.$executeRaw`
            UPDATE "Sender"
            SET "pendingConnectionCount" = GREATEST(0, "pendingConnectionCount" - 1),
                "pendingCountUpdatedAt" = NOW()
            WHERE "id" = ${action.senderId}
          `;

          await tx.linkedInConnection.updateMany({
            where: {
              senderId: action.senderId,
              personId: action.personId!,
              status: "pending",
            },
            data: { status: "withdrawn" },
          });

          const retryTime = new Date(Date.now() + WITHDRAWAL_COOLDOWN_MS);

          await tx.linkedInAction.create({
            data: {
              senderId: action.senderId,
              personId: action.personId!,
              workspaceSlug: action.workspaceSlug,
              actionType: "connection_request",
              priority: 5,
              scheduledFor: retryTime,
              status: "pending",
              sequenceStepRef: "connection_retry",
            },
          });

          await tx.linkedInConnection.updateMany({
            where: {
              senderId: action.senderId,
              personId: action.personId!,
              status: "withdrawn",
            },
            data: {
              status: "pending",
              requestSentAt: retryTime,
            },
          });

          await tx.sender.update({
            where: { id: action.senderId },
            data: {
              pendingConnectionCount: { increment: 1 },
              pendingCountUpdatedAt: new Date(),
            },
          });
        }
      } else if (action.sequenceStepRef === "withdrawal_final") {
        await tx.$executeRaw`
          UPDATE "Sender"
          SET "pendingConnectionCount" = GREATEST(0, "pendingConnectionCount" - 1),
              "pendingCountUpdatedAt" = NOW()
          WHERE "id" = ${action.senderId}
        `;

        await tx.linkedInConnection.updateMany({
          where: {
            senderId: action.senderId,
            personId: action.personId!,
            status: { in: ["pending", "withdrawn"] },
          },
          data: { status: "failed" },
        });
      }
    }

    return { transitionedFromRunning: true };
  });
}

/**
 * Mark an action as failed. If retries remain, schedule the next retry
 * with exponential backoff (5 min, 30 min, 2 hours).
 */
export async function markFailed(
  actionId: string,
  error: string,
): Promise<boolean> {
  const action = await prisma.linkedInAction.findUniqueOrThrow({
    where: { id: actionId },
  });

  if (action.status === "complete") {
    return false;
  }

  const retriesExhausted =
    action.attempts >= action.maxAttempts || isTerminalActionError(error);

  if (retriesExhausted) {
    const updated = await prisma.linkedInAction.updateMany({
      where: { id: actionId, status: action.status },
      data: {
        status: "failed",
        result: JSON.stringify({ error }),
      },
    });
    return updated.count === 1;
  } else {
    // Exponential backoff: 5 min, 30 min, 2 hours
    const backoffMinutes = [5, 30, 120];
    const delayMinutes = backoffMinutes[Math.min(action.attempts, backoffMinutes.length - 1)];
    const nextRetry = new Date(Date.now() + delayMinutes * 60 * 1000);

    const updated = await prisma.linkedInAction.updateMany({
      where: { id: actionId, status: action.status },
      data: {
        status: "pending", // back to pending for retry
        nextRetryAt: nextRetry,
        scheduledFor: nextRetry, // re-schedule for the retry time
        result: JSON.stringify({ error, retryAt: nextRetry.toISOString() }),
      },
    });
    return updated.count === 1;
  }
}

/**
 * Mark an action as failed only if it is still in "running" status.
 *
 * Used by worker timeout cleanup so late completions or already-cleaned rows
 * are not clobbered back into failed/pending.
 */
export async function markFailedIfRunning(
  actionId: string,
  error: string,
): Promise<boolean> {
  const action = await prisma.linkedInAction.findUniqueOrThrow({
    where: { id: actionId },
  });

  if (action.status !== "running") {
    return false;
  }

  // Graceful worker yield: the action was claimed for this sender tick but
  // never actually started executing. Release it back to pending without
  // consuming retry budget so the next poll can pick it up cleanly.
  if (error === "graceful_yield") {
    const attemptsUpdate =
      action.attempts > 0 ? { decrement: 1 } : 0;
    const updated = await prisma.linkedInAction.updateMany({
      where: { id: actionId, status: "running" },
      data: {
        status: "pending",
        attempts: attemptsUpdate,
      },
    });
    return updated.count === 1;
  }

  const retriesExhausted =
    action.attempts >= action.maxAttempts || isTerminalActionError(error);

  if (retriesExhausted) {
    const updated = await prisma.linkedInAction.updateMany({
      where: { id: actionId, status: "running" },
      data: {
        status: "failed",
        result: JSON.stringify({ error }),
      },
    });
    return updated.count === 1;
  }

  const backoffMinutes = [5, 30, 120];
  const delayMinutes =
    backoffMinutes[Math.min(action.attempts, backoffMinutes.length - 1)];
  const nextRetry = new Date(Date.now() + delayMinutes * 60 * 1000);

  const updated = await prisma.linkedInAction.updateMany({
    where: { id: actionId, status: "running" },
    data: {
      status: "pending",
      nextRetryAt: nextRetry,
      scheduledFor: nextRetry,
      result: JSON.stringify({ error, retryAt: nextRetry.toISOString() }),
    },
  });

  return updated.count === 1;
}

/**
 * Cancel a pending action (e.g., when lead replies and we no longer need to connect).
 */
export async function cancelAction(actionId: string): Promise<void> {
  await prisma.linkedInAction.update({
    where: { id: actionId },
    data: { status: "cancelled" },
  });
}

/**
 * Cancel all pending actions for a person across all senders in a workspace.
 * Used when a lead replies or opts out.
 */
export async function cancelActionsForPerson(
  personId: string,
  workspaceSlug: string,
): Promise<number> {
  const result = await prisma.linkedInAction.updateMany({
    where: {
      personId,
      workspaceSlug,
      status: "pending",
    },
    data: { status: "cancelled" },
  });

  return result.count;
}

/**
 * Bump an existing pending action to priority 1 (warm lead fast-track).
 * Returns true if an action was found and bumped.
 */
export async function bumpPriority(personId: string, workspaceSlug: string): Promise<boolean> {
  const result = await prisma.linkedInAction.updateMany({
    where: {
      personId,
      workspaceSlug,
      status: "pending",
      actionType: { in: ["connect", "connection_request"] },
    },
    data: {
      priority: 1,
      scheduledFor: new Date(), // execute ASAP
    },
  });

  return result.count > 0;
}

/**
 * Expire connection requests that have been pending for more than the
 * specified number of days (default 14).
 */
export async function expireStaleActions(maxAgeDays: number = 14): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);

  const result = await prisma.linkedInAction.updateMany({
    where: {
      status: "pending",
      actionType: { in: ["connect", "connection_request"] },
      scheduledFor: { lt: cutoff },
    },
    data: { status: "expired" },
  });

  return result.count;
}

/**
 * Recover actions stuck in "running" status (from worker crashes).
 * Resets to "pending" if retries remain, or "failed" if exhausted.
 */
export async function recoverStuckActions(): Promise<number> {
  // Actions stuck in "running" for more than 10 minutes
  const cutoff = new Date(Date.now() - 10 * 60 * 1000);

  const stuckActions = await prisma.linkedInAction.findMany({
    where: {
      status: "running",
      lastAttemptAt: { lt: cutoff },
    },
  });

  let recovered = 0;
  for (const action of stuckActions) {
    const retriesExhausted = action.attempts >= action.maxAttempts;
    await prisma.linkedInAction.update({
      where: { id: action.id },
      data: {
        status: retriesExhausted ? "failed" : "pending",
        result: JSON.stringify({ error: "Worker crash recovery" }),
      },
    });
    recovered++;
  }

  return recovered;
}

/**
 * Sweeper: hard-fail actions that have been stuck in "running" beyond the
 * given threshold. Complements `recoverStuckActions()` which retries stuck
 * actions — this sweeper exists as a belt-and-braces safety net that runs
 * on a Trigger.dev cron so stuck actions are caught even when the Railway
 * worker is offline or crashed. Uses a longer threshold than the worker's
 * own recovery to avoid racing with legitimate retry attempts.
 *
 * Schema note: LinkedInAction has no `failureReason` field. We stash the
 * reason inside the `result` JSON blob (same pattern as `markFailed`).
 *
 * @param thresholdMinutes how long a row must have been in "running" with
 *   `lastAttemptAt` older than this cutoff before it is considered stuck.
 *   Defaults to 30 minutes — longer than any legitimate LinkedIn action
 *   (profile view + connection request + post-accept polling all finish
 *   well inside a minute individually).
 */
export async function sweepStuckRunningActions(
  thresholdMinutes: number = 30,
): Promise<{ swept: number; ids: string[] }> {
  const cutoff = new Date(Date.now() - thresholdMinutes * 60 * 1000);

  const stuck = await prisma.linkedInAction.findMany({
    where: {
      status: "running",
      // lastAttemptAt is set by markRunning() — a row with null here but
      // status=running is malformed, but still stuck. Include both cases.
      OR: [{ lastAttemptAt: { lt: cutoff } }, { lastAttemptAt: null }],
    },
    select: { id: true, attempts: true, maxAttempts: true, result: true },
  });

  if (stuck.length === 0) {
    return { swept: 0, ids: [] };
  }

  // Mirror `recoverStuckActions()` retry semantics (Blocker 5.4): rows that
  // still have retries left are reset to "pending", only fully exhausted
  // rows are hard-failed. The sweeper still runs at a longer threshold
  // (30min vs the worker's 10min) so it remains a backstop, not a primary
  // mechanism — but we must not contradict the existing retry contract.
  const sweptAt = new Date().toISOString();
  const baseFailurePayload = {
    error: "stuck-running-sweeper",
    failureReason: "stuck-running-sweeper",
    sweptAt,
    thresholdMinutes,
  };

  const sweptIds: string[] = [];
  for (const action of stuck) {
    const retriesExhausted = action.attempts >= action.maxAttempts;
    // Re-match status='running' inside each update so rows that flipped to
    // complete/failed/pending between the read and write are not clobbered.
    const update = await prisma.linkedInAction.updateMany({
      where: { id: action.id, status: "running" },
      data: retriesExhausted
        ? {
            status: "failed",
            result: JSON.stringify(baseFailurePayload),
          }
        : {
            status: "pending",
            result: JSON.stringify({
              ...baseFailurePayload,
              recovered: true,
              attemptsRemaining: action.maxAttempts - action.attempts,
            }),
          },
    });
    if (update.count > 0) {
      sweptIds.push(action.id);
    }
  }

  return { swept: sweptIds.length, ids: sweptIds };
}
