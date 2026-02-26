/**
 * AI Ark person data provider adapter.
 *
 * Fetches structured person data (job title, company, location, LinkedIn URL, email)
 * from the AI Ark API given a LinkedIn URL or name+company identifiers.
 *
 * IMPORTANT: AI Ark auth header name is LOW confidence (docs say "Header" security
 * scheme without specifying the literal name). Currently using "X-TOKEN" as the most
 * common pattern. If calls return 401/403, check https://ai-ark.com/docs and update
 * AUTH_HEADER_NAME below to match the actual header name.
 */

import { z } from "zod";
import { PROVIDER_COSTS } from "../costs";
import type { EmailAdapterInput, PersonAdapter, PersonProviderResult } from "../types";

const AIARK_PEOPLE_ENDPOINT = "https://api.ai-ark.com/api/developer-portal/v1/people";

/**
 * Auth header literal name for AI Ark API.
 * LOW CONFIDENCE — update if you get 401/403 responses.
 * Candidates: "X-TOKEN", "Authorization" (Bearer), "X-API-Key"
 */
const AUTH_HEADER_NAME = "X-TOKEN";

const REQUEST_TIMEOUT_MS = 10_000;

function getApiKey(): string {
  const key = process.env.AIARK_API_KEY;
  if (!key) {
    throw new Error("AIARK_API_KEY environment variable is not set");
  }
  return key;
}

/**
 * Loose validation schema — AI Ark people response shape is MEDIUM confidence.
 * All fields are optional to be defensive.
 */
const AiArkPersonSchema = z
  .object({
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    title: z.string().optional(),
    linkedin_url: z.string().optional(),
    email: z.string().optional(),
    location: z.string().optional(),
    company: z
      .object({
        name: z.string().optional(),
        domain: z.string().optional(),
      })
      .optional(),
  })
  .passthrough();

type AiArkPerson = z.infer<typeof AiArkPersonSchema>;

/**
 * Normalize raw API response to an array of person records.
 * AI Ark may return a single object, an array, or wrap results in a `data` key.
 */
function extractPeople(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (obj.data !== undefined) {
      return Array.isArray(obj.data) ? obj.data : [obj.data];
    }
  }
  return [raw];
}

function mapToResult(person: AiArkPerson, raw: unknown): PersonProviderResult {
  return {
    firstName: person.first_name,
    lastName: person.last_name,
    jobTitle: person.title,
    linkedinUrl: person.linkedin_url,
    email: person.email,
    location: person.location,
    company: person.company?.name,
    companyDomain: person.company?.domain,
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

    if (response.status === 401 || response.status === 403) {
      console.warn(
        `AI Ark people auth failed (${response.status}) — verify AUTH_HEADER_NAME in aiark-person.ts matches API docs. ` +
          `Currently using "${AUTH_HEADER_NAME}". Check https://ai-ark.com/docs for the correct header name.`,
      );
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

  const people = extractPeople(raw);
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
