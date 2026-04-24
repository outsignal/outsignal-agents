import type { CreateLeadParams } from "./types";
import { normalizeCompanyName } from "./company-normaliser";
import { resolveLastEmailMonth } from "@/lib/outreach/last-email-month";

export interface EmailLeadPayloadInput {
  personId?: string | null;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  jobTitle?: string | null;
  company?: string | null;
  companyDomain?: string | null;
  location?: string | null;
}

export interface BuildEmailLeadPayloadOptions {
  allowMissingLastName?: boolean;
}

export interface MissingRequiredLeadField {
  fieldName: "lastName";
  personId: string;
  email: string;
}

function normalizeLeadField(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function collectMissingRequiredLeadFields(
  people: readonly Pick<EmailLeadPayloadInput, "personId" | "email" | "lastName">[],
): MissingRequiredLeadField[] {
  return people.flatMap((person) => {
    if (normalizeLeadField(person.lastName)) {
      return [];
    }
    return [
      {
        fieldName: "lastName" as const,
        personId: person.personId?.trim() || person.email,
        email: person.email,
      },
    ];
  });
}

export class MissingRequiredLeadFieldError extends Error {
  readonly fieldName: "lastName";
  readonly personIds: string[];
  readonly emails: string[];

  constructor(missing: readonly MissingRequiredLeadField[]) {
    const personIds = missing.map((entry) => entry.personId);
    const emails = missing.map((entry) => entry.email);
    super(
      `Missing required lead field lastName for ${missing.length} lead(s): ${personIds.join(", ")}`,
    );
    this.name = "MissingRequiredLeadFieldError";
    this.fieldName = "lastName";
    this.personIds = personIds;
    this.emails = emails;
  }
}

/**
 * Build the EmailBison lead payload used by outbound email flows.
 *
 * Keeps company normalisation and supported custom-variable population in one
 * place so the main email adapter and signal-campaign pipeline stay in sync.
 */
export function buildEmailLeadPayload(
  person: EmailLeadPayloadInput,
  campaignDescription?: string | null,
  opts: BuildEmailLeadPayloadOptions = {},
): CreateLeadParams {
  const customVariables: NonNullable<CreateLeadParams["customVariables"]> = [];

  const location = person.location?.trim();
  if (location) {
    customVariables.push({ name: "location", value: location });
  }

  const lastEmailMonth = resolveLastEmailMonth(campaignDescription);
  if (lastEmailMonth) {
    customVariables.push({ name: "lastemailmonth", value: lastEmailMonth });
  }

  const firstName = normalizeLeadField(person.firstName);
  const normalizedLastName = normalizeLeadField(person.lastName);
  const lastName =
    normalizedLastName ?? (opts.allowMissingLastName === true ? "" : undefined);

  return {
    email: person.email,
    firstName,
    lastName,
    jobTitle: person.jobTitle ?? undefined,
    company:
      normalizeCompanyName(
        person.company,
        person.companyDomain ?? null,
      ) ?? undefined,
    customVariables: customVariables.length > 0 ? customVariables : undefined,
  };
}
