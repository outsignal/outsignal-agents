/**
 * Kitt email-finding adapter for the enrichment waterfall.
 *
 * Wraps kitt.findEmail() to conform to the EmailAdapter interface used by
 * the enrichment waterfall (waterfall.ts). Kitt finds emails by name + domain,
 * optionally improved with a LinkedIn URL.
 *
 * Cost: $0.005 per found email (free if not found).
 * Position in waterfall: after Prospeo, before verification.
 */
import type { EmailAdapter, EmailProviderResult } from "../types";
import { findEmail } from "@/lib/verification/kitt";

/**
 * Kitt email adapter conforming to the EmailAdapter interface.
 *
 * Requires firstName + lastName + companyDomain (or companyName).
 * LinkedIn URL is optional but improves accuracy.
 * Returns null email if Kitt cannot find one or if required fields are missing.
 */
export const kittAdapter: EmailAdapter = async (input) => {
  const firstName = input.firstName;
  const lastName = input.lastName;
  const domain = input.companyDomain ?? input.companyName;

  // Kitt requires fullName + domain at minimum
  if (!firstName || !lastName || !domain) {
    return {
      email: null,
      source: "kitt-find",
      rawResponse: { skipped: true, reason: "missing required fields (name + domain)" },
      costUsd: 0,
    };
  }

  const fullName = `${firstName} ${lastName}`;

  const result = await findEmail({
    fullName,
    domain,
    linkedinUrl: input.linkedinUrl,
    // personId not available here -- enrichment logging is handled by the waterfall
  });

  return {
    email: result.email,
    source: "kitt-find",
    rawResponse: result.rawResponse ?? result,
    costUsd: result.costUsd,
  };
};
