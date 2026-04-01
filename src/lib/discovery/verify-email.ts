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
import type { DiscoveredPersonResult } from "./types";

/** Delay between verification calls to respect rate limits (ms) */
const INTER_VERIFY_DELAY_MS = 100;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Verify a single email via BounceBan + Kitt fallback.
 * Returns true if the email is valid, false otherwise.
 */
async function verifySingleEmail(email: string): Promise<boolean> {
  try {
    const bbResult = await bouncebanVerify(email);

    if (bbResult.status === "valid" || bbResult.status === "valid_catch_all") {
      return true;
    }

    if (bbResult.status === "unknown") {
      // BounceBan inconclusive — try Kitt
      try {
        const kittResult = await kittVerify(email);
        return kittResult.status === "valid";
      } catch {
        return false; // both failed — reject
      }
    }

    // invalid, risky, catch_all — reject
    return false;
  } catch {
    // BounceBan error — try Kitt fallback
    try {
      const kittResult = await kittVerify(email);
      return kittResult.status === "valid";
    } catch {
      return false;
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

  const BOUNCEBAN_COST = 0.005;

  for (let i = 0; i < people.length; i++) {
    const person = people[i];
    if (!person.email) continue;

    // Skip indices that are already verified (e.g., AI Ark pre-verified emails)
    if (skipIndices?.has(i)) {
      validCount++;
      continue;
    }

    const isValid = await verifySingleEmail(person.email);
    costUsd += BOUNCEBAN_COST; // BounceBan always charged

    if (isValid) {
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
