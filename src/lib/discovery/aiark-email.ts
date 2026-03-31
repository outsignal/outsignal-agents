/**
 * AI Ark native email finding via /v1/people/export/single.
 *
 * Uses the AI Ark person ID (from search results) to fetch a full profile
 * including a verified email address. Emails are BounceBan-verified in
 * real-time by AI Ark.
 *
 * Cost: 1 credit per call (0.5 profile + 0.5 email), 0 credits if no email.
 * Auth: X-TOKEN header with AIARK_API_KEY.
 *
 * This should be called BEFORE falling back to Prospeo bulk-enrich for
 * AI Ark-sourced leads, since AI Ark already has the person data indexed.
 */

import type { DiscoveredPersonResult } from "./types";

const AIARK_EXPORT_SINGLE_ENDPOINT =
  "https://api.ai-ark.com/api/developer-portal/v1/people/export/single";

const REQUEST_TIMEOUT_MS = 15_000;

/** Delay between sequential calls to avoid hammering the API (ms) */
const INTER_REQUEST_DELAY_MS = 200;

/** Approximate cost per successful export in USD */
const AIARK_EXPORT_CREDIT_COST = 0.005;

function getApiKey(): string {
  const key = process.env.AIARK_API_KEY;
  if (!key) {
    throw new Error("AIARK_API_KEY environment variable is not set");
  }
  return key;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ExportSingleResponse {
  profile?: {
    email?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    title?: string | null;
  };
  email?: string | null;
}

/**
 * Enrich discovered people with emails via AI Ark's /export/single endpoint.
 *
 * For each person with a sourceId (AI Ark person ID) or a linkedinUrl,
 * calls the export endpoint to retrieve a verified email. People without
 * either identifier or who already have an email are skipped.
 *
 * The API accepts either `id` (AI Ark person ID) or `url` (LinkedIn URL).
 * When called from AI Ark search results, sourceId is used. When called
 * as a fallback from Prospeo/Apollo, linkedinUrl is used instead.
 *
 * Handles:
 *   - 200 with email → sets person.email
 *   - 404 → no email found, skip (no cost)
 *   - 402 → credits exhausted, abort remaining and return early
 *   - 429 → rate limited, stop and return early
 *   - Other errors → skip individual person, continue with rest
 *
 * @returns enriched count and cost in USD
 */
export async function enrichViaAiArk(
  people: DiscoveredPersonResult[],
): Promise<{ enriched: number; costUsd: number }> {
  const apiKey = getApiKey();

  let enriched = 0;
  let costUsd = 0;
  let creditsExhausted = false;

  for (let i = 0; i < people.length; i++) {
    const person = people[i];

    // Skip if already has an email, or no identifier to look up
    if (person.email || (!person.sourceId && !person.linkedinUrl)) continue;

    // If credits were exhausted on a previous call, stop trying
    if (creditsExhausted) break;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(AIARK_EXPORT_SINGLE_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "accept": "application/json",
          "X-TOKEN": apiKey,
        },
        body: JSON.stringify(
          person.sourceId
            ? { id: person.sourceId }
            : { url: person.linkedinUrl },
        ),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.status === 402) {
        // Credits exhausted — abort all remaining AI Ark enrichment
        console.warn(
          "[aiark-email] AI Ark credits exhausted (402). Skipping remaining people — will fall back to Prospeo.",
        );
        creditsExhausted = true;
        continue;
      }

      if (response.status === 404) {
        // No email found for this person — not an error, no cost
        continue;
      }

      if (response.status === 429) {
        // Rate limited — stop to avoid further 429s, let next provider handle the rest
        console.warn(
          "[aiark-email] AI Ark rate limited (429). Stopping AI Ark enrichment.",
        );
        break;
      }

      if (!response.ok) {
        const identifier = person.sourceId ?? person.linkedinUrl;
        console.warn(
          `[aiark-email] AI Ark export/single unexpected error: ${response.status} for person ${identifier}`,
        );
        continue;
      }

      const data = (await response.json()) as ExportSingleResponse;

      // The email could be at the top level or nested under profile
      const email = data.email ?? data.profile?.email;

      if (email) {
        people[i] = { ...person, email };
        enriched++;
        costUsd += AIARK_EXPORT_CREDIT_COST;
      }
      // If no email in the 200 response, no cost charged (AI Ark only charges for emails found)
    } catch (err) {
      clearTimeout(timeoutId);
      const identifier = person.sourceId ?? person.linkedinUrl;
      console.warn(
        `[aiark-email] Error exporting person ${identifier}:`,
        err,
      );
      // Continue with next person
    }

    // Small delay between requests to be respectful of rate limits
    if (i < people.length - 1) {
      await delay(INTER_REQUEST_DELAY_MS);
    }
  }

  if (enriched > 0 || creditsExhausted) {
    console.log(
      `[aiark-email] AI Ark native enrichment: ${enriched} emails found (cost: $${costUsd.toFixed(4)})${
        creditsExhausted ? " [credits exhausted — partial run]" : ""
      }`,
    );
  }

  return { enriched, costUsd };
}
