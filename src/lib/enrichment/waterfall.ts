/**
 * Waterfall enrichment orchestrators.
 *
 * enrichEmail: Tries Prospeo → LeadMagic → FindyMail in order, stopping at first email found.
 * enrichCompany: Tries AI Ark → Firecrawl in order, stopping at first success with data.
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
import { leadmagicAdapter } from "./providers/leadmagic";
import { findymailAdapter } from "./providers/findymail";
import { aiarkAdapter } from "./providers/aiark";
import { firecrawlCompanyAdapter } from "./providers/firecrawl-company";
import { classifyIndustry, classifyJobTitle, classifyCompanyName } from "@/lib/normalizer";
import type { Provider, EmailAdapterInput, EmailAdapter, CompanyAdapter } from "./types";

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
// enrichEmail
// ---------------------------------------------------------------------------

interface EmailProvider {
  adapter: EmailAdapter;
  name: Provider;
}

const EMAIL_PROVIDERS: EmailProvider[] = [
  { adapter: prospeoAdapter, name: "prospeo" },
  { adapter: leadmagicAdapter, name: "leadmagic" },
  { adapter: findymailAdapter, name: "findymail" },
];

/**
 * Run the email enrichment waterfall for a person.
 *
 * Tries Prospeo → LeadMagic → FindyMail. Stops at the first provider that
 * returns a non-null email. When no LinkedIn URL is present, only Prospeo is
 * attempted (LeadMagic and FindyMail both require a LinkedIn URL).
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
  // When no LinkedIn URL, only Prospeo can attempt (via name+company fallback).
  // LeadMagic and FindyMail both require a LinkedIn URL, so skip them.
  const providers = input.linkedinUrl ? EMAIL_PROVIDERS : EMAIL_PROVIDERS.slice(0, 1);

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
        const error = err instanceof Error ? err : new Error(String(err));
        const is429 = (err as any)?.status === 429 || error.message.includes("429");

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
      breaker.consecutiveFailures.set(name, failures + 1);
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

    // --- Email found — write and normalize ---
    const personData: Parameters<typeof mergePersonData>[1] = {
      email: result.email,
    };
    if (result.firstName) personData.firstName = result.firstName;
    if (result.lastName) personData.lastName = result.lastName;
    if (result.jobTitle) personData.jobTitle = result.jobTitle;
    if (result.linkedinUrl) personData.linkedinUrl = result.linkedinUrl;
    if (result.location) personData.location = result.location;

    const fieldsWritten = await mergePersonData(personId, personData);

    await incrementDailySpend(name, result.costUsd);
    await recordEnrichment({
      entityId: personId,
      entityType: "person",
      provider: name,
      status: "success",
      fieldsWritten,
      costUsd: result.costUsd,
      rawResponse: result.rawResponse,
      workspaceSlug,
    });
    breaker.consecutiveFailures.set(name, 0);

    // --- Run normalizers inline ---
    // Re-fetch the updated person to get current field values
    const updatedPerson = await prisma.person.findUnique({ where: { id: personId } });
    if (updatedPerson) {
      // Normalize job title
      if (updatedPerson.jobTitle) {
        try {
          const titleResult = await classifyJobTitle(updatedPerson.jobTitle);
          if (titleResult) {
            const normalizedUpdates: Record<string, unknown> = {
              jobTitle: titleResult.canonical,
            };
            // Store seniority in enrichmentData JSON (no dedicated seniority column)
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

      // Normalize company name
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

    return; // first email wins — stop waterfall
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
        const error = err instanceof Error ? err : new Error(String(err));
        const is429 = (err as any)?.status === 429 || error.message.includes("429");

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
      breaker.consecutiveFailures.set(name, failures + 1);
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
