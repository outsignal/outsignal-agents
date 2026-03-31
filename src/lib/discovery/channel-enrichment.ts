/**
 * channel-enrichment.ts
 *
 * Channel-aware enrichment routing. LinkedIn-only campaigns skip email
 * enrichment; email campaigns always get LinkedIn URLs.
 *
 * Purpose: Save credits by not enriching channels that won't be used,
 * and provide routing suggestions for unverified/CATCH_ALL emails.
 */

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/**
 * Safely parse the Campaign.channels JSON string field.
 * Campaign.channels is stored as a JSON string like '["email"]' or '["linkedin"]'.
 * Catches parse errors and defaults to ["email"].
 */
export function getCampaignChannels(campaign: { channels: string }): string[] {
  try {
    const parsed = JSON.parse(campaign.channels);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed as string[];
    }
    return ["email"];
  } catch {
    return ["email"];
  }
}

/**
 * Determine the enrichment profile based on campaign channels.
 * - LinkedIn-only (channels = ["linkedin"]) -> "linkedin-only": skip email enrichment
 * - All other combos -> "full": email + LinkedIn URLs
 */
export function getEnrichmentProfile(channels: string[]): "full" | "linkedin-only" {
  if (channels.length === 1 && channels[0] === "linkedin") {
    return "linkedin-only";
  }
  return "full";
}

/**
 * Convenience wrapper: returns true when enrichment profile is "linkedin-only".
 */
export function shouldSkipEmailEnrichment(channels: string[]): boolean {
  return getEnrichmentProfile(channels) === "linkedin-only";
}

/**
 * Generate a routing suggestion for unverified/CATCH_ALL emails.
 *
 * At staging time (DiscoveredPerson), we can only check email PRESENCE,
 * not verification status. Verification status comes AFTER promotion + enrichment.
 * This function works on presence only. The routing suggestion is forward-looking.
 */
export function getUnverifiedRoutingSuggestion(
  people: Array<{ email?: string | null; linkedinUrl?: string | null }>,
): {
  totalWithEmail: number;
  verifiedCount: number;
  catchAllCount: number;
  unverifiedCount: number;
  noEmailCount: number;
  suggestion: string;
} {
  let totalWithEmail = 0;
  let noEmailCount = 0;

  for (const person of people) {
    if (person.email) {
      totalWithEmail++;
    } else {
      noEmailCount++;
    }
  }

  // At staging time we cannot distinguish verified from catch-all from unverified.
  // All emails are "present but unverified" until enrichment runs.
  const total = people.length;
  const suggestionParts: string[] = [];

  if (noEmailCount > 0) {
    suggestionParts.push(
      `${noEmailCount} of ${total} leads have no email. Enrichment waterfall will attempt to find emails via FindyMail, Prospeo, and AI Ark.`,
    );
  }

  if (totalWithEmail > 0) {
    suggestionParts.push(
      `After promotion, ${totalWithEmail} leads with emails will be routed through LeadMagic verification. CATCH_ALL and unverified emails will be flagged for review.`,
    );
  }

  return {
    totalWithEmail,
    verifiedCount: 0, // not knowable at staging time
    catchAllCount: 0, // not knowable at staging time
    unverifiedCount: 0, // not knowable at staging time
    noEmailCount,
    suggestion: suggestionParts.join(" ") || "No leads to assess.",
  };
}
