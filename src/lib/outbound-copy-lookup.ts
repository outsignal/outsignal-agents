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
      const steps = JSON.parse(campaign.emailSequence) as {
        position: number;
        subjectLine?: string;
        body?: string;
      }[];
      const match = steps.find((s) => s.position === sequenceStep);
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
      // Try exact position match first
      let match = steps.find((s) => s.position === sequenceStep);
      // Off-by-one fallback (EB API may be 0-indexed while webhook is 1-indexed)
      if (!match) {
        match = steps.find((s) => s.position === sequenceStep - 1);
      }
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
