/**
 * Channel validation gate for target lists and campaign publishing.
 *
 * Validates that people meet channel requirements before being added to a
 * target list or before a campaign is published. This is the verification-aware
 * layer that sits above the structural checks in `channels/validation.ts`.
 *
 * Key difference from `channels/validation.ts`:
 *   - `channels/validation.ts` checks structural presence (email exists, LinkedIn URL exists)
 *   - This module checks data QUALITY (email is verified, not just present)
 *
 * Verification statuses from BounceBan:
 *   - "valid"          => allowed (deliverable)
 *   - "catch_all"      => allowed only if allowCatchAll option is true
 *   - "valid_catch_all" => same as catch_all
 *   - "invalid"        => rejected (undeliverable)
 *   - "risky"          => rejected (risky)
 *   - "unknown"        => rejected (unknown deliverability)
 *   - null/missing     => rejected (never verified)
 */

import { prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChannelValidationResult {
  valid: boolean;
  rejected: Array<{
    personId: string;
    reason: string;
  }>;
  accepted: string[]; // personIds that passed
}

export interface ChannelGateOptions {
  /** Allow catch-all emails (default: false). */
  allowCatchAll?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Placeholder email domains that must never enter a live campaign. */
const PLACEHOLDER_DOMAINS = ["@discovery.internal", "@discovered.local"] as const;

function isPlaceholderEmail(email: string): boolean {
  const lower = email.toLowerCase();
  return PLACEHOLDER_DOMAINS.some((d) => lower.includes(d));
}

/** Accepted verification statuses for email campaigns. */
const ACCEPTED_STATUSES = new Set(["valid", "deliverable"]);
const CATCH_ALL_STATUSES = new Set(["catch_all", "valid_catch_all"]);

/**
 * Parse emailVerificationStatus from a person's enrichmentData JSON string.
 * Returns null if unparseable or not present.
 */
function getVerificationStatus(enrichmentData: string | null): string | null {
  if (!enrichmentData) return null;
  try {
    const data = JSON.parse(enrichmentData);
    if (typeof data === "object" && data !== null && typeof data.emailVerificationStatus === "string") {
      return data.emailVerificationStatus;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// validatePeopleForChannel
// ---------------------------------------------------------------------------

/**
 * Validate people meet channel requirements before adding to a target list.
 *
 * Rules:
 * - Email campaigns: person.email must be non-null, non-empty, not placeholder
 * - Email campaigns: emailVerificationStatus must be 'valid' or 'deliverable'
 *   - catch_all/valid_catch_all allowed if allowCatchAll is true
 *   - null/missing = rejected (unverified)
 *   - 'invalid', 'risky', 'unknown' = rejected
 * - LinkedIn campaigns: person.linkedinUrl must be non-null and non-empty
 * - 'both' channel: must pass BOTH email and LinkedIn checks
 *
 * @param personIds - Array of Person IDs to validate
 * @param channel   - Campaign channel: 'email', 'linkedin', or 'both'
 * @param options   - Optional: { allowCatchAll?: boolean }
 * @returns ChannelValidationResult with accepted and rejected arrays
 */
export async function validatePeopleForChannel(
  personIds: string[],
  channel: "email" | "linkedin" | "both",
  options?: ChannelGateOptions,
): Promise<ChannelValidationResult> {
  if (personIds.length === 0) {
    return { valid: true, rejected: [], accepted: [] };
  }

  const allowCatchAll = options?.allowCatchAll ?? false;

  // Fetch all people in a single query
  const people = await prisma.person.findMany({
    where: { id: { in: personIds } },
    select: {
      id: true,
      email: true,
      linkedinUrl: true,
      enrichmentData: true,
    },
  });

  // Build a lookup for people that weren't found
  const foundIds = new Set(people.map((p) => p.id));

  const accepted: string[] = [];
  const rejected: Array<{ personId: string; reason: string }> = [];

  // Reject any IDs not found in DB
  for (const pid of personIds) {
    if (!foundIds.has(pid)) {
      rejected.push({ personId: pid, reason: "person not found in database" });
    }
  }

  for (const person of people) {
    const failures: string[] = [];

    // Email checks
    if (channel === "email" || channel === "both") {
      if (!person.email || person.email.trim().length === 0) {
        failures.push("missing email address");
      } else if (isPlaceholderEmail(person.email)) {
        failures.push("placeholder email not allowed");
      } else {
        // Check verification status
        const status = getVerificationStatus(person.enrichmentData);
        if (!status) {
          failures.push("email not verified (no verification status)");
        } else if (ACCEPTED_STATUSES.has(status)) {
          // Pass
        } else if (CATCH_ALL_STATUSES.has(status)) {
          if (!allowCatchAll) {
            failures.push(`email verification status '${status}' not accepted (enable allowCatchAll to include)`);
          }
        } else {
          // invalid, risky, unknown, or any other status
          failures.push(`email verification status '${status}' not accepted`);
        }
      }
    }

    // LinkedIn checks
    if (channel === "linkedin" || channel === "both") {
      if (!person.linkedinUrl || person.linkedinUrl.trim().length === 0) {
        failures.push("missing LinkedIn URL");
      }
    }

    if (failures.length > 0) {
      rejected.push({ personId: person.id, reason: failures.join("; ") });
    } else {
      accepted.push(person.id);
    }
  }

  return {
    valid: rejected.length === 0,
    rejected,
    accepted,
  };
}

// ---------------------------------------------------------------------------
// auditTargetListForChannel
// ---------------------------------------------------------------------------

/**
 * Audit an existing target list against a campaign's channel.
 * Returns people who don't meet channel + verification requirements.
 *
 * @param listId  - TargetList ID to audit
 * @param channel - Campaign channel: 'email', 'linkedin', or 'both'
 * @param options - Optional: { allowCatchAll?: boolean }
 * @returns ChannelValidationResult with accepted/rejected arrays
 */
export async function auditTargetListForChannel(
  listId: string,
  channel: "email" | "linkedin" | "both",
  options?: ChannelGateOptions,
): Promise<ChannelValidationResult> {
  // Fetch all people in the target list
  const members = await prisma.targetListPerson.findMany({
    where: { listId },
    select: { personId: true },
  });

  const personIds = members.map((m) => m.personId);
  return validatePeopleForChannel(personIds, channel, options);
}
