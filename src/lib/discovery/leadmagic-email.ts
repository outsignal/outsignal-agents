/**
 * LeadMagic email finding for the discovery pipeline.
 *
 * Wraps the enrichment provider's leadmagicAdapter for use in the discovery
 * waterfall. For each person without an email, calls LeadMagic using:
 *   - Strategy 1 (1 credit): name + company (if available)
 *   - Strategy 2 (2 credits): LinkedIn URL -> profile-search -> email-finder
 *
 * This is the final fallback step after AI Ark and Prospeo enrichment.
 *
 * Cost: $0.005 per call (1 credit) or $0.01 (2 credits for LinkedIn path)
 * Auth: X-API-Key header with LEADMAGIC_API_KEY
 */

import type { DiscoveredPersonResult } from "./types";
import { leadmagicAdapter } from "../enrichment/providers/leadmagic";

/** Delay between sequential calls to avoid hammering the API (ms) */
const INTER_REQUEST_DELAY_MS = 200;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Enrich discovered people with emails via LeadMagic.
 *
 * For each person without an email, calls the leadmagicAdapter which
 * automatically selects the best strategy based on available data:
 *   - name + company -> direct email-finder (1 credit)
 *   - LinkedIn URL -> profile-search + email-finder (2 credits)
 *
 * Handles:
 *   - 429 rate limit -> stop processing, return early
 *   - Other errors -> skip individual person, continue
 *
 * @returns enriched count and cost in USD
 */
export async function enrichViaLeadMagic(
  people: DiscoveredPersonResult[],
): Promise<{ enriched: number; costUsd: number }> {
  let enriched = 0;
  let costUsd = 0;

  // Check if API key is configured — if not, skip silently
  if (!process.env.LEADMAGIC_API_KEY) {
    console.warn(
      "[leadmagic-email] LEADMAGIC_API_KEY not set — skipping LeadMagic enrichment.",
    );
    return { enriched: 0, costUsd: 0 };
  }

  for (let i = 0; i < people.length; i++) {
    const person = people[i];

    // Skip if already has an email
    if (person.email) continue;

    // Need either name+company or LinkedIn URL
    const hasName = Boolean(person.firstName && person.lastName);
    const hasCompany = Boolean(person.company || person.companyDomain);
    const hasLinkedIn = Boolean(person.linkedinUrl);

    if (!hasLinkedIn && !(hasName && hasCompany)) continue;

    try {
      const result = await leadmagicAdapter({
        linkedinUrl: person.linkedinUrl,
        firstName: person.firstName,
        lastName: person.lastName,
        companyName: person.company,
        companyDomain: person.companyDomain,
      });

      costUsd += result.costUsd;

      if (result.email) {
        people[i] = { ...person, email: result.email };
        enriched++;
      }
    } catch (err: unknown) {
      if (err && typeof err === "object" && "status" in err) {
        const status = (err as { status: number }).status;
        if (status === 429) {
          console.warn(
            "[leadmagic-email] LeadMagic rate limited (429). Stopping LeadMagic enrichment.",
          );
          break;
        }
        if (status === 402) {
          console.warn(
            "[leadmagic-email] LeadMagic credits exhausted (402). Stopping LeadMagic enrichment.",
          );
          break;
        }
      }
      console.warn(
        `[leadmagic-email] Error enriching person ${person.linkedinUrl ?? person.firstName}:`,
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
      `[leadmagic-email] LeadMagic enrichment: ${enriched} emails found (cost: $${costUsd.toFixed(4)})`,
    );
  }

  return { enriched, costUsd };
}
