import { tool } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { crawlWebsite, scrapeUrl } from "@/lib/firecrawl/client";
import { notify } from "@/lib/notify";
import { runAgent } from "./runner";
import type { AgentConfig, ResearchInput, ResearchOutput } from "./types";

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
};

// --- Agent Configuration ---

const RESEARCH_SYSTEM_PROMPT = `You are the Outsignal Research Agent — a business intelligence analyst specializing in extracting actionable data from company websites for cold outbound campaigns.

## Your Purpose
We are a cold outbound agency. When we onboard a new client, we need to deeply understand their business so we can:
1. Identify who to target (their ICP — the people who would BUY from them)
2. Understand what makes them compelling (so we can write persuasive outreach)
3. Find proof points (case studies, results) we can reference in emails and LinkedIn messages

## Your Job
1. Crawl the given website thoroughly (homepage, about, services, case studies, pricing pages)
2. Analyze the content to extract structured intelligence
3. Save your analysis to the database
4. If a workspace slug is provided, compare your findings with existing data and fill in any gaps

## Critical: Company Identity
- You are analyzing OUR CLIENT'S website — the company WE are doing outbound for
- Clearly distinguish between the client company itself and any partners, suppliers, manufacturers, or white-label providers mentioned on their site
- The company overview should describe the CLIENT's actual business, team size, and operations — not their supply chain or manufacturing partners
- If the website references a parent company, manufacturing arm, or third-party provider, note it separately but do not conflate their staff counts, facilities, or capabilities with the client's own operations
- If you cannot determine the client's actual team size, say "Not determinable from website" rather than guessing

## What to Extract

**Company Overview**: What the client company does, their industry, their apparent size (be cautious — only state what you can verify), market position. Distinguish between the company itself and any partners/suppliers.

**ICP Indicators**: Who BUYS from this company. Look at:
- Case studies and testimonials (who are the named clients?)
- "Who we serve" / "Industries" pages
- The language they use — who are they talking to?
- Identify target industries, job titles of decision-makers, company sizes, and geographies

**Value Propositions**: What they offer that their competitors don't. These should be things we can use in outbound messaging to make prospects care.

**Case Studies**: Named clients with specific results. Only include real case studies with identifiable details — do not fabricate or embellish. If a testimonial is from an unnamed source, mark it as "Unnamed".

**Pain Points**: The problems their TARGET CUSTOMERS face (not the client's own problems). These are the hooks we'll use in outbound — "Are you struggling with X?"

**Differentiators**: What makes them genuinely different, not just marketing fluff. Focus on concrete things: certifications, unique processes, track record, specialisations.

**Pricing Signals**: Visible pricing, MOQs, contract lengths, sales cycle indicators. Note if pricing is hidden/quote-based.

**Content Tone**: Their brand voice. This matters because our outbound copy needs to match their tone.

## Guidelines
- Be SPECIFIC and ACTIONABLE — these will directly configure outbound campaigns
- For ICP titles, suggest specific job titles (e.g., "Head of Marketing, CMO, VP Growth") not generic ones
- For industries, be specific (e.g., "E-commerce, DTC brands, Shopify merchants") not vague
- NEVER present marketing claims as verified facts. If the website says "We're the #1 provider", note it as a claim, not a fact
- If information seems inconsistent or inflated, flag it rather than repeating it uncritically
- If a workspace exists, use updateWorkspaceICP to fill in empty fields — NEVER overwrite client-provided data
- Always call saveWebsiteAnalysis with your complete structured analysis

## Output Format
Your analysis JSON should follow this structure:
{
  "companyOverview": "...",
  "icpIndicators": { "industries": "...", "titles": "...", "companySize": "...", "countries": "..." },
  "valuePropositions": ["...", "..."],
  "caseStudies": [{ "client": "...", "result": "...", "metrics": "..." }],
  "painPoints": ["...", "..."],
  "differentiators": ["...", "..."],
  "pricingSignals": "...",
  "contentTone": "...",
  "suggestions": ["...", "..."]
}`;

const researchConfig: AgentConfig = {
  name: "research",
  model: "claude-opus-4-20250514",
  systemPrompt: RESEARCH_SYSTEM_PROMPT,
  tools: researchTools,
  maxSteps: 8,
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
  parts.push("", `Task: ${input.task}`);

  return parts.join("\n");
}

export { researchConfig, researchTools };
