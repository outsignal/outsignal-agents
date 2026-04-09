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

export interface IcpScoreResult {
  score: number;       // 0-100
  reasoning: string;   // 1-3 sentences
  confidence: "high" | "medium" | "low";
}

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

/**
 * Build a scoring prompt from person + company + website data.
 */
export function buildScoringPrompt(params: {
  person: {
    firstName: string | null;
    lastName: string | null;
    jobTitle: string | null;
    company: string | null;
    vertical: string | null;
    location: string | null;
    enrichmentData: string | null;
  };
  company: {
    headcount: number | null;
    industry: string | null;
    description: string | null;
    yearFounded: number | null;
  } | null;
  websiteMarkdown: string | null;
}): string {
  const { person, company, websiteMarkdown } = params;

  // Extract seniority from enrichmentData JSON if present
  let seniority: string = "Unknown";
  if (person.enrichmentData) {
    try {
      const data = JSON.parse(person.enrichmentData);
      if (data.seniority) seniority = data.seniority;
      else if (data.seniorityLevel) seniority = data.seniorityLevel;
    } catch {
      // Ignore parse errors
    }
  }

  const personSection = `## Person Data
- Name: ${person.firstName ?? ""} ${person.lastName ?? ""}`.trim() + `
- Job Title: ${person.jobTitle ?? "Unknown"}
- Company: ${person.company ?? "Unknown"}
- Industry: ${person.vertical ?? "Unknown"}
- Location: ${person.location ?? "Unknown"}
- Seniority: ${seniority}`;

  const companySection = company
    ? `## Company Data
- Headcount: ${company.headcount ?? "Unknown"}
- Industry: ${company.industry ?? "Unknown"}
- Description: ${company.description ?? "Unknown"}
- Year Founded: ${company.yearFounded ?? "Unknown"}`
    : `## Company Data
- No company record found`;

  const websiteSection = `## Company Website (homepage excerpt)
${websiteMarkdown?.slice(0, 3000) ?? "No website data available — score based on available data only."}`;

  return `Score this prospect's ICP fit from 0-100 based on the workspace ICP criteria provided in the system prompt.

${personSection}

${companySection}

${websiteSection}

Return a score from 0-100 and 1-3 sentence reasoning. Set confidence based on data completeness:
- "high": Person data + company data + website all available
- "medium": 2 out of 3 signal types available
- "low": Only 1 signal type or very sparse data`;
}

/**
 * Score a person's ICP fit for a given workspace.
 *
 * @param personId - Person record ID
 * @param workspaceSlug - Workspace slug (e.g. "rise")
 * @param forceRecrawl - Force re-scraping the company homepage (bypass crawl cache)
 * @returns ICP score result with 0-100 score, reasoning, and confidence
 * @throws If workspace has no icpCriteriaPrompt configured
 */
export async function scorePersonIcp(
  personId: string,
  workspaceSlug: string,
  forceRecrawl?: boolean,
): Promise<IcpScoreResult> {
  // 1. Fetch the person with their workspace membership
  const person = await prisma.person.findUniqueOrThrow({
    where: { id: personId },
    include: {
      workspaces: {
        where: { workspace: workspaceSlug },
      },
    },
  });

  // 2. Fetch the workspace (for icpCriteriaPrompt)
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { slug: workspaceSlug },
  });

  // 3. Validate ICP criteria prompt is configured
  if (!workspace.icpCriteriaPrompt?.trim()) {
    throw new Error(
      `No ICP criteria prompt configured for workspace '${workspaceSlug}'. Use set_workspace_prompt to configure it first.`
    );
  }

  // 4. Get company homepage markdown (from cache or Firecrawl)
  const websiteMarkdown = person.companyDomain
    ? await getCrawlMarkdown(person.companyDomain, forceRecrawl)
    : null;

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
      company: person.company,
      vertical: person.vertical,
      location: person.location,
      enrichmentData: person.enrichmentData,
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

  // 7. Call Claude Haiku via generateObject
  let result: IcpScoreResult;
  try {
    const { object } = await generateObject({
      model: anthropic("claude-haiku-4-5-20251001"),
      schema: IcpScoreSchema,
      system: workspace.icpCriteriaPrompt,
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

  // 8. Persist score on PersonWorkspace (workspace-scoped, not Person)
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
    },
  });

  // 9. Return the result
  return result;
}

/**
 * Build a batch scoring prompt for multiple people.
 * Uses truncated website markdown (2,000 chars vs 3,000 in single mode)
 * to keep total prompt size manageable.
 */
function buildBatchPersonEntry(params: {
  personId: string;
  person: {
    firstName: string | null;
    lastName: string | null;
    jobTitle: string | null;
    company: string | null;
    vertical: string | null;
    location: string | null;
    enrichmentData: string | null;
  };
  company: {
    headcount: number | null;
    industry: string | null;
    description: string | null;
    yearFounded: number | null;
  } | null;
  websiteMarkdown: string | null;
}): string {
  const { personId, person, company, websiteMarkdown } = params;

  let seniority: string = "Unknown";
  if (person.enrichmentData) {
    try {
      const data = JSON.parse(person.enrichmentData);
      if (data.seniority) seniority = data.seniority;
      else if (data.seniorityLevel) seniority = data.seniorityLevel;
    } catch {
      // Ignore parse errors
    }
  }

  const lines = [
    `Person (ID: ${personId}):`,
    `Name: ${(person.firstName ?? "")} ${(person.lastName ?? "")}`.trim(),
    `Title: ${person.jobTitle ?? "Unknown"}`,
    `Company: ${person.company ?? "Unknown"}`,
    `Industry: ${person.vertical ?? "Unknown"}`,
    `Location: ${person.location ?? "Unknown"}`,
    `Seniority: ${seniority}`,
  ];

  if (company) {
    lines.push(`Company Headcount: ${company.headcount ?? "Unknown"}`);
    lines.push(`Company Industry: ${company.industry ?? "Unknown"}`);
    lines.push(`Company Description: ${company.description ?? "Unknown"}`);
    lines.push(`Company Year Founded: ${company.yearFounded ?? "Unknown"}`);
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
 * Score multiple people's ICP fit for a workspace in batches.
 *
 * Sends multiple people per Claude call to reduce API overhead.
 * Falls back to individual scoring if a batch call fails.
 *
 * @param personIds - Array of Person record IDs
 * @param workspaceSlug - Workspace slug
 * @param options - batchSize (default 15), forceRecrawl
 * @returns Summary of scored, failed, and skipped counts
 */
export async function scorePersonIcpBatch(
  personIds: string[],
  workspaceSlug: string,
  options?: { batchSize?: number; forceRecrawl?: boolean },
): Promise<BatchIcpScoreResult> {
  const batchSize = options?.batchSize ?? 15;
  const forceRecrawl = options?.forceRecrawl ?? false;

  let scored = 0;
  let failed = 0;
  let skipped = 0;

  if (personIds.length === 0) {
    return { scored, failed, skipped };
  }

  // 1. Fetch workspace (for icpCriteriaPrompt) — same for all people
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { slug: workspaceSlug },
  });

  if (!workspace.icpCriteriaPrompt?.trim()) {
    throw new Error(
      `No ICP criteria prompt configured for workspace '${workspaceSlug}'. Use set_workspace_prompt to configure it first.`,
    );
  }

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

  // 4. Chunk into batches and process
  for (let i = 0; i < validIds.length; i += batchSize) {
    const batchIds = validIds.slice(i, i + batchSize);

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
            company: person.company,
            vertical: person.vertical,
            location: person.location,
            enrichmentData: person.enrichmentData,
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

    const batchPrompt = `Score the following ${batchIds.length} people against the ICP criteria. Return a JSON array with one entry per person, using the personId shown for each.

${entries.map((e) => `---\n${e}`).join("\n\n")}

Return a score from 0-100 and 1-3 sentence reasoning for each person. Set confidence based on data completeness:
- "high": Person data + company data + website all available
- "medium": 2 out of 3 signal types available
- "low": Only 1 signal type or very sparse data`;

    try {
      const { object: results } = await generateObject({
        model: anthropic("claude-haiku-4-5-20251001"),
        schema: BatchIcpScoreSchema,
        system: workspace.icpCriteriaPrompt,
        prompt: batchPrompt,
      });

      // Map results back by personId for reliable matching
      const resultMap = new Map(results.map((r) => [r.personId, r]));

      // Persist each score
      for (const id of batchIds) {
        const result = resultMap.get(id);
        if (!result) {
          // Person not in response — fall back to individual scoring
          try {
            await scorePersonIcp(id, workspaceSlug, forceRecrawl);
            scored++;
          } catch {
            failed++;
          }
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
            },
          });
          scored++;
        } catch {
          failed++;
        }
      }
    } catch (error) {
      // Batch call failed — fall back to individual scoring for this batch
      console.error(
        `[icp-scorer] Batch scoring failed, falling back to individual: ${error instanceof Error ? error.message : String(error)}`,
      );

      for (const id of batchIds) {
        try {
          await scorePersonIcp(id, workspaceSlug, forceRecrawl);
          scored++;
        } catch {
          failed++;
        }
      }
    }
  }

  return { scored, failed, skipped };
}
