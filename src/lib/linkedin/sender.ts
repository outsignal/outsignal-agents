/**
 * Sender management — CRUD and assignment logic for LinkedIn senders.
 *
 * A Sender links an email identity (used in EmailBison) to a LinkedIn
 * account, within a workspace. One workspace can have multiple senders.
 */
import type { Sender } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getWarmupLimits } from "./rate-limiter";

export interface CreateSenderParams {
  workspaceSlug: string;
  name: string;
  emailAddress?: string;
  emailSenderName?: string;
  linkedinProfileUrl?: string;
  linkedinTier?: "free" | "premium";
  proxyUrl?: string;
}

/**
 * Create a new sender for a workspace. Starts in "setup" status
 * with warm-up day 0 and conservative default limits.
 */
export async function createSender(params: CreateSenderParams) {
  const {
    workspaceSlug,
    name,
    emailAddress,
    emailSenderName,
    linkedinProfileUrl,
    linkedinTier = "free",
    proxyUrl,
  } = params;

  return prisma.sender.create({
    data: {
      workspaceSlug,
      name: name.trim(),
      emailAddress: emailAddress ?? null,
      emailSenderName: emailSenderName ?? null,
      linkedinProfileUrl: linkedinProfileUrl ?? null,
      linkedinTier,
      proxyUrl: proxyUrl ?? null,
      channel: "linkedin",
      status: "setup",
      healthStatus: "healthy",
      sessionStatus: "not_setup",
      warmupDay: 0,
      // Conservative defaults (Phase 1 warm-up)
      dailyConnectionLimit: 5,
      dailyMessageLimit: 10,
      dailyProfileViewLimit: 15,
    },
  });
}

/**
 * Get all senders for a workspace.
 */
export async function getSendersForWorkspace(workspaceSlug: string) {
  return prisma.sender.findMany({
    where: { workspaceSlug },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Returns the single best LinkedIn-capable sender for a workspace,
 * preferring the most recently active session.
 *
 * Returns null if no live LinkedIn sender exists (email-only workspace).
 * Logs a warning if multiple live candidates exist — usually means session
 * setup ran twice without cleanup.
 */
export async function getCanonicalLinkedInSender(
  workspaceSlug: string,
): Promise<Sender | null> {
  const candidates = await prisma.sender.findMany({
    where: {
      workspaceSlug,
      status: "active",
      channel: { in: ["linkedin", "both"] },
      sessionStatus: "active",
      healthStatus: { notIn: ["blocked", "session_expired"] },
    },
    orderBy: [
      { lastKeepaliveAt: { sort: "desc", nulls: "last" } },
      { lastActiveAt: { sort: "desc", nulls: "last" } },
      { createdAt: "asc" },
    ],
  });

  if (candidates.length === 0) {
    return null;
  }

  if (candidates.length > 1) {
    console.warn(
      `[linkedin/sender] WARNING: ${candidates.length} live LinkedIn senders for ${workspaceSlug} — returning most recent keepalive`,
    );
  }

  return candidates[0] ?? null;
}

/**
 * Get all operational LinkedIn senders for a workspace.
 *
 * We intentionally require an active LinkedIn session here, not just
 * `status="active"`. Historical debris rows can remain marked active while
 * still being `sessionStatus="not_setup"`; the worker ignores them, but the
 * planner and sender-assignment flows should not see them as eligible.
 */
export async function getActiveSenders(workspaceSlug: string) {
  return prisma.sender.findMany({
    where: {
      workspaceSlug,
      status: "active",
      channel: { in: ["linkedin", "both"] },
      sessionStatus: "active",
      healthStatus: { notIn: ["blocked", "session_expired"] },
    },
    orderBy: { createdAt: "asc" },
  });
}

async function getRefreshableSenders(workspaceSlug: string) {
  return prisma.sender.findMany({
    where: {
      workspaceSlug,
      status: "active",
      channel: { in: ["linkedin", "both"] },
      sessionStatus: { in: ["active", "expired"] },
      healthStatus: { not: "blocked" },
    },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Resolve which sender should handle a LinkedIn action for a person.
 *
 * For Email+LinkedIn campaigns: match by the email sender address from
 * the EMAIL_SENT webhook. The person should be contacted on LinkedIn by
 * the same person who emailed them.
 *
 * For LinkedIn-only campaigns: round-robin across active senders.
 */
export async function assignSenderForPerson(
  workspaceSlug: string,
  options: {
    emailSenderAddress?: string; // from EMAIL_SENT webhook
    mode: "email_linkedin" | "linkedin_only";
  },
) {
  const activeSenders = await getActiveSenders(workspaceSlug);
  let candidateSenders = activeSenders;
  if (candidateSenders.length === 0) {
    candidateSenders = await getRefreshableSenders(workspaceSlug);
  }
  if (candidateSenders.length === 0) return null;

  if (options.mode === "email_linkedin" && options.emailSenderAddress) {
    // Match by email address
    const matched = candidateSenders.find(
      (s) => s.emailAddress?.toLowerCase() === options.emailSenderAddress!.toLowerCase(),
    );
    if (matched) {
      return matched;
    }
  }

  // Fall back to least-used eligible sender when an exact email match is
  // unavailable. This keeps email+LinkedIn actions moving during transient
  // sender refresh windows instead of dropping them on the floor.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const sendersWithUsage = await Promise.all(
    candidateSenders.map(async (sender) => {
      const usage = await prisma.linkedInDailyUsage.findUnique({
        where: { senderId_date: { senderId: sender.id, date: today } },
      });
      const totalUsed = usage
        ? usage.connectionsSent + usage.messagesSent + usage.profileViews
        : 0;
      return { sender, totalUsed };
    }),
  );

  // Sort by least used today
  sendersWithUsage.sort((a, b) => a.totalUsed - b.totalUsed);

  return sendersWithUsage[0]?.sender ?? null;
}

/**
 * Activate a sender and start warm-up.
 */
export async function activateSender(senderId: string) {
  const limits = getWarmupLimits(1, senderId);

  return prisma.sender.update({
    where: { id: senderId },
    data: {
      status: "active",
      warmupDay: 1,
      warmupStartedAt: new Date(),
      dailyConnectionLimit: limits.connections,
      dailyMessageLimit: limits.messages,
      dailyProfileViewLimit: limits.profileViews,
    },
  });
}

/**
 * Pause a sender. All pending actions remain in queue but won't be picked up.
 */
export async function pauseSender(senderId: string, reason?: string) {
  return prisma.sender.update({
    where: { id: senderId },
    data: {
      status: "paused",
      healthStatus: reason === "captcha" || reason === "restriction" ? "blocked" : "paused",
    },
  });
}

/**
 * Resume a paused sender.
 */
export async function resumeSender(senderId: string) {
  return prisma.sender.update({
    where: { id: senderId },
    data: {
      status: "active",
      healthStatus: "healthy",
    },
  });
}

/**
 * Update a sender's acceptance rate based on recent connection data.
 */
export async function updateAcceptanceRate(senderId: string): Promise<number | null> {
  const totalSent = await prisma.linkedInConnection.count({
    where: { senderId, status: { in: ["pending", "connected", "expired"] } },
  });

  if (totalSent === 0) return null;

  const accepted = await prisma.linkedInConnection.count({
    where: { senderId, status: "connected" },
  });

  const rate = accepted / totalSent;

  await prisma.sender.update({
    where: { id: senderId },
    data: { acceptanceRate: rate },
  });

  return rate;
}
