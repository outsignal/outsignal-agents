/**
 * AI Ark source-first enrichment — uses stored AI Ark person ID for direct lookup.
 *
 * When a person was discovered via AI Ark search, their AI Ark person ID is stored
 * as PersonWorkspace.sourceId during promotion. This module uses that ID to call
 * the /v1/people/export/single endpoint for a direct lookup, which has a much higher
 * hit rate than generic name/company matching.
 *
 * Cost: ~$0.005 per call with email found, $0 if no email.
 * Auth: X-TOKEN header with AIARK_API_KEY.
 * Rate limit: 5 req/s — sequential calls with 200ms delay.
 */

import { CreditExhaustionError } from "@/lib/enrichment/credit-exhaustion";
import type { EmailProviderResult } from "../types";

const AIARK_EXPORT_SINGLE_ENDPOINT =
  "https://api.ai-ark.com/api/developer-portal/v1/people/export/single";

const REQUEST_TIMEOUT_MS = 15_000;
const INTER_REQUEST_DELAY_MS = 200;
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
 * Bulk enrich people by their AI Ark person ID via /export/single.
 *
 * Sequential calls with 200ms delay to respect AI Ark's 5 req/s limit.
 * Returns a Map of personId -> EmailProviderResult for people where an email was found.
 *
 * Handles:
 *   - 200 with email: returns result with email
 *   - 200 without email: returns result with null email (no cost)
 *   - 404: no data found, skip (no cost)
 *   - 402/403: credit exhaustion, throws CreditExhaustionError
 *   - 429: rate limited, stops and returns what we have so far
 *   - Other errors: skip individual person, continue
 */
export async function bulkEnrichByAiArkId(
  people: Array<{ personId: string; aiarkPersonId: string }>,
): Promise<Map<string, EmailProviderResult>> {
  const results = new Map<string, EmailProviderResult>();
  const apiKey = getApiKey();

  for (let i = 0; i < people.length; i++) {
    const { personId, aiarkPersonId } = people[i];

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(AIARK_EXPORT_SINGLE_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
          "X-TOKEN": apiKey,
        },
        body: JSON.stringify({ id: aiarkPersonId }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.status === 402 || response.status === 403) {
        throw new CreditExhaustionError("aiark", response.status, "AI Ark source-first credits exhausted");
      }

      if (response.status === 404) {
        // No data found — skip, no cost
        results.set(personId, {
          email: null,
          source: "aiark",
          rawResponse: null,
          costUsd: 0,
        });
        continue;
      }

      if (response.status === 429) {
        console.warn("[aiark-source-first] Rate limited (429) — stopping AI Ark source-first enrichment");
        break;
      }

      if (!response.ok) {
        console.warn(`[aiark-source-first] Unexpected HTTP ${response.status} for person ${personId} (aiarkId: ${aiarkPersonId})`);
        continue;
      }

      const data = (await response.json()) as ExportSingleResponse;
      const email = data.email ?? data.profile?.email ?? null;

      results.set(personId, {
        email: email || null,
        firstName: data.profile?.first_name ?? undefined,
        lastName: data.profile?.last_name ?? undefined,
        jobTitle: data.profile?.title ?? undefined,
        source: "aiark",
        rawResponse: data,
        costUsd: email ? AIARK_EXPORT_CREDIT_COST : 0,
      });
    } catch (err) {
      clearTimeout(timeoutId);

      if (err instanceof CreditExhaustionError) {
        throw err;
      }

      console.warn(`[aiark-source-first] Error for person ${personId} (aiarkId: ${aiarkPersonId}):`, err);
      continue;
    }

    // Rate limit: 200ms between calls (5 req/s)
    if (i < people.length - 1) {
      await delay(INTER_REQUEST_DELAY_MS);
    }
  }

  return results;
}
