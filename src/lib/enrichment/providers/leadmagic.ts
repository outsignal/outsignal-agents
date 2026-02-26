/**
 * LeadMagic email-finding adapter.
 * Finds a person's email given their LinkedIn profile URL.
 *
 * Endpoint: POST https://api.leadmagic.io/v1/people/b2b-profile-to-email
 * Auth: X-API-Key header
 * Docs: https://leadmagic.io
 *
 * NOTE: Requires LinkedIn URL — returns null email without making an API call if not provided.
 */
import { z } from "zod";
import { PROVIDER_COSTS } from "../costs";
import type { EmailAdapter, EmailProviderResult } from "../types";

const LEADMAGIC_ENDPOINT = "https://api.leadmagic.io/v1/people/b2b-profile-to-email";
const TIMEOUT_MS = 10_000;

function getApiKey(): string {
  const key = process.env.LEADMAGIC_API_KEY;
  if (!key) throw new Error("LEADMAGIC_API_KEY environment variable is not set");
  return key;
}

const LeadMagicResponseSchema = z.object({
  email: z.string().nullable().optional(),
  credits_consumed: z.number().optional(),
});

/**
 * LeadMagic adapter — finds email from LinkedIn profile URL.
 * Returns null email (costUsd=0) when no LinkedIn URL is provided.
 */
export const leadmagicAdapter: EmailAdapter = async (
  input
): Promise<EmailProviderResult> => {
  if (!input.linkedinUrl) {
    return {
      email: null,
      source: "leadmagic",
      rawResponse: { skipped: "no linkedin url" },
      costUsd: 0,
    };
  }

  const apiKey = getApiKey();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let raw: unknown;
  try {
    const res = await fetch(LEADMAGIC_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify({ profile_url: input.linkedinUrl }),
      signal: controller.signal,
    });

    if (!res.ok) {
      if (res.status === 429) {
        const err = new Error(`LeadMagic rate-limited: HTTP 429`);
        (err as any).status = 429;
        throw err;
      }
      if (res.status === 404 || res.status === 422) {
        const err = new Error(`LeadMagic returned HTTP ${res.status}`);
        (err as any).status = res.status;
        throw err;
      }
      throw new Error(`LeadMagic HTTP error: ${res.status} ${res.statusText}`);
    }

    raw = await res.json();
  } finally {
    clearTimeout(timeout);
  }

  const parsed = LeadMagicResponseSchema.safeParse(raw);

  if (!parsed.success) {
    console.warn("[leadmagicAdapter] Zod validation failed:", parsed.error.message, "rawResponse:", raw);
    return {
      email: null,
      source: "leadmagic",
      rawResponse: raw,
      costUsd: PROVIDER_COSTS.leadmagic,
    };
  }

  const email = parsed.data.email ?? null;

  return {
    email,
    source: "leadmagic",
    rawResponse: raw,
    costUsd: PROVIDER_COSTS.leadmagic,
  };
};
