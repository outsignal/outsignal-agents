/**
 * Prospeo email-finding adapter.
 * Finds a person's email given their LinkedIn URL, or falls back to name+company lookup.
 *
 * Endpoint: POST https://api.prospeo.io/enrich-person
 * Auth: X-KEY header
 * Docs: https://prospeo.io/api
 *
 * NOTE: /social-url-finder was removed March 2026 — use /enrich-person exclusively.
 */
import { z } from "zod";
import { PROVIDER_COSTS } from "../costs";
import type { EmailAdapter, EmailProviderResult } from "../types";

const PROSPEO_ENDPOINT = "https://api.prospeo.io/enrich-person";
const TIMEOUT_MS = 10_000;

function getApiKey(): string {
  const key = process.env.PROSPEO_API_KEY;
  if (!key) throw new Error("PROSPEO_API_KEY environment variable is not set");
  return key;
}

const ProspeoResponseSchema = z.object({
  error: z.boolean(),
  person: z
    .object({
      email: z
        .object({
          email: z.string().nullable().optional(),
        })
        .optional(),
    })
    .optional(),
});

/**
 * Prospeo adapter — finds email via LinkedIn URL or name+company fallback.
 * Returns null email (costUsd=0) when insufficient input provided.
 */
export const prospeoAdapter: EmailAdapter = async (
  input
): Promise<EmailProviderResult> => {
  const hasLinkedin = Boolean(input.linkedinUrl);
  const hasNameAndCompany =
    Boolean(input.firstName) &&
    Boolean(input.lastName) &&
    Boolean(input.companyName ?? input.companyDomain);

  // Early return if we can't form a valid request
  if (!hasLinkedin && !hasNameAndCompany) {
    return {
      email: null,
      source: "prospeo",
      rawResponse: { skipped: "insufficient input" },
      costUsd: 0,
    };
  }

  const apiKey = getApiKey();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let raw: unknown;
  try {
    const body = hasLinkedin
      ? { data: { linkedin_url: input.linkedinUrl } }
      : {
          data: {
            first_name: input.firstName,
            last_name: input.lastName,
            company_name: input.companyName,
            company_website: input.companyDomain,
          },
        };

    const res = await fetch(PROSPEO_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-KEY": apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      if (res.status === 429) {
        const err = new Error(`Prospeo rate-limited: HTTP 429`);
        (err as any).status = 429;
        throw err;
      }
      if (res.status === 404 || res.status === 422) {
        const err = new Error(`Prospeo returned HTTP ${res.status}`);
        (err as any).status = res.status;
        throw err;
      }
      throw new Error(`Prospeo HTTP error: ${res.status} ${res.statusText}`);
    }

    raw = await res.json();
  } finally {
    clearTimeout(timeout);
  }

  const parsed = ProspeoResponseSchema.safeParse(raw);

  if (!parsed.success) {
    console.warn("[prospeoAdapter] Zod validation failed:", parsed.error.message, "rawResponse:", raw);
    return {
      email: null,
      source: "prospeo",
      rawResponse: raw,
      costUsd: PROVIDER_COSTS.prospeo,
    };
  }

  const email = parsed.data.person?.email?.email ?? null;

  return {
    email,
    source: "prospeo",
    rawResponse: raw,
    costUsd: PROVIDER_COSTS.prospeo,
  };
};
