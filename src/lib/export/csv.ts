/**
 * CSV generation utility for TargetList export.
 *
 * Generates a downloadable CSV containing all enriched Person and Company fields.
 * Enforces the verification gate: export is blocked if any person has an unverified email.
 * Invalid/blocked emails are automatically excluded; only exportable (valid) emails are included.
 *
 * enrichmentData flattening handles both formats found in DB:
 * - Clay person data: [{name, value}] array → enrichment_{name} columns
 * - Company / provider data: {key: value} object → enrichment_{key} columns
 */

import { prisma } from "@/lib/db";
import { getListExportReadiness, ExportPerson } from "@/lib/export/verification-gate";
import type { Company } from "@prisma/client";

/**
 * Flatten enrichmentData JSON string into a flat record of CSV columns.
 *
 * Handles two formats:
 * - Array: [{name: "fundingStage", value: "series B"}] → {enrichment_fundingStage: "series B"}
 * - Object: {type: "Privately Held"} → {enrichment_type: "Privately Held"}
 *
 * @param enrichmentData - Raw enrichmentData JSON string from Person or Company
 * @returns Flat record of enrichment_* keys to string values
 */
export function flattenEnrichmentData(enrichmentData: string | null): Record<string, string> {
  if (!enrichmentData) return {};
  try {
    const parsed: unknown = JSON.parse(enrichmentData);

    // Array format: [{name, value}] (Clay person data)
    if (Array.isArray(parsed)) {
      const result: Record<string, string> = {};
      for (const entry of parsed as { name: string; value: unknown }[]) {
        if (entry.name != null) {
          result[`enrichment_${entry.name}`] = String(entry.value ?? "");
        }
      }
      return result;
    }

    // Object format: {key: value} (company enrichmentData, provider data)
    if (typeof parsed === "object" && parsed !== null) {
      const result: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        result[`enrichment_${k}`] = String(v ?? "");
      }
      return result;
    }

    return {};
  } catch {
    return {};
  }
}

/**
 * Escape a value for CSV output.
 *
 * - null/undefined → empty string
 * - Contains comma, double-quote, or newline → wrap in double-quotes, double internal quotes
 * - Otherwise return as-is
 *
 * @param s - Value to escape
 * @returns CSV-safe string
 */
export function escapeCsv(s: string | null | undefined): string {
  if (s == null || s === "") return "";
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Generate a CSV file for all exportable members of a TargetList.
 *
 * Enforces the verification gate:
 * - Throws if any member has an unverified email (needsVerificationCount > 0)
 * - Auto-excludes verified but blocked emails (invalid/catch_all/etc.)
 *
 * Joins Company records via companyDomain for company-level columns.
 * Flattens enrichmentData from both Person and Company into dynamic columns.
 *
 * @param listId - TargetList ID to export
 * @returns { csv: string, filename: string, count: number }
 * @throws If unverified emails exist (verification gate block)
 */
export async function generateListCsv(
  listId: string
): Promise<{ csv: string; filename: string; count: number }> {
  // 1. Check export readiness — hard block on unverified emails
  const readiness = await getListExportReadiness(listId);

  if (readiness.needsVerificationCount > 0) {
    throw new Error(
      `Export blocked: ${readiness.needsVerificationCount} people have unverified emails. Verify first.`
    );
  }

  // 2. Only export ready people (auto-exclude blocked)
  const people: ExportPerson[] = readiness.readyPeople;

  // 3. Fetch the list name for filename generation
  const list = await prisma.targetList.findUnique({
    where: { id: listId },
    select: { name: true },
  });
  const listName = list?.name ?? listId;

  // 4. Fetch all Company records for people that have a companyDomain (single query)
  const domains = [...new Set(people.map((p) => p.companyDomain).filter((d): d is string => !!d))];
  const companies = await prisma.company.findMany({
    where: { domain: { in: domains } },
  });
  const companyMap = new Map<string, Company>(companies.map((c) => [c.domain, c]));

  // 5. Flatten enrichmentData for all people AND their companies to discover all keys
  type EnrichmentPair = { personFlat: Record<string, string>; companyFlat: Record<string, string> };
  const enrichmentPairs: EnrichmentPair[] = people.map((p) => {
    const company = p.companyDomain ? companyMap.get(p.companyDomain) : undefined;
    return {
      personFlat: flattenEnrichmentData(p.enrichmentData),
      companyFlat: flattenEnrichmentData(company?.enrichmentData ?? null),
    };
  });

  // Collect all unique enrichment keys across the full list (sorted for deterministic output)
  const allEnrichmentKeys = new Set<string>();
  for (const { personFlat, companyFlat } of enrichmentPairs) {
    for (const k of Object.keys(personFlat)) allEnrichmentKeys.add(k);
    for (const k of Object.keys(companyFlat)) allEnrichmentKeys.add(k);
  }
  const enrichmentHeaders = Array.from(allEnrichmentKeys).sort();

  // 6. Build CSV headers
  const baseHeaders = [
    "first_name",
    "last_name",
    "email",
    "job_title",
    "company",
    "company_domain",
    "linkedin_url",
    "phone",
    "location",
    "vertical",
  ];
  const companyHeaders = [
    "company_industry",
    "company_headcount",
    "company_location",
    "company_revenue",
    "company_year_founded",
    "company_type",
  ];
  const allHeaders = [...baseHeaders, ...companyHeaders, ...enrichmentHeaders];

  // 7. Build CSV rows
  const rows: string[] = [allHeaders.join(",")];

  for (let i = 0; i < people.length; i++) {
    const p = people[i];
    const company = p.companyDomain ? companyMap.get(p.companyDomain) : undefined;
    const { personFlat, companyFlat } = enrichmentPairs[i];

    // Merge person and company enrichment (person wins on key collision)
    const mergedEnrichment: Record<string, string> = { ...companyFlat, ...personFlat };

    const baseValues = [
      escapeCsv(p.firstName),
      escapeCsv(p.lastName),
      escapeCsv(p.email),
      escapeCsv(p.jobTitle),
      escapeCsv(p.company),
      escapeCsv(p.companyDomain),
      escapeCsv(p.linkedinUrl),
      escapeCsv(p.phone),
      escapeCsv(p.location),
      escapeCsv(p.vertical),
    ];

    const companyValues = [
      escapeCsv(company?.industry ?? null),
      escapeCsv(company?.headcount != null ? String(company.headcount) : null),
      escapeCsv(company?.location ?? null),
      escapeCsv(company?.revenue ?? null),
      escapeCsv(company?.yearFounded != null ? String(company.yearFounded) : null),
      escapeCsv(company?.companyType ?? null),
    ];

    const enrichmentValues = enrichmentHeaders.map((k) =>
      escapeCsv(mergedEnrichment[k] ?? null)
    );

    rows.push([...baseValues, ...companyValues, ...enrichmentValues].join(","));
  }

  const csv = rows.join("\n");

  // 8. Build filename: sanitize list name → lowercase, non-alphanumeric → underscore
  const sanitizedName = listName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const filename = `${sanitizedName}_${dateStr}.csv`;

  return { csv, filename, count: people.length };
}
