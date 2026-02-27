export type EnrichmentStatus = "full" | "partial" | "missing";

/**
 * Derive enrichment status from a person record's field presence.
 * - full: has email + linkedinUrl + companyDomain
 * - partial: has at least one but not all three
 * - missing: has none of the three key enrichment fields
 *
 * Note: Person.email is String @unique (never null), so "missing" means
 * no linkedinUrl AND no companyDomain. In practice, everyone has email.
 */
export function getEnrichmentStatus(person: {
  email: string | null;
  linkedinUrl: string | null;
  companyDomain: string | null;
}): EnrichmentStatus {
  const has = [!!person.email, !!person.linkedinUrl, !!person.companyDomain].filter(Boolean).length;
  if (has === 3) return "full";
  if (has >= 1) return "partial";
  return "missing";
}

/**
 * Derive enrichment status for a company record.
 * - full: has industry + headcount + description
 * - partial: has at least one but not all three
 * - missing: none present
 */
export function getCompanyEnrichmentStatus(company: {
  industry: string | null;
  headcount: number | null;
  description: string | null;
}): EnrichmentStatus {
  const has = [!!company.industry, company.headcount != null, !!company.description].filter(Boolean).length;
  if (has === 3) return "full";
  if (has >= 1) return "partial";
  return "missing";
}

/** Color mapping for enrichment status indicators (green/yellow/red intent per user decision) */
export const ENRICHMENT_COLORS: Record<EnrichmentStatus, string> = {
  full: "#4ECDC4",    // teal-green
  partial: "#F0FF7A", // brand yellow
  missing: "#FF6B6B", // red
};

/** Human-readable labels */
export const ENRICHMENT_LABELS: Record<EnrichmentStatus, string> = {
  full: "Enriched",
  partial: "Partial",
  missing: "Missing",
};
