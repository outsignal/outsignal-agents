/**
 * Email verification for the discovery pipeline.
 *
 * Verifies discovered emails via BounceBan (primary) with Kitt fallback
 * for unknown results. Used inline during discovery enrichment to ensure
 * only valid emails are kept before staging.
 *
 * AI Ark emails are pre-verified by AI Ark (BounceBan-verified in real-time)
 * and should skip re-verification.
 */
import { verifyEmail as bouncebanVerify } from "@/lib/verification/bounceban";
import { verifyEmail as kittVerify } from "@/lib/verification/kitt";
import { isCreditExhaustion } from "@/lib/enrichment/credit-exhaustion";
import { notifyCreditExhaustion } from "@/lib/notifications";
import type { DiscoveredPersonResult } from "./types";

/** Delay between verification calls to respect rate limits (ms) */
const INTER_VERIFY_DELAY_MS = 100;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface VerifySingleResult {
  isValid: boolean;
  /** Approximate cost in USD for this single verification */
  costUsd: number;
}

const BOUNCEBAN_COST = 0.005;
const KITT_COST = 0.0015;

/**
 * Verify a single email via BounceBan + Kitt fallback.
 * Returns validity and actual cost based on which providers ran.
 *
 * Cost logic:
 * - BounceBan succeeds → charge BounceBan only
 * - BounceBan errors (Kitt fallback) → charge Kitt only (BounceBan didn't complete)
 * - BounceBan returns unknown (Kitt fallback) → charge both (both ran)
 */
async function verifySingleEmail(email: string): Promise<VerifySingleResult> {
  try {
    const bbResult = await bouncebanVerify(email);

    if (bbResult.status === "valid") {
      return { isValid: true, costUsd: BOUNCEBAN_COST };
    }

    if (bbResult.status === "unknown") {
      // BounceBan inconclusive — try Kitt. Charge both since BounceBan ran.
      try {
        const kittResult = await kittVerify(email);
        return { isValid: kittResult.status === "valid", costUsd: BOUNCEBAN_COST + KITT_COST };
      } catch (kittErr) {
        if (isCreditExhaustion(kittErr)) {
          await notifyCreditExhaustion({
            provider: kittErr.provider,
            httpStatus: kittErr.httpStatus,
            context: "discovery email verification (Kitt fallback)",
          });
          throw kittErr;
        }
        // Kitt failed but BounceBan ran — charge BounceBan only
        return { isValid: false, costUsd: BOUNCEBAN_COST };
      }
    }

    // invalid, risky, catch_all — reject. BounceBan ran successfully.
    return { isValid: false, costUsd: BOUNCEBAN_COST };
  } catch (err) {
    // Credit exhaustion — notify admin and re-throw to halt the entire pipeline
    if (isCreditExhaustion(err)) {
      await notifyCreditExhaustion({
        provider: err.provider,
        httpStatus: err.httpStatus,
        context: "discovery email verification (BounceBan)",
      });
      throw err;
    }
    // BounceBan error — try Kitt fallback. Charge Kitt only (BounceBan didn't complete).
    try {
      const kittResult = await kittVerify(email);
      return { isValid: kittResult.status === "valid", costUsd: KITT_COST };
    } catch (kittErr) {
      if (isCreditExhaustion(kittErr)) {
        await notifyCreditExhaustion({
          provider: kittErr.provider,
          httpStatus: kittErr.httpStatus,
          context: "discovery email verification (Kitt fallback after BounceBan error)",
        });
        throw kittErr;
      }
      return { isValid: false, costUsd: 0 };
    }
  }
}

export interface VerifyBatchResult {
  /** Number of emails verified as valid */
  validCount: number;
  /** Number of emails rejected (nulled out) */
  rejectedCount: number;
  /** Approximate verification cost in USD */
  costUsd: number;
}

/**
 * Verify all emails in a batch of discovered people.
 * Invalid emails are nulled out in-place.
 *
 * @param people - Array of discovered people (mutated in place)
 * @param skipIndices - Set of indices to skip (e.g., AI Ark emails already verified at source)
 * @returns Counts of valid and rejected emails
 */
export async function verifyDiscoveredEmails(
  people: DiscoveredPersonResult[],
  skipIndices?: Set<number>,
): Promise<VerifyBatchResult> {
  let validCount = 0;
  let rejectedCount = 0;
  let costUsd = 0;

  for (let i = 0; i < people.length; i++) {
    const person = people[i];
    if (!person.email) continue;

    // Skip indices that are already verified (e.g., AI Ark pre-verified emails)
    if (skipIndices?.has(i)) {
      validCount++;
      continue;
    }

    const result = await verifySingleEmail(person.email);
    costUsd += result.costUsd;

    if (result.isValid) {
      validCount++;
    } else {
      console.warn(
        `[verify-email] Rejected invalid email ${person.email} for ${person.firstName} ${person.lastName}`,
      );
      people[i] = { ...person, email: undefined };
      rejectedCount++;
    }

    // Small delay between verifications
    if (i < people.length - 1) {
      await delay(INTER_VERIFY_DELAY_MS);
    }
  }

  if (validCount > 0 || rejectedCount > 0) {
    console.log(
      `[verify-email] Verification complete: ${validCount} valid, ${rejectedCount} rejected (cost: $${costUsd.toFixed(4)})`,
    );
  }

  return { validCount, rejectedCount, costUsd };
}
