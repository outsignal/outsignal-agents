/**
 * LeadMagic email verification adapter.
 * Verifies email deliverability via LeadMagic API.
 *
 * Endpoint: POST https://api.leadmagic.io/v1/people/email-validation
 * Auth: X-API-Key header (same LEADMAGIC_API_KEY as email-finding adapter)
 *
 * Status values: valid | invalid | valid_catch_all | catch_all | unknown
 * Export policy: STRICT — only "valid" emails are exportable.
 * Cost: $0.05 for valid/invalid/valid_catch_all; FREE for catch_all/unknown.
 *
 * IMPORTANT: catch_all and valid_catch_all are BOTH blocked from export.
 * "valid_catch_all" sounds safe because "valid" is in the name, but the
 * domain accepts ALL emails — deliverability is unverifiable.
 */
import { z } from "zod";
import { prisma } from "@/lib/db";
import { incrementDailySpend } from "@/lib/enrichment/costs";
import { recordEnrichment } from "@/lib/enrichment/log";

const VERIFY_ENDPOINT = "https://api.leadmagic.io/v1/people/email-validation";
const TIMEOUT_MS = 10_000;

export interface VerificationResult {
  email: string;
  status: "valid" | "invalid" | "valid_catch_all" | "catch_all" | "unknown";
  isExportable: boolean;  // true ONLY for "valid"
  costUsd: number;
}

const VerifyResponseSchema = z.object({
  email_status: z.enum(["valid", "invalid", "valid_catch_all", "catch_all", "unknown"]),
  email: z.string().optional(),
  credits_consumed: z.number().optional(),
});

/** Cost per verification call by status. catch_all and unknown are free. */
const VERIFICATION_COST: Record<string, number> = {
  valid: 0.05,
  invalid: 0.05,
  valid_catch_all: 0.05,
  catch_all: 0,
  unknown: 0,
};

function getApiKey(): string {
  const key = process.env.LEADMAGIC_API_KEY;
  if (!key) throw new Error("LEADMAGIC_API_KEY environment variable is not set");
  return key;
}

/**
 * Verify an email address via LeadMagic.
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let raw: unknown;
  try {
    const res = await fetch(VERIFY_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify({ email }),
      signal: controller.signal,
    });

    if (!res.ok) {
      if (res.status === 429) {
        const err = new Error(`LeadMagic verify rate-limited: HTTP 429`);
        (err as any).status = 429;
        throw err;
      }
      if (res.status === 404 || res.status === 422) {
        const err = new Error(`LeadMagic verify returned HTTP ${res.status}`);
        (err as any).status = res.status;
        throw err;
      }
      throw new Error(`LeadMagic verify HTTP error: ${res.status} ${res.statusText}`);
    }

    raw = await res.json();
  } finally {
    clearTimeout(timeout);
  }

  const parsed = VerifyResponseSchema.safeParse(raw);

  if (!parsed.success) {
    // Fail-safe: unknown = not exportable
    console.error("[leadmagic-verify] Zod validation failed:", parsed.error.message, "rawResponse:", raw);
    return { email, status: "unknown", isExportable: false, costUsd: 0 };
  }

  const status = parsed.data.email_status;
  const costUsd = VERIFICATION_COST[status] ?? 0;
  const isExportable = status === "valid";

  // Track cost (only when a charge applies)
  if (costUsd > 0) {
    await incrementDailySpend("leadmagic-verify", costUsd);
  }

  // Log enrichment provenance (only when personId available)
  if (personId) {
    await recordEnrichment({
      entityId: personId,
      entityType: "person",
      provider: "leadmagic-verify",
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
        }),
      },
    });
  }

  return { email, status, isExportable, costUsd };
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
