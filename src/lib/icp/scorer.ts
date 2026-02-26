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

const IcpScoreSchema = z.object({
  score: z.number().min(0).max(100),
  reasoning: z.string().describe("1-3 sentence explanation of ICP fit"),
  confidence: z.enum(["high", "medium", "low"]).describe(
    "Data completeness: high=all signals, medium=2/3, low=sparse"
  ),
});

/**
 * Build a scoring prompt from person + company + website data.
 */
function buildScoringPrompt(params: {
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
