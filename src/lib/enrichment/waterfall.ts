/**
 * Waterfall enrichment orchestrators.
 *
 * enrichEmail: AI Ark (person data) → FindyMail → Prospeo → Kitt (cheapest-first).
 *   AI Ark runs first as a person-data step (fills jobTitle, company, location, etc.).
 *   Then FindyMail → Prospeo → Kitt run in cheapest-first order to find the email.
 *   Each found email is verified via BounceBan (+ Kitt fallback for unknowns).
 *   If verification fails, the email is rejected and the next provider is tried.
 *   Only verified-valid emails are accepted and saved.
 * enrichCompany: Tries AI Ark → Firecrawl in order, stopping at first success with data.
 *
 * Waterfall order: AI Ark (person data) → FindyMail → Prospeo → Kitt.
 * Verification: BounceBan (primary) → Kitt (fallback for unknowns).
 *
 * Both functions apply:
 * - Circuit breaker: skips a provider after 5 consecutive failures within a batch
 * - Dedup gate: skips providers that have already successfully enriched this entity
 * - Daily cost cap: pauses the job (throws DAILY_CAP_HIT) when the daily limit is reached
 * - Exponential backoff on 429 rate-limit responses (1s, 2s, 4s, up to 3 retries)
 * - AI normalizers run inline after data is written to person/company records
 */
import { prisma } from "@/lib/db";
import { shouldEnrich } from "./dedup";
import { recordEnrichment } from "./log";
import { checkDailyCap, incrementDailySpend } from "./costs";
import { mergePersonData, mergeCompanyData } from "./merge";
import { prospeoAdapter } from "./providers/prospeo";
import { findymailAdapter } from "./providers/findymail";
import { kittAdapter } from "./providers/kitt";
import { aiarkAdapter } from "./providers/aiark";
import { aiarkPersonAdapter } from "./providers/aiark-person";
import { firecrawlCompanyAdapter } from "./providers/firecrawl-company";
import { classifyIndustry, classifyJobTitle, classifyCompanyName } from "@/lib/normalizer";
import { isRateLimited } from "@/lib/http-error";
import { verifyEmail as bouncebanVerify } from "@/lib/verification/bounceban";
import { verifyEmail as kittVerify } from "@/lib/verification/kitt";
import { CreditExhaustionError, isCreditExhaustion } from "@/lib/enrichment/credit-exhaustion";
import { notifyCreditExhaustion } from "@/lib/notifications";
import type { Provider, EmailAdapterInput, EmailAdapter, CompanyAdapter, PersonAdapter, PersonProviderResult } from "./types";

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

export interface CircuitBreaker {
  consecutiveFailures: Map<string, number>;
}

export function createCircuitBreaker(): CircuitBreaker {
  return { consecutiveFailures: new Map() };
}

// ---------------------------------------------------------------------------
// Backoff utilities
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function exponentialBackoff(attempt: number): number {
  // attempt 0 → 1s, attempt 1 → 2s, attempt 2 → 4s
  return Math.pow(2, attempt) * 1000;
}

const CIRCUIT_BREAKER_THRESHOLD = 5;
const MAX_RETRIES = 3;

// ---------------------------------------------------------------------------
// Email verification helper
// ---------------------------------------------------------------------------

/**
 * Verify a found email via BounceBan, with Kitt as fallback for unknown results.
 *
 * Returns true if the email is valid (should be accepted).
 * Returns false if the email is invalid/risky/undeliverable (should be rejected).
 *
 * Flow:
 *   1. BounceBan verify → "valid" → accept (true)
 *   2. BounceBan verify → "unknown" → Kitt verify fallback
 *      - Kitt "valid" → accept (true)
 *      - Kitt anything else → reject (false)
 *   3. BounceBan verify → "invalid"/"risky"/"catch_all" → reject (false)
 *   4. BounceBan error → treat as unknown → Kitt fallback
 */
async function verifyFoundEmail(
  email: string,
  personId: string,
): Promise<boolean> {
  try {
    const bbResult = await bouncebanVerify(email, personId);

    if (bbResult.status === "valid" || bbResult.status === "valid_catch_all") {
      return true; // verified deliverable
    }

    if (bbResult.status === "unknown") {
      // BounceBan inconclusive — try Kitt as fallback verifier
      console.log(`[waterfall] BounceBan returned unknown for ${email} — trying Kitt verify`);
      try {
        const kittResult = await kittVerify(email, personId);
        if (kittResult.status === "valid") {
          return true; // Kitt says valid
        }
        console.warn(`[waterfall] Kitt verify returned ${kittResult.status} for ${email} — rejecting`);
        return false;
      } catch (kittErr) {
        // Credit exhaustion in Kitt verifier — treat as unverifiable, reject this email
        if (isCreditExhaustion(kittErr)) {
          console.warn(`[waterfall] Kitt verify credit exhaustion for ${email} — treating as unverifiable, rejecting`);
          return false;
        }
        console.warn(`[waterfall] Kitt verify error for ${email}:`, kittErr);
        return false; // both verifiers failed — reject
      }
    }

    // invalid, risky, catch_all — reject
    console.warn(`[waterfall] BounceBan returned ${bbResult.status} for ${email} — rejecting`);
    return false;
  } catch (err) {
    // Credit exhaustion in BounceBan — treat as unverifiable, reject this email
    if (isCreditExhaustion(err)) {
      console.warn(`[waterfall] BounceBan credit exhaustion for ${email} — treating as unverifiable, rejecting`);
      return false;
    }
    // BounceBan error — try Kitt as fallback
    console.warn(`[waterfall] BounceBan error for ${email}:`, err, "— trying Kitt fallback");
    try {
      const kittResult = await kittVerify(email, personId);
      if (kittResult.status === "valid") {
        return true;
      }
      return false;
    } catch (kittErr) {
      // Credit exhaustion in Kitt fallback — treat as unverifiable, reject this email
      if (isCreditExhaustion(kittErr)) {
        console.warn(`[waterfall] Kitt verify credit exhaustion (fallback) for ${email} — treating as unverifiable, rejecting`);
        return false;
      }
      console.warn(`[waterfall] Kitt verify also failed for ${email}:`, kittErr);
      return false; // both verifiers unavailable — reject to be safe
    }
  }
}

// ---------------------------------------------------------------------------
// enrichEmail
// ---------------------------------------------------------------------------

interface EmailProvider {
  adapter: EmailAdapter;
  name: Provider;
}

const EMAIL_PROVIDERS: EmailProvider[] = [
  { adapter: findymailAdapter, name: "findymail" },  // $0.001 — cheapest first
  { adapter: prospeoAdapter, name: "prospeo" },      // $0.002
  { adapter: kittAdapter, name: "kitt-find" },       // $0.005
];

/**
 * Run the email enrichment waterfall for a person.
 *
 * Tries FindyMail → Prospeo → Kitt (cheapest-first). Each found email is
 * verified via BounceBan before acceptance. If BounceBan returns "unknown",
 * Kitt verify is used as fallback. Invalid/risky emails are rejected and
 * the waterfall continues to the next provider. Only verified-valid emails
 * are saved. When no LinkedIn URL is present, FindyMail is skipped.
 *
 * Throws "DAILY_CAP_HIT" when the daily cost cap is reached — the queue
 * processor catches this and pauses the job until midnight UTC.
 */
export async function enrichEmail(
  personId: string,
  input: EmailAdapterInput,
  breaker: CircuitBreaker,
  workspaceSlug?: string,
): Promise<void> {
  // ---------------------------------------------------------------------------
  // BL-037: Verify pre-existing emails (e.g. from Apify Leads Finder)
  //
  // If the person already has an email from discovery (e.g. Apify Leads Finder
  // returns "verified" emails), we must run it through BounceBan verification
  // before accepting it. The only exception is AI Ark export-sourced emails,
  // which are pre-verified by BounceBan on AI Ark's side.
  //
  // This handles the single-person code path. The batch path
  // (enrichEmailBatch) already handles this via the alreadyHaveEmail list.
  // ---------------------------------------------------------------------------
  const existingPerson = await prisma.person.findUnique({
    where: { id: personId },
    select: { email: true, source: true },
  });

  if (existingPerson?.email && input.discoverySource !== "aiark-export") {
    const isVerified = await verifyFoundEmail(existingPerson.email, personId);
    if (isVerified) {
      console.log(`[waterfall] Pre-existing email ${existingPerson.email} verified for person ${personId} — done`);
      return; // verified valid — no further enrichment needed
    }
    // Verification failed — null out the unverified email and continue with waterfall
    console.warn(`[waterfall] Pre-existing email ${existingPerson.email} failed verification for person ${personId} — nulling out and continuing waterfall`);
    await prisma.person.update({
      where: { id: personId },
      data: { email: null },
    });
  }

  // ---------------------------------------------------------------------------
  // AI Ark source-first: direct export/single by stored AI Ark person ID (BL-040)
  // ---------------------------------------------------------------------------
  // If this person was discovered via AI Ark search and we have their AI Ark ID,
  // try a direct lookup first — higher hit rate than generic enrichment.
  if (input.discoverySource === "aiark" && input.sourceId) {
    const aiarkSfFailures = breaker.consecutiveFailures.get("aiark") ?? 0;
    if (aiarkSfFailures < CIRCUIT_BREAKER_THRESHOLD) {
      const capHit = await checkDailyCap();
      if (capHit) throw new Error("DAILY_CAP_HIT");

      try {
        const aiarkSfResults = await bulkEnrichByAiArkId([
          { personId, aiarkPersonId: input.sourceId },
        ]);
        const sfResult = aiarkSfResults.get(personId);

        if (sfResult) {
          if (sfResult.costUsd > 0) {
            await incrementDailySpend("aiark", sfResult.costUsd);
          }
          await recordEnrichment({
            entityId: personId,
            entityType: "person",
            provider: "aiark",
            status: "success",
            fieldsWritten: sfResult.email ? ["email"] : [],
            costUsd: sfResult.costUsd,
            rawResponse: sfResult.rawResponse,
            workspaceSlug,
          });
          breaker.consecutiveFailures.set("aiark", 0);

          if (sfResult.email) {
            // Verify before accepting
            const verified = await verifyFoundEmail(sfResult.email, personId);
            if (verified) {
              await mergePersonData(personId, { email: sfResult.email });
              return; // source-first success — waterfall done
            }
            console.warn(`[waterfall] AI Ark source-first email ${sfResult.email} failed verification for person ${personId} — continuing waterfall`);
          }
        }
      } catch (err) {
        if (isCreditExhaustion(err)) {
          await notifyCreditExhaustion({
            provider: (err as CreditExhaustionError).provider,
            httpStatus: (err as CreditExhaustionError).httpStatus,
            context: `enrichment waterfall (aiark source-first) for person ${personId} — skipping, continuing waterfall`,
          });
          console.warn(`[waterfall] AI Ark source-first credit exhaustion for ${personId} — continuing waterfall`);
        } else {
          breaker.consecutiveFailures.set("aiark", (breaker.consecutiveFailures.get("aiark") ?? 0) + 1);
          console.warn(`[waterfall] AI Ark source-first error for ${personId}:`, err);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // AI Ark person data enrichment (fills jobTitle, company, location, etc.)
  // ---------------------------------------------------------------------------
  // Runs BEFORE email providers because it enriches person fields that can
  // improve downstream email-finding accuracy. This satisfies the ENRICH-02
  // waterfall order: FindyMail -> Prospeo -> Kitt (cheapest-first) by making
  // AI Ark a separate person-data step before the email-finding loop.
  // If AI Ark also returns an email, we treat it as an email-finding success
  // and stop early (same as any email provider).
  const aiarkFailures = breaker.consecutiveFailures.get("aiark") ?? 0;
  if (aiarkFailures < CIRCUIT_BREAKER_THRESHOLD) {
    const aiarkShouldRun = await shouldEnrich(personId, "person", "aiark");
    if (aiarkShouldRun) {
      const capHit = await checkDailyCap();
      if (capHit) throw new Error("DAILY_CAP_HIT");

      let aiarkResult: PersonProviderResult | null = null;
      let aiarkError: Error | null = null;

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          aiarkResult = await aiarkPersonAdapter(input);
          aiarkError = null;
          break;
        } catch (err) {
          // Credit exhaustion — notify admin but DON'T halt the waterfall.
          // AI Ark is optional person-data enrichment, not email finding.
          // Skip to email providers instead of pausing the entire job.
          if (isCreditExhaustion(err)) {
            await notifyCreditExhaustion({
              provider: (err as CreditExhaustionError).provider,
              httpStatus: (err as CreditExhaustionError).httpStatus,
              context: `enrichment waterfall (aiark person data) for person ${personId} — skipping, continuing to email providers`,
            });
            console.warn(`[waterfall] AI Ark credit exhaustion for ${personId} — skipping person data, continuing to email providers`);
            break; // exit retry loop, fall through to email providers
          }
          const error = err instanceof Error ? err : new Error(String(err));
          const is429 = isRateLimited(err) || error.message.includes("429");
          if (is429 && attempt < MAX_RETRIES - 1) {
            await sleep(exponentialBackoff(attempt));
            continue;
          }
          aiarkError = error;
          break;
        }
      }

      if (aiarkError !== null) {
        await recordEnrichment({
          entityId: personId,
          entityType: "person",
          provider: "aiark",
          status: "error",
          errorMessage: aiarkError.message,
          costUsd: 0,
          workspaceSlug,
        });
        // Don't increment circuit breaker for credit exhaustion (already re-thrown above)
        breaker.consecutiveFailures.set("aiark", aiarkFailures + 1);
      } else if (aiarkResult && aiarkResult.costUsd > 0) {
        // Only record and spend when an actual API call was made (costUsd > 0)
        const hasPersonData =
          aiarkResult.firstName != null ||
          aiarkResult.lastName != null ||
          aiarkResult.jobTitle != null ||
          aiarkResult.linkedinUrl != null ||
          aiarkResult.location != null ||
          aiarkResult.company != null ||
          aiarkResult.companyDomain != null ||
          aiarkResult.email != null;

        if (hasPersonData) {
          const personData: Parameters<typeof mergePersonData>[1] = {};
          if (aiarkResult.firstName) personData.firstName = aiarkResult.firstName;
          if (aiarkResult.lastName) personData.lastName = aiarkResult.lastName;
          if (aiarkResult.jobTitle) personData.jobTitle = aiarkResult.jobTitle;
          if (aiarkResult.linkedinUrl) personData.linkedinUrl = aiarkResult.linkedinUrl;
          if (aiarkResult.location) personData.location = aiarkResult.location;
          if (aiarkResult.company) personData.company = aiarkResult.company;
          if (aiarkResult.companyDomain) personData.companyDomain = aiarkResult.companyDomain;
          if (aiarkResult.email) personData.email = aiarkResult.email;

          const aiarkFieldsWritten = await mergePersonData(personId, personData);

          await incrementDailySpend("aiark", aiarkResult.costUsd);
          await recordEnrichment({
            entityId: personId,
            entityType: "person",
            provider: "aiark",
            status: "success",
            fieldsWritten: aiarkFieldsWritten,
            costUsd: aiarkResult.costUsd,
            rawResponse: aiarkResult.rawResponse,
            workspaceSlug,
          });
          breaker.consecutiveFailures.set("aiark", 0);

          // --- Run normalizers inline for AI Ark person data ---
          const updatedPersonAiArk = await prisma.person.findUnique({ where: { id: personId } });
          if (updatedPersonAiArk) {
            if (updatedPersonAiArk.jobTitle) {
              try {
                const titleResult = await classifyJobTitle(updatedPersonAiArk.jobTitle);
                if (titleResult) {
                  const normalizedUpdates: Record<string, unknown> = {
                    jobTitle: titleResult.canonical,
                  };
                  const existing = updatedPersonAiArk.enrichmentData
                    ? (() => {
                        try {
                          return JSON.parse(updatedPersonAiArk.enrichmentData) as Record<string, unknown>;
                        } catch {
                          return {} as Record<string, unknown>;
                        }
                      })()
                    : {};
                  normalizedUpdates.enrichmentData = JSON.stringify({
                    ...existing,
                    seniority: titleResult.seniority,
                  });
                  await prisma.person.update({
                    where: { id: personId },
                    data: normalizedUpdates,
                  });
                }
              } catch (err) {
                console.warn(`[waterfall] classifyJobTitle (aiark) failed for person ${personId}:`, err);
              }
            }

            if (aiarkFieldsWritten.includes("company") && updatedPersonAiArk.company) {
              try {
                const normalizedName = await classifyCompanyName(updatedPersonAiArk.company);
                if (normalizedName) {
                  await prisma.person.update({
                    where: { id: personId },
                    data: { company: normalizedName },
                  });
                }
              } catch (err) {
                console.warn(`[waterfall] classifyCompanyName (aiark) failed for person ${personId}:`, err);
              }
            }
          }

          // If AI Ark returned an email, verify it before accepting
          if (aiarkResult.email) {
            const verified = await verifyFoundEmail(aiarkResult.email, personId);
            if (verified) {
              return; // verified valid — waterfall success
            }
            // Verification failed — null out the email and continue to email-finding waterfall
            console.warn(`[waterfall] AI Ark email ${aiarkResult.email} failed verification for person ${personId} — continuing waterfall`);
            await prisma.person.update({
              where: { id: personId },
              data: { email: null },
            });
          }
        } else {
          // API call succeeded but no data returned
          await recordEnrichment({
            entityId: personId,
            entityType: "person",
            provider: "aiark",
            status: "success",
            fieldsWritten: [],
            costUsd: aiarkResult.costUsd,
            rawResponse: aiarkResult.rawResponse,
            workspaceSlug,
          });
          breaker.consecutiveFailures.set("aiark", 0);
        }
      }
      // If costUsd === 0 (no API call made), skip recording — no cost, no data
    }
  } else {
    console.warn(`[waterfall] Circuit breaker OPEN for aiark (${aiarkFailures} consecutive failures) — skipping person data step`);
  }

  // ---------------------------------------------------------------------------
  // Email-finding waterfall: FindyMail → Prospeo → Kitt (cheapest-first)
  // Each found email is verified before acceptance. Invalid → try next provider.
  // ---------------------------------------------------------------------------

  // FindyMail requires a LinkedIn URL (endpoint: /api/search/linkedin).
  // When no LinkedIn URL is present, skip FindyMail and try Prospeo + Kitt.
  const providers = input.linkedinUrl
    ? EMAIL_PROVIDERS
    : EMAIL_PROVIDERS.filter(p => p.name !== "findymail");

  for (const { adapter, name } of providers) {
    // --- Circuit breaker ---
    const failures = breaker.consecutiveFailures.get(name) ?? 0;
    if (failures >= CIRCUIT_BREAKER_THRESHOLD) {
      console.warn(`[waterfall] Circuit breaker OPEN for ${name} (${failures} consecutive failures) — skipping`);
      continue;
    }

    // --- Dedup gate ---
    const shouldRun = await shouldEnrich(personId, "person", name);
    if (!shouldRun) {
      continue;
    }

    // --- Daily cap check ---
    const capHit = await checkDailyCap();
    if (capHit) {
      throw new Error("DAILY_CAP_HIT");
    }

    // --- Call with retry loop ---
    let result: Awaited<ReturnType<EmailAdapter>> | null = null;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        result = await adapter(input);
        lastError = null;
        break; // success — exit retry loop
      } catch (err) {
        // Credit exhaustion — notify admin and skip to next provider
        if (isCreditExhaustion(err)) {
          await notifyCreditExhaustion({
            provider: (err as CreditExhaustionError).provider,
            httpStatus: (err as CreditExhaustionError).httpStatus,
            context: `enrichment waterfall (${name}) for person ${personId} — skipping to next provider`,
          });
          console.warn(`[waterfall] ${name} credit exhaustion — skipping to next provider`);
          break; // exit retry loop, fall through to next provider
        }
        const error = err instanceof Error ? err : new Error(String(err));
        const is429 = isRateLimited(err) || error.message.includes("429");

        if (is429 && attempt < MAX_RETRIES - 1) {
          await sleep(exponentialBackoff(attempt));
          continue; // retry after backoff
        }

        lastError = error;
        break; // permanent error or retries exhausted
      }
    }

    // --- Error path ---
    if (lastError !== null) {
      await recordEnrichment({
        entityId: personId,
        entityType: "person",
        provider: name,
        status: "error",
        errorMessage: lastError.message,
        costUsd: 0,
        workspaceSlug,
      });
      // Don't increment circuit breaker for credit exhaustion (skipped above via break)
      if (!isCreditExhaustion(lastError)) {
        breaker.consecutiveFailures.set(name, failures + 1);
      }
      continue;
    }

    if (!result) continue;

    // --- No email found (API call succeeded but returned null) ---
    if (result.email === null) {
      await recordEnrichment({
        entityId: personId,
        entityType: "person",
        provider: name,
        status: "success",
        fieldsWritten: [],
        costUsd: result.costUsd,
        rawResponse: result.rawResponse,
        workspaceSlug,
      });
      breaker.consecutiveFailures.set(name, 0);
      continue; // try next provider
    }

    // --- Email found — verify before accepting ---
    // Record the finder cost and success regardless of verification outcome
    await incrementDailySpend(name, result.costUsd);
    await recordEnrichment({
      entityId: personId,
      entityType: "person",
      provider: name,
      status: "success",
      fieldsWritten: result.email ? ["email"] : [],
      costUsd: result.costUsd,
      rawResponse: result.rawResponse,
      workspaceSlug,
    });
    breaker.consecutiveFailures.set(name, 0);

    // Verify the found email via BounceBan (+ Kitt fallback for unknowns)
    const emailValid = await verifyFoundEmail(result.email, personId);

    if (!emailValid) {
      // Verification failed — reject this email, continue to next provider
      console.warn(`[waterfall] ${name} email ${result.email} failed verification for person ${personId} — trying next provider`);
      continue;
    }

    // --- Verified valid — write person data and normalize ---
    const personData: Parameters<typeof mergePersonData>[1] = {
      email: result.email,
    };
    if (result.firstName) personData.firstName = result.firstName;
    if (result.lastName) personData.lastName = result.lastName;
    if (result.jobTitle) personData.jobTitle = result.jobTitle;
    if (result.linkedinUrl) personData.linkedinUrl = result.linkedinUrl;
    if (result.location) personData.location = result.location;

    const fieldsWritten = await mergePersonData(personId, personData);

    // --- Run normalizers inline ---
    const updatedPerson = await prisma.person.findUnique({ where: { id: personId } });
    if (updatedPerson) {
      if (updatedPerson.jobTitle) {
        try {
          const titleResult = await classifyJobTitle(updatedPerson.jobTitle);
          if (titleResult) {
            const normalizedUpdates: Record<string, unknown> = {
              jobTitle: titleResult.canonical,
            };
            const existing = updatedPerson.enrichmentData
              ? (() => {
                  try {
                    return JSON.parse(updatedPerson.enrichmentData) as Record<string, unknown>;
                  } catch {
                    return {} as Record<string, unknown>;
                  }
                })()
              : {};
            normalizedUpdates.enrichmentData = JSON.stringify({
              ...existing,
              seniority: titleResult.seniority,
            });
            await prisma.person.update({
              where: { id: personId },
              data: normalizedUpdates,
            });
          }
        } catch (err) {
          console.warn(`[waterfall] classifyJobTitle failed for person ${personId}:`, err);
        }
      }

      if (fieldsWritten.includes("company") && updatedPerson.company) {
        try {
          const normalizedName = await classifyCompanyName(updatedPerson.company);
          if (normalizedName) {
            await prisma.person.update({
              where: { id: personId },
              data: { company: normalizedName },
            });
          }
        } catch (err) {
          console.warn(`[waterfall] classifyCompanyName failed for person ${personId}:`, err);
        }
      }
    }

    return; // verified email — waterfall success
  }
}

// ---------------------------------------------------------------------------
// enrichEmailBatch — Batch mode for parallel enrichment
// ---------------------------------------------------------------------------

import { bulkEnrichPerson, bulkEnrichByPersonId } from "./providers/prospeo";
import { bulkEnrichByAiArkId } from "./providers/aiark-source-first";
import { bulkFindEmail } from "./providers/findymail";
import { bulkVerifyEmails } from "@/lib/verification/bounceban";
import { findEmail as kittFindEmail } from "@/lib/verification/kitt";
/**
 * Input for batch enrichment — one entry per person.
 */
export interface PersonForEnrichment {
  personId: string;
  firstName?: string | null;
  lastName?: string | null;
  linkedinUrl?: string | null;
  companyDomain?: string | null;
  companyName?: string | null;
  email?: string | null; // existing email from AI Ark step
  /** Discovery platform source ID (Prospeo person_id, AI Ark person id) for source-first enrichment */
  sourceId?: string | null;
  /** Which discovery platform found this person: 'prospeo', 'aiark', 'apify-leads-finder', etc. */
  discoverySource?: string | null;
}

/**
 * Summary returned after batch enrichment.
 */
export interface BatchEnrichmentSummary {
  total: number;
  enriched: number;
  verified: number;
  failed: number;
  costs: Record<string, number>;
}

/**
 * Simple concurrency limiter for Kitt parallel calls.
 */
function createBatchLimiter(concurrency: number) {
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

/**
 * Batch email enrichment — processes multiple people in parallel using bulk APIs.
 *
 * Flow:
 * 1. Dedup gate + daily cap check
 * 2. Prospeo bulk (50/batch) for all eligible people
 * 3. FindyMail parallel (100 concurrent) for remaining people with LinkedIn URLs
 * 4. Kitt single (15 concurrent) for remaining people
 * 5. BounceBan bulk verify all found emails
 * 6. Kitt verify fallback for "unknown" results (15 concurrent)
 * 7. Merge verified emails to Person records + normalize
 *
 * Preserves all existing single-person flow — this is purely additive.
 */
export async function enrichEmailBatch(
  people: PersonForEnrichment[],
  breaker: CircuitBreaker,
  workspaceSlug?: string,
): Promise<BatchEnrichmentSummary> {
  const costs: Record<string, number> = {};
  const addCost = (provider: string, amount: number) => {
    costs[provider] = (costs[provider] ?? 0) + amount;
  };

  let enriched = 0;
  let verified = 0;
  let failed = 0;

  // Track which people still need an email
  // Map of personId → found email (null means not found yet)
  const foundEmails = new Map<string, string | null>();

  // People who already have emails go to verification — EXCEPT aiark-export
  // sourced people whose emails are pre-verified by AI Ark (BounceBan).
  const alreadyHaveEmail: Array<{ personId: string; email: string }> = [];
  const needEmail: PersonForEnrichment[] = [];

  // Track people whose emails were found by AI Ark export (skip BounceBan for these)
  const aiarkVerifiedPersonIds = new Set<string>();

  for (const person of people) {
    if (person.email) {
      // AI Ark export-sourced people with emails are pre-verified by BounceBan
      // on AI Ark's side — skip our own verification entirely
      if (person.discoverySource === "aiark-export") {
        aiarkVerifiedPersonIds.add(person.personId);
      }
      alreadyHaveEmail.push({ personId: person.personId, email: person.email });
      foundEmails.set(person.personId, person.email);
    } else {
      needEmail.push(person);
      foundEmails.set(person.personId, null);
    }
  }

  // --- Daily cap check ---
  const capHit = await checkDailyCap();
  if (capHit) throw new Error("DAILY_CAP_HIT");

  // -------------------------------------------------------------------------
  // Step 0: Source-first enrichment — use discovery platform IDs directly
  //
  // People discovered via Prospeo have a person_id that allows direct lookup
  // (much higher hit rate than generic name/LinkedIn matching).
  //
  // AI Ark export-sourced people already have emails from the export endpoint
  // (pre-verified by BounceBan). They skip this step entirely — handled above.
  //
  // Prospeo emails are NOT pre-verified — they go through BounceBan below.
  // -------------------------------------------------------------------------
  const prospeoSourced: Array<{ personId: string; prospeoPersonId: string }> = [];
  const aiarkSourced: Array<{ personId: string; aiarkPersonId: string }> = [];

  for (const person of needEmail) {
    if (!person.sourceId) continue;
    if (person.discoverySource === "prospeo") {
      prospeoSourced.push({ personId: person.personId, prospeoPersonId: person.sourceId });
    } else if (person.discoverySource === "aiark") {
      // AI Ark search-sourced people: use stored sourceId for direct lookup
      aiarkSourced.push({ personId: person.personId, aiarkPersonId: person.sourceId });
    }
    // AI Ark export people already have emails populated — no source-first needed
  }

  // --- Prospeo source-first: bulk enrich by person_id ---
  if (prospeoSourced.length > 0) {
    const prospeoFailures0 = breaker.consecutiveFailures.get("prospeo") ?? 0;
    if (prospeoFailures0 < CIRCUIT_BREAKER_THRESHOLD) {
      if (await checkDailyCap()) throw new Error("DAILY_CAP_HIT");

      try {
        console.log(`[waterfall-batch] Prospeo source-first (person_id): ${prospeoSourced.length} people`);
        const prospeoResults = await bulkEnrichByPersonId(prospeoSourced);

        for (const [personId, result] of prospeoResults) {
          addCost("prospeo", result.costUsd);
          if (result.costUsd > 0) {
            await incrementDailySpend("prospeo", result.costUsd);
          }
          await recordEnrichment({
            entityId: personId,
            entityType: "person",
            provider: "prospeo",
            status: "success",
            fieldsWritten: result.email ? ["email"] : [],
            costUsd: result.costUsd,
            rawResponse: result.rawResponse,
            workspaceSlug,
          });

          if (result.email) {
            foundEmails.set(personId, result.email.trim() || null);
          }
        }
        breaker.consecutiveFailures.set("prospeo", 0);
      } catch (err) {
        if (isCreditExhaustion(err)) {
          await notifyCreditExhaustion({
            provider: (err as CreditExhaustionError).provider,
            httpStatus: (err as CreditExhaustionError).httpStatus,
            context: `batch enrichment (prospeo source-first person_id) — falling through to generic waterfall`,
          });
          console.warn(`[waterfall-batch] Prospeo source-first credit exhaustion — falling through`);
        } else {
          breaker.consecutiveFailures.set("prospeo", (breaker.consecutiveFailures.get("prospeo") ?? 0) + 1);
          console.error(`[waterfall-batch] Prospeo source-first error:`, err);
        }
      }
    }
  }

  // --- AI Ark source-first: direct lookup by AI Ark person ID (BL-040) ---
  if (aiarkSourced.length > 0) {
    const aiarkFailures0 = breaker.consecutiveFailures.get("aiark") ?? 0;
    if (aiarkFailures0 < CIRCUIT_BREAKER_THRESHOLD) {
      if (await checkDailyCap()) throw new Error("DAILY_CAP_HIT");

      try {
        console.log(`[waterfall-batch] AI Ark source-first (person_id): ${aiarkSourced.length} people`);
        const aiarkResults = await bulkEnrichByAiArkId(aiarkSourced);

        for (const [personId, result] of aiarkResults) {
          addCost("aiark", result.costUsd);
          if (result.costUsd > 0) {
            await incrementDailySpend("aiark", result.costUsd);
          }
          await recordEnrichment({
            entityId: personId,
            entityType: "person",
            provider: "aiark",
            status: "success",
            fieldsWritten: result.email ? ["email"] : [],
            costUsd: result.costUsd,
            rawResponse: result.rawResponse,
            workspaceSlug,
          });

          if (result.email) {
            foundEmails.set(personId, result.email.trim() || null);
          }
        }
        breaker.consecutiveFailures.set("aiark", 0);
      } catch (err) {
        if (isCreditExhaustion(err)) {
          await notifyCreditExhaustion({
            provider: (err as CreditExhaustionError).provider,
            httpStatus: (err as CreditExhaustionError).httpStatus,
            context: `batch enrichment (aiark source-first person_id) — falling through to generic waterfall`,
          });
          console.warn(`[waterfall-batch] AI Ark source-first credit exhaustion — falling through`);
        } else {
          breaker.consecutiveFailures.set("aiark", (breaker.consecutiveFailures.get("aiark") ?? 0) + 1);
          console.error(`[waterfall-batch] AI Ark source-first error:`, err);
        }
      }
    }
  }

  // NOTE: AI Ark source-first emails are added to foundEmails and verified via
  // the shared BounceBan bulk step (Step 4), not inline. People with foundEmails
  // entries are skipped by downstream providers via the `stillNeedEmail` filter
  // (line: needEmail.filter(p => !foundEmails.get(p.personId))), not via
  // shouldEnrich() dedup gate. The shouldEnrich() call in Prospeo/FindyMail/Kitt
  // steps provides a secondary dedup layer against prior enrichment runs.

  // -------------------------------------------------------------------------
  // Step 1: Prospeo bulk for all eligible people (generic — no person_id)
  // -------------------------------------------------------------------------
  const prospeoFailures = breaker.consecutiveFailures.get("prospeo") ?? 0;
  if (prospeoFailures < CIRCUIT_BREAKER_THRESHOLD && needEmail.length > 0) {
    // Filter to people eligible for Prospeo (dedup gate)
    const prospeoEligible: typeof needEmail = [];
    for (const person of needEmail) {
      const shouldRun = await shouldEnrich(person.personId, "person", "prospeo");
      if (shouldRun) {
        prospeoEligible.push(person);
      }
    }

    if (prospeoEligible.length > 0) {
      // Check daily cap again before Prospeo
      if (await checkDailyCap()) throw new Error("DAILY_CAP_HIT");

      try {
        console.log(`[waterfall-batch] Prospeo bulk: ${prospeoEligible.length} people`);
        const prospeoResults = await bulkEnrichPerson(
          prospeoEligible.map((p) => ({
            personId: p.personId,
            firstName: p.firstName ?? undefined,
            lastName: p.lastName ?? undefined,
            linkedinUrl: p.linkedinUrl ?? undefined,
            companyDomain: p.companyDomain ?? undefined,
          })),
        );

        // Process Prospeo results
        for (const [personId, result] of prospeoResults) {
          addCost("prospeo", result.costUsd);
          if (result.costUsd > 0) {
            await incrementDailySpend("prospeo", result.costUsd);
          }
          await recordEnrichment({
            entityId: personId,
            entityType: "person",
            provider: "prospeo",
            status: "success",
            fieldsWritten: result.email ? ["email"] : [],
            costUsd: result.costUsd,
            rawResponse: result.rawResponse,
            workspaceSlug,
          });

          if (result.email) {
            foundEmails.set(personId, result.email.trim() || null);
          }
        }
        breaker.consecutiveFailures.set("prospeo", 0);
      } catch (err) {
        if (isCreditExhaustion(err)) {
          await notifyCreditExhaustion({
            provider: (err as CreditExhaustionError).provider,
            httpStatus: (err as CreditExhaustionError).httpStatus,
            context: `batch enrichment (prospeo bulk) — skipping to FindyMail`,
          });
          console.warn(`[waterfall-batch] Prospeo credit exhaustion — skipping to FindyMail`);
        } else {
          breaker.consecutiveFailures.set("prospeo", prospeoFailures + 1);
          console.error(`[waterfall-batch] Prospeo bulk error:`, err);
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Step 2: FindyMail parallel for remaining people with LinkedIn URLs
  // -------------------------------------------------------------------------
  const findymailFailures = breaker.consecutiveFailures.get("findymail") ?? 0;
  const stillNeedEmail = needEmail.filter((p) => !foundEmails.get(p.personId));

  if (findymailFailures < CIRCUIT_BREAKER_THRESHOLD && stillNeedEmail.length > 0) {
    const findymailEligible: Array<{ personId: string; linkedinUrl: string }> = [];
    for (const person of stillNeedEmail) {
      if (!person.linkedinUrl) continue;
      const shouldRun = await shouldEnrich(person.personId, "person", "findymail");
      if (shouldRun) {
        findymailEligible.push({
          personId: person.personId,
          linkedinUrl: person.linkedinUrl,
        });
      }
    }

    if (findymailEligible.length > 0) {
      if (await checkDailyCap()) throw new Error("DAILY_CAP_HIT");

      try {
        console.log(`[waterfall-batch] FindyMail parallel: ${findymailEligible.length} people`);
        const findymailResults = await bulkFindEmail(findymailEligible);

        for (const [personId, result] of findymailResults) {
          addCost("findymail", result.costUsd);
          if (result.costUsd > 0) {
            await incrementDailySpend("findymail", result.costUsd);
          }
          await recordEnrichment({
            entityId: personId,
            entityType: "person",
            provider: "findymail",
            status: "success",
            fieldsWritten: result.email ? ["email"] : [],
            costUsd: result.costUsd,
            rawResponse: result.rawResponse,
            workspaceSlug,
          });

          if (result.email) {
            foundEmails.set(personId, result.email.trim() || null);
          }
        }
        breaker.consecutiveFailures.set("findymail", 0);
      } catch (err) {
        if (isCreditExhaustion(err)) {
          await notifyCreditExhaustion({
            provider: (err as CreditExhaustionError).provider,
            httpStatus: (err as CreditExhaustionError).httpStatus,
            context: `batch enrichment (findymail parallel) — skipping to Kitt`,
          });
          console.warn(`[waterfall-batch] FindyMail credit exhaustion — skipping to Kitt`);
        } else {
          breaker.consecutiveFailures.set("findymail", findymailFailures + 1);
          console.error(`[waterfall-batch] FindyMail bulk error:`, err);
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Step 3: Kitt single (15 concurrent) for remaining people
  // -------------------------------------------------------------------------
  const kittFailures = breaker.consecutiveFailures.get("kitt-find") ?? 0;
  const stillNeedEmail2 = needEmail.filter((p) => !foundEmails.get(p.personId));

  if (kittFailures < CIRCUIT_BREAKER_THRESHOLD && stillNeedEmail2.length > 0) {
    const kittEligible: PersonForEnrichment[] = [];
    for (const person of stillNeedEmail2) {
      // Kitt requires name + domain
      if (!person.firstName || !person.lastName) continue;
      if (!person.companyDomain && !person.companyName) continue;
      const shouldRun = await shouldEnrich(person.personId, "person", "kitt-find");
      if (shouldRun) {
        kittEligible.push(person);
      }
    }

    if (kittEligible.length > 0) {
      if (await checkDailyCap()) throw new Error("DAILY_CAP_HIT");

      console.log(`[waterfall-batch] Kitt parallel: ${kittEligible.length} people`);
      const kittLimiter = createBatchLimiter(15);

      const kittPromises = kittEligible.map((person) =>
        kittLimiter.run(async () => {
          try {
            const fullName = `${person.firstName} ${person.lastName}`;
            const domain = person.companyDomain ?? person.companyName ?? "";
            const result = await kittFindEmail({
              fullName,
              domain,
              linkedinUrl: person.linkedinUrl ?? undefined,
              personId: person.personId,
            });

            addCost("kitt-find", result.costUsd);

            if (result.email) {
              foundEmails.set(person.personId, result.email.trim() || null);
            }
          } catch (err) {
            if (isCreditExhaustion(err)) {
              console.warn(`[waterfall-batch] Kitt credit exhaustion for ${person.personId}`);
              // Don't throw — let other parallel tasks finish
            } else {
              console.error(`[waterfall-batch] Kitt error for ${person.personId}:`, err);
            }
          }
        }),
      );

      await Promise.allSettled(kittPromises);
      breaker.consecutiveFailures.set("kitt-find", 0);
    }
  }

  // -------------------------------------------------------------------------
  // Step 4: BounceBan bulk verify all found emails
  //
  // EXCEPTION: AI Ark source-first emails are pre-verified by BounceBan
  // on AI Ark's side — skip our own verification for those to save credits.
  // Apify Leads Finder emails are NOT pre-verified — must go through BounceBan
  // despite Apify claiming "validated" status.
  // -------------------------------------------------------------------------
  const allFoundEmails: Array<{ personId: string; email: string }> = [];
  // AI Ark pre-verified emails — bypass BounceBan, go straight to merge
  const preVerifiedEmails: Array<{ personId: string; email: string }> = [];

  for (const [personId, email] of foundEmails) {
    if (email) {
      if (aiarkVerifiedPersonIds.has(personId)) {
        preVerifiedEmails.push({ personId, email });
      } else {
        allFoundEmails.push({ personId, email });
      }
    }
  }
  // Include pre-existing emails (from AI Ark enrichment step)
  for (const entry of alreadyHaveEmail) {
    if (!allFoundEmails.find((e) => e.personId === entry.personId) &&
        !preVerifiedEmails.find((e) => e.personId === entry.personId)) {
      allFoundEmails.push(entry);
    }
  }

  if (preVerifiedEmails.length > 0) {
    console.log(`[waterfall-batch] Skipping BounceBan for ${preVerifiedEmails.length} AI Ark pre-verified emails`);
  }

  // Merge pre-verified AI Ark emails directly (no BounceBan needed)
  for (const entry of preVerifiedEmails) {
    try {
      const personData: Parameters<typeof mergePersonData>[1] = {
        email: entry.email,
      };
      await mergePersonData(entry.personId, personData);
      enriched++;
      verified++;

      // Run normalizers
      const updatedPerson = await prisma.person.findUnique({ where: { id: entry.personId } });
      if (updatedPerson?.jobTitle) {
        try {
          const titleResult = await classifyJobTitle(updatedPerson.jobTitle);
          if (titleResult) {
            const existing = updatedPerson.enrichmentData
              ? (() => { try { return JSON.parse(updatedPerson.enrichmentData) as Record<string, unknown>; } catch { return {} as Record<string, unknown>; } })()
              : {};
            await prisma.person.update({
              where: { id: entry.personId },
              data: {
                jobTitle: titleResult.canonical,
                enrichmentData: JSON.stringify({ ...existing, seniority: titleResult.seniority }),
              },
            });
          }
        } catch (err) {
          console.warn(`[waterfall-batch] classifyJobTitle failed for pre-verified ${entry.personId}:`, err);
        }
      }
    } catch (err) {
      console.error(`[waterfall-batch] Failed to merge pre-verified email ${entry.email} for ${entry.personId}:`, err);
      failed++;
    }
  }

  if (allFoundEmails.length > 0) {
    console.log(`[waterfall-batch] BounceBan bulk verify: ${allFoundEmails.length} emails`);

    let verificationResults: Map<string, import("@/lib/verification/bounceban").VerificationResult>;

    try {
      verificationResults = await bulkVerifyEmails(
        allFoundEmails.map((e) => ({ email: e.email, personId: e.personId })),
      );

      // Sum verification costs
      for (const [, result] of verificationResults) {
        addCost("bounceban-verify", result.costUsd);
      }
    } catch (err) {
      if (isCreditExhaustion(err)) {
        await notifyCreditExhaustion({
          provider: (err as CreditExhaustionError).provider,
          httpStatus: (err as CreditExhaustionError).httpStatus,
          context: `batch enrichment (bounceban bulk verify)`,
        });
        console.warn(`[waterfall-batch] BounceBan credit exhaustion — skipping verification`);
        // All emails remain unverified — mark as failed
        failed = allFoundEmails.length;
        return { total: people.length, enriched, verified, failed, costs };
      }
      throw err;
    }

    // -----------------------------------------------------------------------
    // Step 5: Kitt verify fallback for "unknown" results (15 concurrent)
    // -----------------------------------------------------------------------
    const unknownResults: Array<{ personId: string; email: string }> = [];
    for (const [personId, result] of verificationResults) {
      if (result.status === "unknown") {
        unknownResults.push({ personId, email: result.email });
      }
    }

    if (unknownResults.length > 0) {
      console.log(`[waterfall-batch] Kitt verify fallback: ${unknownResults.length} unknowns`);
      const kittVerifyLimiter = createBatchLimiter(15);

      const kittVerifyPromises = unknownResults.map((entry) =>
        kittVerifyLimiter.run(async () => {
          try {
            const kittResult = await kittVerify(entry.email, entry.personId);
            addCost("kitt-verify", kittResult.costUsd);

            // Update the verification result map
            verificationResults.set(entry.personId, kittResult);
          } catch (err) {
            if (isCreditExhaustion(err)) {
              console.warn(`[waterfall-batch] Kitt verify credit exhaustion for ${entry.email}`);
            } else {
              console.error(`[waterfall-batch] Kitt verify error for ${entry.email}:`, err);
            }
          }
        }),
      );

      await Promise.allSettled(kittVerifyPromises);
    }

    // -----------------------------------------------------------------------
    // Step 6: Merge verified emails to Person records + normalize
    // -----------------------------------------------------------------------
    for (const entry of allFoundEmails) {
      const vResult = verificationResults.get(entry.personId);
      if (!vResult) {
        failed++;
        continue;
      }

      const isValid = vResult.status === "valid" || vResult.status === "valid_catch_all";

      if (!isValid) {
        // Verification failed — null out the email if it was written
        console.warn(`[waterfall-batch] Email ${entry.email} for ${entry.personId} failed verification (${vResult.status})`);
        await prisma.person.update({
          where: { id: entry.personId },
          data: { email: null },
        });
        failed++;
        continue;
      }

      // Verified valid — merge person data
      try {
        const personData: Parameters<typeof mergePersonData>[1] = {
          email: entry.email,
        };

        const fieldsWritten = await mergePersonData(entry.personId, personData);
        enriched++;
        verified++;

        // Run normalizers inline
        const updatedPerson = await prisma.person.findUnique({ where: { id: entry.personId } });
        if (updatedPerson?.jobTitle) {
          try {
            const titleResult = await classifyJobTitle(updatedPerson.jobTitle);
            if (titleResult) {
              const existing = updatedPerson.enrichmentData
                ? (() => { try { return JSON.parse(updatedPerson.enrichmentData) as Record<string, unknown>; } catch { return {} as Record<string, unknown>; } })()
                : {};
              await prisma.person.update({
                where: { id: entry.personId },
                data: {
                  jobTitle: titleResult.canonical,
                  enrichmentData: JSON.stringify({ ...existing, seniority: titleResult.seniority }),
                },
              });
            }
          } catch (err) {
            console.warn(`[waterfall-batch] classifyJobTitle failed for ${entry.personId}:`, err);
          }
        }

        if (updatedPerson?.company && fieldsWritten.includes("company")) {
          try {
            const normalizedName = await classifyCompanyName(updatedPerson.company);
            if (normalizedName) {
              await prisma.person.update({
                where: { id: entry.personId },
                data: { company: normalizedName },
              });
            }
          } catch (err) {
            console.warn(`[waterfall-batch] classifyCompanyName failed for ${entry.personId}:`, err);
          }
        }
      } catch (err) {
        // Catch merge failures (e.g. unique constraint on email) so one failure
        // doesn't crash the entire batch — remaining people still get processed.
        console.error(`[waterfall-batch] Failed to merge email ${entry.email} for ${entry.personId}:`, err);
        failed++;
      }
    }
  }

  // People who never got an email at all
  for (const person of needEmail) {
    if (!foundEmails.get(person.personId) && !allFoundEmails.find((e) => e.personId === person.personId)) {
      failed++;
    }
  }

  return { total: people.length, enriched, verified, failed, costs };
}

// ---------------------------------------------------------------------------
// enrichCompany
// ---------------------------------------------------------------------------

interface CompanyProvider {
  adapter: CompanyAdapter;
  name: Provider;
}

const COMPANY_PROVIDERS: CompanyProvider[] = [
  { adapter: aiarkAdapter, name: "aiark" },
  { adapter: firecrawlCompanyAdapter, name: "firecrawl" },
];

/**
 * Run the company enrichment waterfall for a domain.
 *
 * Tries AI Ark → Firecrawl. Stops at the first provider that returns useful data.
 *
 * Throws "DAILY_CAP_HIT" when the daily cost cap is reached.
 */
export async function enrichCompany(
  domain: string,
  breaker: CircuitBreaker,
  workspaceSlug?: string,
): Promise<void> {
  // Look up company DB record for dedup checks
  let company = await prisma.company.findUnique({ where: { domain } });
  let companyDbId = company?.id ?? null;

  for (const { adapter, name } of COMPANY_PROVIDERS) {
    // --- Circuit breaker ---
    const failures = breaker.consecutiveFailures.get(name) ?? 0;
    if (failures >= CIRCUIT_BREAKER_THRESHOLD) {
      console.warn(`[waterfall] Circuit breaker OPEN for ${name} (${failures} consecutive failures) — skipping`);
      continue;
    }

    // --- Dedup gate (only when company record exists in DB) ---
    if (companyDbId !== null) {
      const shouldRun = await shouldEnrich(companyDbId, "company", name);
      if (!shouldRun) {
        continue;
      }
    }

    // --- Daily cap check ---
    const capHit = await checkDailyCap();
    if (capHit) {
      throw new Error("DAILY_CAP_HIT");
    }

    // --- Call with retry loop ---
    let result: Awaited<ReturnType<CompanyAdapter>> | null = null;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        result = await adapter(domain);
        lastError = null;
        break;
      } catch (err) {
        // Credit exhaustion — notify admin and skip to next provider
        if (isCreditExhaustion(err)) {
          await notifyCreditExhaustion({
            provider: (err as CreditExhaustionError).provider,
            httpStatus: (err as CreditExhaustionError).httpStatus,
            context: `company enrichment waterfall (${name}) for domain ${domain} — skipping to next provider`,
          });
          console.warn(`[waterfall] ${name} credit exhaustion — skipping to next provider`);
          break; // exit retry loop, fall through to next provider
        }
        const error = err instanceof Error ? err : new Error(String(err));
        const is429 = isRateLimited(err) || error.message.includes("429");

        if (is429 && attempt < MAX_RETRIES - 1) {
          await sleep(exponentialBackoff(attempt));
          continue;
        }

        lastError = error;
        break;
      }
    }

    // --- Error path ---
    if (lastError !== null) {
      await recordEnrichment({
        entityId: companyDbId ?? domain,
        entityType: "company",
        provider: name,
        status: "error",
        errorMessage: lastError.message,
        costUsd: 0,
        workspaceSlug,
      });
      // Don't increment circuit breaker for credit exhaustion (skipped above via break)
      if (!isCreditExhaustion(lastError)) {
        breaker.consecutiveFailures.set(name, failures + 1);
      }
      continue;
    }

    if (!result) continue;

    // Check if the result has any useful data fields
    const hasData =
      result.name != null ||
      result.industry != null ||
      result.headcount != null ||
      result.description != null ||
      result.website != null ||
      result.location != null ||
      result.yearFounded != null;

    // --- No data returned ---
    if (!hasData) {
      await recordEnrichment({
        entityId: companyDbId ?? domain,
        entityType: "company",
        provider: name,
        status: "success",
        fieldsWritten: [],
        costUsd: result.costUsd,
        rawResponse: result.rawResponse,
        workspaceSlug,
      });
      breaker.consecutiveFailures.set(name, 0);
      continue; // try next provider
    }

    // --- Data returned — ensure company record exists ---
    if (company === null || companyDbId === null) {
      company = await prisma.company.create({
        data: { domain, name: result.name ?? domain },
      });
      companyDbId = company.id;
    }

    const companyData: Parameters<typeof mergeCompanyData>[1] = {};
    if (result.name) companyData.name = result.name;
    if (result.industry) companyData.industry = result.industry;
    if (result.headcount) companyData.headcount = result.headcount;
    if (result.description) companyData.description = result.description;
    if (result.website) companyData.website = result.website;
    if (result.location) companyData.location = result.location;
    if (result.yearFounded) companyData.yearFounded = result.yearFounded;

    const fieldsWritten = await mergeCompanyData(domain, companyData);

    await incrementDailySpend(name, result.costUsd);
    await recordEnrichment({
      entityId: companyDbId,
      entityType: "company",
      provider: name,
      status: "success",
      fieldsWritten,
      costUsd: result.costUsd,
      rawResponse: result.rawResponse,
      workspaceSlug,
    });
    breaker.consecutiveFailures.set(name, 0);

    // --- Run normalizers inline ---
    if (fieldsWritten.includes("industry") && result.industry) {
      try {
        const canonical = await classifyIndustry(result.industry);
        if (canonical) {
          await prisma.company.update({
            where: { domain },
            data: { industry: canonical },
          });
        }
      } catch (err) {
        console.warn(`[waterfall] classifyIndustry failed for domain ${domain}:`, err);
      }
    }

    if (fieldsWritten.includes("name") && result.name) {
      try {
        const normalizedName = await classifyCompanyName(result.name);
        if (normalizedName) {
          await prisma.company.update({
            where: { domain },
            data: { name: normalizedName },
          });
        }
      } catch (err) {
        console.warn(`[waterfall] classifyCompanyName failed for domain ${domain}:`, err);
      }
    }

    return; // first success with data wins — stop waterfall
  }
}
