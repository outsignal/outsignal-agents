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
 * Action type groups for fair batch allocation.
 * Connection requests are the most valuable (initiate relationship) and must
 * never be starved by profile views filling the batch first.
 */
const CONNECTION_TYPES: LinkedInActionType[] = ["connect", "connection_request"];
const VIEW_TYPES: LinkedInActionType[] = ["profile_view", "check_connection"];
const MESSAGE_TYPES: LinkedInActionType[] = ["message"];

/**
 * Get the next batch of ready actions for a sender, respecting:
 * - Type-fair allocation (connection requests guaranteed batch slots)
 * - Priority ordering within each type (lower number = higher priority)
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

  // Fair allocation: each type group gets a guaranteed share of slots.
  // Connection requests get 50%, views get 30%, messages get 20%.
  const connectionSlots = Math.ceil(limit * 0.5);
  const viewSlots = Math.ceil(limit * 0.3);
  const messageSlots = Math.max(1, limit - connectionSlots - viewSlots);

  // Query each type group separately to prevent starvation
  const [connectionActions, viewActions, messageActions] = await Promise.all([
    prisma.linkedInAction.findMany({
      where: { ...baseWhere, actionType: { in: CONNECTION_TYPES } },
      orderBy,
      take: connectionSlots * 2, // fetch extra for budget filtering
      select: selectFields,
    }),
    prisma.linkedInAction.findMany({
      where: { ...baseWhere, actionType: { in: VIEW_TYPES } },
      orderBy,
      take: viewSlots * 2,
      select: selectFields,
    }),
    prisma.linkedInAction.findMany({
      where: { ...baseWhere, actionType: { in: MESSAGE_TYPES } },
      orderBy,
      take: messageSlots * 2,
      select: selectFields,
    }),
  ]);

  // Budget-filter each group up to its slot allocation
  const filterByBudget = async (
    actions: typeof connectionActions,
    maxSlots: number,
  ) => {
    const filtered: typeof actions = [];
    for (const action of actions) {
      if (filtered.length >= maxSlots) break;
      const budget = await checkBudget(senderId, action.actionType as LinkedInActionType, action.priority);
      if (budget.allowed) {
        filtered.push(action);
      }
    }
    return filtered;
  };

  const filteredConnections = await filterByBudget(connectionActions, connectionSlots);
  const filteredViews = await filterByBudget(viewActions, viewSlots);
  const filteredMessages = await filterByBudget(messageActions, messageSlots);

  // Merge results. If one group used fewer than its allocation, redistribute
  // remaining slots to other groups (connections first, then views, then messages).
  const used = filteredConnections.length + filteredViews.length + filteredMessages.length;
  let remainingSlots = limit - used;

  // Backfill from groups that had more pending actions than their initial allocation
  const backfillSources = [
    { actions: connectionActions, filtered: filteredConnections },
    { actions: viewActions, filtered: filteredViews },
    { actions: messageActions, filtered: filteredMessages },
  ];

  const backfilled: typeof connectionActions = [];
  for (const source of backfillSources) {
    if (remainingSlots <= 0) break;
    // Skip actions already included
    const included = new Set(source.filtered.map((a) => a.id));
    for (const action of source.actions) {
      if (remainingSlots <= 0) break;
      if (included.has(action.id)) continue;
      const budget = await checkBudget(senderId, action.actionType as LinkedInActionType, action.priority);
      if (budget.allowed) {
        backfilled.push(action);
        included.add(action.id);
        remainingSlots--;
      }
    }
  }

  const result = [...filteredConnections, ...filteredViews, ...filteredMessages, ...backfilled];

  // Sort merged result by priority then scheduledFor for consistent ordering
  result.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return 0; // scheduledFor ordering preserved within each group
  });

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
