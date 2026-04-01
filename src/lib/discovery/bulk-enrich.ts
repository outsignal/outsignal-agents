/**
 * Prospeo Bulk Enrich helper for discovery pipeline.
 *
 * After discovery adapters find people (without emails), this module calls
 * Prospeo's /bulk-enrich-person endpoint to find verified email addresses
 * in batches of up to 50 records.
 *
 * Supports three input modes:
 *   1. person_id (from Prospeo /search-person results) -- highest match rate
 *   2. linkedin_url -- reliable if available
 *   3. first_name + last_name + company_website -- fallback
 *
 * Endpoint: POST https://api.prospeo.io/bulk-enrich-person
 * Auth: X-KEY header (same PROSPEO_API_KEY as other Prospeo endpoints)
 * Cost: 1 credit per matched result (not per request)
 * Batch size: max 50 datapoints per request
 *
 * Reference: https://prospeo.io/api/bulk-enrich-person
 */

import { CreditExhaustionError } from "@/lib/enrichment/credit-exhaustion";
import { notifyCreditExhaustion } from "@/lib/notifications";
import type { DiscoveredPersonResult } from "./types";

const PROSPEO_BULK_ENRICH_ENDPOINT =
  "https://api.prospeo.io/bulk-enrich-person";
const TIMEOUT_MS = 30_000; // Bulk enrichment can be slower
const MAX_BATCH_SIZE = 50;

/** Cost per matched result in USD */
const PROSPEO_ENRICH_CREDIT_COST = 0.002;

function getApiKey(): string {
  const key = process.env.PROSPEO_API_KEY;
  if (!key) throw new Error("PROSPEO_API_KEY environment variable is not set");
  return key;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BulkEnrichDatapoint {
  /** Prospeo person_id from /search-person (best match key) */
  person_id?: string;
  /** LinkedIn profile URL */
  linkedin_url?: string;
  /** First name for name+company fallback */
  first_name?: string;
  /** Last name for name+company fallback */
  last_name?: string;
  /** Company website/domain for name+company fallback */
  company_website?: string;
}

interface BulkEnrichResponse {
  matched?: Array<{
    person_id?: string;
    linkedin_url?: string;
    first_name?: string;
    last_name?: string;
    email?: string;
    company_website?: string;
  }>;
  not_matched?: Array<unknown>;
  invalid_datapoints?: Array<unknown>;
}

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Call Prospeo /bulk-enrich-person with a batch of datapoints.
 * Returns the matched results with emails.
 */
async function callBulkEnrich(
  datapoints: BulkEnrichDatapoint[]
): Promise<BulkEnrichResponse> {
  const apiKey = getApiKey();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(PROSPEO_BULK_ENRICH_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-KEY": apiKey,
      },
      body: JSON.stringify({
        datapoints,
        only_verified_email: true,
      }),
      signal: controller.signal,
    });

    if (res.status === 402 || res.status === 403) {
      throw new CreditExhaustionError("prospeo", res.status);
    }

    if (!res.ok) {
      if (res.status === 429) {
        console.warn("[bulk-enrich] Prospeo rate-limited (429)");
        return { matched: [], not_matched: datapoints, invalid_datapoints: [] };
      }
      console.warn(
        `[bulk-enrich] Prospeo bulk-enrich error: ${res.status} ${res.statusText}`
      );
      return { matched: [], not_matched: datapoints, invalid_datapoints: [] };
    }

    return (await res.json()) as BulkEnrichResponse;
  } catch (err) {
    // Credit exhaustion — notify admin and re-throw to halt the entire pipeline
    if (err instanceof CreditExhaustionError) {
      await notifyCreditExhaustion({
        provider: err.provider,
        httpStatus: err.httpStatus,
        context: "discovery bulk enrichment (Prospeo)",
      });
      throw err;
    }
    console.warn("[bulk-enrich] Prospeo bulk-enrich failed:", err);
    return { matched: [], not_matched: datapoints, invalid_datapoints: [] };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface BulkEnrichResult {
  /** People with emails filled in where matches were found */
  people: DiscoveredPersonResult[];
  /** Number of people that received an email from bulk enrichment */
  enrichedCount: number;
  /** Total API cost in USD */
  costUsd: number;
}

/**
 * Enrich a list of discovered people by finding their emails via Prospeo
 * /bulk-enrich-person. Processes in batches of 50.
 *
 * For each person, builds the best available datapoint:
 *   1. If sourceId is set (Prospeo person_id) -> use person_id
 *   2. Else if linkedinUrl is set -> use linkedin_url
 *   3. Else if firstName+lastName+companyDomain -> use name+company
 *   4. Otherwise skip (cannot enrich)
 *
 * Returns the same people array with email fields populated where matches found.
 */
export async function bulkEnrichPeople(
  people: DiscoveredPersonResult[],
  source: "prospeo" | "aiark" | "apollo" | "leads-finder"
): Promise<BulkEnrichResult> {
  if (people.length === 0) {
    return { people, enrichedCount: 0, costUsd: 0 };
  }

  // Build datapoints, tracking which person index maps to which datapoint
  const indexMap: number[] = []; // indexMap[datapointIdx] = peopleIdx
  const datapoints: BulkEnrichDatapoint[] = [];

  for (let i = 0; i < people.length; i++) {
    const p = people[i];

    // Skip people who already have an email
    if (p.email) continue;

    const dp: BulkEnrichDatapoint = {};

    if (source === "prospeo" && p.sourceId) {
      // Prospeo person_id for exact matching
      dp.person_id = p.sourceId;
    } else if (p.linkedinUrl) {
      dp.linkedin_url = p.linkedinUrl;
    } else if (p.firstName && p.lastName && p.companyDomain) {
      dp.first_name = p.firstName;
      dp.last_name = p.lastName;
      dp.company_website = p.companyDomain;
    } else {
      // Cannot build a viable datapoint -- skip
      continue;
    }

    datapoints.push(dp);
    indexMap.push(i);
  }

  if (datapoints.length === 0) {
    return { people, enrichedCount: 0, costUsd: 0 };
  }

  // Process in batches of 50
  let totalEnriched = 0;
  let totalCost = 0;

  for (let batchStart = 0; batchStart < datapoints.length; batchStart += MAX_BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + MAX_BATCH_SIZE, datapoints.length);
    const batchDatapoints = datapoints.slice(batchStart, batchEnd);
    const batchIndexes = indexMap.slice(batchStart, batchEnd);

    const result = await callBulkEnrich(batchDatapoints);
    const matchedCount = result.matched?.length ?? 0;
    totalCost += matchedCount * PROSPEO_ENRICH_CREDIT_COST;

    if (result.matched && result.matched.length > 0) {
      // Match enriched results back to people by looking up the identifier
      for (const match of result.matched) {
        if (!match.email) continue;

        // Find which datapoint this match corresponds to
        let matchedIdx: number | null = null;

        for (let j = 0; j < batchDatapoints.length; j++) {
          const dp = batchDatapoints[j];
          if (
            (dp.person_id && dp.person_id === match.person_id) ||
            (dp.linkedin_url && dp.linkedin_url === match.linkedin_url) ||
            (dp.first_name &&
              dp.last_name &&
              dp.first_name === match.first_name &&
              dp.last_name === match.last_name)
          ) {
            matchedIdx = j;
            break;
          }
        }

        if (matchedIdx !== null) {
          const peopleIdx = batchIndexes[matchedIdx];
          people[peopleIdx] = { ...people[peopleIdx], email: match.email };
          totalEnriched++;
        }
      }
    }
  }

  console.log(
    `[bulk-enrich] Enriched ${totalEnriched}/${datapoints.length} people with verified emails (cost: $${totalCost.toFixed(4)})`
  );

  return {
    people,
    enrichedCount: totalEnriched,
    costUsd: totalCost,
  };
}
