import type { CreateLeadParams } from "./types";
import { normalizeCompanyName } from "./company-normaliser";
import { resolveLastEmailMonth } from "@/lib/outreach/last-email-month";

export interface EmailLeadPayloadInput {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  jobTitle?: string | null;
  company?: string | null;
  companyDomain?: string | null;
  location?: string | null;
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
): CreateLeadParams {
  const customVariables: NonNullable<CreateLeadParams["customVariables"]> = [];

  const location = person.location?.trim();
  if (location) {
    customVariables.push({ name: "LOCATION", value: location });
  }

  const lastEmailMonth = resolveLastEmailMonth(campaignDescription);
  if (lastEmailMonth) {
    customVariables.push({ name: "LASTEMAILMONTH", value: lastEmailMonth });
  }

  return {
    email: person.email,
    firstName: person.firstName ?? undefined,
    lastName: person.lastName ?? undefined,
    jobTitle: person.jobTitle ?? undefined,
    company:
      normalizeCompanyName(
        person.company,
        person.companyDomain ?? null,
      ) ?? undefined,
    customVariables: customVariables.length > 0 ? customVariables : undefined,
  };
}
