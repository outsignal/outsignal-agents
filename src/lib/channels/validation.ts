/**
 * Channel-level validation for individual people.
 *
 * These are the ground-truth rules for whether a person can enter a campaign
 * on a given channel. They are enforced at TWO gates:
 *
 *   1. Add-time — when people are added to a target list that is linked to
 *      a campaign.  Invalid people are filtered out and rejected counts are
 *      returned to the caller so it can surface them in the UI / CLI output.
 *
 *   2. Publish-time — when publishForReview() transitions a campaign to
 *      pending_approval.  If any invalid people remain in the list the
 *      transition is hard-blocked.
 *
 * Rules
 * -----
 * Email channel:
 *   - email must be non-null and non-empty
 *   - email must NOT contain "@discovery.internal" or "@discovered.local"
 *     (these are placeholder addresses generated during discovery staging)
 *
 * LinkedIn channel:
 *   - linkedinUrl must be non-null and non-empty
 *
 * Dual-channel (email + linkedin):
 *   - person must satisfy ALL enabled channels
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal person shape required by the validators. */
export type ChannelValidationPerson = {
  email?: string | null;
  linkedinUrl?: string | null;
};

/** Result of validating a single person against a single channel. */
export interface PersonChannelValidation {
  valid: boolean;
  /** Human-readable reason if invalid. Undefined when valid === true. */
  reason?: string;
}

/** Result of filtering a list of people for one or more channels. */
export interface FilterResult<T extends ChannelValidationPerson> {
  valid: T[];
  rejected: Array<{ person: T; reason: string }>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Placeholder email domains that must never enter a live campaign. */
const PLACEHOLDER_DOMAINS = ["@discovery.internal", "@discovered.local"] as const;

function isPlaceholderEmail(email: string): boolean {
  const lower = email.toLowerCase();
  return PLACEHOLDER_DOMAINS.some((d) => lower.includes(d));
}

// ---------------------------------------------------------------------------
// validatePersonForChannel
// ---------------------------------------------------------------------------

/**
 * Validates that a person has the required data for a campaign's channel.
 *
 * @param person  - Object with at minimum `email` and `linkedinUrl` fields.
 * @param channel - The channel to validate against: "email" or "linkedin".
 * @returns `{ valid: true }` when the person passes, or
 *          `{ valid: false, reason: string }` when they don't.
 */
export function validatePersonForChannel(
  person: ChannelValidationPerson,
  channel: string,
): PersonChannelValidation {
  if (channel === "email") {
    if (!person.email || person.email.trim().length === 0) {
      return { valid: false, reason: "missing email address" };
    }
    if (isPlaceholderEmail(person.email)) {
      return {
        valid: false,
        reason: `placeholder email not allowed in campaigns (${person.email})`,
      };
    }
    return { valid: true };
  }

  if (channel === "linkedin") {
    if (!person.linkedinUrl || person.linkedinUrl.trim().length === 0) {
      return { valid: false, reason: "missing LinkedIn URL" };
    }
    return { valid: true };
  }

  // Unknown channel — pass through rather than silently blocking.
  // publishForReview will catch structural issues.
  return { valid: true };
}

// ---------------------------------------------------------------------------
// filterPeopleForChannels
// ---------------------------------------------------------------------------

/**
 * Filters a list of people to only those valid for ALL the given channels.
 *
 * A person with a valid email but no LinkedIn URL will pass an email-only
 * campaign but fail a dual-channel or LinkedIn-only campaign.
 *
 * @param people   - Array of people (must include `email` and `linkedinUrl`).
 * @param channels - Array of channel strings, e.g. `["email"]` or
 *                   `["email", "linkedin"]`.
 * @returns `{ valid, rejected }` — `valid` is the subset that passes all
 *          channels; `rejected` includes each failed person with a reason.
 */
export function filterPeopleForChannels<T extends ChannelValidationPerson>(
  people: T[],
  channels: string[],
): FilterResult<T> {
  const valid: T[] = [];
  const rejected: Array<{ person: T; reason: string }> = [];

  for (const person of people) {
    const failures: string[] = [];

    for (const channel of channels) {
      const result = validatePersonForChannel(person, channel);
      if (!result.valid && result.reason) {
        failures.push(`[${channel}] ${result.reason}`);
      }
    }

    if (failures.length === 0) {
      valid.push(person);
    } else {
      rejected.push({ person, reason: failures.join("; ") });
    }
  }

  return { valid, rejected };
}
