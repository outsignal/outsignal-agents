import { tool } from "ai";
import { z } from "zod";
import * as campaignOperations from "@/lib/campaigns/operations";
import * as leadsOperations from "@/lib/leads/operations";
import { runAgent } from "./runner";
import type { AgentConfig, CampaignInput, CampaignOutput } from "./types";

// --- Campaign Agent Tools ---

const campaignTools = {
  createCampaign: tool({
    description:
      "Create a new campaign for a workspace. Always confirm campaign details (name, list, channels) with the admin before calling this. If the admin mentions a list by name, use findTargetList first to resolve the list ID.",
    inputSchema: z.object({
      workspaceSlug: z.string().describe("The workspace slug"),
      name: z.string().describe("Campaign name"),
      description: z.string().optional().describe("Optional campaign description"),
      channels: z
        .array(z.enum(["email", "linkedin"]))
        .optional()
        .describe("Channels: ['email'], ['linkedin'], or ['email', 'linkedin']. Defaults to ['email']."),
      targetListId: z
        .string()
        .optional()
        .describe("ID of the target list to link (resolve name to ID with findTargetList first)"),
    }),
    execute: async ({ workspaceSlug, name, description, channels, targetListId }) => {
      return campaignOperations.createCampaign({
        workspaceSlug,
        name,
        description,
        channels,
        targetListId,
      });
    },
  }),

  getCampaign: tool({
    description: "Get full details of a campaign by ID, including sequences and target list info.",
    inputSchema: z.object({
      campaignId: z.string().describe("The campaign ID"),
    }),
    execute: async ({ campaignId }) => {
      const campaign = await campaignOperations.getCampaign(campaignId);
      if (!campaign) {
        return { error: `Campaign not found: '${campaignId}'` };
      }
      return campaign;
    },
  }),

  listCampaigns: tool({
    description: "List all campaigns for a workspace, ordered by most recently updated.",
    inputSchema: z.object({
      workspaceSlug: z.string().describe("The workspace slug"),
    }),
    execute: async ({ workspaceSlug }) => {
      return campaignOperations.listCampaigns(workspaceSlug);
    },
  }),

  findTargetList: tool({
    description:
      "Find target lists for a workspace. Use this to resolve a list name mentioned by the admin into a list ID before creating a campaign. Optionally filter by name.",
    inputSchema: z.object({
      workspaceSlug: z.string().describe("The workspace slug"),
      nameFilter: z
        .string()
        .optional()
        .describe("Filter lists by name (partial match, case-insensitive)"),
    }),
    execute: async ({ workspaceSlug, nameFilter }) => {
      const result = await leadsOperations.getLists({
        workspaceSlug,
        query: nameFilter,
      });
      return result;
    },
  }),

  updateCampaignStatus: tool({
    description:
      "Transition a campaign to a new status. Valid transitions: draft -> internal_review, internal_review -> pending_approval | draft, pending_approval -> approved | internal_review, approved -> deployed, deployed -> active, active -> paused | completed, paused -> active | completed. Any status can transition to 'completed'.",
    inputSchema: z.object({
      campaignId: z.string().describe("The campaign ID"),
      newStatus: z
        .string()
        .describe(
          "The new status: draft, internal_review, pending_approval, approved, deployed, active, paused, completed",
        ),
    }),
    execute: async ({ campaignId, newStatus }) => {
      return campaignOperations.updateCampaignStatus(campaignId, newStatus);
    },
  }),

  publishForReview: tool({
    description:
      "Publish a campaign for client review. Transitions status to 'pending_approval'. Requires: campaign in 'internal_review' status, at least one sequence (email or LinkedIn), and a target list linked. Always confirm with the admin before publishing. After publishing, inform the admin that client notification (email + portal link) will fire in Phase 9.",
    inputSchema: z.object({
      campaignId: z.string().describe("The campaign ID to publish for review"),
    }),
    execute: async ({ campaignId }) => {
      return campaignOperations.publishForReview(campaignId);
    },
  }),
};

// --- System Prompt ---

const CAMPAIGN_SYSTEM_PROMPT = `You are the Outsignal Campaign Agent — responsible for managing the campaign lifecycle for Outsignal clients.

## Capabilities
You can: create campaigns, list campaigns, get campaign details, link target lists, update campaign status, and publish campaigns for client review.

## Interaction Rules
- **Always confirm before creating**: Before calling createCampaign, show the admin a preview of the campaign details (name, channels, target list if known) and ask for confirmation.
- **List name resolution**: If the admin says "use the fintech CTO list", call findTargetList first to get the list ID, then include it when creating the campaign.
- **Status transitions**: Use updateCampaignStatus for internal status changes. Use publishForReview specifically when the admin says "push for approval" or "publish for review".
- **Content generation is separate**: You do NOT generate email or LinkedIn copy. The orchestrator delegates that to the Writer Agent. Inform the admin of this boundary if they ask you to write content.
- **Campaign context**: "This campaign" always refers to the most recently mentioned campaign in the conversation.

## Campaign Workflow
1. Admin: "Create a campaign for Rise using the fintech CTO list"
   → findTargetList (get list ID) → confirm details → createCampaign
2. Admin: "Write email sequence for this campaign"
   → Inform admin this will be handled by the Writer Agent (orchestrator will delegate)
3. Admin: "Push this campaign for approval"
   → Confirm with admin → publishForReview (transitions to pending_approval)
   → Note: Client notification (email + portal link) will be implemented in Phase 9

## After Publishing
When a campaign is published for review, inform the admin:
- Campaign is now in 'pending_approval' status
- Client notification (email + Slack with portal link) is not yet active — it will be implemented in Phase 9

## Voice
Professional, clear, action-oriented. Brief confirmations after each action.`;

// --- Agent Configuration ---

const campaignConfig: AgentConfig = {
  name: "campaign",
  model: "claude-sonnet-4-20250514",
  systemPrompt: CAMPAIGN_SYSTEM_PROMPT,
  tools: campaignTools,
  maxSteps: 8,
};

// --- Public API ---

/**
 * Run the Campaign Agent to manage campaign lifecycle via natural language.
 *
 * Can be called from:
 * - Dashboard chat: via orchestrator's delegateToCampaign tool
 * - CLI scripts: `runCampaignAgent({ workspaceSlug: "rise", task: "create a campaign" })`
 * - API routes: /api/agents/campaign
 *
 * The runAgent() call automatically creates an AgentRun audit record.
 */
export async function runCampaignAgent(input: CampaignInput): Promise<CampaignOutput> {
  const userMessage = buildCampaignMessage(input);

  const result = await runAgent<CampaignOutput>(campaignConfig, userMessage, {
    triggeredBy: "orchestrator",
    workspaceSlug: input.workspaceSlug,
  });

  return result.output;
}

function buildCampaignMessage(input: CampaignInput): string {
  const parts: string[] = [];

  if (input.workspaceSlug) {
    parts.push(`Workspace: ${input.workspaceSlug}`);
  }
  if (input.campaignId) {
    parts.push(`Campaign ID: ${input.campaignId}`);
  }
  if (input.campaignName) {
    parts.push(`Campaign Name: ${input.campaignName}`);
  }
  parts.push("", `Task: ${input.task}`);

  return parts.join("\n");
}

export { campaignConfig, campaignTools };
