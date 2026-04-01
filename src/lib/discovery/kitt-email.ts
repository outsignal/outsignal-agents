/**
 * Kitt email finding for the discovery pipeline.
 *
 * Replaces LeadMagic as the final email-finding fallback in the discovery
 * enrichment waterfall. For each person without an email, calls Kitt's
 * find_email endpoint using name + domain (+ optional LinkedIn URL).
 *
 * Cost: $0.005 per found email (free if not found)
 * Auth: x-api-key header (KITT_API_KEY env var)
 */

import type { DiscoveredPersonResult } from "./types";
import { findEmail } from "@/lib/verification/kitt";

/** Delay between sequential calls to avoid hammering the API (ms) */
const INTER_REQUEST_DELAY_MS = 200;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Enrich discovered people with emails via Kitt find_email.
 *
 * For each person without an email, calls Kitt using:
 *   - fullName (firstName + lastName) + domain (required)
 *   - linkedinUrl (optional, improves accuracy)
 *
 * Handles:
 *   - 401 → bad API key, abort
 *   - 402 → credits exhausted, abort
 *   - Other errors → skip individual person, continue
 *
 * @returns enriched count and cost in USD
 */
export async function enrichViaKitt(
  people: DiscoveredPersonResult[],
): Promise<{ enriched: number; costUsd: number }> {
  let enriched = 0;
  let costUsd = 0;

  // Check if API key is configured
  if (!process.env.KITT_API_KEY) {
    console.warn(
      "[kitt-email] KITT_API_KEY not set — skipping Kitt enrichment.",
    );
    return { enriched: 0, costUsd: 0 };
  }

  for (let i = 0; i < people.length; i++) {
    const person = people[i];

    // Skip if already has an email
    if (person.email) continue;

    // Need name + domain at minimum
    if (!person.firstName || !person.lastName) continue;
    const domain = person.companyDomain ?? person.company;
    if (!domain) continue;

    try {
      const result = await findEmail({
        fullName: `${person.firstName} ${person.lastName}`,
        domain,
        linkedinUrl: person.linkedinUrl,
      });

      costUsd += result.costUsd;

      if (result.email) {
        people[i] = { ...person, email: result.email };
        enriched++;
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.message.includes("401") || err.message.includes("402")) {
          console.warn(
            `[kitt-email] Kitt error: ${err.message}. Stopping Kitt enrichment.`,
          );
          break;
        }
      }
      console.warn(
        `[kitt-email] Error finding email for ${person.firstName} ${person.lastName}:`,
        err,
      );
      // Continue with next person
    }

    // Small delay between requests
    if (i < people.length - 1) {
      await delay(INTER_REQUEST_DELAY_MS);
    }
  }

  if (enriched > 0) {
    console.log(
      `[kitt-email] Kitt enrichment: ${enriched} emails found (cost: $${costUsd.toFixed(4)})`,
    );
  }

  return { enriched, costUsd };
}
