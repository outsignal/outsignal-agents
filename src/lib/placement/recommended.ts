// --- Recommended-for-testing query ---
// Identifies senders with >3% bounce rate and 20+ sends who should have
// an inbox placement test run.

import { prisma } from "@/lib/db";
import { RecommendedSender } from "./types";

const BOUNCE_RATE_THRESHOLD = 0.03; // 3%
const MIN_EMAILS_SENT = 20;

/**
 * Returns senders recommended for inbox placement testing.
 *
 * Criteria:
 *  - bounceRate > 3% on their most recent BounceSnapshot
 *  - emailsSent >= 20 on that same snapshot
 *
 * Also includes lastTestAt from EmailSenderHealth if a test has been run.
 *
 * Implementation: fetches all BounceSnapshots ordered by snapshotDate desc,
 * deduplicates in JS by senderEmail (taking the most recent row), then filters
 * by bounce rate and emailsSent. This avoids complex raw SQL while remaining
 * correct for the expected dataset size (~100 sender emails max).
 */
export async function getRecommendedForTesting(): Promise<RecommendedSender[]> {
  // Fetch all snapshots, newest first
  const snapshots = await prisma.bounceSnapshot.findMany({
    orderBy: { snapshotDate: "desc" },
    select: {
      senderEmail: true,
      senderDomain: true,
      workspaceSlug: true,
      bounceRate: true,
      emailsSent: true,
    },
  });

  // Deduplicate by senderEmail — first occurrence = most recent snapshot
  const seenEmails = new Set<string>();
  const latestPerSender: typeof snapshots = [];

  for (const snap of snapshots) {
    if (!seenEmails.has(snap.senderEmail)) {
      seenEmails.add(snap.senderEmail);
      latestPerSender.push(snap);
    }
  }

  // Filter to high-bounce senders
  const highBounce = latestPerSender.filter(
    (s) =>
      s.bounceRate !== null &&
      s.bounceRate > BOUNCE_RATE_THRESHOLD &&
      s.emailsSent >= MIN_EMAILS_SENT
  );

  if (highBounce.length === 0) {
    return [];
  }

  // Fetch EmailSenderHealth for these senders to include lastTestAt
  const senderEmails = highBounce.map((s) => s.senderEmail);
  const healthRecords = await prisma.emailSenderHealth.findMany({
    where: { senderEmail: { in: senderEmails } },
    select: { senderEmail: true, lastTestAt: true },
  });

  const healthByEmail = new Map(
    healthRecords.map((h) => [h.senderEmail, h.lastTestAt])
  );

  return highBounce.map((s) => ({
    senderEmail: s.senderEmail,
    senderDomain: s.senderDomain,
    workspaceSlug: s.workspaceSlug,
    bounceRate: s.bounceRate as number,
    emailsSent: s.emailsSent,
    lastTestAt: healthByEmail.get(s.senderEmail) ?? null,
  }));
}

/**
 * Convenience check: returns true if a specific sender is recommended for testing.
 * Uses the same criteria as getRecommendedForTesting().
 */
export async function isRecommendedForTesting(
  senderEmail: string
): Promise<boolean> {
  const latest = await prisma.bounceSnapshot.findFirst({
    where: { senderEmail },
    orderBy: { snapshotDate: "desc" },
    select: { bounceRate: true, emailsSent: true },
  });

  if (!latest) return false;
  if (latest.bounceRate === null) return false;

  return (
    latest.bounceRate > BOUNCE_RATE_THRESHOLD &&
    latest.emailsSent >= MIN_EMAILS_SENT
  );
}
