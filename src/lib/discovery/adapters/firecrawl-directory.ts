/**
 * Firecrawl Directory extraction adapter.
 *
 * Extracts structured contact lists from arbitrary directory URLs using the
 * Firecrawl SDK's extract() method with a fixed JSON schema.
 *
 * Uses the same @mendable/firecrawl-js SDK and patterns as firecrawl-company.ts:
 *   - Schema cast to `any` (Zod version mismatch between project zod v3 and SDK's bundled zod v4)
 *   - Promise.race timeout (45s — directory pages can be larger than company pages)
 *   - Client created per-call (no shared state)
 *
 * Validates extraction results and filters obvious junk:
 *   - Records without any identity (no name, no email) are skipped
 *   - Malformed email addresses are skipped
 *   - LinkedIn URLs that don't contain "linkedin.com" are skipped
 *
 * Cost: $0.001 per call (same as firecrawl company extraction).
 */

import Firecrawl from "@mendable/firecrawl-js";
import { z } from "zod";
import { PROVIDER_COSTS } from "../../enrichment/costs";
import type { DiscoveredPersonResult } from "../types";

/** Safety timeout — directory pages can be large. */
const EXTRACT_TIMEOUT_MS = 45_000;

/** Free email provider domains — companyDomain is NOT derived from these. */
const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "hotmail.com",
  "hotmail.co.uk", "outlook.com", "live.com", "live.co.uk", "aol.com",
  "icloud.com", "me.com", "mac.com", "mail.com", "mail.ru", "msn.com",
  "protonmail.com", "proton.me", "ymail.com", "zoho.com", "gmx.com",
  "fastmail.com", "hey.com", "tutanota.com", "pm.me",
]);

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface DirectoryExtractionResult {
  people: DiscoveredPersonResult[];
  /** Number of records that passed validation and were included */
  validCount: number;
  /** Number of records filtered out by validation */
  skippedCount: number;
  /** Actual API cost in USD */
  costUsd: number;
  /** Raw Firecrawl response for debugging/audit */
  rawResponse: unknown;
}

// ---------------------------------------------------------------------------
// Extraction schema
// ---------------------------------------------------------------------------

/**
 * Fixed extraction schema — no adaptive schemas per design.
 * Covers the most common contact fields found in directory pages.
 */
const DirectoryPersonSchema = z.object({
  name: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().optional(),
  jobTitle: z.string().optional(),
  company: z.string().optional(),
  phone: z.string().optional(),
  linkedinUrl: z.string().optional(),
});

type DirectoryPerson = z.infer<typeof DirectoryPersonSchema>;

const EXTRACTION_PROMPT =
  "Extract all people/contacts from this directory page. For each person, capture:\n" +
  "- Full name (or first/last name separately)\n" +
  "- Email address\n" +
  "- Job title or role\n" +
  "- Company or organization name\n" +
  "- Phone number\n" +
  "- LinkedIn profile URL\n\n" +
  "If a name cannot be split into first/last, put the full name in the 'name' field.\n" +
  "Return an array of person objects. Only include entries that have at least a name or email.";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getClient(): Firecrawl {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error("FIRECRAWL_API_KEY environment variable is not set");
  }
  return new Firecrawl({ apiKey });
}

/**
 * Validate a single extracted record.
 * Returns false if the record looks like junk (no identity, bad email, bad LinkedIn URL).
 */
function isValidExtraction(record: DirectoryPerson): boolean {
  const hasIdentity = Boolean(record.name || record.firstName || record.email);
  const emailOk =
    !record.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email);
  const linkedinOk =
    !record.linkedinUrl || record.linkedinUrl.includes("linkedin.com");
  return hasIdentity && emailOk && linkedinOk;
}

/**
 * Derive company domain from an email address, skipping free email providers.
 * Returns undefined if email is missing or from a free provider.
 */
function deriveCompanyDomain(email: string | undefined): string | undefined {
  if (!email) return undefined;
  const domain = email.split("@")[1];
  if (!domain || FREE_EMAIL_DOMAINS.has(domain)) return undefined;
  return domain;
}

/**
 * Split "First Last" into { firstName, lastName }.
 * Handles single-word names (all goes to firstName).
 */
function splitName(fullName: string): { firstName: string; lastName?: string } {
  const spaceIdx = fullName.indexOf(" ");
  if (spaceIdx === -1) return { firstName: fullName };
  return {
    firstName: fullName.slice(0, spaceIdx),
    lastName: fullName.slice(spaceIdx + 1),
  };
}

/**
 * Map a validated DirectoryPerson record to DiscoveredPersonResult.
 * Handles name splitting and companyDomain derivation.
 */
function mapToDiscoveredPerson(record: DirectoryPerson): DiscoveredPersonResult {
  // Prefer explicit firstName/lastName; fall back to splitting `name`
  let firstName = record.firstName;
  let lastName = record.lastName;

  if (!firstName && !lastName && record.name) {
    const split = splitName(record.name);
    firstName = split.firstName;
    lastName = split.lastName;
  }

  return {
    firstName,
    lastName,
    email: record.email,
    jobTitle: record.jobTitle,
    company: record.company,
    phone: record.phone,
    linkedinUrl: record.linkedinUrl,
    companyDomain: deriveCompanyDomain(record.email),
  };
}

// ---------------------------------------------------------------------------
// Main extraction function
// ---------------------------------------------------------------------------

/**
 * Extract structured contact records from a directory URL.
 * Uses Firecrawl extract() with a fixed schema and validates results.
 *
 * @param url - The directory URL to extract contacts from
 * @returns Extraction result with validated people array and cost
 */
export async function extractDirectory(url: string): Promise<DirectoryExtractionResult> {
  const client = getClient();

  const emptyResult: DirectoryExtractionResult = {
    people: [],
    validCount: 0,
    skippedCount: 0,
    costUsd: PROVIDER_COSTS.firecrawl,
    rawResponse: null,
  };

  let result: Awaited<ReturnType<typeof client.extract>>;

  try {
    result = await Promise.race([
      // Cast schema to `any` — Firecrawl SDK bundles its own zod v4 ZodTypeAny,
      // not assignable from project's zod v3 types. At runtime this works fine.
      // Same pattern as firecrawl-company.ts.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client.extract({
        urls: [url],
        prompt: EXTRACTION_PROMPT,
        schema: z.object({ people: z.array(DirectoryPersonSchema) }) as any,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Firecrawl directory extract timeout after ${EXTRACT_TIMEOUT_MS / 1000}s`)),
          EXTRACT_TIMEOUT_MS,
        ),
      ),
    ]);
  } catch (err) {
    console.error(`Firecrawl directory extract failed for URL "${url}":`, err);
    throw err;
  }

  // Extract the people array from result.data
  const rawData = (result as { success: boolean; data?: unknown }).data;

  if (!rawData) {
    console.warn(`Firecrawl directory extract: empty result for URL "${url}"`);
    return { ...emptyResult, rawResponse: result };
  }

  const rawPeople = (rawData as Record<string, unknown>)?.people;

  if (!Array.isArray(rawPeople)) {
    console.warn(`Firecrawl directory extract: expected array at data.people, got ${typeof rawPeople} for URL "${url}"`);
    return { ...emptyResult, rawResponse: result };
  }

  // Validate and map each record
  let skippedCount = 0;
  const people: DiscoveredPersonResult[] = [];

  for (const item of rawPeople) {
    const parsed = DirectoryPersonSchema.safeParse(item);
    if (!parsed.success) {
      console.warn("Firecrawl directory: skipping unparseable record:", parsed.error.message);
      skippedCount++;
      continue;
    }

    if (!isValidExtraction(parsed.data)) {
      // Filtered: no identity, bad email, or bad LinkedIn URL
      skippedCount++;
      continue;
    }

    people.push(mapToDiscoveredPerson(parsed.data));
  }

  return {
    people,
    validCount: people.length,
    skippedCount,
    costUsd: PROVIDER_COSTS.firecrawl,
    rawResponse: result,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * Firecrawl directory adapter — const object exposing the extract function.
 * Not a class; not implementing DiscoveryAdapter (URL-based, not filter-based).
 */
export const firecrawlDirectoryAdapter = {
  extract: extractDirectory,
} as const;
