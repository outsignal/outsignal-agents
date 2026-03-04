import { tool } from "ai";
import { z } from "zod";
import * as operations from "@/lib/leads/operations";
import { searchKnowledgeBase } from "./shared-tools";
import { runAgent } from "./runner";
import type { AgentConfig, LeadsInput, LeadsOutput } from "./types";
import { apolloAdapter } from "@/lib/discovery/adapters/apollo";
import { prospeoSearchAdapter } from "@/lib/discovery/adapters/prospeo-search";
import { aiarkSearchAdapter } from "@/lib/discovery/adapters/aiark-search";
import { serperAdapter } from "@/lib/discovery/adapters/serper";
import { firecrawlDirectoryAdapter } from "@/lib/discovery/adapters/firecrawl-directory";
import { stageDiscoveredPeople } from "@/lib/discovery/staging";
import { incrementDailySpend, PROVIDER_COSTS } from "@/lib/enrichment/costs";
import { getWorkspaceQuotaUsage } from "@/lib/workspaces/quota";
import { deduplicateAndPromote as runDeduplicateAndPromote } from "@/lib/discovery/promotion";
import { prisma } from "@/lib/db";

// --- Leads Agent Tools ---

const leadsTools = {
  searchPeople: tool({
    description:
      "Search people in the database by criteria. Use for: finding leads by title, vertical, company, location, ICP score. Searches are FREE (no credit cost). Returns up to 25 results per page with ICP scores where available.",
    inputSchema: z.object({
      query: z
        .string()
        .optional()
        .describe(
          "Free-text search across name, email, company, job title",
        ),
      jobTitle: z
        .string()
        .optional()
        .describe("Filter by job title (e.g. 'CTO', 'Head of Marketing')"),
      vertical: z
        .string()
        .optional()
        .describe("Filter by vertical/industry (exact match)"),
      location: z
        .string()
        .optional()
        .describe("Filter by location (contains, case-insensitive)"),
      workspaceSlug: z
        .string()
        .optional()
        .describe("Filter to people associated with a specific workspace"),
      minIcpScore: z
        .number()
        .optional()
        .describe("Only return people with ICP score >= this value"),
      hasVerifiedEmail: z
        .boolean()
        .optional()
        .describe("If true, only return people with verified email addresses"),
      page: z.number().optional().describe("Page number (default: 1)"),
      limit: z
        .number()
        .optional()
        .default(25)
        .describe("Results per page (default: 25)"),
    }),
    execute: async (params) => {
      return operations.searchPeople(params);
    },
  }),

  createList: tool({
    description:
      "Create a new target list for a workspace. Use after a search to save results.",
    inputSchema: z.object({
      name: z.string().describe("Name of the target list"),
      workspaceSlug: z
        .string()
        .describe("The workspace this list belongs to"),
      description: z
        .string()
        .optional()
        .describe("Optional description of the list"),
    }),
    execute: async (params) => {
      return operations.createList(params);
    },
  }),

  addPeopleToList: tool({
    description:
      "Add people to an existing target list by their IDs. Deduplicates automatically.",
    inputSchema: z.object({
      listId: z.string().describe("The ID of the target list"),
      personIds: z
        .array(z.string())
        .describe("Array of person IDs to add to the list"),
    }),
    execute: async ({ listId, personIds }) => {
      return operations.addPeopleToList(listId, personIds);
    },
  }),

  getList: tool({
    description:
      "Get details of a target list including all people and their enrichment data.",
    inputSchema: z.object({
      listId: z.string().describe("The ID of the target list"),
    }),
    execute: async ({ listId }) => {
      return operations.getList(listId);
    },
  }),

  getLists: tool({
    description:
      "List all target lists, optionally filtered by workspace.",
    inputSchema: z.object({
      workspaceSlug: z
        .string()
        .optional()
        .describe("Filter lists by workspace slug"),
      query: z
        .string()
        .optional()
        .describe("Search query to filter lists by name or description"),
    }),
    execute: async (params) => {
      return operations.getLists(params);
    },
  }),

  scoreList: tool({
    description:
      "Score all unscored people in a target list against the workspace ICP criteria. Skips already-scored people. COSTS CREDITS (Firecrawl + Claude Haiku per person). Always show the user how many will be scored before proceeding.",
    inputSchema: z.object({
      listId: z.string().describe("The ID of the target list to score"),
      workspaceSlug: z
        .string()
        .describe(
          "The workspace slug — determines which ICP criteria to score against",
        ),
    }),
    execute: async ({ listId, workspaceSlug }) => {
      return operations.scoreList(listId, workspaceSlug);
    },
  }),

  exportListToEmailBison: tool({
    description:
      "Export verified leads from a target list to the EmailBison workspace. Only exports people with verified emails. If unverified people exist, returns a count and asks user to verify first. COSTS CREDITS for verification. Leads are uploaded to the workspace — campaign assignment must be done manually in EmailBison.",
    inputSchema: z.object({
      listId: z.string().describe("The ID of the target list to export"),
      workspaceSlug: z
        .string()
        .describe("The EmailBison workspace to export leads to"),
    }),
    execute: async ({ listId, workspaceSlug }) => {
      return operations.exportListToEmailBison(listId, workspaceSlug);
    },
  }),

  buildDiscoveryPlan: tool({
    description:
      "Build a discovery plan showing sources, estimated cost, estimated volume, and quota impact. ALWAYS call this before executing any discovery searches. Does NOT make external API calls — just computes projections from workspace quota data. Present the returned plan to admin and wait for approval before calling search tools.",
    inputSchema: z.object({
      workspaceSlug: z.string().describe("Workspace slug for quota lookup"),
      sources: z.array(
        z.object({
          name: z.enum([
            "apollo",
            "prospeo",
            "aiark",
            "serper-web",
            "serper-maps",
            "firecrawl",
          ]),
          reasoning: z
            .string()
            .describe("1-line explanation of why this source was chosen"),
          estimatedVolume: z
            .number()
            .describe("Estimated leads this source will return"),
          filters: z
            .record(z.string(), z.unknown())
            .describe("Source-specific filters as JSON"),
        }),
      ),
    }),
    execute: async (params) => {
      const usage = await getWorkspaceQuotaUsage(params.workspaceSlug);
      const workspace = await prisma.workspace.findUnique({
        where: { slug: params.workspaceSlug },
        select: { monthlyLeadQuota: true },
      });
      const quotaLimit = workspace?.monthlyLeadQuota ?? 2000;
      const totalEstimatedLeads = params.sources.reduce(
        (sum, s) => sum + s.estimatedVolume,
        0,
      );

      // Cost estimation per source using PROVIDER_COSTS
      const SOURCE_COST_MAP: Record<string, string> = {
        apollo: "apollo-search",
        prospeo: "prospeo-search",
        aiark: "aiark-search",
        "serper-web": "serper-web",
        "serper-maps": "serper-maps",
        firecrawl: "firecrawl-extract",
      };

      const sourcesWithCost = params.sources.map((s) => {
        const costKey = SOURCE_COST_MAP[s.name] ?? s.name;
        const costPerCall = PROVIDER_COSTS[costKey] ?? 0;
        // Apollo is free. Others: ~1 API call per 25 results.
        const estimatedCalls =
          s.name === "apollo"
            ? 0
            : Math.max(1, Math.ceil(s.estimatedVolume / 25));
        const estimatedCost = costPerCall * estimatedCalls;
        return { ...s, estimatedCost };
      });

      const totalCost = sourcesWithCost.reduce(
        (sum, s) => sum + s.estimatedCost,
        0,
      );
      const quotaAfter = usage.totalLeadsUsed + totalEstimatedLeads;
      const overQuota = quotaAfter > quotaLimit;

      return {
        sources: sourcesWithCost,
        totalEstimatedLeads,
        totalCost,
        quotaBefore: usage.totalLeadsUsed,
        quotaAfter,
        quotaLimit,
        overQuota,
      };
    },
  }),

  deduplicateAndPromote: tool({
    description:
      "After discovery searches complete for an approved plan, deduplicate staged leads against the Person DB and promote non-duplicates. Triggers enrichment waterfall for promoted leads. Call this AFTER all search tools for an approved plan have finished.",
    inputSchema: z.object({
      workspaceSlug: z.string().describe("Workspace running the discovery"),
      discoveryRunIds: z
        .array(z.string())
        .describe("Run IDs returned by each search tool call"),
    }),
    execute: async (params) => {
      return runDeduplicateAndPromote(
        params.workspaceSlug,
        params.discoveryRunIds,
      );
    },
  }),

  searchKnowledgeBase,

  searchApollo: tool({
    description:
      "Search Apollo.io for people matching ICP filters. Apollo has 275M contacts. Search is FREE (no credits). Returns identity data only (no emails — enrichment fills those later). Use for enterprise B2B discovery.",
    inputSchema: z.object({
      workspaceSlug: z.string().describe("Workspace running the discovery"),
      jobTitles: z
        .array(z.string())
        .optional()
        .describe("Job titles to search for (e.g., ['CTO', 'VP Engineering'])"),
      seniority: z
        .array(z.string())
        .optional()
        .describe(
          "Seniority levels: 'c_suite', 'vp', 'director', 'manager', 'ic'",
        ),
      industries: z
        .array(z.string())
        .optional()
        .describe("Industry keywords (e.g., ['Software', 'Fintech'])"),
      locations: z
        .array(z.string())
        .optional()
        .describe("Locations (e.g., ['London, United Kingdom'])"),
      companySizes: z
        .array(z.string())
        .optional()
        .describe(
          "Company size ranges: '1-10', '11-50', '51-200', '201-500', '500+'",
        ),
      companyDomains: z
        .array(z.string())
        .optional()
        .describe("Target specific company domains"),
      keywords: z
        .array(z.string())
        .optional()
        .describe("Free-text keywords"),
      limit: z.number().default(25).describe("Results per page (max 100)"),
      pageToken: z
        .string()
        .optional()
        .describe("Pagination token from previous search"),
    }),
    execute: async (params) => {
      const filters = {
        jobTitles: params.jobTitles,
        seniority: params.seniority,
        industries: params.industries,
        locations: params.locations,
        companySizes: params.companySizes,
        companyDomains: params.companyDomains,
        keywords: params.keywords,
      };
      const result = await apolloAdapter.search(
        filters,
        params.limit,
        params.pageToken,
      );
      const { staged, runId } = await stageDiscoveredPeople({
        people: result.people,
        discoverySource: "apollo",
        workspaceSlug: params.workspaceSlug,
        searchQuery: JSON.stringify(filters),
        rawResponses: result.people.map(() => result.rawResponse),
      });
      return {
        source: "apollo",
        found: result.people.length,
        staged,
        runId,
        totalAvailable: result.totalAvailable,
        hasMore: result.hasMore,
        nextPageToken: result.nextPageToken,
        costUsd: result.costUsd,
        people: result.people.slice(0, 10).map((p) => ({
          name: [p.firstName, p.lastName].filter(Boolean).join(" "),
          title: p.jobTitle,
          company: p.company,
          location: p.location,
        })),
      };
    },
  }),

  searchProspeo: tool({
    description:
      "Search Prospeo for people matching ICP filters. Supports 20+ filters including funding stage and headcount. COSTS 1 CREDIT PER REQUEST. Returns identity data only (no emails). Use for B2B discovery with funding/headcount filters.",
    inputSchema: z.object({
      workspaceSlug: z.string().describe("Workspace running the discovery"),
      jobTitles: z
        .array(z.string())
        .optional()
        .describe("Job titles to include"),
      seniority: z
        .array(z.string())
        .optional()
        .describe(
          "Seniority levels: 'c_suite', 'vp', 'director', 'manager'",
        ),
      industries: z
        .array(z.string())
        .optional()
        .describe("Company industries to include"),
      locations: z
        .array(z.string())
        .optional()
        .describe("Person locations to include"),
      companySizes: z
        .array(z.string())
        .optional()
        .describe(
          "Headcount ranges: '1-10', '11-50', '51-200', '201-500', '501-1000'",
        ),
      companyDomains: z
        .array(z.string())
        .optional()
        .describe("Company domains to target"),
      keywords: z
        .array(z.string())
        .optional()
        .describe("Free-text keywords"),
      fundingStages: z
        .array(z.string())
        .optional()
        .describe(
          "Funding stages: 'seed', 'series_a', 'series_b', 'series_c'",
        ),
      departments: z
        .array(z.string())
        .optional()
        .describe(
          "Departments: 'engineering', 'product', 'sales', 'marketing'",
        ),
      limit: z
        .number()
        .default(25)
        .describe("Results per page (fixed at 25 by Prospeo)"),
      pageToken: z
        .string()
        .optional()
        .describe("Pagination token from previous search"),
    }),
    execute: async (params) => {
      const filters = {
        jobTitles: params.jobTitles,
        seniority: params.seniority,
        industries: params.industries,
        locations: params.locations,
        companySizes: params.companySizes,
        companyDomains: params.companyDomains,
        keywords: params.keywords,
      };
      // Build Prospeo-specific extras for funding stage and department filters
      const extras: Record<string, unknown> = {};
      if (params.fundingStages?.length) {
        extras.company_funding = { include: params.fundingStages };
      }
      if (params.departments?.length) {
        extras.person_department = { include: params.departments };
      }
      const result = await prospeoSearchAdapter.search(
        filters,
        params.limit,
        params.pageToken,
        Object.keys(extras).length > 0 ? extras : undefined,
      );
      await incrementDailySpend("prospeo-search", result.costUsd);
      const { staged, runId } = await stageDiscoveredPeople({
        people: result.people,
        discoverySource: "prospeo",
        workspaceSlug: params.workspaceSlug,
        searchQuery: JSON.stringify({
          ...filters,
          fundingStages: params.fundingStages,
          departments: params.departments,
        }),
      });
      return {
        source: "prospeo",
        found: result.people.length,
        staged,
        runId,
        totalAvailable: result.totalAvailable,
        hasMore: result.hasMore,
        nextPageToken: result.nextPageToken,
        costUsd: result.costUsd,
        people: result.people.slice(0, 10).map((p) => ({
          name: [p.firstName, p.lastName].filter(Boolean).join(" "),
          title: p.jobTitle,
          company: p.company,
          location: p.location,
        })),
      };
    },
  }),

  searchAiArk: tool({
    description:
      "Search AI Ark for people by role, seniority, department, location, keywords. COSTS CREDITS. Similar to Apollo but may have different coverage. Use as secondary B2B source.",
    inputSchema: z.object({
      workspaceSlug: z.string().describe("Workspace running the discovery"),
      jobTitles: z
        .array(z.string())
        .optional()
        .describe("Job titles to search"),
      seniority: z
        .array(z.string())
        .optional()
        .describe("Seniority levels"),
      industries: z.array(z.string()).optional().describe("Industries"),
      locations: z.array(z.string()).optional().describe("Locations"),
      companySizes: z
        .array(z.string())
        .optional()
        .describe("Company size ranges"),
      keywords: z.array(z.string()).optional().describe("Keywords"),
      limit: z
        .number()
        .default(25)
        .describe("Results per page (max 100)"),
      pageToken: z
        .string()
        .optional()
        .describe("Pagination token"),
    }),
    execute: async (params) => {
      const filters = {
        jobTitles: params.jobTitles,
        seniority: params.seniority,
        industries: params.industries,
        locations: params.locations,
        companySizes: params.companySizes,
        keywords: params.keywords,
      };
      const result = await aiarkSearchAdapter.search(
        filters,
        params.limit,
        params.pageToken,
      );
      await incrementDailySpend("aiark-search", result.costUsd);
      const { staged, runId } = await stageDiscoveredPeople({
        people: result.people,
        discoverySource: "aiark",
        workspaceSlug: params.workspaceSlug,
        searchQuery: JSON.stringify(filters),
      });
      return {
        source: "aiark",
        found: result.people.length,
        staged,
        runId,
        totalAvailable: result.totalAvailable,
        hasMore: result.hasMore,
        nextPageToken: result.nextPageToken,
        costUsd: result.costUsd,
        people: result.people.slice(0, 10).map((p) => ({
          name: [p.firstName, p.lastName].filter(Boolean).join(" "),
          title: p.jobTitle,
          company: p.company,
          location: p.location,
        })),
      };
    },
  }),

  searchGoogle: tool({
    description:
      "Search Google via Serper.dev. Two modes: (1) 'web' for directory-style queries ('list of HVAC contractors Dallas') or company research, (2) 'maps' for local businesses from Google Maps with phone/address/website. COSTS 1 CREDIT PER SEARCH. Maps results are company-level (no person data). Social mentions are NOT available through this tool.",
    inputSchema: z.object({
      workspaceSlug: z.string().describe("Workspace running the discovery"),
      query: z.string().describe("Natural language search query"),
      mode: z
        .enum(["web", "maps"])
        .default("web")
        .describe(
          "'web' for Google search results, 'maps' for Google Maps places",
        ),
      limit: z
        .number()
        .default(10)
        .describe("Number of results (web mode only, max 100)"),
    }),
    execute: async (params) => {
      if (params.mode === "maps") {
        const { results, costUsd } = await serperAdapter.searchMaps(
          params.query,
        );
        await incrementDailySpend("serper-maps", costUsd);
        const people = results.map((r) => ({
          company: r.company,
          phone: r.phone,
          companyDomain: r.companyDomain,
          location: r.address,
        }));
        const { staged, runId } = await stageDiscoveredPeople({
          people,
          discoverySource: "serper-maps",
          workspaceSlug: params.workspaceSlug,
          searchQuery: params.query,
        });
        return {
          source: "serper-maps",
          found: results.length,
          staged,
          runId,
          costUsd,
          places: results.slice(0, 10).map((r) => ({
            name: r.company,
            address: r.address,
            phone: r.phone,
            website: r.website,
            rating: r.rating,
          })),
        };
      } else {
        const { results, costUsd } = await serperAdapter.searchWeb(
          params.query,
          params.limit,
        );
        await incrementDailySpend("serper-web", costUsd);
        // Web results are informational — return to agent for analysis, not staged
        return {
          source: "serper-web",
          found: results.length,
          costUsd,
          results: results.slice(0, 10).map((r) => ({
            title: r.title,
            link: r.link,
            snippet: r.snippet,
          })),
          note: "Web results are informational. Use extractDirectory to extract contacts from specific URLs, or searchApollo/searchProspeo for structured people search.",
        };
      }
    },
  }),

  extractDirectory: tool({
    description:
      "Extract a structured contact list from a URL (association member page, government database, directory listing). Uses AI to extract names, emails, titles, companies, phones, LinkedIn URLs. COSTS 1 CREDIT. Validates results and filters junk. Use after finding directory URLs via searchGoogle.",
    inputSchema: z.object({
      workspaceSlug: z.string().describe("Workspace running the discovery"),
      url: z
        .string()
        .url()
        .describe("URL of the directory page to extract contacts from"),
      discoveryRunId: z
        .string()
        .optional()
        .describe(
          "Group with other extractions from the same discovery run",
        ),
    }),
    execute: async (params) => {
      const result = await firecrawlDirectoryAdapter.extract(params.url);
      await incrementDailySpend("firecrawl-extract", result.costUsd);
      const { staged, runId } = await stageDiscoveredPeople({
        people: result.people,
        discoverySource: "firecrawl",
        workspaceSlug: params.workspaceSlug,
        searchQuery: params.url,
        discoveryRunId: params.discoveryRunId,
      });
      return {
        source: "firecrawl",
        found: result.validCount,
        staged,
        skipped: result.skippedCount,
        runId,
        costUsd: result.costUsd,
        url: params.url,
        people: result.people.slice(0, 10).map((p) => ({
          name: [p.firstName, p.lastName].filter(Boolean).join(" "),
          email: p.email,
          title: p.jobTitle,
          company: p.company,
        })),
      };
    },
  }),
};

// --- System Prompt ---

const LEADS_SYSTEM_PROMPT = `You are the Outsignal Leads Agent — a specialist for managing the lead pipeline through natural language.

## Capabilities
You can: search people in the local database, create target lists, add people to lists, score leads against ICP criteria, export verified leads to EmailBison, and discover new leads from external sources (Apollo, Prospeo, AI Ark, Serper, Firecrawl).

## Discovery Workflow

When asked to find or discover leads, ALWAYS follow this exact flow:

### Step 1: Build the Discovery Plan
- Analyze the request to determine ICP characteristics (industry, title, seniority, location, company size, etc.)
- Select the best sources for this ICP type (see Source Selection Guide below)
- Call buildDiscoveryPlan with your selected sources, filters, and estimated volumes
- Present the plan to the admin showing:
  * Each source with reasoning, filters, estimated volume, and cost
  * Total estimated leads and cost
  * Quota impact: "Quota: {before}/{limit} used -> estimated {after}/{limit} after this search"
  * If over quota: warning that this would exceed the monthly quota (but do NOT block -- soft limit)
- End with: "Reply with 'approve' to start discovery, or tell me what to adjust."

### Step 2: Wait for Approval
- You MUST receive an explicit approval before calling any search tools
- Approval phrases: "approve", "yes", "go ahead", "looks good", "confirm", "do it", "go"
- Any other response means: adjust the plan and re-present. Examples:
  * "Remove Serper" -> rebuild plan without Serper, re-present
  * "Add Apollo with seniority=VP" -> add Apollo source, re-present
  * "That's too many leads" -> reduce estimated volumes, re-present
  * "What about Firecrawl?" -> add Firecrawl if relevant, re-present
- NEVER call searchApollo, searchProspeo, searchAiArk, searchGoogle, or extractDirectory without prior approval of a discovery plan

### Step 3: Execute the Plan
- Say: "Starting discovery -- estimated ~30 seconds..."
- Call each search tool from the plan in sequence
- Collect the runId from each tool's return value

### Step 4: Deduplicate and Promote
- Call deduplicateAndPromote with all collected runIds
- Report results as per-source breakdown:
  "Apollo: 142 found, 18 dupes skipped, 124 promoted.
   Prospeo: 89 found, 7 dupes skipped, 82 promoted.
   Total: 206 new leads -- enrichment running in background."
- Show up to 5 sample duplicate names (not the full list)
- Mention that enrichment (email finding) is running in background

## Source Selection Guide

You decide which sources to use -- there are no rigid categories. Use these as starting points:

**Enterprise B2B (title + seniority + industry + location + company size):**
- searchApollo -- 275M contacts, FREE search, best coverage for enterprise B2B
- searchProspeo -- Strong B2B coverage, COSTS CREDITS, unique funding stage and headcount filters
- searchAiArk -- B2B people search, COSTS CREDITS, equal coverage to Apollo/Prospeo (not a fallback -- a full peer)

**Niche/Association/Government directories:**
- searchGoogle (web mode) -- Find directory URLs first
- extractDirectory -- Extract contacts from the directory URL

**Local/SMB businesses:**
- searchGoogle (maps mode) -- Google Maps data with phone/address/website (company-level, no person data)

**Mixed/Ambiguous requests:**
- Make your best guess and build the plan. The plan IS the clarification -- admin reviews and adjusts before execution.
- For broad B2B requests, default to Apollo (free) + one paid source that adds unique filters.
- AI Ark is an equal option alongside Apollo and Prospeo -- consider it when extra coverage or different data sources would help.

## Discovery Rules
- All discovered leads go to the DiscoveredPerson staging table, NOT directly to the Person table. Use deduplicateAndPromote to move them.
- Discovery does NOT include emails for most sources (Apollo, Prospeo). Enrichment fills those in later after promotion.
- ALWAYS follow the plan-approve-execute flow above. Never call search tools directly without a plan.
- Show results as a compact preview after each search. Ask before fetching more pages.
- ALWAYS show cost and staged count after each discovery call.

## Interaction Rules
- Break multi-step flows into separate steps. Complete one action, show results, then suggest next steps.
- CREDIT GATE: Database searches are free. Scoring and export COST CREDITS. Always preview counts before running scoring or export. Say how many people will be scored/exported and ask for confirmation.
- For search results, present as a compact table: Name | Title | Company | Email Status | ICP Score | Vertical
- After search results, suggest next actions: "Want to: [Add to a list] [Score these] [Export]"
- ICP scores include a one-line reason (e.g. "85 -- title match, verified email, target vertical")

## Conversational Refinement
The conversation history may contain previous search results. When the user says things like "narrow to London only" or "filter to fintech", refine the previous search with additional filters rather than starting from scratch.

## Voice
Friendly but brief. Warm and efficient, light personality. Examples:
- "Nice -- found 47 CTOs in fintech! 32 have verified emails. Want to build a list?"
- "No results for CTOs in fintech in Lagos. Try broadening: drop the location, or try 'technology' instead of 'fintech'?"

## Error Handling
- Empty results: suggest refinements
- Unrecognized queries: show capabilities list
- API failures: report transparently + offer retry
- Missing ICP criteria: tell user to configure it first
- If a source fails mid-plan, report which source failed and continue with remaining sources. Present partial results.

## Important Notes
- Export to EmailBison means uploading leads to the workspace lead list. There is NO API to assign leads to a campaign -- that must be done manually in EmailBison UI.
- When scoring, only unscored people are scored. Already-scored people are skipped (no wasted credits).`;

// --- Agent Configuration ---

const leadsConfig: AgentConfig = {
  name: "leads",
  model: "claude-sonnet-4-20250514",
  systemPrompt: LEADS_SYSTEM_PROMPT,
  tools: leadsTools,
  maxSteps: 15,
};

// --- Public API ---

/**
 * Run the Leads Agent to manage the lead pipeline via natural language.
 *
 * Can be called from:
 * - Dashboard chat: via orchestrator's delegateToLeads tool
 * - CLI scripts: `runLeadsAgent({ task: "find CTOs in fintech" })`
 * - API routes: /api/agents/leads
 *
 * The runAgent() call automatically creates an AgentRun audit record (LEAD-06).
 */
export async function runLeadsAgent(input: LeadsInput): Promise<LeadsOutput> {
  const userMessage = buildLeadsMessage(input);

  const result = await runAgent<LeadsOutput>(leadsConfig, userMessage, {
    triggeredBy: "orchestrator",
    workspaceSlug: input.workspaceSlug,
  });

  return result.output;
}

function buildLeadsMessage(input: LeadsInput): string {
  const parts: string[] = [];

  if (input.workspaceSlug) {
    parts.push(`Workspace: ${input.workspaceSlug}`);
  }
  if (input.conversationContext) {
    parts.push(`Context: ${input.conversationContext}`);
  }
  parts.push("", `Task: ${input.task}`);

  return parts.join("\n");
}

