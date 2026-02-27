/**
 * Export verification gate for TargetList members.
 *
 * Checks email verification status for every person in a list before allowing
 * export to EmailBison or CSV. Hard block: any unverified email prevents export.
 *
 * Flow:
 * 1. Call getListExportReadiness(listId) to get summary and categorized people
 * 2. If needsVerificationCount > 0, block export and offer to verify
 * 3. Call verifyAndFilter(needsVerificationPeople) to verify unverified emails
 * 4. Re-call getListExportReadiness to get updated summary after verification
 * 5. Export readyPeople only (blocked are auto-excluded)
 */

import { getVerificationStatus, verifyEmail, VerificationResult } from "@/lib/verification/leadmagic";
import { prisma } from "@/lib/db";

/** Shape of a Person record as returned by the TargetListPerson include. */
export interface ExportPerson {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  company: string | null;
  companyDomain: string | null;
  linkedinUrl: string | null;
  phone: string | null;
  location: string | null;
  vertical: string | null;
  enrichmentData: string | null;
}

/** Full export readiness summary for a TargetList. */
export interface ExportReadiness {
  /** Total members in the list */
  totalCount: number;
  /** Members with verified + exportable emails (isExportable=true) */
  readyCount: number;
  /** Members never verified (no emailVerificationStatus in enrichmentData) */
  needsVerificationCount: number;
  /** Members verified but blocked (invalid/catch_all/unknown) */
  blockedCount: number;
  /** Percentage of members that are ready to export, e.g. "72.5" */
  verifiedEmailPct: string;
  /** Breakdown of member count by vertical, e.g. { "SaaS": 5, "Unknown": 2 } */
  verticalBreakdown: Record<string, number>;
  /** Coverage of enrichment data fields across list members */
  enrichmentCoverage: {
    companyDataPct: string;
    linkedinPct: string;
    jobTitlePct: string;
  };
  /** People ready for export (isExportable=true) */
  readyPeople: ExportPerson[];
  /** People that need verification (never verified) */
  needsVerificationPeople: ExportPerson[];
  /** People verified but blocked from export */
  blockedPeople: ExportPerson[];
}

/**
 * Check export readiness for all members of a TargetList.
 *
 * Fetches all members, checks verification status for each, and categorizes
 * them into ready/needsVerification/blocked groups.
 *
 * @param listId - TargetList ID to check
 * @returns ExportReadiness summary with categorized person arrays
 */
export async function getListExportReadiness(listId: string): Promise<ExportReadiness> {
  // Fetch all list members with full Person data needed for export
  const members = await prisma.targetListPerson.findMany({
    where: { listId },
    include: {
      person: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          jobTitle: true,
          company: true,
          companyDomain: true,
          linkedinUrl: true,
          phone: true,
          location: true,
          vertical: true,
          enrichmentData: true,
        },
      },
    },
  });

  const readyPeople: ExportPerson[] = [];
  const needsVerificationPeople: ExportPerson[] = [];
  const blockedPeople: ExportPerson[] = [];
  const verticalBreakdown: Record<string, number> = {};

  // Check verification status for each person in parallel
  const verificationResults = await Promise.all(
    members.map(async (m) => {
      const status = await getVerificationStatus(m.person.id);
      return { person: m.person as ExportPerson, status };
    })
  );

  for (const { person, status } of verificationResults) {
    // Accumulate vertical breakdown
    const vertical = person.vertical ?? "Unknown";
    verticalBreakdown[vertical] = (verticalBreakdown[vertical] ?? 0) + 1;

    if (status === null) {
      // Never verified
      needsVerificationPeople.push(person);
    } else if (status.isExportable) {
      // Verified and exportable (status === "valid")
      readyPeople.push(person);
    } else {
      // Verified but blocked (invalid, catch_all, valid_catch_all, unknown)
      blockedPeople.push(person);
    }
  }

  const totalCount = members.length;
  const readyCount = readyPeople.length;
  const needsVerificationCount = needsVerificationPeople.length;
  const blockedCount = blockedPeople.length;

  // Calculate enrichment coverage across all list members
  const allPeople = [...readyPeople, ...needsVerificationPeople, ...blockedPeople];
  const withCompanyDomain = allPeople.filter((p) => !!p.companyDomain).length;
  const withLinkedin = allPeople.filter((p) => !!p.linkedinUrl).length;
  const withJobTitle = allPeople.filter((p) => !!p.jobTitle).length;

  const pct = (n: number): string =>
    totalCount === 0 ? "0.0" : ((n / totalCount) * 100).toFixed(1);

  return {
    totalCount,
    readyCount,
    needsVerificationCount,
    blockedCount,
    verifiedEmailPct: pct(readyCount),
    verticalBreakdown,
    enrichmentCoverage: {
      companyDataPct: pct(withCompanyDomain),
      linkedinPct: pct(withLinkedin),
      jobTitlePct: pct(withJobTitle),
    },
    readyPeople,
    needsVerificationPeople,
    blockedPeople,
  };
}

/**
 * Verify emails for unverified people and separate into exportable vs excluded.
 *
 * Called after user approves the verification spend. Runs verifyEmail() for
 * each person and returns them split by whether they passed or failed.
 *
 * @param people - People to verify (id + email required)
 * @returns { verified: VerificationResult[], excluded: VerificationResult[] }
 */
export async function verifyAndFilter(
  people: { id: string; email: string }[]
): Promise<{ verified: VerificationResult[]; excluded: VerificationResult[] }> {
  const results = await Promise.all(
    people.map(({ id, email }) => verifyEmail(email, id))
  );

  const verified: VerificationResult[] = [];
  const excluded: VerificationResult[] = [];

  for (const result of results) {
    if (result.isExportable) {
      verified.push(result);
    } else {
      excluded.push(result);
    }
  }

  return { verified, excluded };
}
