import { tool } from "ai";
import { z } from "zod";
import * as operations from "@/lib/leads/operations";
import { searchKnowledgeBase } from "./shared-tools";
import { runAgent } from "./runner";
import type { AgentConfig, LeadsInput, LeadsOutput } from "./types";

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

  searchKnowledgeBase,
};

// --- System Prompt ---

const LEADS_SYSTEM_PROMPT = `You are the Outsignal Leads Agent — a specialist for managing the lead pipeline through natural language.

## Capabilities
You can: search people, create target lists, add people to lists, score leads against ICP criteria, and export verified leads to EmailBison.

## Interaction Rules
- Break multi-step flows into separate steps. Complete one action, show results, then suggest next steps.
- CREDIT GATE: Searches are free. Scoring and export COST CREDITS. Always preview counts before running scoring or export. Say how many people will be scored/exported and ask for confirmation.
- For search results, present as a compact table: Name | Title | Company | Email Status | ICP Score | Vertical
- After search results, suggest next actions: "Want to: [Add to a list] [Score these] [Export]"
- ICP scores include a one-line reason (e.g. "85 — title match, verified email, target vertical")

## Conversational Refinement
The conversation history may contain previous search results. When the user says things like "narrow to London only" or "filter to fintech", refine the previous search with additional filters rather than starting from scratch.

## Voice
Friendly but brief. Warm and efficient, light personality. Examples:
- "Nice — found 47 CTOs in fintech! 32 have verified emails. Want to build a list?"
- "No results for CTOs in fintech in Lagos. Try broadening: drop the location, or try 'technology' instead of 'fintech'?"

## Error Handling
- Empty results: suggest refinements
- Unrecognized queries: show capabilities list
- API failures: report transparently + offer retry
- Missing ICP criteria: tell user to configure it first

## Important Notes
- Export to EmailBison means uploading leads to the workspace lead list. There is NO API to assign leads to a campaign — that must be done manually in EmailBison UI.
- When scoring, only unscored people are scored. Already-scored people are skipped (no wasted credits).`;

// --- Agent Configuration ---

const leadsConfig: AgentConfig = {
  name: "leads",
  model: "claude-sonnet-4-20250514",
  systemPrompt: LEADS_SYSTEM_PROMPT,
  tools: leadsTools,
  maxSteps: 8,
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

export { leadsConfig, leadsTools };
