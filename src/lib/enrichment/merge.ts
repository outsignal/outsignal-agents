/**
 * "Existing data wins" merge strategy.
 * Only writes provider data to fields that are currently null/empty on the record.
 * Returns the list of field names that were actually written.
 */
import { prisma } from "@/lib/db";

function isBlank(value: unknown): boolean {
  return (
    value == null ||
    (typeof value === "string" && value.trim() === "")
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeProviderIds(
  existing: unknown,
  incoming: Record<string, string>,
): Record<string, string> | null {
  const current = isPlainObject(existing) ? existing : {};
  const merged = { ...current, ...incoming };
  return JSON.stringify(merged) === JSON.stringify(current)
    ? null
    : merged as Record<string, string>;
}

/**
 * Merge provider data into a Person record.
 * Only fills null/empty fields — never overwrites existing data.
 */
export async function mergePersonData(
  personId: string,
  data: Partial<{
    email: string;
    firstName: string;
    lastName: string;
    jobTitle: string;
    linkedinUrl: string;
    location: string;
    phone: string;
    company: string;
    companyDomain: string;
    providerIds: Record<string, string>;
    headline: string;
    skills: unknown[];
    jobHistory: unknown[];
    mobilePhone: string;
    locationCity: string;
    locationState: string;
    locationCountry: string;
    locationCountryCode: string;
  }>,
): Promise<string[]> {
  const person = await prisma.person.findUniqueOrThrow({ where: { id: personId } });

  const updates: Record<string, unknown> = {};
  const fieldsWritten: string[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (key === "providerIds" && isPlainObject(value)) {
      const merged = mergeProviderIds(person.providerIds, value as Record<string, string>);
      if (merged) {
        updates.providerIds = merged;
        fieldsWritten.push("providerIds");
      }
      continue;
    }

    if (!isBlank(value) && isBlank((person as Record<string, unknown>)[key])) {
      updates[key] = value;
      fieldsWritten.push(key);
    }
  }

  if (Object.keys(updates).length > 0) {
    await prisma.person.update({ where: { id: personId }, data: updates });
  }

  return fieldsWritten;
}

/**
 * Merge provider data into a Company record.
 * Only fills null/empty fields — never overwrites existing data.
 */
export async function mergeCompanyData(
  domain: string,
  data: Partial<{
    name: string;
    industry: string;
    headcount: number;
    description: string;
    website: string;
    location: string;
    yearFounded: number;
    revenue: string;
    linkedinUrl: string;
    companyType: string;
    providerIds: Record<string, string>;
    hqPhone: string;
    hqAddress: string;
    hqCity: string;
    hqState: string;
    hqCountry: string;
    hqCountryCode: string;
    socialUrls: Record<string, string>;
    technologies: unknown;
    fundingTotal: bigint;
    fundingStageLatest: string;
    fundingLatestDate: Date;
    fundingEvents: unknown;
    jobPostingsActiveCount: number;
    jobPostingTitles: string[];
  }>,
): Promise<string[]> {
  const company = await prisma.company.findUniqueOrThrow({ where: { domain } });

  const updates: Record<string, unknown> = {};
  const fieldsWritten: string[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (key === "providerIds" && isPlainObject(value)) {
      const merged = mergeProviderIds(company.providerIds, value as Record<string, string>);
      if (merged) {
        updates.providerIds = merged;
        fieldsWritten.push("providerIds");
      }
      continue;
    }

    if (!isBlank(value) && isBlank((company as Record<string, unknown>)[key])) {
      updates[key] = value;
      fieldsWritten.push(key);
    }
  }

  if (Object.keys(updates).length > 0) {
    await prisma.company.update({ where: { domain }, data: updates });
  }

  return fieldsWritten;
}
