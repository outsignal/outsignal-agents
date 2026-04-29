/**
 * AI Ark person data provider adapter.
 *
 * Fetches structured person data (job title, company, location, LinkedIn URL, email)
 * from the AI Ark API given a LinkedIn URL or name+company identifiers.
 *
 * Auth: X-TOKEN header with API key.
 */

import { z } from "zod";
import { CreditExhaustionError } from "@/lib/enrichment/credit-exhaustion";
import { PROVIDER_COSTS } from "../costs";
import type { EmailAdapterInput, PersonAdapter, PersonProviderResult } from "../types";
import type { RateLimits } from "@/lib/discovery/rate-limit";
import {
  asAiArkPersonRecord,
  extractAiArkPeople,
  mapAiArkCompanyData,
  mapAiArkPersonData,
} from "./aiark-mapping";

/**
 * AI Ark person enrichment rate limits.
 * Source: AI Ark API docs.
 *
 * All endpoints share the same limits:
 *   - 5 requests/second
 *   - 300 requests/minute
 *   - 18,000 requests/hour
 * Returns 429 when exceeded. Rate limits reset every 60 seconds.
 */
export const RATE_LIMITS: RateLimits = {
  maxBatchSize: 1,
  delayBetweenCalls: 200,        // 5 req/s — Source: AI Ark API docs
  maxConcurrent: 1,
  dailyCap: null,                // No daily cap; 18,000 req/hour limit
  cooldownOnRateLimit: 300_000,  // 5 min cooldown on 401/429
};

const AIARK_PEOPLE_ENDPOINT = "https://api.ai-ark.com/api/developer-portal/v1/people";

/** Auth header name for AI Ark API (confirmed working in production). */
const AUTH_HEADER_NAME = "X-TOKEN";

const REQUEST_TIMEOUT_MS = 10_000;

function getApiKey(): string {
  const key = process.env.AIARK_API_KEY;
  if (!key) {
    throw new Error("AIARK_API_KEY environment variable is not set");
  }
  return key;
}

/** Loose validation schema for a nested AI Ark person record. */
const AiArkPersonSchema = z
  .object({
    id: z.string().optional(),
    profile: z.object({}).passthrough().optional(),
    link: z.object({}).passthrough().optional(),
    location: z.object({}).passthrough().optional(),
    department: z.object({}).passthrough().optional(),
    company: z.object({}).passthrough().optional(),
  })
  .passthrough();

type AiArkPerson = z.infer<typeof AiArkPersonSchema>;

function mapToResult(person: AiArkPerson, raw: unknown): PersonProviderResult {
  const record = asAiArkPersonRecord(person);
  const personData = mapAiArkPersonData(record);
  const company = mapAiArkCompanyData(record);

  return {
    ...personData,
    ...(Object.keys(company.data).length > 0 ? { companyData: company.data } : {}),
    source: "aiark",
    rawResponse: raw,
    costUsd: PROVIDER_COSTS.aiark,
  };
}

/**
 * Determine the request body for the AI Ark people endpoint.
 * Prefers LinkedIn URL (most reliable identifier), falls back to name+company.
 * Returns null if neither input path is viable.
 */
function buildRequestBody(input: EmailAdapterInput): Record<string, unknown> | null {
  if (input.linkedinUrl) {
    return { linkedin_url: input.linkedinUrl };
  }

  if (input.firstName && input.lastName && (input.companyName || input.companyDomain)) {
    return {
      first_name: input.firstName,
      last_name: input.lastName,
      company: input.companyName ?? input.companyDomain,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// AI Ark person data adapter
// ---------------------------------------------------------------------------

/**
 * AI Ark person data adapter.
 * Implements PersonAdapter — takes person identifiers, returns enriched person fields.
 * Returns person data (jobTitle, company, location, etc.); email is optional bonus.
 */
export const aiarkPersonAdapter: PersonAdapter = async (input: EmailAdapterInput): Promise<PersonProviderResult> => {
  const requestBody = buildRequestBody(input);

  if (!requestBody) {
    // Neither LinkedIn URL nor name+company available — cannot call AI Ark
    return {
      source: "aiark",
      rawResponse: null,
      costUsd: 0, // No API call made, no cost
    };
  }

  const apiKey = getApiKey();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let raw: unknown;

  try {
    const response = await fetch(AIARK_PEOPLE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [AUTH_HEADER_NAME]: apiKey,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.status === 402 || response.status === 403) {
      throw new CreditExhaustionError("aiark", response.status, "AI Ark person data credits exhausted");
    }

    if (response.status === 401) {
      console.warn(`AI Ark people auth failed: HTTP ${response.status}`);
      throw new Error(`AI Ark people auth error: HTTP ${response.status}`);
    }

    if (response.status === 429) {
      throw Object.assign(new Error("AI Ark rate limit exceeded"), { status: 429 });
    }

    if (response.status === 404 || response.status === 422) {
      throw Object.assign(new Error(`AI Ark people error: HTTP ${response.status}`), {
        status: response.status,
      });
    }

    if (!response.ok) {
      throw Object.assign(new Error(`AI Ark people unexpected error: HTTP ${response.status}`), {
        status: response.status,
      });
    }

    raw = await response.json();
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }

  const people = extractAiArkPeople(raw);
  const firstPerson = people[0];

  if (!firstPerson) {
    // No person data — return empty result (waterfall will continue to email providers)
    return {
      source: "aiark",
      rawResponse: raw,
      costUsd: PROVIDER_COSTS.aiark,
    };
  }

  const parsed = AiArkPersonSchema.safeParse(firstPerson);

  if (!parsed.success) {
    // Validation failed — still charge the cost, return empty result
    console.warn("AI Ark people response failed validation:", parsed.error.message);
    return {
      source: "aiark",
      rawResponse: raw,
      costUsd: PROVIDER_COSTS.aiark,
    };
  }

  return mapToResult(parsed.data, raw);
};
