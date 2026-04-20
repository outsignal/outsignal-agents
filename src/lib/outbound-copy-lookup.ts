/**
 * Shared utility to look up outbound copy (subject + body) for a reply.
 *
 * Strategy: local emailSequence first (fast, no API call), then EB API fallback.
 * Used by both the backfill script and process-reply.ts.
 */

import { PrismaClient } from "@prisma/client";
import { EmailBisonClient } from "@/lib/emailbison/client";
import type { SequenceStep } from "@/lib/emailbison/types";

const prisma = new PrismaClient();

// In-memory cache to avoid repeated API calls for the same campaign
const stepCache = new Map<number, SequenceStep[]>();

/**
 * Fetch sequence steps for an EB campaign, using an in-memory cache.
 * Reuse across multiple replies sharing the same campaign.
 */
export async function getSequenceStepsCached(
  emailBisonCampaignId: number,
  apiToken: string,
): Promise<SequenceStep[]> {
  const cached = stepCache.get(emailBisonCampaignId);
  if (cached) return cached;

  const client = new EmailBisonClient(apiToken);
  const steps = await client.getSequenceSteps(emailBisonCampaignId);
  stepCache.set(emailBisonCampaignId, steps);
  return steps;
}

/** Clear the step cache (useful between test runs). */
export function clearStepCache(): void {
  stepCache.clear();
}

export interface StoredEmailSequenceCopyStep {
  position: number;
  subjectLine?: string;
  body?: string;
}

function hasContiguousPositions(positions: number[]): boolean {
  if (positions.length === 0) return false;
  return positions.every((position, idx) =>
    idx === 0 ? true : position === positions[idx - 1] + 1,
  );
}

/**
 * Match a reply's 1-indexed EmailBison sequence step against locally stored
 * Campaign.emailSequence rows.
 *
 * Most campaigns store positions 1..N, but a small legacy Lime subset was
 * saved as 0..N-1. We try the canonical exact match first, then an off-by-one
 * fallback for those legacy rows. This keeps reply context correct without
 * mutating historical campaign data in the hot path.
 */
export function findStepForReplySequence<T extends { position: number }>(
  steps: T[],
  sequenceStep: number | null,
): T | null {
  if (sequenceStep == null || sequenceStep <= 0) return null;

  const positions = steps.map((s) => s.position).sort((a, b) => a - b);
  const maxPosition = positions.length > 0 ? positions[positions.length - 1] : null;
  if (maxPosition == null) return null;

  const isContiguous = hasContiguousPositions(positions);
  const isZeroBased =
    positions.length > 0 &&
    isContiguous &&
    positions.every((position, idx) => position === idx);
  const maxSequenceStep = isZeroBased ? maxPosition + 1 : maxPosition;
  if (sequenceStep > maxSequenceStep) return null;

  if (isZeroBased) {
    return steps.find((s) => s.position === sequenceStep - 1) ?? null;
  }

  const exactMatch = steps.find((s) => s.position === sequenceStep);
  if (exactMatch) {
    return exactMatch;
  }

  // Defensive fallback for any mixed/legacy edge case that doesn't neatly fit
  // the expected scheme but is still only off by one. Only allow it when the
  // positions are contiguous; sparse sets like [1,3,5] should fail closed.
  if (isContiguous) {
    return steps.find((s) => s.position === sequenceStep - 1) ?? null;
  }

  return null;
}

/**
 * Look up the outbound copy that was sent to a lead before they replied.
 *
 * @param campaignId  Outsignal Campaign UUID (from Reply.campaignId)
 * @param sequenceStep  1-indexed position from EB webhook (Reply.sequenceStep), or null
 * @returns { subject, body } or { null, null } if unresolvable
 */
export async function lookupOutboundCopy(
  campaignId: string,
  sequenceStep: number | null,
): Promise<{ subject: string | null; body: string | null }> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: {
      emailSequence: true,
      emailBisonCampaignId: true,
      workspaceSlug: true,
    },
  });

  if (!campaign) return { subject: null, body: null };

  // --- Fast path: local emailSequence ---
  if (campaign.emailSequence && sequenceStep != null) {
    try {
      const steps = JSON.parse(campaign.emailSequence) as StoredEmailSequenceCopyStep[];
      const match = findStepForReplySequence(steps, sequenceStep);
      if (match) {
        return {
          subject: match.subjectLine ?? null,
          body: match.body ?? null,
        };
      }
    } catch {
      // JSON parse failure -- fall through to API
    }
  }

  // --- Slow path: EmailBison API fallback ---
  if (!campaign.emailBisonCampaignId) return { subject: null, body: null };

  const workspace = await prisma.workspace.findUnique({
    where: { slug: campaign.workspaceSlug },
    select: { apiToken: true },
  });

  if (!workspace?.apiToken) return { subject: null, body: null };

  try {
    const steps = await getSequenceStepsCached(
      campaign.emailBisonCampaignId,
      workspace.apiToken,
    );

    if (sequenceStep != null) {
      const match = findStepForReplySequence(steps, sequenceStep);
      if (match) {
        return { subject: match.subject || null, body: match.body || null };
      }
    }

    // If sequenceStep is null but campaign has only 1 step, use it
    if (sequenceStep == null && steps.length === 1) {
      return {
        subject: steps[0].subject || null,
        body: steps[0].body || null,
      };
    }
  } catch (err) {
    console.warn(
      `[outbound-copy-lookup] EB API call failed for campaign ${campaignId} (EB ID ${campaign.emailBisonCampaignId}):`,
      err,
    );
  }

  return { subject: null, body: null };
}
