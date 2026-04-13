import type { EmailBisonClient } from "./client";
import type { SequenceStep } from "./types";

/**
 * Cache of sequence steps per EmailBison campaign, scoped to a single
 * poll/backfill run. Callers instantiate one cache per task invocation so
 * values don't go stale across runs, but one reply's lookup can reuse another's
 * fetch when they share a campaign.
 */
export type SequenceStepCache = Map<number, Promise<SequenceStep[]>>;

export function createSequenceStepCache(): SequenceStepCache {
  return new Map();
}

/**
 * Result from resolving a scheduled email's sequence step and campaign.
 */
export interface ResolvedScheduledEmail {
  /** 1-indexed step position, or null if unresolved */
  sequenceStep: number | null;
  /** EmailBison campaign_id from the scheduled email, or null if unresolved */
  ebCampaignId: number | null;
}

/**
 * Resolve the 1-indexed sequence step position (`order`) for a reply given
 * its EmailBison `scheduled_email_id`. Mirrors the webhook path at
 * src/app/api/webhooks/emailbison/route.ts:346 which reads
 * `data.scheduled_email.sequence_step_order` directly — we recover the same
 * value via two API calls since the flat /replies list endpoint omits the
 * nested scheduled_email object.
 *
 * Non-throwing: returns null on any failure (missing ID, EB API error,
 * step not found in campaign). Callers should log the null case but must
 * never let it block reply persistence.
 *
 * @param client            Authenticated EmailBison client for the workspace
 * @param scheduledEmailId  reply.scheduled_email_id from the /replies response
 * @param stepCache         Per-run Map, keyed by EB campaign_id, that memoises
 *                          the full sequence-steps list. Reuse across a single
 *                          run to avoid hammering the API.
 * @returns The step.position (1-indexed) or null if unresolved.
 */
export async function resolveSequenceStepOrder(
  client: EmailBisonClient,
  scheduledEmailId: number | null | undefined,
  stepCache: SequenceStepCache,
): Promise<number | null> {
  const result = await resolveScheduledEmail(client, scheduledEmailId, stepCache);
  return result.sequenceStep;
}

/**
 * Resolve both the sequence step position and the EB campaign_id from a
 * scheduled email. Used by poll-replies to recover campaign attribution
 * when the reply's top-level campaign_id is null (BL-029).
 *
 * Same non-throwing guarantees as resolveSequenceStepOrder.
 */
export async function resolveScheduledEmail(
  client: EmailBisonClient,
  scheduledEmailId: number | null | undefined,
  stepCache: SequenceStepCache,
): Promise<ResolvedScheduledEmail> {
  if (scheduledEmailId == null) return { sequenceStep: null, ebCampaignId: null };

  try {
    const scheduled = await client.getScheduledEmail(scheduledEmailId);
    const campaignId = scheduled.campaign_id;
    const stepId = scheduled.sequence_step_id;

    if (!campaignId || !stepId) {
      return { sequenceStep: null, ebCampaignId: campaignId ?? null };
    }

    let stepsPromise = stepCache.get(campaignId);
    if (!stepsPromise) {
      stepsPromise = client.getSequenceSteps(campaignId);
      stepCache.set(campaignId, stepsPromise);
    }

    const steps = await stepsPromise;
    const match = steps.find((s) => s.id === stepId);
    return { sequenceStep: match?.position ?? null, ebCampaignId: campaignId };
  } catch (err) {
    console.warn(
      `[resolve-step] Failed to resolve sequence step for scheduled_email_id=${scheduledEmailId}:`,
      err instanceof Error ? err.message : String(err),
    );
    return { sequenceStep: null, ebCampaignId: null };
  }
}
