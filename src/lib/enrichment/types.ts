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
