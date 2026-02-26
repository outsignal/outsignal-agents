/**
 * "Existing data wins" merge strategy.
 * Only writes provider data to fields that are currently null/empty on the record.
 * Returns the list of field names that were actually written.
 */
import { prisma } from "@/lib/db";

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
  }>,
): Promise<string[]> {
  const person = await prisma.person.findUniqueOrThrow({ where: { id: personId } });

  const updates: Record<string, unknown> = {};
  const fieldsWritten: string[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (value != null && value !== "" && (person as Record<string, unknown>)[key] == null) {
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
    companyType: string;
  }>,
): Promise<string[]> {
  const company = await prisma.company.findUniqueOrThrow({ where: { domain } });

  const updates: Record<string, unknown> = {};
  const fieldsWritten: string[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (value != null && value !== "" && (company as Record<string, unknown>)[key] == null) {
      updates[key] = value;
      fieldsWritten.push(key);
    }
  }

  if (Object.keys(updates).length > 0) {
    await prisma.company.update({ where: { domain }, data: updates });
  }

  return fieldsWritten;
}
