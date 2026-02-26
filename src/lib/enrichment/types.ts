/**
 * Enrichment pipeline type definitions.
 * Central source of truth for provider names, entity types, and enrichment results.
 */

/** Supported enrichment providers. "clay" is the legacy provider (existing webhook). */
export type Provider =
  | "prospeo"
  | "aiark"
  | "leadmagic"
  | "findymail"
  | "firecrawl"
  | "clay"
  | "ai-normalizer";

/** Entity types that can be enriched. */
export type EntityType = "person" | "company";

/** Status of an enrichment run. */
export type EnrichmentStatus = "success" | "error" | "skipped";

/** Result returned after recording an enrichment run. */
export interface EnrichmentResult {
  entityId: string;
  entityType: EntityType;
  provider: Provider;
  status: EnrichmentStatus;
  fieldsWritten: string[];
  costUsd?: number;
  errorMessage?: string;
}

/** Result from an email-finding provider adapter. */
export interface EmailProviderResult {
  email: string | null;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  linkedinUrl?: string;
  location?: string;
  source: Provider;
  rawResponse: unknown;
  costUsd: number;
}

/** Result from a company data provider adapter. */
export interface CompanyProviderResult {
  name?: string;
  industry?: string;
  headcount?: number;
  description?: string;
  website?: string;
  location?: string;
  yearFounded?: number;
  source: Provider;
  rawResponse: unknown;
  costUsd: number;
}

/** Input for email-finding adapters. */
export interface EmailAdapterInput {
  linkedinUrl?: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  companyDomain?: string;
}

/** Email provider adapter — takes person info, returns email (or null). */
export type EmailAdapter = (input: EmailAdapterInput) => Promise<EmailProviderResult>;

/** Company provider adapter — takes domain, returns company data. */
export type CompanyAdapter = (domain: string) => Promise<CompanyProviderResult>;
