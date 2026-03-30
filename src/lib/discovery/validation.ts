/**
 * Discovery filter validation module.
 *
 * Pure-function safety net that validates search filters before paid API calls
 * execute. Mirrors the copy-quality.ts pattern: no side effects, no async,
 * no database calls. CLI search wrappers import and call validateDiscoveryFilters()
 * before delegating to the adapter.
 *
 * Five check types:
 *   1. Company name vs domain (hard-block)
 *   2. Missing required ICP fields (hard-block)
 *   3. Filter-platform mismatch (hard-block or warning)
 *   4. Budget exceeded (warning)
 *   5. ICP mismatch (warning)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DiscoverySource =
  | "apollo"
  | "prospeo"
  | "aiark"
  | "leads-finder"
  | "google-maps"
  | "ecommerce-stores";

export type CheckType =
  | "company-name-vs-domain"
  | "missing-icp-fields"
  | "filter-platform-mismatch"
  | "budget-exceeded"
  | "icp-mismatch";

export interface ValidationIssue {
  type: "hard-block" | "warning";
  check: CheckType;
  message: string;
  suggestion: string;
}

export interface ValidationResult {
  /** false if any hard-blocks */
  valid: boolean;
  issues: ValidationIssue[];
}

export interface ValidationContext {
  workspaceIcp?: Record<string, unknown>;
  estimatedCostUsd?: number;
  remainingBudgetUsd?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asStringArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value === "string") return [value];
  return [];
}

function isNonEmpty(value: unknown): boolean {
  if (!value) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

// ---------------------------------------------------------------------------
// Check 1: Company Name vs Domain
// ---------------------------------------------------------------------------

function checkCompanyNameVsDomain(
  filters: Record<string, unknown>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const domains = asStringArray(filters.companyDomains);

  for (const entry of domains) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    if (trimmed.includes(" ")) {
      issues.push({
        type: "hard-block",
        check: "company-name-vs-domain",
        message: `'${trimmed}' contains spaces -- use domains like 'acme.com', not company names`,
        suggestion: "Use company domains like 'acme.com', not company names like 'Acme Corp'",
      });
    } else if (!trimmed.includes(".")) {
      issues.push({
        type: "hard-block",
        check: "company-name-vs-domain",
        message: `'${trimmed}' looks like a company name, not a domain`,
        suggestion: "Use company domains like 'acme.com', not company names like 'Acme Corp'",
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Check 2: Missing Required ICP Fields
// ---------------------------------------------------------------------------

/** Sources that use different filter sets (company discovery, not people search) */
const COMPANY_DISCOVERY_SOURCES: DiscoverySource[] = [
  "google-maps",
  "ecommerce-stores",
];

function checkMissingIcpFields(
  source: DiscoverySource,
  filters: Record<string, unknown>,
): ValidationIssue[] {
  // Company discovery tools use categories/keywords/locations -- skip this check
  if (COMPANY_DISCOVERY_SOURCES.includes(source)) return [];

  const hasJobTitles = isNonEmpty(filters.jobTitles);
  const hasSeniority = isNonEmpty(filters.seniority);
  const hasIndustries = isNonEmpty(filters.industries);
  const hasCompanyDomains = isNonEmpty(filters.companyDomains);

  if (!hasJobTitles && !hasSeniority && !hasIndustries && !hasCompanyDomains) {
    return [
      {
        type: "hard-block",
        check: "missing-icp-fields",
        message:
          "Too broad -- at least one of: job titles, seniority, industries, or company domains required",
        suggestion: "Add at least one targeting filter to narrow the search",
      },
    ];
  }

  return [];
}

// ---------------------------------------------------------------------------
// Check 3: Filter-Platform Mismatch
// ---------------------------------------------------------------------------

function checkFilterPlatformMismatch(
  source: DiscoverySource,
  filters: Record<string, unknown>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (source === "aiark") {
    if (isNonEmpty(filters.departments)) {
      issues.push({
        type: "hard-block",
        check: "filter-platform-mismatch",
        message:
          "AI Ark contact.department filter is broken (silently ignores filter, returns all records)",
        suggestion: "Remove departments filter from AI Ark search. Use Prospeo for department filtering.",
      });
    }

    if (isNonEmpty(filters.keywords)) {
      issues.push({
        type: "hard-block",
        check: "filter-platform-mismatch",
        message: "AI Ark contact.keyword returns 400 error",
        suggestion:
          "Remove keywords filter from AI Ark search. Use jobTitles for people-level filtering, or companyKeywords (which uses the two-step workaround).",
      });
    }
  }

  if (source === "apollo") {
    if (isNonEmpty(filters.sicCodes)) {
      issues.push({
        type: "warning",
        check: "filter-platform-mismatch",
        message: "Apollo does not support SIC codes -- use Prospeo instead",
        suggestion: "Move sicCodes filter to a Prospeo search.",
      });
    }

    if (isNonEmpty(filters.yearsExperience)) {
      issues.push({
        type: "warning",
        check: "filter-platform-mismatch",
        message:
          "Apollo does not support years of experience -- use Prospeo instead",
        suggestion: "Move yearsExperience filter to a Prospeo search.",
      });
    }

    if (isNonEmpty(filters.fundingStages)) {
      issues.push({
        type: "warning",
        check: "filter-platform-mismatch",
        message: "Apollo free tier has limited funding filter support",
        suggestion: "Use Prospeo or AI Ark for more reliable funding stage filtering.",
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Check 4: Budget Exceeded
// ---------------------------------------------------------------------------

function checkBudgetExceeded(context?: ValidationContext): ValidationIssue[] {
  if (
    !context ||
    context.estimatedCostUsd == null ||
    context.remainingBudgetUsd == null
  ) {
    return [];
  }

  if (context.estimatedCostUsd > context.remainingBudgetUsd) {
    return [
      {
        type: "warning",
        check: "budget-exceeded",
        message: `Estimated cost $${context.estimatedCostUsd.toFixed(2)} would exceed remaining daily budget of $${context.remainingBudgetUsd.toFixed(2)}`,
        suggestion: "Reduce page count or remove a paid source",
      },
    ];
  }

  return [];
}

// ---------------------------------------------------------------------------
// Check 5: ICP Mismatch
// ---------------------------------------------------------------------------

function checkIcpMismatch(
  filters: Record<string, unknown>,
  context?: ValidationContext,
): ValidationIssue[] {
  if (!context?.workspaceIcp) return [];

  const issues: ValidationIssue[] = [];
  const icp = context.workspaceIcp;

  // Compare industries
  const searchIndustries = asStringArray(filters.industries).map((s) =>
    s.toLowerCase(),
  );
  const icpIndustries = asStringArray(icp.industries).map((s) =>
    s.toLowerCase(),
  );

  if (
    searchIndustries.length > 0 &&
    icpIndustries.length > 0 &&
    !searchIndustries.some((si) =>
      icpIndustries.some((ii) => si.includes(ii) || ii.includes(si)),
    )
  ) {
    issues.push({
      type: "warning",
      check: "icp-mismatch",
      message: `Search industries [${searchIndustries.join(", ")}] do not overlap with workspace ICP industries [${icpIndustries.join(", ")}]`,
      suggestion:
        "Verify this is intentional. The search targets different industries than the workspace ICP.",
    });
  }

  // Compare locations
  const searchLocations = asStringArray(filters.locations).map((s) =>
    s.toLowerCase(),
  );
  const icpLocations = asStringArray(
    icp.locations ?? icp.geographies ?? icp.countries,
  ).map((s) => s.toLowerCase());

  if (
    searchLocations.length > 0 &&
    icpLocations.length > 0 &&
    !searchLocations.some((sl) =>
      icpLocations.some((il) => sl.includes(il) || il.includes(sl)),
    )
  ) {
    issues.push({
      type: "warning",
      check: "icp-mismatch",
      message: `Search locations [${searchLocations.join(", ")}] do not match workspace ICP geographies [${icpLocations.join(", ")}]`,
      suggestion:
        "Verify this is intentional. The search targets different locations than the workspace ICP.",
    });
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Main validation function
// ---------------------------------------------------------------------------

/**
 * Validate discovery filters before executing a paid search.
 * Hard-blocks prevent execution. Warnings are logged but don't block.
 *
 * @param source - The discovery platform identifier
 * @param filters - The search filter parameters
 * @param context - Optional context for budget and ICP checks
 * @returns ValidationResult with `valid` (false if any hard-blocks) and `issues` array
 */
export function validateDiscoveryFilters(
  source: DiscoverySource,
  filters: Record<string, unknown>,
  context?: ValidationContext,
): ValidationResult {
  const issues: ValidationIssue[] = [
    ...checkCompanyNameVsDomain(filters),
    ...checkMissingIcpFields(source, filters),
    ...checkFilterPlatformMismatch(source, filters),
    ...checkBudgetExceeded(context),
    ...checkIcpMismatch(filters, context),
  ];

  const hasHardBlock = issues.some((i) => i.type === "hard-block");

  return {
    valid: !hasHardBlock,
    issues,
  };
}
