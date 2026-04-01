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
 * Rate limit: 25 req/sec.
 */
import { z } from "zod";
import { prisma } from "@/lib/db";
import { incrementDailySpend } from "@/lib/enrichment/costs";
import { recordEnrichment } from "@/lib/enrichment/log";

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
      throw new Error(
        "BounceBan verify failed: insufficient credits (HTTP 403). Top up your BounceBan account.",
      );
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
