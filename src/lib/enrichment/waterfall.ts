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
        // Credit exhaustion in verification — halt everything
        if (isCreditExhaustion(kittErr)) throw kittErr;
        console.warn(`[waterfall] Kitt verify error for ${email}:`, kittErr);
        return false; // both verifiers failed — reject
      }
    }

    // invalid, risky, catch_all — reject
    console.warn(`[waterfall] BounceBan returned ${bbResult.status} for ${email} — rejecting`);
    return false;
  } catch (err) {
    // Credit exhaustion — re-throw immediately, never swallow
    if (isCreditExhaustion(err)) throw err;
    // BounceBan error — try Kitt as fallback
    console.warn(`[waterfall] BounceBan error for ${email}:`, err, "— trying Kitt fallback");
    try {
      const kittResult = await kittVerify(email, personId);
      if (kittResult.status === "valid") {
        return true;
      }
      return false;
    } catch (kittErr) {
      // Credit exhaustion in Kitt fallback — halt everything
      if (isCreditExhaustion(kittErr)) throw kittErr;
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
        // Credit exhaustion — notify admin and halt the entire waterfall
        if (isCreditExhaustion(err)) {
          await notifyCreditExhaustion({
            provider: (err as CreditExhaustionError).provider,
            httpStatus: (err as CreditExhaustionError).httpStatus,
            context: `enrichment waterfall (${name}) for person ${personId}`,
          });
          throw err;
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
      // Don't increment circuit breaker for credit exhaustion (already re-thrown above)
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
        // Credit exhaustion — notify admin and halt the entire waterfall
        if (isCreditExhaustion(err)) {
          await notifyCreditExhaustion({
            provider: (err as CreditExhaustionError).provider,
            httpStatus: (err as CreditExhaustionError).httpStatus,
            context: `company enrichment waterfall (${name}) for domain ${domain}`,
          });
          throw err;
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
