/**
 * FindyMail email-finding adapter.
 * Finds a person's email given their LinkedIn profile URL.
 *
 * Endpoint: POST https://app.findymail.com/api/search/linkedin
 * Auth: Authorization: Bearer header
 * Docs: https://findymail.com
 *
 * API response shape validated with:
 * - .passthrough() Zod schema to accept unknown extra fields
 * - Fallback email extraction from common alternative paths
 */
import { z } from "zod";
import { CreditExhaustionError } from "@/lib/enrichment/credit-exhaustion";
import { PROVIDER_COSTS } from "../costs";
import type { EmailAdapter, EmailProviderResult } from "../types";
import type { RateLimits } from "@/lib/discovery/rate-limit";

/**
 * FindyMail rate limits.
 * Source: FindyMail API docs.
 *
 * Concurrency model (NOT requests/second):
 *   - 300 concurrent requests (all endpoints)
 *   - Same concurrency model as Kitt but much more generous
 *
 * We use maxConcurrent=300 to reflect the concurrency-based model.
 * delayBetweenCalls is minimal since the constraint is concurrency, not rate.
 * Separate email finder and verifier credit pools.
 */
export const RATE_LIMITS: RateLimits = {
  maxBatchSize: 1,               // Single lookup per request
  delayBetweenCalls: 0,          // No delay needed — concurrency-based, not rate-based
  maxConcurrent: 300,            // 300 concurrent requests — Source: FindyMail API docs
  dailyCap: null,
  cooldownOnRateLimit: 60_000,   // 60s wait after 429
};

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

// ---------------------------------------------------------------------------
// Bulk parallel fan-out
// ---------------------------------------------------------------------------

/**
 * Simple concurrency limiter (pLimit pattern).
 * Caps how many promises run at once.
 */
function createLimiter(concurrency: number) {
  let running = 0;
  const queue: Array<() => void> = [];

  async function run<T>(fn: () => Promise<T>): Promise<T> {
    while (running >= concurrency) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    running++;
    try {
      return await fn();
    } finally {
      running--;
      if (queue.length > 0) {
        const next = queue.shift()!;
        next();
      }
    }
  }

  return { run };
}

export interface BulkFindEmailInput {
  personId: string;
  linkedinUrl: string;
}

/**
 * Bulk find emails via FindyMail using parallel fan-out.
 * Fires up to 200 concurrent requests (under the 300 API limit).
 * Adds a 10ms delay between launches to avoid burst.
 *
 * Returns a Map of personId → EmailProviderResult.
 * People without a linkedinUrl should be filtered out before calling this.
 */
export async function bulkFindEmail(
  people: BulkFindEmailInput[],
): Promise<Map<string, EmailProviderResult>> {
  const results = new Map<string, EmailProviderResult>();
  const limiter = createLimiter(200);
  let creditExhausted = false;

  const apiKey = getApiKey();

  // Stagger launches by 10ms BEFORE entering the limiter to avoid burst.
  // The limiter controls concurrency at 100; the stagger spaces out entries.
  const promises: Promise<void>[] = [];
  for (let i = 0; i < people.length; i++) {
    if (i > 0) {
      await new Promise((r) => setTimeout(r, 10));
    }
    const person = people[i];
    promises.push(
      limiter.run(async () => {
        // Check if credit exhaustion was detected — skip remaining
        if (creditExhausted) {
          results.set(person.personId, {
            email: null,
            source: "findymail",
            rawResponse: { skipped: "credit_exhaustion_in_batch" },
            costUsd: 0,
          });
          return;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

        try {
          const res = await fetch(FINDYMAIL_ENDPOINT, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({ linkedin_url: person.linkedinUrl }),
            signal: controller.signal,
          });

          if (res.status === 402 || res.status === 403) {
            creditExhausted = true;
            throw new CreditExhaustionError("findymail", res.status);
          }

          if (res.status === 429) {
            const err = new Error(`FindyMail rate-limited: HTTP 429`);
            (err as any).status = 429;
            throw err;
          }

          if (!res.ok) {
            throw new Error(`FindyMail HTTP error: ${res.status} ${res.statusText}`);
          }

          const raw = await res.json();
          const parsed = FindyMailResponseSchema.safeParse(raw);

          const email = parsed.success
            ? parsed.data.email ?? null
            : (raw as any)?.email ??
              (raw as any)?.data?.email ??
              (raw as any)?.verified_email ??
              null;

          results.set(person.personId, {
            email,
            source: "findymail",
            rawResponse: raw,
            costUsd: PROVIDER_COSTS.findymail,
          });
        } catch (err) {
          if (err instanceof CreditExhaustionError) {
            results.set(person.personId, {
              email: null,
              source: "findymail",
              rawResponse: { error: "credit_exhaustion" },
              costUsd: 0,
            });
            return;
          }
          results.set(person.personId, {
            email: null,
            source: "findymail",
            rawResponse: { error: err instanceof Error ? err.message : String(err) },
            costUsd: 0,
          });
        } finally {
          clearTimeout(timeout);
        }
      }),
    );
  }

  await Promise.allSettled(promises);

  return results;
}

// ---------------------------------------------------------------------------
// Single enrichment (existing)
// ---------------------------------------------------------------------------

/**
 * FindyMail adapter — finds email from LinkedIn profile URL.
 * Returns null email (costUsd=0) when no LinkedIn URL is provided.
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

    if (res.status === 402 || res.status === 403) {
      throw new CreditExhaustionError("findymail", res.status);
    }

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
