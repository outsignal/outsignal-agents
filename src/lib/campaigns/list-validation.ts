/**
 * Channel-aware list validation and data quality pre-checks.
 *
 * Pure functions — no database calls. Operates on arrays of person objects
 * passed in by the caller (e.g. publishForReview, campaign agent tools).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ListValidationResult {
  valid: boolean;
  hardFailures: string[];
  softWarnings: string[];
}

export interface DataQualityReport {
  totalPeople: number;
  withFirstName: number;
  withCompany: number;
  firstNameAndCompanyPct: number;
  channelReport: {
    channel: "email" | "linkedin";
    eligible: number;
    ineligible: number;
    ineligibleReasons: string[];
  }[];
  warnings: string[];
  pass: boolean;
}

export type PersonData = {
  email?: string | null;
  linkedinUrl?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  jobTitle?: string | null;
};

// ---------------------------------------------------------------------------
// validateListForChannel
// ---------------------------------------------------------------------------

/**
 * Validates that people in a list meet the channel requirements.
 *
 * Email campaigns: verified email required (hard gate), LinkedIn URL preferred (soft)
 * LinkedIn campaigns: LinkedIn URL + firstName + jobTitle + company all required
 */
export function validateListForChannel(
  channel: "email" | "linkedin",
  people: PersonData[],
): ListValidationResult {
  const hardFailures: string[] = [];
  const softWarnings: string[] = [];

  if (people.length === 0) {
    hardFailures.push("List is empty — no people to validate");
    return { valid: false, hardFailures, softWarnings };
  }

  if (channel === "email") {
    const withEmail = people.filter((p) => p.email && p.email.trim().length > 0);
    if (withEmail.length === 0) {
      hardFailures.push("0 verified emails in this list");
    }

    const withoutLinkedIn = people.filter((p) => !p.linkedinUrl || p.linkedinUrl.trim().length === 0);
    if (withoutLinkedIn.length > 0) {
      softWarnings.push(
        `${withoutLinkedIn.length} of ${people.length} people missing LinkedIn URL (preferred for email campaigns)`,
      );
    }
  }

  if (channel === "linkedin") {
    const requiredFields = ["linkedinUrl", "firstName", "jobTitle", "company"] as const;
    const missingByField: Record<string, number> = {};

    for (const person of people) {
      for (const field of requiredFields) {
        const value = person[field];
        if (!value || (typeof value === "string" && value.trim().length === 0)) {
          missingByField[field] = (missingByField[field] ?? 0) + 1;
        }
      }
    }

    for (const field of requiredFields) {
      const count = missingByField[field];
      if (count && count > 0) {
        hardFailures.push(
          `${count} of ${people.length} people missing ${field} (required for LinkedIn campaigns)`,
        );
      }
    }
  }

  return {
    valid: hardFailures.length === 0,
    hardFailures,
    softWarnings,
  };
}

// ---------------------------------------------------------------------------
// runDataQualityPreCheck
// ---------------------------------------------------------------------------

/**
 * Runs full data quality pre-check on a list for given channels.
 *
 * - Counts people with firstName AND company -> percentage
 * - If < 80%: adds warning
 * - Per-channel: counts eligible vs ineligible with reasons
 * - pass = true only if all channels have > 0 eligible AND firstNameAndCompanyPct >= 80
 */
export function runDataQualityPreCheck(
  channels: ("email" | "linkedin")[],
  people: PersonData[],
): DataQualityReport {
  const totalPeople = people.length;
  const withFirstName = people.filter((p) => p.firstName && p.firstName.trim().length > 0).length;
  const withCompany = people.filter((p) => p.company && p.company.trim().length > 0).length;
  const withBoth = people.filter(
    (p) =>
      p.firstName && p.firstName.trim().length > 0 &&
      p.company && p.company.trim().length > 0,
  ).length;

  const firstNameAndCompanyPct = totalPeople > 0 ? Math.round((withBoth / totalPeople) * 100) : 0;

  const warnings: string[] = [];
  if (firstNameAndCompanyPct < 80) {
    warnings.push(
      `Only ${firstNameAndCompanyPct}% of leads have first name and company name (minimum 80%)`,
    );
  }

  const channelReport: DataQualityReport["channelReport"] = [];

  for (const channel of channels) {
    if (channel === "email") {
      const eligible = people.filter((p) => p.email && p.email.trim().length > 0).length;
      const ineligible = totalPeople - eligible;
      const reasons: string[] = [];
      if (ineligible > 0) {
        reasons.push(`${ineligible} people missing verified email`);
      }
      channelReport.push({ channel, eligible, ineligible, ineligibleReasons: reasons });
    }

    if (channel === "linkedin") {
      const eligible = people.filter((p) =>
        p.linkedinUrl && p.linkedinUrl.trim().length > 0 &&
        p.firstName && p.firstName.trim().length > 0 &&
        p.jobTitle && p.jobTitle.trim().length > 0 &&
        p.company && p.company.trim().length > 0,
      ).length;
      const ineligible = totalPeople - eligible;
      const reasons: string[] = [];
      if (ineligible > 0) {
        const missingLinkedin = people.filter((p) => !p.linkedinUrl || p.linkedinUrl.trim().length === 0).length;
        const missingName = people.filter((p) => !p.firstName || p.firstName.trim().length === 0).length;
        const missingTitle = people.filter((p) => !p.jobTitle || p.jobTitle.trim().length === 0).length;
        const missingCompany = people.filter((p) => !p.company || p.company.trim().length === 0).length;
        if (missingLinkedin > 0) reasons.push(`${missingLinkedin} missing LinkedIn URL`);
        if (missingName > 0) reasons.push(`${missingName} missing first name`);
        if (missingTitle > 0) reasons.push(`${missingTitle} missing job title`);
        if (missingCompany > 0) reasons.push(`${missingCompany} missing company`);
      }
      channelReport.push({ channel, eligible, ineligible, ineligibleReasons: reasons });
    }
  }

  const allChannelsHaveEligible = channelReport.every((cr) => cr.eligible > 0);
  const pass = allChannelsHaveEligible && firstNameAndCompanyPct >= 80;

  return {
    totalPeople,
    withFirstName,
    withCompany,
    firstNameAndCompanyPct,
    channelReport,
    warnings,
    pass,
  };
}
