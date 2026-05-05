/**
 * ICP scorer — qualifies a person against workspace ICP criteria.
 * Uses Firecrawl homepage scrape + enrichment data + Claude Haiku to produce
 * a 0-100 score with reasoning and confidence level.
 *
 * Score is stored on PersonWorkspace (not Person) because ICP fit is
 * workspace-specific — Pitfall 5 from research.
 */
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCrawlMarkdown } from "./crawl-cache";
import {
  resolveIcpContextForWorkspaceSlug,
  type IcpContext,
} from "./resolver";

export interface IcpScoreResult {
  score: number;       // 0-100
  reasoning: string;   // 1-3 sentences
  confidence: "high" | "medium" | "low";
}

export const ICP_SCORING_METHOD = "firecrawl+llm";
export const ICP_NEEDS_WEBSITE_STATUS = "needs_website";
const ICP_NEEDS_WEBSITE_REASON =
  "NEEDS_WEBSITE: company website content unavailable";

export interface NeedsWebsiteIcpResult {
  status: typeof ICP_NEEDS_WEBSITE_STATUS;
  reasoning: string;
  confidence: "low";
  scoringMethod: null;
}

export interface ScoredStagedIcpResult extends IcpScoreResult {
  status: "scored";
  scoringMethod: typeof ICP_SCORING_METHOD;
}

export type StagedIcpEvaluationResult =
  | ScoredStagedIcpResult
  | NeedsWebsiteIcpResult;

export const IcpScoreSchema = z.object({
  score: z.number().describe("ICP fit score from 0 to 100"),
  reasoning: z.string().describe("1-3 sentence explanation of ICP fit"),
  confidence: z.enum(["high", "medium", "low"]).describe(
    "Data completeness: high=all signals, medium=2/3, low=sparse"
  ),
});

export const BatchIcpScoreSchema = z.array(
  z.object({
    personId: z.string(),
    score: z.number().min(0).max(100),
    reasoning: z.string(),
    confidence: z.enum(["high", "medium", "low"]),
  }),
);

export interface BatchIcpScoreResult {
  scored: number;
  failed: number;
  skipped: number;
}

function hasWebsiteMarkdown(value: string | null): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function createNeedsWebsiteResult(): NeedsWebsiteIcpResult {
  return {
    status: ICP_NEEDS_WEBSITE_STATUS,
    reasoning: ICP_NEEDS_WEBSITE_REASON,
    confidence: "low",
    scoringMethod: null,
  };
}

interface PromptPersonInput {
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  headline?: string | null;
  skills?: unknown;
  jobHistory?: unknown;
  profileSummary?: string | null;
  education?: unknown;
  certifications?: unknown;
  languages?: unknown;
  company: string | null;
  vertical: string | null;
  location: string | null;
  locationCity?: string | null;
  locationState?: string | null;
  locationCountry?: string | null;
  seniority?: string | null;
  enrichmentData: string | null;
}

interface PromptCompanyInput {
  headcount: number | null;
  industry: string | null;
  description: string | null;
  yearFounded: number | null;
  revenue?: string | null;
  technologies?: unknown;
  fundingTotal?: bigint | number | null;
  socialUrls?: unknown;
  jobPostingsActiveCount?: number | null;
  jobPostingTitles?: unknown;
  industries?: unknown;
  naicsCodes?: unknown;
}

function parseLegacySeniority(enrichmentData: string | null): string | null {
  if (!enrichmentData) return null;

  try {
    const data = JSON.parse(enrichmentData) as { seniority?: unknown; seniorityLevel?: unknown };
    if (typeof data.seniority === "string" && data.seniority.trim()) {
      return data.seniority;
    }
    if (typeof data.seniorityLevel === "string" && data.seniorityLevel.trim()) {
      return data.seniorityLevel;
    }
  } catch {
    // Ignore legacy JSON parse errors.
  }

  return null;
}

function formatPersonLocation(person: PromptPersonInput): string {
  const granular = [
    person.locationCity,
    person.locationState,
    person.locationCountry,
  ].filter((part): part is string => typeof part === "string" && part.trim().length > 0);

  if (granular.length > 0) return granular.join(", ");
  return person.location ?? "Unknown";
}

function getTechnologyName(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record.name === "string" && record.name.trim()) return record.name.trim();
    if (typeof record.technology === "string" && record.technology.trim()) {
      return record.technology.trim();
    }
  }
  return null;
}

function formatTechnologies(value: unknown, limit = 8): string {
  if (value == null) return "Unknown";

  const names: string[] = [];
  const pushName = (candidate: unknown) => {
    const name = getTechnologyName(candidate);
    if (name && !names.includes(name)) names.push(name);
  };

  if (Array.isArray(value)) {
    for (const item of value) pushName(item);
  } else if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const candidates = [
      record.technology_names,
      record.technology_list,
      record.technologies,
      record.names,
    ];

    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        for (const item of candidate) pushName(item);
      }
    }
  }

  return names.length > 0 ? names.slice(0, limit).join(", ") : "Unknown";
}

function formatFundingUsd(value: bigint | number | null | undefined): string {
  if (value == null) return "Unknown";
  const amount = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isFinite(amount)) return "Unknown";
  return `$${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function asTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function uniqueStrings(values: unknown[], limit: number): string[] {
  const strings: string[] = [];
  for (const value of values) {
    const str = asTrimmedString(value);
    if (str && !strings.includes(str)) strings.push(str);
    if (strings.length >= limit) break;
  }
  return strings;
}

function formatSkills(value: unknown, limit = 8): string {
  if (!Array.isArray(value)) return "Unknown";
  const skills = uniqueStrings(value, limit);
  return skills.length > 0 ? skills.join(", ") : "Unknown";
}

function getRecordString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    const str = asTrimmedString(value);
    if (str) return str;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = value as Record<string, unknown>;
      const nestedStr = asTrimmedString(nested.name) ?? asTrimmedString(nested.title);
      if (nestedStr) return nestedStr;
    }
  }
  return null;
}

function extractYear(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value !== "string") return null;
  const match = value.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function formatYear(value: unknown, currentFallback = false): string {
  if (value == null && currentFallback) return "Present";
  const year = extractYear(value);
  return year ? String(year) : currentFallback ? "Present" : "Unknown";
}

function formatJobHistory(value: unknown, limit = 3): string {
  if (!Array.isArray(value)) return "Career: Unknown";

  const entries = value
    .filter((item): item is Record<string, unknown> => item != null && typeof item === "object" && !Array.isArray(item))
    .map((item, index) => ({
      item,
      index,
      sortYear:
        extractYear(item.end) ??
        extractYear(item.end_date) ??
        extractYear(item.to) ??
        (item.current === true || item.is_current === true ? 9999 : null) ??
        extractYear(item.start) ??
        extractYear(item.start_date) ??
        extractYear(item.from) ??
        0,
    }))
    .sort((a, b) => b.sortYear - a.sortYear || a.index - b.index)
    .slice(0, limit)
    .map(({ item }) => {
      const company =
        getRecordString(item, ["company", "companyName", "company_name", "organization"]) ?? "Unknown company";
      const title = getRecordString(item, ["title", "jobTitle", "job_title", "position"]) ?? "Unknown title";
      const start = formatYear(item.start ?? item.start_date ?? item.from);
      const end = formatYear(item.end ?? item.end_date ?? item.to, item.current === true || item.is_current === true);
      return `${start}-${end} ${company} (${title})`;
    });

  return entries.length > 0 ? `Career: ${entries.join("; ")}` : "Career: Unknown";
}

function formatProfileSummary(value: string | null | undefined, limit = 500): string {
  const summary = asTrimmedString(value);
  if (!summary) return "Unknown";
  return summary.length > limit ? `${summary.slice(0, limit).trimEnd()}...` : summary;
}

function formatEducation(value: unknown, limit = 2): string {
  if (!Array.isArray(value)) return "Unknown";

  const entries = value
    .filter((item): item is Record<string, unknown> => item != null && typeof item === "object" && !Array.isArray(item))
    .slice(0, limit)
    .map((item) => {
      const institution =
        getRecordString(item, ["institution", "school", "school_name", "university", "name"]) ?? null;
      const degree = getRecordString(item, ["degree", "degree_name", "degreeName", "qualification"]) ?? null;
      const field = getRecordString(item, ["field", "field_of_study", "fieldOfStudy", "major"]) ?? null;
      return [institution, degree, field].filter(Boolean).join(" - ");
    })
    .filter((entry) => entry.length > 0);

  return entries.length > 0 ? entries.join("; ") : "Unknown";
}

function formatCertifications(value: unknown, limit = 3): string {
  if (!Array.isArray(value)) return "Unknown";

  const names = value
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && !Array.isArray(item)) {
        return getRecordString(item as Record<string, unknown>, ["name", "title", "certification"]);
      }
      return null;
    })
    .filter((name): name is string => typeof name === "string");

  const unique = uniqueStrings(names, limit);
  return unique.length > 0 ? unique.join(", ") : "Unknown";
}

function flattenLanguageNames(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["profile_languages", "languages", "spoken_languages"]) {
      const candidate = record[key];
      if (Array.isArray(candidate)) return candidate;
    }
  }
  return [];
}

function formatLanguages(value: unknown, limit = 8): string {
  const names = flattenLanguageNames(value)
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && !Array.isArray(item)) {
        return getRecordString(item as Record<string, unknown>, ["name", "language"]);
      }
      return null;
    })
    .filter((name): name is string => typeof name === "string");

  const unique = uniqueStrings(names, limit);
  return unique.length > 0 ? unique.join(", ") : "Unknown";
}

function formatSocialPresence(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Social: Unknown";

  const labels: Record<string, string> = {
    linkedin: "LinkedIn",
    twitter: "Twitter",
    x: "X",
    facebook: "Facebook",
    instagram: "Instagram",
    youtube: "YouTube",
    crunchbase: "Crunchbase",
    github: "GitHub",
  };

  const present = Object.entries(value as Record<string, unknown>)
    .filter(([, url]) => asTrimmedString(url) != null)
    .map(([platform]) => labels[platform] ?? platform.charAt(0).toUpperCase() + platform.slice(1))
    .sort();

  return present.length > 0 ? `Social: ${present.map((label) => `${label} ✓`).join(", ")}` : "Social: Unknown";
}

function getTitleName(value: unknown): string | null {
  if (typeof value === "string") return asTrimmedString(value);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return getRecordString(value as Record<string, unknown>, ["title", "name", "jobTitle", "job_title"]);
  }
  return null;
}

function formatHiring(count: number | null | undefined, titles: unknown, limit = 5): string {
  if (count == null || count <= 0) return "Hiring: None visible";

  const titleList = Array.isArray(titles)
    ? uniqueStrings(titles.map(getTitleName).filter((title): title is string => title != null), limit)
    : [];

  return titleList.length > 0
    ? `Currently hiring: ${count} open roles (${titleList.join(", ")})`
    : `Currently hiring: ${count} open roles`;
}

function formatIndustries(value: unknown, fallback: string | null | undefined, limit = 8): string {
  if (Array.isArray(value)) {
    const industries = uniqueStrings(value, limit);
    if (industries.length > 0) return industries.join(", ");
  }
  return fallback ?? "Unknown";
}

function formatNaicsCodes(value: unknown, limit = 3): string {
  if (!Array.isArray(value)) return "Unknown";
  const codes = value
    .map((item) => {
      if (typeof item === "string" || typeof item === "number") return String(item);
      if (item && typeof item === "object" && !Array.isArray(item)) {
        return getRecordString(item as Record<string, unknown>, ["code", "naics", "id"]);
      }
      return null;
    })
    .filter((code): code is string => typeof code === "string");

  const unique = uniqueStrings(codes, limit);
  return unique.length > 0 ? unique.join(", ") : "Unknown";
}

/**
 * Build a scoring prompt from person + company + website data.
 */
export function buildScoringPrompt(params: {
  person: PromptPersonInput;
  company: PromptCompanyInput | null;
  websiteMarkdown: string | null;
}): string {
  const { person, company, websiteMarkdown } = params;

  const seniority = person.seniority ?? parseLegacySeniority(person.enrichmentData) ?? "Unknown";

  const personSection = `## Person Data
- Name: ${person.firstName ?? ""} ${person.lastName ?? ""}`.trim() + `
- Job Title: ${person.jobTitle ?? "Unknown"}
- Headline: ${person.headline ?? "Unknown"}
- Profile Summary: ${formatProfileSummary(person.profileSummary)}
- Company: ${person.company ?? "Unknown"}
- Industry: ${person.vertical ?? "Unknown"}
- Location: ${formatPersonLocation(person)}
- Seniority: ${seniority}
- Skills: ${formatSkills(person.skills)}
- ${formatJobHistory(person.jobHistory)}
- Education: ${formatEducation(person.education)}
- Certifications: ${formatCertifications(person.certifications)}
- Languages: ${formatLanguages(person.languages)}`;

  const companySection = company
    ? `## Company Data
- Headcount: ${company.headcount ?? "Unknown"}
- Industry: ${formatIndustries(company.industries, company.industry)}
- Description: ${company.description ?? "Unknown"}
- Year Founded: ${company.yearFounded ?? "Unknown"}
- Revenue: ${company.revenue ?? "Unknown"}
- Technologies: ${formatTechnologies(company.technologies)}
- Funding: ${formatFundingUsd(company.fundingTotal)}
- ${formatSocialPresence(company.socialUrls)}
- ${formatHiring(company.jobPostingsActiveCount, company.jobPostingTitles)}
- NAICS: ${formatNaicsCodes(company.naicsCodes)}`
    : `## Company Data
- No company record found`;

  const websiteSection = `## Company Website (homepage excerpt)
${websiteMarkdown?.slice(0, 3000) ?? "Website homepage unavailable. Do not score without website evidence."}`;

  return `Score this prospect's ICP fit from 0-100 based on the workspace ICP criteria provided in the system prompt.

${personSection}

${companySection}

${websiteSection}

Return a score from 0-100 and 1-3 sentence reasoning. Set confidence based on data completeness:
- "high": Person data + company data + website all available
- "medium": 2 out of 3 signal types available
- "low": Only 1 signal type or very sparse data`;
}

// ---------------------------------------------------------------------------
// Staged person scoring (pre-promotion — BL-038)
// ---------------------------------------------------------------------------

/**
 * Input shape matching DiscoveredPerson fields for pre-promotion scoring.
 * Does NOT require a Person or PersonWorkspace to exist.
 */
export interface StagedPersonInput {
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  company: string | null;
  companyDomain: string | null;
  location: string | null;
}

/**
 * Score a staged DiscoveredPerson's ICP fit BEFORE promotion.
 *
 * Unlike scorePersonIcp(), this does NOT require the person to exist in the
 * Person table — it works with raw DiscoveredPerson fields. The caller is
 * responsible for persisting the score on DiscoveredPerson.
 *
 * @param input - DiscoveredPerson-shaped fields
 * @param workspaceSlug - Workspace slug to fetch icpCriteriaPrompt
 * @returns ICP score result (score, reasoning, confidence) — NOT persisted
 * @throws If workspace has no icpCriteriaPrompt configured
 */
export async function scoreStagedPersonIcp(
  input: StagedPersonInput,
  workspaceSlug: string,
  options?: Pick<ScorePersonIcpOptions, "campaignId" | "icpProfileId" | "icpContext">,
): Promise<StagedIcpEvaluationResult> {
  // 1. Resolve ICP criteria/profile version.
  const icpContext = await resolveScoringIcpContext(workspaceSlug, options);
  const systemPrompt = getScoringSystemPrompt(icpContext, workspaceSlug);

  // 2. Get company homepage markdown (from cache or crawl)
  const websiteMarkdown = input.companyDomain
    ? await getCrawlMarkdown(input.companyDomain)
    : null;
  if (!hasWebsiteMarkdown(websiteMarkdown)) {
    return createNeedsWebsiteResult();
  }

  // 3. Fetch company record if exists
  const company = input.companyDomain
    ? await prisma.company.findUnique({ where: { domain: input.companyDomain } })
    : null;

  // 4. Build scoring prompt — map DiscoveredPerson fields to person parameter
  const scoringPrompt = buildScoringPrompt({
    person: {
      firstName: input.firstName,
      lastName: input.lastName,
      jobTitle: input.jobTitle,
      company: input.company,
      vertical: null, // DiscoveredPerson doesn't have vertical
      location: input.location,
      enrichmentData: null, // not enriched yet
    },
    company: company
      ? {
          headcount: company.headcount,
          industry: company.industry,
          description: company.description,
          yearFounded: company.yearFounded,
        }
      : null,
    websiteMarkdown,
  });

  // 5. Call Claude Haiku via generateObject — pinned to temperature: 0
  const { object } = await generateObject({
    model: anthropic("claude-haiku-4-5-20251001"),
    temperature: 0,
    schema: IcpScoreSchema,
    system: systemPrompt,
    prompt: scoringPrompt,
  });

  return {
    status: "scored",
    score: object.score,
    reasoning: object.reasoning,
    confidence: object.confidence,
    scoringMethod: ICP_SCORING_METHOD,
  };
}

export interface ScorePersonIcpOptions {
  /** Bypass the crawl cache and re-scrape the company homepage */
  forceRecrawl?: boolean;
  /**
   * When false, scores returned with confidence="low" are NOT persisted
   * to PersonWorkspace. The caller still receives the result but the DB
   * remains untouched so the lead can be re-scored later once upstream
   * data quality improves. Defaults to true (existing behaviour).
   */
  persistLowConfidence?: boolean;
  /** Optional campaign profile source for score-context resolution. */
  campaignId?: string;
  /** Optional explicit profile override for score-context resolution. */
  icpProfileId?: string;
  /** Pre-resolved context for callers that need one consistent version. */
  icpContext?: IcpContext;
}

async function resolveScoringIcpContext(
  workspaceSlug: string,
  options?: Pick<ScorePersonIcpOptions, "campaignId" | "icpProfileId" | "icpContext">,
): Promise<IcpContext> {
  if (options?.icpContext) return options.icpContext;
  return resolveIcpContextForWorkspaceSlug({
    workspaceSlug,
    campaignId: options?.campaignId,
    icpProfileId: options?.icpProfileId,
  });
}

function getScoringSystemPrompt(context: IcpContext, workspaceSlug: string): string {
  const prompt = context.snapshot?.description?.trim();
  if (!prompt) {
    throw new Error(
      `No ICP criteria prompt configured for workspace '${workspaceSlug}'.`,
    );
  }
  return prompt;
}

/**
 * Score a person's ICP fit for a given workspace.
 *
 * @param personId - Person record ID
 * @param workspaceSlug - Workspace slug (e.g. "rise")
 * @param forceRecrawl - Force re-scraping (legacy positional arg; prefer options)
 * @param options - Scoring options including confidence persistence gate
 * @returns ICP score result with 0-100 score, reasoning, and confidence
 * @throws If workspace has no icpCriteriaPrompt configured
 */
export async function scorePersonIcp(
  personId: string,
  workspaceSlug: string,
  forceRecrawl?: boolean,
  options?: ScorePersonIcpOptions,
): Promise<IcpScoreResult & { persisted: boolean }> {
  const persistLowConfidence = options?.persistLowConfidence ?? true;
  const effectiveForceRecrawl = options?.forceRecrawl ?? forceRecrawl ?? false;
  // 1. Fetch the person with their workspace membership
  const person = await prisma.person.findUniqueOrThrow({
    where: { id: personId },
    include: {
      workspaces: {
        where: { workspace: workspaceSlug },
      },
    },
  });

  // 2. Resolve the ICP context (profile version when available, legacy otherwise).
  const icpContext = await resolveScoringIcpContext(workspaceSlug, options);
  const systemPrompt = getScoringSystemPrompt(icpContext, workspaceSlug);

  // 4. Get company homepage markdown (from cache or Firecrawl)
  const websiteMarkdown = person.companyDomain
    ? await getCrawlMarkdown(person.companyDomain, effectiveForceRecrawl)
    : null;
  if (!hasWebsiteMarkdown(websiteMarkdown)) {
    throw new Error(
      `NEEDS_WEBSITE: company website content unavailable for person ${personId}`,
    );
  }

  // 5. Fetch company record for enrichment data (headcount, industry, etc.)
  const company = person.companyDomain
    ? await prisma.company.findUnique({ where: { domain: person.companyDomain } })
    : null;

  // 6. Build scoring prompt
  const scoringPrompt = buildScoringPrompt({
    person: {
      firstName: person.firstName,
      lastName: person.lastName,
      jobTitle: person.jobTitle,
      headline: person.headline,
      skills: person.skills,
      jobHistory: person.jobHistory,
      profileSummary: person.profileSummary,
      education: person.education,
      certifications: person.certifications,
      languages: person.languages,
      company: person.company,
      vertical: person.vertical,
      location: person.location,
      locationCity: person.locationCity,
      locationState: person.locationState,
      locationCountry: person.locationCountry,
      seniority: person.seniority,
      enrichmentData: person.enrichmentData,
    },
    company: company
      ? {
          headcount: company.headcount,
          industry: company.industry,
          description: company.description,
          yearFounded: company.yearFounded,
          revenue: company.revenue,
          technologies: company.technologies,
          fundingTotal: company.fundingTotal,
          socialUrls: company.socialUrls,
          jobPostingsActiveCount: company.jobPostingsActiveCount,
          jobPostingTitles: company.jobPostingTitles,
          industries: company.industries,
          naicsCodes: company.naicsCodes,
        }
      : null,
    websiteMarkdown,
  });

  // 7. Call Claude Haiku via generateObject — pinned to temperature: 0
  //    for deterministic scoring on identical input.
  let result: IcpScoreResult;
  try {
    const { object } = await generateObject({
      model: anthropic("claude-haiku-4-5-20251001"),
      temperature: 0,
      schema: IcpScoreSchema,
      system: systemPrompt,
      prompt: scoringPrompt,
    });
    result = {
      score: object.score,
      reasoning: object.reasoning,
      confidence: object.confidence,
    };
  } catch (error) {
    throw new Error(
      `ICP scoring failed for person ${personId} in workspace '${workspaceSlug}': ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // 8. Persist score on PersonWorkspace — but skip persistence for
  //    low-confidence results when the caller opts out. This preserves
  //    the null icpScore so the lead gets retried once upstream data
  //    (crawl content, title, company info) improves.
  const shouldPersist = persistLowConfidence || result.confidence !== "low";

  if (shouldPersist) {
    await prisma.personWorkspace.update({
      where: {
        personId_workspace: {
          personId,
          workspace: workspaceSlug,
        },
      },
      data: {
        icpScore: result.score,
        icpReasoning: result.reasoning,
        icpConfidence: result.confidence,
        icpScoredAt: new Date(),
        icpProfileVersionId: icpContext.versionId,
      },
    });
  }

  // 9. Return the result with persistence flag
  return { ...result, persisted: shouldPersist };
}

/**
 * Build a batch scoring prompt for multiple people.
 * Uses truncated website markdown (2,000 chars vs 3,000 in single mode)
 * to keep total prompt size manageable.
 */
function buildBatchPersonEntry(params: {
  personId: string;
  person: PromptPersonInput;
  company: PromptCompanyInput | null;
  websiteMarkdown: string | null;
}): string {
  const { personId, person, company, websiteMarkdown } = params;

  const seniority = person.seniority ?? parseLegacySeniority(person.enrichmentData) ?? "Unknown";

  const lines = [
    `Person (ID: ${personId}):`,
    `Name: ${(person.firstName ?? "")} ${(person.lastName ?? "")}`.trim(),
    `Title: ${person.jobTitle ?? "Unknown"}`,
    `Headline: ${person.headline ?? "Unknown"}`,
    `Profile Summary: ${formatProfileSummary(person.profileSummary)}`,
    `Company: ${person.company ?? "Unknown"}`,
    `Industry: ${person.vertical ?? "Unknown"}`,
    `Location: ${formatPersonLocation(person)}`,
    `Seniority: ${seniority}`,
    `Skills: ${formatSkills(person.skills)}`,
    formatJobHistory(person.jobHistory),
    `Education: ${formatEducation(person.education)}`,
    `Certifications: ${formatCertifications(person.certifications)}`,
    `Languages: ${formatLanguages(person.languages)}`,
  ];

  if (company) {
    lines.push(`Company Headcount: ${company.headcount ?? "Unknown"}`);
    lines.push(`Company Industry: ${formatIndustries(company.industries, company.industry)}`);
    lines.push(`Company Description: ${company.description ?? "Unknown"}`);
    lines.push(`Company Year Founded: ${company.yearFounded ?? "Unknown"}`);
    lines.push(`Company Revenue: ${company.revenue ?? "Unknown"}`);
    lines.push(`Company Technologies: ${formatTechnologies(company.technologies)}`);
    lines.push(`Company Funding: ${formatFundingUsd(company.fundingTotal)}`);
    lines.push(formatSocialPresence(company.socialUrls));
    lines.push(formatHiring(company.jobPostingsActiveCount, company.jobPostingTitles));
    lines.push(`Company NAICS: ${formatNaicsCodes(company.naicsCodes)}`);
  } else {
    lines.push("Company Data: No company record found");
  }

  lines.push(
    `Website Homepage:`,
    websiteMarkdown?.slice(0, 2000) ?? "Website homepage not available",
  );

  return lines.join("\n");
}

/**
 * Parse JSON from Claude Code CLI output.
 * Handles raw JSON, JSON envelope with `result` field, markdown code-fenced JSON,
 * and JSON arrays embedded in surrounding text.
 */
function parseCliJsonArray(output: string): unknown {
  // Claude Code --output-format json wraps in a JSON envelope with "result" field
  let rawText = output.trim();
  try {
    const envelope = JSON.parse(rawText);
    if (envelope.result) {
      rawText = envelope.result;
    }
  } catch {
    // Not a JSON envelope, use raw output
  }

  // Try raw JSON parse first
  try {
    return JSON.parse(rawText.trim());
  } catch {
    // noop
  }

  // Try extracting from markdown code fence
  const fenceMatch = rawText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // noop
    }
  }

  // Try finding JSON array in the output
  const arrayMatch = rawText.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0]);
    } catch {
      // noop
    }
  }

  throw new Error(
    `Could not parse JSON from Claude Code output: ${rawText.substring(0, 200)}`,
  );
}

/**
 * Score multiple people's ICP fit for a workspace in batches.
 *
 * Uses Claude Code CLI (`claude -p`) instead of the Anthropic API to avoid
 * API credit costs. Falls back to marking the batch as failed if a CLI call
 * or JSON parse fails.
 *
 * @param personIds - Array of Person record IDs
 * @param workspaceSlug - Workspace slug
 * @param options - batchSize (default 15), forceRecrawl
 * @returns Summary of scored, failed, and skipped counts
 */
export async function scorePersonIcpBatch(
  personIds: string[],
  workspaceSlug: string,
  options?: {
    batchSize?: number;
    forceRecrawl?: boolean;
    campaignId?: string;
    icpProfileId?: string;
    icpContext?: IcpContext;
  },
): Promise<BatchIcpScoreResult> {
  const { execSync } = await import("child_process");
  const { writeFileSync, unlinkSync } = await import("fs");
  const { randomUUID } = await import("crypto");
  const { tmpdir } = await import("os");
  const { join } = await import("path");

  const batchSize = options?.batchSize ?? 15;
  const forceRecrawl = options?.forceRecrawl ?? false;

  let scored = 0;
  let failed = 0;
  let skipped = 0;

  if (personIds.length === 0) {
    return { scored, failed, skipped };
  }

  // 1. Resolve ICP criteria/profile version — same for all people.
  const icpContext = await resolveScoringIcpContext(workspaceSlug, options);
  const systemPrompt = getScoringSystemPrompt(icpContext, workspaceSlug);

  // 2. Fetch all person records with workspace memberships
  const people = await prisma.person.findMany({
    where: { id: { in: personIds } },
    include: {
      workspaces: {
        where: { workspace: workspaceSlug },
      },
    },
  });

  // Build a lookup map; skip any person not found or without workspace membership
  const personMap = new Map(
    people
      .filter((p) => p.workspaces.length > 0)
      .map((p) => [p.id, p]),
  );

  const validIds = personIds.filter((id) => personMap.has(id));
  skipped += personIds.length - validIds.length;

  if (validIds.length === 0) {
    return { scored, failed, skipped };
  }

  // 3. Collect unique domains and fetch company records
  const uniqueDomains = [
    ...new Set(
      validIds
        .map((id) => personMap.get(id)!.companyDomain)
        .filter((d): d is string => !!d),
    ),
  ];

  // Fetch website markdown for each unique domain (inflight dedup handles concurrency)
  const websiteMap = new Map<string, string | null>();
  await Promise.all(
    uniqueDomains.map(async (domain) => {
      const md = await getCrawlMarkdown(domain, forceRecrawl);
      websiteMap.set(domain, md);
    }),
  );

  // Fetch company records for enrichment data
  const companies = await prisma.company.findMany({
    where: { domain: { in: uniqueDomains } },
  });
  const companyMap = new Map(companies.map((c) => [c.domain, c]));

  const scoreableIds = validIds.filter((id) => {
    const person = personMap.get(id)!;
    if (!person.companyDomain) return false;
    return hasWebsiteMarkdown(websiteMap.get(person.companyDomain) ?? null);
  });
  skipped += validIds.length - scoreableIds.length;

  // 4. Chunk into batches and process via Claude Code CLI
  for (let i = 0; i < scoreableIds.length; i += batchSize) {
    const batchIds = scoreableIds.slice(i, i + batchSize);

    // Build person entries for this batch
    const entries: string[] = [];
    for (const id of batchIds) {
      const person = personMap.get(id)!;
      const company = person.companyDomain
        ? companyMap.get(person.companyDomain) ?? null
        : null;
      const websiteMarkdown = person.companyDomain
        ? websiteMap.get(person.companyDomain) ?? null
        : null;

      entries.push(
        buildBatchPersonEntry({
          personId: id,
          person: {
            firstName: person.firstName,
            lastName: person.lastName,
            jobTitle: person.jobTitle,
            headline: person.headline,
            skills: person.skills,
            jobHistory: person.jobHistory,
            profileSummary: person.profileSummary,
            education: person.education,
            certifications: person.certifications,
            languages: person.languages,
            company: person.company,
            vertical: person.vertical,
            location: person.location,
            locationCity: person.locationCity,
            locationState: person.locationState,
            locationCountry: person.locationCountry,
            seniority: person.seniority,
            enrichmentData: person.enrichmentData,
          },
          company: company
            ? {
                headcount: company.headcount,
                industry: company.industry,
                description: company.description,
                yearFounded: company.yearFounded,
                revenue: company.revenue,
                technologies: company.technologies,
                fundingTotal: company.fundingTotal,
                socialUrls: company.socialUrls,
                jobPostingsActiveCount: company.jobPostingsActiveCount,
                jobPostingTitles: company.jobPostingTitles,
                industries: company.industries,
                naicsCodes: company.naicsCodes,
              }
            : null,
          websiteMarkdown,
        }),
      );
    }

    const fullPrompt = [
      "You are an ICP (Ideal Customer Profile) scoring expert. Score each person below against these criteria:\n",
      systemPrompt,
      "\n\nFor each person, return a JSON array where each element has:",
      "- personId: the ID shown for that person",
      "- score: 0-100 ICP fit score",
      '- reasoning: 1-3 sentences explaining the score',
      '- confidence: "high", "medium", or "low"',
      "\nReturn ONLY the JSON array, no other text.\n",
      entries.map((e) => `---\n${e}`).join("\n\n"),
      "\n\nSet confidence based on data completeness:",
      '- "high": Person data + company data + website all available',
      '- "medium": 2 out of 3 signal types available',
      '- "low": Only 1 signal type or very sparse data',
    ].join("\n");

    const promptPath = join(tmpdir(), `icp-batch-${randomUUID()}.txt`);

    try {
      writeFileSync(promptPath, fullPrompt, "utf-8");

      const output = execSync(
        `npx -y @anthropic-ai/claude-code -p "$(cat '${promptPath}')" --output-format json --model claude-haiku-4-5`,
        {
          encoding: "utf-8",
          maxBuffer: 10 * 1024 * 1024,
          timeout: 120_000,
        },
      ).trim();

      const parsed = parseCliJsonArray(output);

      // Validate it is an array
      if (!Array.isArray(parsed)) {
        throw new Error(
          `Expected JSON array from Claude Code, got ${typeof parsed}`,
        );
      }

      // Validate each entry and build a result map
      const resultMap = new Map<
        string,
        { personId: string; score: number; reasoning: string; confidence: "high" | "medium" | "low" }
      >();

      for (const entry of parsed) {
        const validated = BatchIcpScoreSchema.element.safeParse(entry);
        if (validated.success) {
          resultMap.set(validated.data.personId, validated.data);
        }
      }

      // Persist each score
      for (const id of batchIds) {
        const result = resultMap.get(id);
        if (!result) {
          // Person not in response — count as failed
          failed++;
          continue;
        }

        try {
          await prisma.personWorkspace.update({
            where: {
              personId_workspace: {
                personId: id,
                workspace: workspaceSlug,
              },
            },
            data: {
              icpScore: result.score,
              icpReasoning: result.reasoning,
              icpConfidence: result.confidence,
              icpScoredAt: new Date(),
              icpProfileVersionId: icpContext.versionId,
            },
          });
          scored++;
        } catch {
          failed++;
        }
      }
    } catch (error) {
      // Batch CLI call failed — mark entire batch as failed, continue to next batch
      console.error(
        `[icp-scorer] Batch scoring via CLI failed for ${batchIds.length} people: ${error instanceof Error ? error.message : String(error)}`,
      );
      failed += batchIds.length;
    } finally {
      try {
        unlinkSync(promptPath);
      } catch {
        // ignore cleanup errors
      }
    }
  }

  return { scored, failed, skipped };
}

// ---------------------------------------------------------------------------
// Staged person batch scoring (pre-promotion — BL-038 fix)
// ---------------------------------------------------------------------------

/**
 * Input for batch scoring staged DiscoveredPerson records.
 * Extends StagedPersonInput with a discoveredPersonId for result lookup.
 */
export interface StagedPersonBatchInput extends StagedPersonInput {
  discoveredPersonId: string;
}

/**
 * Score multiple staged DiscoveredPerson records' ICP fit in batches.
 *
 * Uses the AI SDK batch path with temperature pinned to 0 so discovery-time
 * promotion scoring is deterministic across identical staged inputs.
 * Mirrors the pattern of scorePersonIcpBatch() but works with raw
 * DiscoveredPerson fields (no Person/PersonWorkspace required).
 *
 * @param inputs - Array of staged person inputs with discoveredPersonId
 * @param workspaceSlug - Workspace slug to fetch icpCriteriaPrompt
 * @param options - batchSize (default 15)
 * @returns Map of discoveredPersonId → IcpScoreResult
 */
export async function scoreStagedPersonIcpBatch(
  inputs: StagedPersonBatchInput[],
  workspaceSlug: string,
  options?: {
    batchSize?: number;
    campaignId?: string;
    icpProfileId?: string;
    icpContext?: IcpContext;
  },
): Promise<Map<string, StagedIcpEvaluationResult>> {
  const batchSize = options?.batchSize ?? 15;
  const results = new Map<string, StagedIcpEvaluationResult>();

  if (inputs.length === 0) {
    return results;
  }

  // 1. Resolve ICP criteria/profile version — same for all people.
  const icpContext = await resolveScoringIcpContext(workspaceSlug, options);
  const systemPrompt = getScoringSystemPrompt(icpContext, workspaceSlug);

  // 2. Collect unique domains and prefetch crawl markdown + company records
  const uniqueDomains = [
    ...new Set(
      inputs
        .map((i) => i.companyDomain)
        .filter((d): d is string => !!d),
    ),
  ];

  const websiteMap = new Map<string, string | null>();
  await Promise.all(
    uniqueDomains.map(async (domain) => {
      const md = await getCrawlMarkdown(domain);
      websiteMap.set(domain, md);
    }),
  );

  const companies = await prisma.company.findMany({
    where: { domain: { in: uniqueDomains } },
  });
  const companyMap = new Map(companies.map((c) => [c.domain, c]));

  // 3. Chunk into batches and process deterministically via the AI SDK
  for (let i = 0; i < inputs.length; i += batchSize) {
    const batch = inputs.slice(i, i + batchSize);
    const scoreableBatch: StagedPersonBatchInput[] = [];

    const entries: string[] = [];
    for (const input of batch) {
      const company = input.companyDomain
        ? companyMap.get(input.companyDomain) ?? null
        : null;
      const websiteMarkdown = input.companyDomain
        ? websiteMap.get(input.companyDomain) ?? null
        : null;

      if (!hasWebsiteMarkdown(websiteMarkdown)) {
        results.set(input.discoveredPersonId, createNeedsWebsiteResult());
        continue;
      }

      scoreableBatch.push(input);

      entries.push(
        buildBatchPersonEntry({
          personId: input.discoveredPersonId,
          person: {
            firstName: input.firstName,
            lastName: input.lastName,
            jobTitle: input.jobTitle,
            company: input.company,
            vertical: null, // DiscoveredPerson doesn't have vertical
            location: input.location,
            enrichmentData: null, // not enriched yet
          },
          company: company
            ? {
                headcount: company.headcount,
                industry: company.industry,
                description: company.description,
                yearFounded: company.yearFounded,
              }
            : null,
          websiteMarkdown,
        }),
      );
    }

    if (scoreableBatch.length === 0) {
      continue;
    }

    const fullPrompt = [
      "You are an ICP (Ideal Customer Profile) scoring expert. Score each person below against these criteria:\n",
      systemPrompt,
      "\n\nFor each person, return a JSON array where each element has:",
      "- personId: the ID shown for that person",
      "- score: 0-100 ICP fit score",
      '- reasoning: 1-3 sentences explaining the score',
      '- confidence: "high", "medium", or "low"',
      "\nReturn ONLY the JSON array, no other text.\n",
      entries.map((e) => `---\n${e}`).join("\n\n"),
      "\n\nSet confidence based on data completeness:",
      '- "high": Person data + company data + website all available',
      '- "medium": 2 out of 3 signal types available',
      '- "low": Only 1 signal type or very sparse data',
    ].join("\n");

    try {
      const { object } = await generateObject({
        model: anthropic("claude-haiku-4-5-20251001"),
        temperature: 0,
        schema: BatchIcpScoreSchema,
        system: systemPrompt,
        prompt: fullPrompt,
      });

      for (const entry of object) {
        const validated = BatchIcpScoreSchema.element.safeParse(entry);
        if (validated.success) {
          results.set(validated.data.personId, {
            status: "scored",
            score: validated.data.score,
            reasoning: validated.data.reasoning,
            confidence: validated.data.confidence,
            scoringMethod: ICP_SCORING_METHOD,
          });
        }
      }
    } catch (error) {
      console.error(
        `[icp-scorer] Staged batch scoring failed for ${batch.length} people: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Fail-open: batch failed, results Map won't have entries for these people
    }
  }

  return results;
}
