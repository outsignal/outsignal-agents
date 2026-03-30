import { tool } from "ai";
import { z } from "zod";
import * as operations from "@/lib/leads/operations";
import { searchKnowledgeBase } from "./shared-tools";
import { runAgent } from "./runner";
import { leadsOutputSchema, NOVA_MODEL } from "./types";
import type { AgentConfig, LeadsInput, LeadsOutput } from "./types";
import { sanitizePromptInput, USER_INPUT_GUARD } from "./utils";
import { loadRules } from "./load-rules";
import { apolloAdapter } from "@/lib/discovery/adapters/apollo";
import { prospeoSearchAdapter } from "@/lib/discovery/adapters/prospeo-search";
import { aiarkSearchAdapter } from "@/lib/discovery/adapters/aiark-search";
import { serperAdapter } from "@/lib/discovery/adapters/serper";
import { firecrawlDirectoryAdapter } from "@/lib/discovery/adapters/firecrawl-directory";
import { apifyLeadsFinderAdapter } from "@/lib/discovery/adapters/apify-leads-finder";
import { checkDomainsForGoogleAds, searchGoogleAdsAdvertisers } from "../discovery/adapters/google-ads";
import { checkTechStack } from "../discovery/adapters/builtwith";
import { searchGoogleMaps } from "../discovery/adapters/google-maps";
import { searchEcommerceStores } from "../discovery/adapters/ecommerce-stores";
import { stageDiscoveredPeople } from "@/lib/discovery/staging";
import { incrementDailySpend, PROVIDER_COSTS } from "@/lib/enrichment/costs";
import { getWorkspaceQuotaUsage } from "@/lib/workspaces/quota";
import { deduplicateAndPromote as runDeduplicateAndPromote } from "@/lib/discovery/promotion";
import { prisma } from "@/lib/db";

// --- Leads Agent Tools ---

export const leadsTools = {
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
            "leads-finder",
            "serper-web",
            "serper-maps",
            "firecrawl",
            "google-maps",
            "ecommerce-stores",
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
        "leads-finder": "apify-leads-finder",
        "serper-web": "serper-web",
        "serper-maps": "serper-maps",
        firecrawl: "firecrawl-extract",
        "google-maps": "google-maps",
        "ecommerce-stores": "ecommerce-stores",
      };

      const sourcesWithCost = params.sources.map((s) => {
        const costKey = SOURCE_COST_MAP[s.name] ?? s.name;
        const costPerCall = PROVIDER_COSTS[costKey] ?? 0;
        let estimatedCost: number;
        if (s.name === "apollo") {
          // Direct Apollo API search is free
          estimatedCost = 0;
        } else if (s.name === "leads-finder") {
          // Leads Finder charges per lead (~$0.002/lead), not per API call
          estimatedCost = s.estimatedVolume * 0.002;
        } else if (s.name === "ecommerce-stores") {
          // Ecommerce Stores charges per lead (~$0.004/lead), not per API call
          estimatedCost = s.estimatedVolume * 0.004;
        } else {
          // Other sources: ~1 API call per 25 results
          const estimatedCalls = Math.max(1, Math.ceil(s.estimatedVolume / 25));
          estimatedCost = costPerCall * estimatedCalls;
        }
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
      "Search Prospeo for people matching ICP filters. Supports 20+ filters including funding, revenue, technologies, departments, NAICS/SIC codes, and years of experience. COSTS 1 CREDIT PER REQUEST. Returns identity data only (no emails).",
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
          "Headcount ranges (Prospeo): '1-10', '11-20', '21-50', '51-100', '101-200', '201-500', '501-1000', '1001-2000', '2001-5000', '5001-10000', '10000+'. Generic values like '11-50', '51-200', '500+' are auto-mapped.",
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
      companyKeywords: z.array(z.string()).optional().describe("Company keywords (e.g., 'fit-out', 'interior design')"),
      revenueMin: z.string().optional().describe("Min revenue: '<100K', '1M', '10M', '100M', '1B', '10B+'"),
      revenueMax: z.string().optional().describe("Max revenue: '<100K', '1M', '10M', '100M', '1B', '10B+'"),
      fundingTotalMin: z.string().optional().describe("Min total funding amount"),
      fundingTotalMax: z.string().optional().describe("Max total funding amount"),
      technologies: z.array(z.string()).optional().describe("Technologies used by company (e.g., ['Salesforce', 'HubSpot', 'AWS'])"),
      companyType: z.array(z.string()).optional().describe("Company type: 'Private', 'Public', 'Non Profit', 'Other'"),
      foundedYearMin: z.number().optional().describe("Min company founded year"),
      foundedYearMax: z.number().optional().describe("Max company founded year"),
      naicsCodes: z.array(z.string()).optional().describe("NAICS industry codes"),
      sicCodes: z.array(z.string()).optional().describe("SIC industry codes"),
      yearsExperienceMin: z.number().optional().describe("Min years of experience"),
      yearsExperienceMax: z.number().optional().describe("Max years of experience"),
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
        companyKeywords: params.companyKeywords,
        fundingStages: params.fundingStages,
        fundingTotalMin: params.fundingTotalMin,
        fundingTotalMax: params.fundingTotalMax,
        departments: params.departments,
        revenueMin: params.revenueMin,
        revenueMax: params.revenueMax,
        technologies: params.technologies,
        companyType: params.companyType,
        foundedYearMin: params.foundedYearMin,
        foundedYearMax: params.foundedYearMax,
        naicsCodes: params.naicsCodes,
        sicCodes: params.sicCodes,
        yearsExperienceMin: params.yearsExperienceMin,
        yearsExperienceMax: params.yearsExperienceMax,
      };
      const result = await prospeoSearchAdapter.search(
        filters,
        params.limit,
        params.pageToken,
      );
      await incrementDailySpend("prospeo-search", result.costUsd);
      const { staged, runId } = await stageDiscoveredPeople({
        people: result.people,
        discoverySource: "prospeo",
        workspaceSlug: params.workspaceSlug,
        searchQuery: JSON.stringify(filters),
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
      "AI Ark B2B people search. 15+ filters including title, seniority, industry, location, company size, revenue, funding, technologies, company type, NAICS codes, and company keywords. Different database to Prospeo — use BOTH for maximum coverage. COSTS CREDITS (~$0.003/call). Returns identity data only (no emails).",
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
      companyDomains: z.array(z.string()).optional().describe("Target specific company domains"),
      companyKeywords: z.array(z.string()).optional().describe("Company keywords (e.g., 'fit-out', 'interior design') — uses /v1/companies workaround"),
      revenueMin: z.string().optional().describe("Min revenue: '<100K', '1M', '10M', '100M', '1B', '10B+'"),
      revenueMax: z.string().optional().describe("Max revenue: '<100K', '1M', '10M', '100M', '1B', '10B+'"),
      fundingStages: z.array(z.string()).optional().describe("Funding stages: 'SEED', 'SERIES_A', 'SERIES_B', 'SERIES_C', 'VENTURE_ROUND', 'ANGEL', 'IPO'"),
      fundingTotalMin: z.string().optional().describe("Min total funding: '1M', '5M', '50M'"),
      fundingTotalMax: z.string().optional().describe("Max total funding: '1M', '5M', '50M'"),
      technologies: z.array(z.string()).optional().describe("Technologies used by company (e.g., ['Salesforce', 'AWS', 'React'])"),
      companyType: z.array(z.string()).optional().describe("Company types: 'PRIVATELY_HELD', 'PUBLIC_COMPANY', 'NON_PROFIT', 'SELF_OWNED', 'PARTNERSHIP'"),
      foundedYearMin: z.number().optional().describe("Min company founded year"),
      foundedYearMax: z.number().optional().describe("Max company founded year"),
      naicsCodes: z.array(z.string()).optional().describe("NAICS industry codes"),
      departments: z.array(z.string()).optional().describe("Person departments (may have limited support)"),
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
        companyDomains: params.companyDomains,
        companyKeywords: params.companyKeywords,
        revenueMin: params.revenueMin,
        revenueMax: params.revenueMax,
        fundingStages: params.fundingStages,
        fundingTotalMin: params.fundingTotalMin,
        fundingTotalMax: params.fundingTotalMax,
        technologies: params.technologies,
        companyType: params.companyType,
        foundedYearMin: params.foundedYearMin,
        foundedYearMax: params.foundedYearMax,
        naicsCodes: params.naicsCodes,
        departments: params.departments,
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

  searchLeadsFinder: tool({
    description:
      "Search Apify Leads Finder for people matching ICP filters. 300M+ B2B database, returns VERIFIED EMAILS + phones + LinkedIn in one step (skips enrichment). Supports: job titles, seniority, location, company size, industry, keywords, domains, revenue, funding, departments. ~$2/1K leads. No pagination — returns all results in one batch. Requires Apify paid plan.",
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
          "Seniority levels: 'c_suite', 'vp', 'director', 'manager', 'senior', 'founder', 'owner', 'partner', 'head', 'entry', 'trainee'",
        ),
      industries: z
        .array(z.string())
        .optional()
        .describe("Company industries (e.g., ['Software', 'Fintech'])"),
      locations: z
        .array(z.string())
        .optional()
        .describe("Person locations (e.g., ['London, United Kingdom'])"),
      companySizes: z
        .array(z.string())
        .optional()
        .describe(
          "Company size ranges: '1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5001-10000', '10001+'",
        ),
      companyDomains: z
        .array(z.string())
        .optional()
        .describe("Target specific company domains"),
      companyKeywords: z
        .array(z.string())
        .optional()
        .describe("Company keywords (e.g., 'fit-out', 'interior design')"),
      departments: z
        .array(z.string())
        .optional()
        .describe("Functional departments (e.g., 'engineering', 'sales')"),
      revenueMin: z
        .string()
        .optional()
        .describe("Min revenue: '100K', '500K', '1M', '5M', '10M', '25M', '50M', '100M', '500M', '1B', '5B', '10B'"),
      revenueMax: z
        .string()
        .optional()
        .describe("Max revenue: '100K', '500K', '1M', '5M', '10M', '25M', '50M', '100M', '500M', '1B', '5B', '10B'"),
      fundingStages: z
        .array(z.string())
        .optional()
        .describe("Funding stages (e.g., ['seed', 'series_a', 'series_b'])"),
      limit: z
        .number()
        .default(25)
        .describe("Number of leads to fetch (no pagination — all returned in one batch)"),
    }),
    execute: async (params) => {
      const filters = {
        jobTitles: params.jobTitles,
        seniority: params.seniority,
        industries: params.industries,
        locations: params.locations,
        companySizes: params.companySizes,
        companyDomains: params.companyDomains,
        companyKeywords: params.companyKeywords,
        departments: params.departments,
        revenueMin: params.revenueMin,
        revenueMax: params.revenueMax,
        fundingStages: params.fundingStages,
      };
      const result = await apifyLeadsFinderAdapter.search(
        filters,
        params.limit,
      );
      await incrementDailySpend("apify-leads-finder", result.costUsd);
      const { staged, runId } = await stageDiscoveredPeople({
        people: result.people,
        discoverySource: "apify-leads-finder",
        workspaceSlug: params.workspaceSlug,
        searchQuery: JSON.stringify(filters),
      });
      return {
        source: "apify-leads-finder",
        found: result.people.length,
        staged,
        runId,
        totalAvailable: result.totalAvailable,
        hasMore: result.hasMore,
        costUsd: result.costUsd,
        people: result.people.slice(0, 10).map((p) => ({
          name: [p.firstName, p.lastName].filter(Boolean).join(" "),
          title: p.jobTitle,
          company: p.company,
          location: p.location,
          email: p.email,
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

  checkGoogleAds: tool({
    description:
      "Check which companies are actively running Google Ads. Pass a list of domains to see which ones have ads, how many, what formats, and date ranges. Useful for qualifying leads — companies running ads have budget for paid media services. Costs ~$0.005 per domain checked (Apify compute). Requires Apify paid plan.",
    inputSchema: z.object({
      domains: z
        .array(z.string())
        .describe("List of domains to check for Google Ads (e.g., ['acme.com', 'example.co.uk'])"),
      region: z
        .string()
        .optional()
        .describe("ISO country code filter (e.g. 'GB', 'US')"),
    }),
    execute: async ({ domains, region }) => {
      const results = await checkDomainsForGoogleAds(domains, { region });
      return results;
    },
  }),

  searchGoogleAdsAdvertisers: tool({
    description:
      "Search Google Ads Transparency Center by keyword to find companies advertising in a space. Returns advertiser names, domains, ad counts, and formats. Useful for finding potential clients who are already spending on Google Ads. Costs ~$0.005 per search (Apify compute). Requires Apify paid plan.",
    inputSchema: z.object({
      query: z
        .string()
        .describe("Keyword or advertiser name to search (e.g., 'recruitment agency London')"),
      region: z
        .string()
        .optional()
        .describe("ISO country code filter (e.g. 'GB', 'US')"),
    }),
    execute: async ({ query, region }) => {
      const results = await searchGoogleAdsAdvertisers(query, { region });
      return results;
    },
  }),

  checkTechStack: tool({
    description:
      "Check what technologies a list of domains use via BuiltWith. Returns full tech stack per domain. Optionally filter for specific technologies (e.g. Shopify, WooCommerce, HubSpot). Useful for tech qualification — e.g. finding Shopify stores for BlankTag, checking if prospects use a specific CMS/framework/analytics tool. Costs ~$0.005 per domain checked (Apify compute). Requires Apify paid plan.",
    inputSchema: z.object({
      domains: z
        .array(z.string())
        .describe("List of domains to check (e.g., ['acme.com', 'example.co.uk'])"),
      filterTechnologies: z
        .array(z.string())
        .optional()
        .describe("Optional list of technology names to match against (e.g., ['Shopify', 'WooCommerce', 'Magento']). Case-insensitive."),
    }),
    execute: async ({ domains, filterTechnologies }) => {
      const results = await checkTechStack(domains, filterTechnologies);
      await incrementDailySpend("builtwith", results.length * 0.005);
      return {
        source: "builtwith",
        domainsChecked: domains.length,
        costUsd: results.length * 0.005,
        results: results.map((r) => ({
          domain: r.domain,
          techCount: r.techCount,
          hasMatch: r.hasMatch,
          matchedTechnologies: r.matchedTechnologies,
          technologies: r.technologies.slice(0, 20).map((t) => ({
            name: t.name,
            category: t.category,
          })),
        })),
      };
    },
  }),

  searchGoogleMaps: tool({
    description:
      "Search Google Maps for local/SMB businesses by keyword and location. Returns business name, address, phone, website, domain, rating, reviews, categories. Great for finding prospects in specific geographies — e.g. umbrella companies in London for 1210 Solutions, restaurants in Manchester, contractors in Birmingham. Company-level data (no person data). Costs ~$0.005 per search (Apify compute). Requires Apify paid plan.",
    inputSchema: z.object({
      query: z
        .string()
        .describe("Business type or keyword to search (e.g., 'umbrella companies', 'Italian restaurant', 'recruitment agency')"),
      location: z
        .string()
        .optional()
        .describe("Location to search in (e.g., 'London, UK', 'New York, NY', 'Manchester')"),
      maxResults: z
        .number()
        .optional()
        .default(20)
        .describe("Maximum number of results to return (default: 20, max: 100)"),
      countryCode: z
        .string()
        .optional()
        .describe("ISO country code to restrict results (e.g., 'gb', 'us')"),
    }),
    execute: async ({ query, location, maxResults, countryCode }) => {
      const results = await searchGoogleMaps(query, location, {
        maxResults,
        countryCode,
      });
      await incrementDailySpend("google-maps", 0.005);
      return {
        source: "google-maps",
        found: results.length,
        costUsd: 0.005,
        places: results.slice(0, 20).map((r) => ({
          name: r.name,
          address: r.address,
          phone: r.phone,
          website: r.website,
          domain: r.domain,
          rating: r.rating,
          reviewsCount: r.reviewsCount,
          category: r.category,
          categories: r.categories,
          city: r.city,
          countryCode: r.countryCode,
          mapsUrl: r.mapsUrl,
        })),
      };
    },
  }),

  searchEcommerceStores: tool({
    description:
      "Search a 14M+ ecommerce store database by platform, category, country, and traffic. Returns store domain, name, platform (Shopify/WooCommerce/BigCommerce/etc.), email, phone, monthly visits, technologies/apps, categories, social links, employee count. Primary tool for ecommerce/DTC brand discovery — e.g. finding Shopify stores for BlankTag's paid media pipeline. Company-level data (no person data). Costs ~$0.004 per lead (pay-per-result). Requires Apify paid plan.",
    inputSchema: z.object({
      platform: z
        .string()
        .optional()
        .describe("Ecommerce platform filter (e.g., 'shopify', 'woocommerce', 'bigcommerce', 'magento')"),
      category: z
        .string()
        .optional()
        .describe("Store category filter (e.g., 'Apparel', 'Electronics', 'Health & Beauty', 'Home & Garden')"),
      country: z
        .string()
        .optional()
        .describe("Country filter (e.g., 'US', 'GB', 'United States')"),
      minMonthlyVisits: z
        .number()
        .optional()
        .describe("Minimum monthly website visits (e.g., 10000 for established stores)"),
      maxResults: z
        .number()
        .optional()
        .default(50)
        .describe("Maximum number of results to return (default: 50, max: 200)"),
      keywords: z
        .array(z.string())
        .optional()
        .describe("Keywords to filter stores by (matched against name/category/technologies)"),
    }),
    execute: async ({ platform, category, country, minMonthlyVisits, maxResults, keywords }) => {
      const results = await searchEcommerceStores({
        platform,
        category,
        country,
        minMonthlyVisits,
        maxResults,
        keywords,
      });
      const costUsd = results.length * 0.004;
      await incrementDailySpend("ecommerce-stores", costUsd);
      return {
        source: "ecommerce-stores",
        found: results.length,
        costUsd,
        stores: results.map((r) => ({
          domain: r.domain,
          storeName: r.storeName,
          platform: r.platform,
          email: r.email,
          phone: r.phone,
          country: r.country,
          city: r.city,
          monthlyVisits: r.monthlyVisits,
          technologies: r.technologies,
          categories: r.categories,
          socialLinks: r.socialLinks,
          employeeCount: r.employeeCount,
        })),
      };
    },
  }),
};

// --- System Prompt ---

const LEADS_SYSTEM_PROMPT = `You are the Outsignal Leads Agent — a specialist for managing the lead pipeline through natural language.

${loadRules("leads-rules.md")}`;

// --- Agent Configuration ---

const leadsConfig: AgentConfig = {
  name: "leads",
  model: NOVA_MODEL,
  systemPrompt: LEADS_SYSTEM_PROMPT + USER_INPUT_GUARD,
  tools: leadsTools,
  maxSteps: 15,
  outputSchema: leadsOutputSchema,
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
    parts.push(`Context: ${sanitizePromptInput(input.conversationContext)}`);
  }
  parts.push("", `Task: ${sanitizePromptInput(input.task)}`);

  return parts.join("\n");
}

