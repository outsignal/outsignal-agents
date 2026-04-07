/**
 * LinkedIn action queue — DB-backed priority queue for LinkedIn automation.
 *
 * Actions are enqueued with a priority (1 = warm lead, 5 = normal) and a
 * scheduledFor timestamp. The worker polls getNextBatch() to retrieve
 * ready actions in priority order, respecting the sender's daily budget.
 */
import { prisma } from "@/lib/db";
import type { EnqueueActionParams, LinkedInActionType } from "./types";
import { checkBudget, checkCircuitBreaker } from "./rate-limiter";

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
    },
  });

  return action.id;
}

/**
 * Get the next batch of ready actions for a sender, respecting:
 * - Priority ordering (lower number = higher priority)
 * - scheduledFor <= now
 * - Daily rate limits per action type
 *
 * Returns actions grouped and ordered by priority, then scheduledFor.
 */
export async function getNextBatch(
  senderId: string,
  limit: number = 10,
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

  // Get all ready actions for this sender
  const actions = await prisma.linkedInAction.findMany({
    where: {
      senderId,
      status: "pending",
      scheduledFor: { lte: now },
    },
    orderBy: [
      { priority: "asc" }, // P1 first
      { scheduledFor: "asc" }, // oldest first within same priority
    ],
    take: limit * 2, // fetch extra to account for budget filtering
    select: {
      id: true,
      personId: true,
      actionType: true,
      messageBody: true,
      priority: true,
      workspaceSlug: true,
      campaignName: true,
      linkedInConversationId: true,
    },
  });

  // Filter by budget availability per action type
  const result: typeof actions = [];
  for (const action of actions) {
    if (result.length >= limit) break;

    const budget = await checkBudget(senderId, action.actionType as LinkedInActionType, action.priority);
    if (budget.allowed) {
      result.push(action);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return result as any;
}

/**
 * Mark an action as running (worker has picked it up).
 */
export async function markRunning(actionId: string): Promise<void> {
  await prisma.linkedInAction.update({
    where: { id: actionId },
    data: {
      status: "running",
      attempts: { increment: 1 },
      lastAttemptAt: new Date(),
    },
  });
}

/**
 * Mark an action as complete with optional result data.
 */
export async function markComplete(actionId: string, result?: string): Promise<void> {
  await prisma.linkedInAction.update({
    where: { id: actionId },
    data: {
      status: "complete",
      completedAt: new Date(),
      result: result ?? null,
    },
  });
}

/**
 * Mark an action as failed. If retries remain, schedule the next retry
 * with exponential backoff (5 min, 30 min, 2 hours).
 */
export async function markFailed(actionId: string, error: string): Promise<void> {
  const action = await prisma.linkedInAction.findUniqueOrThrow({
    where: { id: actionId },
  });

  const retriesExhausted = action.attempts >= action.maxAttempts;

  if (retriesExhausted) {
    await prisma.linkedInAction.update({
      where: { id: actionId },
      data: {
        status: "failed",
        result: JSON.stringify({ error }),
      },
    });
  } else {
    // Exponential backoff: 5 min, 30 min, 2 hours
    const backoffMinutes = [5, 30, 120];
    const delayMinutes = backoffMinutes[Math.min(action.attempts, backoffMinutes.length - 1)];
    const nextRetry = new Date(Date.now() + delayMinutes * 60 * 1000);

    await prisma.linkedInAction.update({
      where: { id: actionId },
      data: {
        status: "pending", // back to pending for retry
        nextRetryAt: nextRetry,
        scheduledFor: nextRetry, // re-schedule for the retry time
        result: JSON.stringify({ error, retryAt: nextRetry.toISOString() }),
      },
    });
  }
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
      actionType: "connect",
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
      actionType: "connect",
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
