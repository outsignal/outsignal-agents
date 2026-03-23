import { tool } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { crawlWebsite, scrapeUrl } from "@/lib/firecrawl/client";
import { notify } from "@/lib/notify";
import { runAgent } from "./runner";
import { searchKnowledgeBase } from "./shared-tools";
import { researchOutputSchema } from "./types";
import type { AgentConfig, ResearchInput, ResearchOutput } from "./types";
import { sanitizePromptInput, USER_INPUT_GUARD } from "./utils";
import { loadRules } from "./load-rules";

// --- Research Agent Tools ---

const researchTools = {
  crawlWebsite: tool({
    description:
      "Deep crawl a website starting from the given URL. Returns markdown content for up to 10 pages (homepage, about, services, case studies, pricing, etc.).",
    inputSchema: z.object({
      url: z.string().describe("The website URL to crawl"),
      maxPages: z
        .number()
        .optional()
        .default(10)
        .describe("Maximum pages to crawl (default 10)"),
    }),
    execute: async ({ url, maxPages }) => {
      const pages = await crawlWebsite(url, { maxPages });
      return pages.map((p) => ({
        url: p.url,
        title: p.title ?? "Untitled",
        contentLength: p.markdown.length,
        content: p.markdown.slice(0, 12000), // limit per page to manage context
      }));
    },
  }),

  scrapeUrl: tool({
    description:
      "Scrape a single URL and return its content as markdown. Use this for targeted page analysis.",
    inputSchema: z.object({
      url: z.string().describe("The URL to scrape"),
    }),
    execute: async ({ url }) => {
      const result = await scrapeUrl(url);
      return {
        url: result.url,
        title: result.title ?? "Untitled",
        content: result.markdown.slice(0, 15000),
      };
    },
  }),

  getWorkspaceInfo: tool({
    description:
      "Read the current workspace data including ICP fields, campaign brief, and configuration. Use this to compare your findings with what the client already provided.",
    inputSchema: z.object({
      slug: z.string().describe("The workspace slug"),
    }),
    execute: async ({ slug }) => {
      const ws = await prisma.workspace.findUnique({ where: { slug } });
      if (!ws) return { error: `Workspace '${slug}' not found` };
      return {
        name: ws.name,
        slug: ws.slug,
        vertical: ws.vertical,
        website: ws.website,
        icpCountries: ws.icpCountries,
        icpIndustries: ws.icpIndustries,
        icpCompanySize: ws.icpCompanySize,
        icpDecisionMakerTitles: ws.icpDecisionMakerTitles,
        icpKeywords: ws.icpKeywords,
        icpExclusionCriteria: ws.icpExclusionCriteria,
        coreOffers: ws.coreOffers,
        pricingSalesCycle: ws.pricingSalesCycle,
        differentiators: ws.differentiators,
        painPoints: ws.painPoints,
        caseStudies: ws.caseStudies,
        leadMagnets: ws.leadMagnets,
      };
    },
  }),

  saveWebsiteAnalysis: tool({
    description:
      "Save the website analysis results to the database. Call this once you have completed your analysis.",
    inputSchema: z.object({
      workspaceSlug: z.string().describe("The workspace slug"),
      url: z.string().describe("The website URL that was analyzed"),
      crawlData: z
        .string()
        .describe("JSON string of the raw crawl results (page URLs and titles)"),
      analysis: z
        .string()
        .describe("JSON string of your structured ResearchOutput analysis"),
      suggestions: z
        .string()
        .optional()
        .describe("JSON string of ICP enhancement suggestions"),
    }),
    execute: async ({
      workspaceSlug,
      url,
      crawlData,
      analysis,
      suggestions,
    }) => {
      const record = await prisma.websiteAnalysis.create({
        data: {
          workspaceSlug,
          url,
          crawlData,
          analysis,
          suggestions: suggestions ?? null,
          status: "complete",
        },
      });
      return { id: record.id, status: "saved" };
    },
  }),

  updateWorkspaceICP: tool({
    description:
      "Update empty ICP and campaign brief fields on the workspace with AI-extracted data. Only fills in fields that are currently null/empty — never overwrites client-provided data.",
    inputSchema: z.object({
      slug: z.string().describe("The workspace slug"),
      vertical: z.string().optional(),
      icpCountries: z.string().optional(),
      icpIndustries: z.string().optional(),
      icpCompanySize: z.string().optional(),
      icpDecisionMakerTitles: z.string().optional(),
      icpKeywords: z.string().optional(),
      icpExclusionCriteria: z.string().optional(),
      coreOffers: z.string().optional(),
      differentiators: z.string().optional(),
      painPoints: z.string().optional(),
      pricingSalesCycle: z.string().optional(),
      caseStudies: z.string().optional(),
    }),
    execute: async ({ slug, ...fields }) => {
      const ws = await prisma.workspace.findUnique({ where: { slug } });
      if (!ws) return { error: `Workspace '${slug}' not found` };

      // Only update fields that are currently empty
      const updates: Record<string, string> = {};
      for (const [key, value] of Object.entries(fields)) {
        if (value && !ws[key as keyof typeof ws]) {
          updates[key] = value;
        }
      }

      if (Object.keys(updates).length === 0) {
        return { updated: [], message: "All fields already have values" };
      }

      await prisma.workspace.update({
        where: { slug },
        data: updates,
      });

      return {
        updated: Object.keys(updates),
        message: `Updated ${Object.keys(updates).length} field(s)`,
      };
    },
  }),

  searchKnowledgeBase,
};

// --- Agent Configuration ---

const RESEARCH_SYSTEM_PROMPT = `You are the Outsignal Research Agent — a business intelligence analyst specializing in extracting actionable data from company websites for cold outbound campaigns.

${loadRules("research-rules.md")}`;

const researchConfig: AgentConfig = {
  name: "research",
  model: "claude-opus-4-20250514",
  systemPrompt: RESEARCH_SYSTEM_PROMPT + USER_INPUT_GUARD,
  tools: researchTools,
  maxSteps: 8,
  outputSchema: researchOutputSchema,
};

// --- Public API ---

/**
 * Run the Research Agent to analyze a website and extract business intelligence.
 *
 * Can be called from:
 * - CLI scripts: `runResearchAgent({ url: "https://example.com", task: "..." })`
 * - Dashboard chat: via orchestrator's delegateToResearch tool
 * - API routes: post-onboarding automation
 */
export async function runResearchAgent(
  input: ResearchInput,
): Promise<ResearchOutput> {
  const userMessage = buildResearchMessage(input);

  try {
    const result = await runAgent<ResearchOutput>(researchConfig, userMessage, {
      triggeredBy: "cli",
      workspaceSlug: input.workspaceSlug,
    });

    return result.output;
  } catch (error) {
    notify({
      type: "agent",
      severity: "error",
      title: "Research agent failed",
      message: error instanceof Error ? error.message : String(error),
      workspaceSlug: input.workspaceSlug,
    }).catch(() => {});
    throw error;
  }
}

function buildResearchMessage(input: ResearchInput): string {
  const parts: string[] = [];

  if (input.workspaceSlug) {
    parts.push(`Workspace: ${input.workspaceSlug}`);
  }
  if (input.url) {
    parts.push(`Website URL: ${input.url}`);
  }
  parts.push("", `Task: ${sanitizePromptInput(input.task)}`);

  return parts.join("\n");
}

export { researchConfig, researchTools };
