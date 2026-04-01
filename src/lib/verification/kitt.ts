/**
 * Kitt email finding and verification adapter.
 *
 * Two capabilities:
 * 1. Email Finder: POST https://api.trykitt.ai/job/find_email
 *    Finds email addresses by name + domain. Used in enrichment waterfall
 *    alongside FindyMail and Prospeo.
 *    Cost: $0.005 per found email (free if not found).
 *
 * 2. Email Verifier: POST https://api.trykitt.ai/job/verify_email
 *    FALLBACK verifier -- only called when BounceBan returns unknown.
 *    Cost: $0.0015 per verification.
 *
 * Auth: x-api-key header (KITT_API_KEY env var).
 * All requests use realtime=true for synchronous results.
 */
import { z } from "zod";
import { prisma } from "@/lib/db";
import { incrementDailySpend } from "@/lib/enrichment/costs";
import { recordEnrichment } from "@/lib/enrichment/log";

import type { VerificationResult } from "./bounceban";

const BASE_URL = "https://api.trykitt.ai";
const FIND_EMAIL_ENDPOINT = `${BASE_URL}/job/find_email`;
const VERIFY_EMAIL_ENDPOINT = `${BASE_URL}/job/verify_email`;
const TIMEOUT_MS = 90_000; // realtime requests can be slow

const FIND_EMAIL_COST = 0.005;
const VERIFY_EMAIL_COST = 0.0015;

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const FindEmailResultSchema = z.object({
  email: z.string(),
  confidence: z.number(),
  sources: z.array(z.string()).optional(),
});

const FindEmailResponseSchema = z.object({
  id: z.string(),
  status: z.string(),
  result: FindEmailResultSchema.nullable().optional(),
});

const VerifyEmailResultSchema = z.object({
  email: z.string(),
  valid: z.boolean(),
  deliverable: z.boolean(),
  confidence: z.number().optional(),
  verification_type: z.string().optional(),
});

const VerifyEmailResponseSchema = z.object({
  id: z.string(),
  status: z.string(),
  result: VerifyEmailResultSchema.nullable().optional(),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FindEmailResult {
  email: string | null;
  confidence: number;
  costUsd: number;
}

// Re-export VerificationResult for consumers that import from this module
export type { VerificationResult };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getApiKey(): string {
  const key = process.env.KITT_API_KEY;
  if (!key) throw new Error("KITT_API_KEY environment variable is not set");
  return key;
}

async function kittFetch(endpoint: string, body: Record<string, unknown>): Promise<{ raw: unknown; status: number }> {
  const apiKey = getApiKey();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (res.status === 401) {
      throw new Error("Kitt API authentication failed (401). Check KITT_API_KEY.");
    }
    if (res.status === 402) {
      throw new Error(
        "Kitt API rate limit or insufficient funds (402). Check your Kitt account balance."
      );
    }
    if (!res.ok) {
      throw new Error(`Kitt API HTTP error: ${res.status} ${res.statusText}`);
    }

    const raw = await res.json();
    return { raw, status: res.status };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// findEmail
// ---------------------------------------------------------------------------

/**
 * Find an email address via Kitt.
 *
 * @param params.fullName - Person's full name (required)
 * @param params.domain - Company domain (required)
 * @param params.linkedinUrl - LinkedIn profile URL (optional, improves accuracy)
 * @param params.personId - Person record ID for enrichment logging + caching
 * @returns FindEmailResult with email (or null), confidence, and cost
 */
export async function findEmail(params: {
  fullName: string;
  domain: string;
  linkedinUrl?: string;
  personId?: string;
}): Promise<FindEmailResult> {
  const body: Record<string, unknown> = {
    fullName: params.fullName,
    domain: params.domain,
    realtime: true,
  };
  if (params.linkedinUrl) {
    body.linkedinStandardProfileURL = params.linkedinUrl;
  }

  let raw: unknown;
  try {
    const result = await kittFetch(FIND_EMAIL_ENDPOINT, body);
    raw = result.raw;
  } catch (err) {
    // Log error enrichment if personId available
    if (params.personId) {
      await recordEnrichment({
        entityId: params.personId,
        entityType: "person",
        provider: "kitt-find" as any,
        status: "error",
        errorMessage: err instanceof Error ? err.message : String(err),
        costUsd: 0,
      });
    }
    throw err;
  }

  const parsed = FindEmailResponseSchema.safeParse(raw);

  if (!parsed.success) {
    console.error("[kitt-find] Zod validation failed:", parsed.error.message, "rawResponse:", raw);
    return { email: null, confidence: 0, costUsd: 0 };
  }

  // Non-completed status means the job did not finish
  if (parsed.data.status !== "completed" || !parsed.data.result) {
    if (params.personId) {
      await recordEnrichment({
        entityId: params.personId,
        entityType: "person",
        provider: "kitt-find" as any,
        status: "success",
        fieldsWritten: [],
        costUsd: 0,
        rawResponse: raw,
      });
    }
    return { email: null, confidence: 0, costUsd: 0 };
  }

  const email = parsed.data.result.email;
  const confidence = parsed.data.result.confidence;
  const costUsd = email ? FIND_EMAIL_COST : 0;

  // Track cost (only when an email was found)
  if (costUsd > 0) {
    await incrementDailySpend("kitt-find", costUsd);
  }

  // Log enrichment provenance
  if (params.personId) {
    await recordEnrichment({
      entityId: params.personId,
      entityType: "person",
      provider: "kitt-find" as any,
      status: "success",
      fieldsWritten: email ? ["email"] : [],
      costUsd,
      rawResponse: raw,
    });
  }

  return { email, confidence, costUsd };
}

// ---------------------------------------------------------------------------
// verifyEmail
// ---------------------------------------------------------------------------

/**
 * Verify an email address via Kitt.
 * This is the FALLBACK verifier -- only called when BounceBan returns unknown.
 *
 * Mapping to internal VerificationResult:
 *   valid: true + deliverable: true  -> status "valid",   isExportable: true
 *   valid: true + deliverable: false -> status "risky",   isExportable: false
 *   valid: false                     -> status "invalid", isExportable: false
 *
 * @param email - Email address to verify
 * @param personId - Optional Person record ID for enrichment logging + caching
 * @returns VerificationResult with status and isExportable flag
 */
export async function verifyEmail(
  email: string,
  personId?: string,
): Promise<VerificationResult> {
  let raw: unknown;
  try {
    const result = await kittFetch(VERIFY_EMAIL_ENDPOINT, {
      email,
      treatAliasesAsValid: true,
      realtime: true,
    });
    raw = result.raw;
  } catch (err) {
    if (personId) {
      await recordEnrichment({
        entityId: personId,
        entityType: "person",
        provider: "kitt-verify" as any,
        status: "error",
        errorMessage: err instanceof Error ? err.message : String(err),
        costUsd: 0,
      });
    }
    throw err;
  }

  const parsed = VerifyEmailResponseSchema.safeParse(raw);

  if (!parsed.success) {
    console.error("[kitt-verify] Zod validation failed:", parsed.error.message, "rawResponse:", raw);
    return { email, status: "unknown", isExportable: false, costUsd: 0 };
  }

  // Non-completed status: treat as unknown
  if (parsed.data.status !== "completed" || !parsed.data.result) {
    // Still costs a credit
    await incrementDailySpend("kitt-verify", VERIFY_EMAIL_COST);

    if (personId) {
      await recordEnrichment({
        entityId: personId,
        entityType: "person",
        provider: "kitt-verify" as any,
        status: "success",
        fieldsWritten: ["emailVerificationStatus"],
        costUsd: VERIFY_EMAIL_COST,
        rawResponse: raw,
      });
    }

    return { email, status: "unknown", isExportable: false, costUsd: VERIFY_EMAIL_COST };
  }

  const { valid, deliverable } = parsed.data.result;

  // Map Kitt results to internal status
  let status: VerificationResult["status"];
  let isExportable: boolean;

  if (valid && deliverable) {
    status = "valid";
    isExportable = true;
  } else if (valid && !deliverable) {
    status = "risky";
    isExportable = false;
  } else {
    status = "invalid";
    isExportable = false;
  }

  const costUsd = VERIFY_EMAIL_COST;

  // Track cost
  await incrementDailySpend("kitt-verify", costUsd);

  // Log enrichment provenance
  if (personId) {
    await recordEnrichment({
      entityId: personId,
      entityType: "person",
      provider: "kitt-verify" as any,
      status: "success",
      fieldsWritten: ["emailVerificationStatus"],
      costUsd,
      rawResponse: raw,
    });

    // Persist verification result on Person.enrichmentData
    const person = await prisma.person.findUnique({ where: { id: personId } });
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
          emailVerifiedBy: "kitt",
        }),
      },
    });
  }

  return { email, status, isExportable, costUsd };
}
