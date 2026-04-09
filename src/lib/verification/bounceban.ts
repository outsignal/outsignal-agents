/**
 * BounceBan email verification adapter.
 * Verifies email deliverability via BounceBan Waterfall API.
 *
 * Endpoint: GET https://api-waterfall.bounceban.com/v1/verify/single
 * Auth: Authorization header with raw API key (no Bearer prefix)
 *
 * Result values: deliverable | risky | undeliverable | unknown
 * Export policy: STRICT -- only "deliverable" emails are exportable.
 * Cost: $0.005 per verification (1 credit), regardless of result.
 *
 * Waterfall endpoint benefits: longer timeout, free retries within 30 min.
 * Rate limit: 100 req/sec on /verify/single (Source: BounceBan API docs).
 */
import { z } from "zod";
import { prisma } from "@/lib/db";
import { CreditExhaustionError } from "@/lib/enrichment/credit-exhaustion";
import { incrementDailySpend } from "@/lib/enrichment/costs";
import { recordEnrichment } from "@/lib/enrichment/log";
import type { RateLimits } from "@/lib/discovery/rate-limit";

/**
 * BounceBan rate limits.
 * Source: BounceBan API docs.
 *
 * Per-endpoint limits:
 *   - /verify/single: 100 requests/second
 *   - /verify/bulk:   5 requests/second
 *   - /check:         25 requests/second
 *   - /account:       5 requests/second
 *
 * This adapter uses /verify/single exclusively (Waterfall endpoint).
 */
export const RATE_LIMITS: RateLimits = {
  maxBatchSize: 1,               // Single email per verification request
  delayBetweenCalls: 10,         // 100 req/s — Source: BounceBan API docs (/verify/single)
  maxConcurrent: 1,
  dailyCap: null,
  cooldownOnRateLimit: 60_000,   // 60s wait after 429
};

const VERIFY_ENDPOINT =
  "https://api-waterfall.bounceban.com/v1/verify/single";
const TIMEOUT_MS = 90_000; // 80s server timeout + 10s buffer
const RETRY_DELAY_MS = 5_000;
const COST_PER_VERIFICATION = 0.005;

export interface VerificationResult {
  email: string;
  status:
    | "valid"
    | "invalid"
    | "valid_catch_all"
    | "catch_all"
    | "risky"
    | "unknown";
  isExportable: boolean; // true ONLY for "valid" (deliverable)
  costUsd: number;
}

const BounceBanResponseSchema = z.object({
  id: z.string(),
  status: z.literal("success"),
  email: z.string(),
  result: z.enum(["deliverable", "risky", "undeliverable", "unknown"]),
  score: z.number(),
  is_disposable: z.boolean(),
  is_accept_all: z.boolean(),
  is_role: z.boolean(),
  is_free: z.boolean(),
  mx_records: z.array(z.string()),
  smtp_provider: z.string(),
  credits_consumed: z.number(),
  credits_remaining: z.number(),
});

const BounceBanTimeoutSchema = z.object({
  id: z.string(),
  error: z.literal("Verification timeout"),
  message: z.string(),
});

function getApiKey(): string {
  const key = process.env.BOUNCEBAN_API_KEY;
  if (!key)
    throw new Error("BOUNCEBAN_API_KEY environment variable is not set");
  return key;
}

/**
 * Map BounceBan result to our internal verification status.
 */
function mapResult(
  result: "deliverable" | "risky" | "undeliverable" | "unknown",
  isAcceptAll: boolean,
): { status: VerificationResult["status"]; isExportable: boolean } {
  switch (result) {
    case "deliverable":
      return { status: "valid", isExportable: true };
    case "risky":
      if (isAcceptAll) {
        return { status: "catch_all", isExportable: false };
      }
      return { status: "risky", isExportable: false };
    case "undeliverable":
      return { status: "invalid", isExportable: false };
    case "unknown":
      return { status: "unknown", isExportable: false };
  }
}

/**
 * Make a single verification request to BounceBan.
 * Returns the parsed response or null on timeout (408).
 */
async function makeRequest(
  email: string,
  apiKey: string,
): Promise<z.infer<typeof BounceBanResponseSchema> | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const url = new URL(VERIFY_ENDPOINT);
    url.searchParams.set("email", email);
    url.searchParams.set("timeout", "80");

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: apiKey,
      },
      signal: controller.signal,
    });

    if (res.status === 408) {
      // Verification timeout -- caller should retry
      return null;
    }

    if (res.status === 403) {
      throw new CreditExhaustionError("bounceban", 403);
    }

    if (res.status === 429) {
      const err = new Error("BounceBan verify rate-limited: HTTP 429");
      (err as any).status = 429;
      throw err;
    }

    if (!res.ok) {
      throw new Error(
        `BounceBan verify HTTP error: ${res.status} ${res.statusText}`,
      );
    }

    const raw = await res.json();

    // Check if it's a timeout response in the body (some APIs return 200 with timeout payload)
    const timeoutParsed = BounceBanTimeoutSchema.safeParse(raw);
    if (timeoutParsed.success) {
      return null;
    }

    const parsed = BounceBanResponseSchema.safeParse(raw);
    if (!parsed.success) {
      console.error(
        "[bounceban-verify] Zod validation failed:",
        parsed.error.message,
        "rawResponse:",
        raw,
      );
      return null;
    }

    return parsed.data;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Verify an email address via BounceBan Waterfall API.
 *
 * @param email - Email address to verify
 * @param personId - Optional Person record ID for enrichment logging + caching
 * @returns Verification result with status and isExportable flag
 */
export async function verifyEmail(
  email: string,
  personId?: string,
): Promise<VerificationResult> {
  const apiKey = getApiKey();

  // First attempt
  let response = await makeRequest(email, apiKey);

  // On timeout, retry once after 5 seconds
  if (!response) {
    console.warn(
      `[bounceban-verify] Timeout for ${email}, retrying in ${RETRY_DELAY_MS}ms...`,
    );
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    response = await makeRequest(email, apiKey);
  }

  // If still no response after retry, return unknown
  if (!response) {
    console.error(
      `[bounceban-verify] Timeout after retry for ${email}, returning unknown`,
    );
    return { email, status: "unknown", isExportable: false, costUsd: 0 };
  }

  const { status, isExportable } = mapResult(
    response.result,
    response.is_accept_all,
  );
  const costUsd = COST_PER_VERIFICATION;

  // Track cost
  await incrementDailySpend("bounceban-verify", costUsd);

  // Log enrichment provenance (only when personId available)
  if (personId) {
    await recordEnrichment({
      entityId: personId,
      entityType: "person",
      provider: "bounceban-verify",
      status: "success",
      fieldsWritten: ["emailVerificationStatus"],
      costUsd,
      rawResponse: response,
    });

    // Persist verification result on Person.enrichmentData
    const person = await prisma.person.findUnique({
      where: { id: personId },
    });
    const existing = person?.enrichmentData
      ? JSON.parse(person.enrichmentData)
      : {};
    await prisma.person.update({
      where: { id: personId },
      data: {
        enrichmentData: JSON.stringify({
          ...existing,
          emailVerificationStatus: status,
          emailVerifiedAt: new Date().toISOString(),
          emailVerificationProvider: "bounceban",
          emailVerificationScore: response.score,
          emailIsDisposable: response.is_disposable,
          emailIsRole: response.is_role,
          emailIsFree: response.is_free,
          emailSmtpProvider: response.smtp_provider,
        }),
      },
    });
  }

  return { email, status, isExportable, costUsd };
}

// ---------------------------------------------------------------------------
// Bulk verification (async: submit → poll → retrieve)
// ---------------------------------------------------------------------------

const BULK_SUBMIT_ENDPOINT = "https://api.bounceban.com/v1/verify/bulk";
const BULK_STATUS_ENDPOINT = "https://api.bounceban.com/v1/verify/bulk/status";
const BULK_DUMP_ENDPOINT = "https://api.bounceban.com/v1/verify/bulk/dump";
const BULK_POLL_INTERVAL_MS = 5_000;
const BULK_TIMEOUT_MS = 10 * 60 * 1_000; // 10 minutes

const BulkSubmitResponseSchema = z.object({
  id: z.string(),
  credits_remaining: z.number().optional(),
}).passthrough();

const BulkStatusResponseSchema = z.object({
  id: z.string(),
  status: z.string(),
  total_count: z.number().optional(),
  deliverable_count: z.number().optional(),
  undeliverable_count: z.number().optional(),
  risky_count: z.number().optional(),
  unknown_count: z.number().optional(),
  credits_consumed: z.number().optional(),
  credits_remaining: z.number().optional(),
}).passthrough();

const BulkDumpItemSchema = z.object({
  email: z.string(),
  result: z.enum(["deliverable", "risky", "undeliverable", "unknown"]),
  score: z.number(),
  is_disposable: z.boolean(),
  is_accept_all: z.boolean(),
  is_role: z.boolean(),
  is_free: z.boolean(),
  mx_records: z.array(z.string()).optional(),
  smtp_provider: z.string().optional(),
}).passthrough();

const BulkDumpResponseSchema = z.object({
  items: z.array(BulkDumpItemSchema),
  result: z.string().optional(),
}).passthrough();

export interface BulkVerifyEntry {
  email: string;
  personId: string;
}

/**
 * Bulk verify emails via BounceBan async bulk API.
 * Submits all emails, polls until finished, retrieves results.
 * Returns a Map of personId → VerificationResult.
 */
export async function bulkVerifyEmails(
  entries: BulkVerifyEntry[],
): Promise<Map<string, VerificationResult>> {
  const results = new Map<string, VerificationResult>();

  if (entries.length === 0) return results;

  const apiKey = getApiKey();
  const emails = entries.map((e) => e.email);

  // Build email→personId lookup (handle duplicates: last wins)
  const emailToPersonId = new Map<string, string>();
  for (const entry of entries) {
    emailToPersonId.set(entry.email.toLowerCase(), entry.personId);
  }

  // --- Step 1: Submit ---
  const submitRes = await fetch(BULK_SUBMIT_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({ emails }),
  });

  if (submitRes.status === 403) {
    throw new CreditExhaustionError("bounceban", 403);
  }
  if (!submitRes.ok) {
    throw new Error(`BounceBan bulk submit HTTP error: ${submitRes.status} ${submitRes.statusText}`);
  }

  const submitRaw = await submitRes.json();
  const submitParsed = BulkSubmitResponseSchema.safeParse(submitRaw);
  if (!submitParsed.success) {
    throw new Error(`BounceBan bulk submit invalid response: ${submitParsed.error.message}`);
  }

  const taskId = submitParsed.data.id;
  console.log(`[bounceban-bulk] Submitted ${emails.length} emails, taskId=${taskId}`);

  // --- Step 2: Poll until finished ---
  const startTime = Date.now();
  let finished = false;

  while (!finished) {
    if (Date.now() - startTime > BULK_TIMEOUT_MS) {
      console.error(`[bounceban-bulk] Timeout waiting for taskId=${taskId} after ${BULK_TIMEOUT_MS / 1000}s`);
      // Return unknown for all entries
      for (const entry of entries) {
        results.set(entry.personId, {
          email: entry.email,
          status: "unknown",
          isExportable: false,
          costUsd: 0,
        });
      }
      return results;
    }

    await new Promise((resolve) => setTimeout(resolve, BULK_POLL_INTERVAL_MS));

    const statusUrl = new URL(BULK_STATUS_ENDPOINT);
    statusUrl.searchParams.set("id", taskId);

    const statusRes = await fetch(statusUrl.toString(), {
      method: "GET",
      headers: { Authorization: apiKey },
    });

    if (statusRes.status === 403) {
      throw new CreditExhaustionError("bounceban", 403);
    }
    if (!statusRes.ok) {
      console.warn(`[bounceban-bulk] Status poll HTTP ${statusRes.status}, retrying...`);
      continue;
    }

    const statusRaw = await statusRes.json();
    const statusParsed = BulkStatusResponseSchema.safeParse(statusRaw);

    if (!statusParsed.success) {
      console.warn(`[bounceban-bulk] Status poll parse error:`, statusParsed.error.message);
      continue;
    }

    if (statusParsed.data.status === "finished") {
      finished = true;
      console.log(`[bounceban-bulk] Task ${taskId} finished. Credits consumed: ${statusParsed.data.credits_consumed ?? "unknown"}`);
    }
  }

  // --- Step 3: Retrieve results ---
  const dumpUrl = new URL(BULK_DUMP_ENDPOINT);
  dumpUrl.searchParams.set("id", taskId);
  dumpUrl.searchParams.set("retrieve_all", "1");

  const dumpRes = await fetch(dumpUrl.toString(), {
    method: "GET",
    headers: { Authorization: apiKey },
  });

  if (dumpRes.status === 403) {
    throw new CreditExhaustionError("bounceban", 403);
  }
  if (!dumpRes.ok) {
    throw new Error(`BounceBan bulk dump HTTP error: ${dumpRes.status} ${dumpRes.statusText}`);
  }

  const dumpRaw = await dumpRes.json();
  const dumpParsed = BulkDumpResponseSchema.safeParse(dumpRaw);

  if (!dumpParsed.success) {
    console.error(`[bounceban-bulk] Dump parse error:`, dumpParsed.error.message, "raw:", dumpRaw);
    // Return unknown for all
    for (const entry of entries) {
      results.set(entry.personId, {
        email: entry.email,
        status: "unknown",
        isExportable: false,
        costUsd: COST_PER_VERIFICATION,
      });
    }
    return results;
  }

  // Map results back to personIds via email join key
  for (const item of dumpParsed.data.items) {
    const personId = emailToPersonId.get(item.email.toLowerCase());
    if (!personId) {
      console.warn(`[bounceban-bulk] Result for unknown email: ${item.email}`);
      continue;
    }

    const { status, isExportable } = mapResult(item.result, item.is_accept_all);
    const costUsd = COST_PER_VERIFICATION;

    results.set(personId, {
      email: item.email,
      status,
      isExportable,
      costUsd,
    });

    // Track cost
    await incrementDailySpend("bounceban-verify", costUsd);

    // Record enrichment log
    await recordEnrichment({
      entityId: personId,
      entityType: "person",
      provider: "bounceban-verify",
      status: "success",
      fieldsWritten: ["emailVerificationStatus"],
      costUsd,
      rawResponse: item,
    });

    // Persist verification result on Person.enrichmentData
    const person = await prisma.person.findUnique({ where: { id: personId } });
    const existing = person?.enrichmentData
      ? (() => { try { return JSON.parse(person.enrichmentData); } catch { return {}; } })()
      : {};
    await prisma.person.update({
      where: { id: personId },
      data: {
        enrichmentData: JSON.stringify({
          ...existing,
          emailVerificationStatus: status,
          emailVerifiedAt: new Date().toISOString(),
          emailVerificationProvider: "bounceban",
          emailVerificationScore: item.score,
          emailIsDisposable: item.is_disposable,
          emailIsRole: item.is_role,
          emailIsFree: item.is_free,
          emailSmtpProvider: item.smtp_provider ?? null,
        }),
      },
    });
  }

  // Any entries not in the dump result → unknown
  for (const entry of entries) {
    if (!results.has(entry.personId)) {
      results.set(entry.personId, {
        email: entry.email,
        status: "unknown",
        isExportable: false,
        costUsd: 0,
      });
    }
  }

  return results;
}

/**
 * Check if a person's email is verified and exportable.
 * Returns cached verification status if available, null if never verified.
 */
export async function getVerificationStatus(
  personId: string,
): Promise<{ status: string; isExportable: boolean } | null> {
  const person = await prisma.person.findUnique({ where: { id: personId } });
  if (!person?.enrichmentData) return null;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(person.enrichmentData);
  } catch {
    return null;
  }

  if (!data.emailVerificationStatus) return null;

  const status = data.emailVerificationStatus as string;
  return {
    status,
    isExportable: status === "valid",
  };
}
