/**
 * quality-gate.ts
 *
 * Post-search quality assessment module. Computes 4 metrics from staged
 * DiscoveredPersonResult arrays: verified email %, LinkedIn URL %, ICP fit
 * distribution, and junk detection count. Pure functions, no side effects.
 *
 * Purpose: Prevent $100 Prospeo-style incidents by computing quality metrics
 * after every search, flagging low-quality results before promotion.
 */

import type { DiscoveredPersonResult } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const JUNK_EMAIL_PREFIXES = [
  "info@",
  "admin@",
  "support@",
  "sales@",
  "contact@",
  "hello@",
  "noreply@",
  "no-reply@",
  "webmaster@",
  "office@",
];

const JUNK_NAME_PATTERNS = [
  /^(n\/a|na|unknown|test|none|null)$/i,
  /^[a-z]$/i, // single character
];

// ---------------------------------------------------------------------------
// Exported interfaces
// ---------------------------------------------------------------------------

export interface QualityMetrics {
  totalResults: number;
  verifiedEmailCount: number;
  verifiedEmailPct: number;
  linkedinUrlCount: number;
  linkedinUrlPct: number;
  icpFitDistribution: { high: number; medium: number; low: number; none: number };
  junkCount: number;
  junkExamples: string[]; // up to 5 examples
  belowThreshold: boolean; // true if verifiedEmailPct < 50
}

export interface QualityReport {
  metrics: QualityMetrics;
  grade: "good" | "acceptable" | "low" | "poor";
  suggestions: string[];
  costPerVerifiedLead: number | null;
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/**
 * Detect whether a discovered person result is junk/garbage data.
 *
 * Returns true if:
 * - Email starts with junk prefixes (info@, admin@, support@, etc.)
 * - Email contains @discovery.internal (placeholder from promotion.ts)
 * - Name matches junk patterns (single char, "N/A", "Unknown", "Test", "None", "null")
 * - Both firstName AND lastName are missing/empty
 * - Both email AND linkedinUrl are missing/null
 */
export function detectJunk(person: DiscoveredPersonResult): boolean {
  // Check junk email prefixes and placeholders
  if (person.email) {
    const lower = person.email.toLowerCase();
    if (JUNK_EMAIL_PREFIXES.some((p) => lower.startsWith(p))) return true;
    if (lower.includes("@discovery.internal")) return true;
  }

  // Check junk names
  const firstName = (person.firstName ?? "").trim();
  const lastName = (person.lastName ?? "").trim();
  const fullName = `${firstName} ${lastName}`.trim();

  if (!fullName) {
    // Both firstName AND lastName are missing/empty
    return true;
  }

  if (JUNK_NAME_PATTERNS.some((p) => p.test(firstName) || p.test(lastName) || p.test(fullName))) {
    return true;
  }

  // No identity at all — both email AND linkedinUrl are missing
  if (!person.email && !person.linkedinUrl) return true;

  return false;
}

/**
 * Check if an email is a real, non-placeholder address.
 * At staging time, "verified" = has a real email (not placeholder, not junk prefix).
 */
function hasRealEmail(person: DiscoveredPersonResult): boolean {
  if (!person.email) return false;
  const lower = person.email.toLowerCase();
  if (lower.includes("@discovery.internal")) return false;
  if (JUNK_EMAIL_PREFIXES.some((p) => lower.startsWith(p))) return false;
  return true;
}

/**
 * Compute preliminary ICP fit from lightweight string matching.
 * No API calls — purely heuristic based on title/location matching.
 */
function computeIcpFit(
  person: DiscoveredPersonResult,
  icp?: { titles?: string[]; locations?: string[]; industries?: string[] },
): "high" | "medium" | "low" | "none" {
  if (!icp) return "none";

  let score = 0;
  const maxScore = 3;

  // Title match
  if (icp.titles?.length && person.jobTitle) {
    const titleLower = person.jobTitle.toLowerCase();
    if (icp.titles.some((t) => titleLower.includes(t.toLowerCase()))) {
      score += 1;
    }
  }

  // Location match
  if (icp.locations?.length && person.location) {
    const locLower = person.location.toLowerCase();
    if (icp.locations.some((l) => locLower.includes(l.toLowerCase()))) {
      score += 1;
    }
  }

  // Industry signal from companyDomain (basic heuristic)
  if (icp.industries?.length && person.company) {
    const companyLower = person.company.toLowerCase();
    if (icp.industries.some((i) => companyLower.includes(i.toLowerCase()))) {
      score += 1;
    }
  }

  if (score >= 2) return "high";
  if (score === 1) return "medium";
  if (score === 0 && (icp.titles?.length || icp.locations?.length || icp.industries?.length)) {
    return "low";
  }
  return "none";
}

/**
 * Assess the quality of a batch of discovery results.
 *
 * Computes 4 metrics:
 * 1. Verified email % — percentage with real email addresses
 * 2. LinkedIn URL % — percentage with LinkedIn profile URL
 * 3. ICP fit distribution — high/medium/low/none breakdown (preliminary)
 * 4. Junk count — results with garbage data
 *
 * CRITICAL: DiscoveredPersonResult is the STAGING table shape — it does NOT have
 * enrichmentData. "Verified email" at staging time = has a real email address
 * (not placeholder, not junk prefix).
 */
export function assessSearchQuality(
  people: DiscoveredPersonResult[],
  options?: {
    costUsd?: number;
    workspaceIcp?: { titles?: string[]; locations?: string[]; industries?: string[] };
  },
): QualityReport {
  const total = people.length;

  if (total === 0) {
    return {
      metrics: {
        totalResults: 0,
        verifiedEmailCount: 0,
        verifiedEmailPct: 0,
        linkedinUrlCount: 0,
        linkedinUrlPct: 0,
        icpFitDistribution: { high: 0, medium: 0, low: 0, none: 0 },
        junkCount: 0,
        junkExamples: [],
        belowThreshold: true,
      },
      grade: "poor",
      suggestions: ["No results returned. Try broadening your search filters."],
      costPerVerifiedLead: null,
    };
  }

  // Count metrics
  let verifiedEmailCount = 0;
  let linkedinUrlCount = 0;
  let junkCount = 0;
  const junkExamples: string[] = [];
  const icpFitDistribution = { high: 0, medium: 0, low: 0, none: 0 };

  for (const person of people) {
    if (hasRealEmail(person)) verifiedEmailCount++;
    if (person.linkedinUrl) linkedinUrlCount++;

    if (detectJunk(person)) {
      junkCount++;
      if (junkExamples.length < 5) {
        const name = [person.firstName, person.lastName].filter(Boolean).join(" ") || "(no name)";
        const email = person.email || "(no email)";
        junkExamples.push(`${name} <${email}>`);
      }
    }

    const fit = computeIcpFit(person, options?.workspaceIcp);
    icpFitDistribution[fit]++;
  }

  const verifiedEmailPct = Math.round((verifiedEmailCount / total) * 100);
  const linkedinUrlPct = Math.round((linkedinUrlCount / total) * 100);
  const junkPct = Math.round((junkCount / total) * 100);

  const belowThreshold = verifiedEmailPct < 50;

  // Compute grade
  let grade: QualityReport["grade"];
  if (verifiedEmailPct > 70 && junkPct < 5) {
    grade = "good";
  } else if (verifiedEmailPct >= 50) {
    grade = "acceptable";
  } else if (verifiedEmailPct >= 30) {
    grade = "low";
  } else {
    grade = "poor";
  }

  // Generate suggestions
  const suggestions: string[] = [];

  if (belowThreshold) {
    const unverifiedPct = 100 - verifiedEmailPct;
    suggestions.push(
      `Verified email rate ${verifiedEmailPct}%. Suggest: run enrichment waterfall on remaining ${unverifiedPct}%, or try different filters.`,
    );
  }

  if (junkPct >= 10) {
    suggestions.push(
      `Junk rate ${junkPct}% (${junkCount} results). Review source filters — generic emails (info@, admin@) and missing names indicate broad search.`,
    );
  }

  if (linkedinUrlPct < 30) {
    suggestions.push(
      `LinkedIn URL coverage ${linkedinUrlPct}%. LinkedIn enrichment may be needed for multi-channel campaigns.`,
    );
  }

  if (grade === "low" || grade === "poor") {
    suggestions.push(
      "Consider: tighter job title filters, more specific location/industry, or switching to a different source.",
    );
  }

  // Unverified routing note
  const noEmailCount = total - verifiedEmailCount;
  if (noEmailCount > 0) {
    suggestions.push(
      `After promotion, ${noEmailCount} leads without verified emails will be routed through the enrichment waterfall (FindyMail, Prospeo, LeadMagic verification).`,
    );
  }

  // Cost per verified lead
  const costPerVerifiedLead =
    options?.costUsd != null && verifiedEmailCount > 0
      ? Math.round((options.costUsd / verifiedEmailCount) * 1000) / 1000
      : null;

  return {
    metrics: {
      totalResults: total,
      verifiedEmailCount,
      verifiedEmailPct,
      linkedinUrlCount,
      linkedinUrlPct,
      icpFitDistribution,
      junkCount,
      junkExamples,
      belowThreshold,
    },
    grade,
    suggestions,
    costPerVerifiedLead,
  };
}
