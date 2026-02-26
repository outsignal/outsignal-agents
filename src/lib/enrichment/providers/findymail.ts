/**
 * FindyMail email-finding adapter.
 * Finds a person's email given their LinkedIn profile URL.
 *
 * Endpoint: POST https://app.findymail.com/api/search/linkedin
 * Auth: Authorization: Bearer header
 * Docs: https://findymail.com
 *
 * IMPORTANT: API response shape is MEDIUM confidence. This adapter uses:
 * - .passthrough() Zod schema to accept unknown extra fields
 * - Fallback email extraction from common alternative paths
 * - Console logging of rawResponse on EVERY call for initial debugging
 */
import { z } from "zod";
import { PROVIDER_COSTS } from "../costs";
import type { EmailAdapter, EmailProviderResult } from "../types";

const FINDYMAIL_ENDPOINT = "https://app.findymail.com/api/search/linkedin";
const TIMEOUT_MS = 10_000;

function getApiKey(): string {
  const key = process.env.FINDYMAIL_API_KEY;
  if (!key) throw new Error("FINDYMAIL_API_KEY environment variable is not set");
  return key;
}

/**
 * Loose schema with .passthrough() to tolerate unknown response fields.
 * Field names are MEDIUM confidence — validated with safeParse and fallback extraction.
 */
const FindyMailResponseSchema = z
  .object({
    email: z.string().nullable().optional(),
  })
  .passthrough();

/**
 * FindyMail adapter — finds email from LinkedIn profile URL.
 * Returns null email (costUsd=0) when no LinkedIn URL is provided.
 * Logs rawResponse on every call for schema discovery during initial use.
 */
export const findymailAdapter: EmailAdapter = async (
  input
): Promise<EmailProviderResult> => {
  if (!input.linkedinUrl) {
    return {
      email: null,
      source: "findymail",
      rawResponse: { skipped: "no linkedin url" },
      costUsd: 0,
    };
  }

  const apiKey = getApiKey();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let raw: unknown;
  try {
    const res = await fetch(FINDYMAIL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      // Field name "linkedin_url" is best guess — may differ from actual API
      body: JSON.stringify({ linkedin_url: input.linkedinUrl }),
      signal: controller.signal,
    });

    if (!res.ok) {
      if (res.status === 429) {
        const err = new Error(`FindyMail rate-limited: HTTP 429`);
        (err as any).status = 429;
        throw err;
      }
      if (res.status === 404 || res.status === 422) {
        const err = new Error(`FindyMail returned HTTP ${res.status}`);
        (err as any).status = res.status;
        throw err;
      }
      throw new Error(`FindyMail HTTP error: ${res.status} ${res.statusText}`);
    }

    raw = await res.json();
  } finally {
    clearTimeout(timeout);
  }

  // Always log rawResponse for schema discovery during initial integration
  console.log("[findymailAdapter] rawResponse:", JSON.stringify(raw));

  const parsed = FindyMailResponseSchema.safeParse(raw);

  // Fallback email extraction for unknown schema variations
  const email = parsed.success
    ? parsed.data.email ?? null
    : (raw as any)?.email ??
      (raw as any)?.data?.email ??
      (raw as any)?.verified_email ??
      null;

  if (!parsed.success) {
    console.warn("[findymailAdapter] Zod validation failed:", parsed.error.message, "rawResponse:", raw);
  }

  return {
    email,
    source: "findymail",
    rawResponse: raw,
    costUsd: PROVIDER_COSTS.findymail,
  };
};
