import { tool } from "ai";
import { z } from "zod";
import * as campaignOperations from "@/lib/campaigns/operations";
import * as leadsOperations from "@/lib/leads/operations";
import { runAgent } from "./runner";
import { campaignOutputSchema, NOVA_MODEL } from "./types";
import type { AgentConfig, CampaignInput, CampaignOutput } from "./types";
import { sanitizePromptInput, USER_INPUT_GUARD } from "./utils";
import { loadRules } from "./load-rules";
import { appendToMemory } from "./memory";
import { prisma } from "@/lib/db";
import { extractIcpCriteria } from "@/lib/icp/extract-criteria";
import { hasModule, getWorkspaceQuotaUsage } from "@/lib/workspaces/quota";
import { validateSignalCampaignContent } from "@/lib/pipeline/signal-content-validation";
import {
  claimSignalCampaignActivation,
  finalizeSignalCampaignActivation,
  rollbackSignalCampaignActivationClaim,
} from "@/lib/campaigns/signal-activation";

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
      // Package enforcement (CFG-02): check enabled modules before creating campaign
      const ws = await prisma.workspace.findUnique({ where: { slug: workspaceSlug } });
      if (!ws) return { error: `Workspace '${workspaceSlug}' not found` };

      const requestedChannels = channels ?? ["email"];

      // Check if any requested channel requires signal modules
      // Note: signal campaign detection will be refined in Phase 19 when signal campaigns exist.
      // For now, block if workspace lacks the base channel modules.
      for (const channel of requestedChannels) {
        if (!hasModule(ws.enabledModules, channel as "email" | "linkedin" | "email-signals" | "linkedin-signals")) {
          return {
            error: `Workspace '${workspaceSlug}' does not have the '${channel}' module enabled. Current modules: ${ws.enabledModules}. Use updateWorkspacePackage to enable it first.`,
          };
        }
      }

      // Campaign allowance soft warning (CFG-03)
      const usage = await getWorkspaceQuotaUsage(workspaceSlug);
      if (usage.campaignsUsed >= ws.monthlyCampaignAllowance) {
        // Soft limit — return warning, don't block
        // The orchestrator should relay this warning and ask admin to confirm
        return {
          warning: `Campaign allowance reached: ${usage.campaignsUsed}/${ws.monthlyCampaignAllowance} campaigns this billing period. Proceeding will exceed the allowance. Confirm with the admin before creating.`,
          campaignsUsed: usage.campaignsUsed,
          allowance: ws.monthlyCampaignAllowance,
          canProceedWithConfirmation: true,
        };
      }

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

  createSignalCampaign: tool({
    description:
      "Create a signal campaign that automatically processes leads when signals fire. Admin specifies ICP criteria (natural language), signal types to monitor, channels, and optional daily lead cap. The campaign is created as a draft — admin must generate content and activate before it goes live. Use this instead of createCampaign when the admin wants a signal-triggered evergreen campaign.",
    inputSchema: z.object({
      workspaceSlug: z.string().describe("The workspace slug"),
      name: z.string().describe("Campaign name (e.g. 'Rise Fintech Signals')"),
      icpDescription: z
        .string()
        .describe(
          "Natural language ICP description (e.g. 'SaaS companies, 50-200 employees in UK, targeting CEOs and CTOs')",
        ),
      signalTypes: z
        .array(
          z.enum([
            "job_change",
            "funding",
            "hiring_spike",
            "tech_adoption",
            "news",
            "social_mention",
          ]),
        )
        .describe("Signal types to monitor"),
      channels: z
        .array(z.enum(["email", "linkedin"]))
        .optional()
        .describe(
          "Channels: ['email'], ['linkedin'], or ['email', 'linkedin']. Defaults to ['email'].",
        ),
      dailyLeadCap: z
        .number()
        .optional()
        .describe("Max leads to add per day (default: 20)"),
      icpScoreThreshold: z
        .number()
        .optional()
        .describe("Min ICP score for lead inclusion (default: 70)"),
    }),
    execute: async ({
      workspaceSlug,
      name,
      icpDescription,
      signalTypes,
      channels,
      dailyLeadCap,
      icpScoreThreshold,
    }) => {
      // 1. Validate workspace exists and has signal modules enabled
      const ws = await prisma.workspace.findUnique({ where: { slug: workspaceSlug } });
      if (!ws) return { error: `Workspace '${workspaceSlug}' not found` };

      const requestedChannels = channels ?? ["email"];
      for (const channel of requestedChannels) {
        const signalModule = `${channel}-signals` as "email-signals" | "linkedin-signals";
        if (!hasModule(ws.enabledModules, signalModule)) {
          return {
            error: `Workspace '${workspaceSlug}' does not have the '${signalModule}' module enabled. Current modules: ${ws.enabledModules}. Use updateWorkspacePackage to enable it first.`,
          };
        }
      }

      // 2. Validate signal types against workspace config
      const wsEnabledTypes: string[] = JSON.parse(ws.signalEnabledTypes || "[]");
      const invalidTypes = signalTypes.filter((t) => !wsEnabledTypes.includes(t));
      if (invalidTypes.length > 0) {
        return {
          error: `Signal types not enabled for workspace '${workspaceSlug}': ${invalidTypes.join(", ")}. Enabled types: ${wsEnabledTypes.join(", ")}. Update workspace signal config first.`,
        };
      }

      // 3. Extract structured ICP criteria from natural language
      const icpCriteria = await extractIcpCriteria(icpDescription);

      // 4. Create the signal campaign via operations
      const campaign = await campaignOperations.createCampaign({
        workspaceSlug,
        name,
        channels: requestedChannels,
        type: "signal",
        icpCriteria: JSON.stringify(icpCriteria),
        signalTypes: JSON.stringify(signalTypes),
        dailyLeadCap: dailyLeadCap ?? 20,
        icpScoreThreshold: icpScoreThreshold ?? 70,
      });

      return {
        campaign,
        icpCriteria, // Show extracted criteria for admin review
        note: "Campaign created as draft. You need to generate an email/LinkedIn sequence and then activate it before signals will be processed. Want me to generate content for this campaign?",
      };
    },
  }),

  activateSignalCampaign: tool({
    description:
      "Activate a signal campaign (transition from draft to active). Requires the campaign to have at least one content sequence (emailSequence or linkedinSequence) set. For email campaigns, this pre-provisions an EmailBison campaign. Once active, the signal pipeline will automatically discover, score, and deploy leads when matching signals fire.",
    inputSchema: z.object({
      campaignId: z.string().describe("The campaign ID to activate"),
    }),
    execute: async ({ campaignId }) => {
      const campaign = await campaignOperations.getCampaign(campaignId);
      if (!campaign) return { error: `Campaign not found: '${campaignId}'` };
      if (campaign.type !== "signal")
        return {
          error: `Campaign '${campaignId}' is not a signal campaign (type: ${campaign.type})`,
        };
      if (campaign.status !== "draft")
        return {
          error: `Campaign must be in 'draft' status to activate (current: ${campaign.status})`,
        };

      // Check content exists
      const hasEmail = campaign.emailSequence && campaign.emailSequence.length > 0;
      const hasLinkedIn =
        campaign.linkedinSequence && campaign.linkedinSequence.length > 0;
      if (!hasEmail && !hasLinkedIn) {
        return {
          error: "Cannot activate signal campaign without content. Generate an email or LinkedIn sequence first.",
        };
      }

      const contentValidation = validateSignalCampaignContent({
        channels: campaign.channels ?? ["email"],
        copyStrategy: campaign.copyStrategy,
        emailSequence: (campaign.emailSequence as Array<{
          position?: number;
          subjectLine?: string;
          subjectVariantB?: string;
          body?: string;
        }> | null) ?? null,
        linkedinSequence: (campaign.linkedinSequence as Array<{
          position?: number;
          subjectLine?: string;
          subjectVariantB?: string;
          body?: string;
        }> | null) ?? null,
      });

      if (contentValidation.hardViolations.length > 0) {
        return {
          error: "Signal campaign content validation failed",
          violations: contentValidation.hardViolations,
          warnings: contentValidation.softWarnings,
        };
      }

      const activationClaimedAt = new Date();
      const claimed = await claimSignalCampaignActivation(
        campaignId,
        activationClaimedAt,
      );
      if (!claimed) {
        const latest = await campaignOperations.getCampaign(campaignId);
        if (latest?.status === "active") {
          return {
            campaign: latest,
            note: `Signal campaign "${latest.name}" was already activated by another request.`,
          };
        }
        return {
          error:
            `Signal campaign activation is already in progress or the campaign is no longer in draft state ` +
            `(current: ${latest?.status ?? "unknown"}). Reload and retry.`,
        };
      }

      let createdTargetListId: string | null = null;
      let signalEmailBisonCampaignId: number | null = null;
      let orphanSignalEbCampaignId: number | null = null;
      let cleanupApiToken: string | null = null;

      try {
        // Check target list exists — create one if needed
        if (!campaign.targetListId) {
          const list = await prisma.targetList.create({
            data: {
              name: `${campaign.name} — Signal Leads`,
              workspaceSlug: campaign.workspaceSlug,
              description: `Auto-created target list for signal campaign "${campaign.name}"`,
            },
          });
          createdTargetListId = list.id;
        }

        // Pre-provision EmailBison campaign for email channel
        if (campaign.channels.includes("email") && hasEmail) {
          const ws = await prisma.workspace.findUnique({
            where: { slug: campaign.workspaceSlug },
            select: { apiToken: true },
          });
          if (!ws?.apiToken) {
            throw new Error(
              `Workspace '${campaign.workspaceSlug}' has no API token configured. Cannot pre-provision EmailBison campaign.`,
            );
          }

          cleanupApiToken = ws.apiToken;

          // Import and use EmailBisonClient to create EB campaign + sequence steps
          const { EmailBisonClient } = await import("@/lib/emailbison/client");
          const ebClient = new EmailBisonClient(ws.apiToken);
          const ebCampaign = await ebClient.createCampaign({ name: campaign.name });
          signalEmailBisonCampaignId = ebCampaign.id;
          orphanSignalEbCampaignId = ebCampaign.id;

          // Create sequence steps via the v1.1 batch endpoint (BL-074 follow-through).
          // The deprecated singular `createSequenceStep` posted a flat body to the
          // v1 path and hit EB 422 "title/sequence_steps required". We now send
          // one batched POST with the EB-required `{title, sequence_steps:[...]}`
          // envelope — title reuses the campaign name already passed to
          // createCampaign above.
          //
          // BL-093 monty-qa F2 (2026-04-16): use the shared
          // `buildSequenceStepsForEB` helper so this signal-campaign path
          // applies the same `thread_reply` rules as `EmailAdapter.deploy`
          // Step 3.
          const { buildSequenceStepsForEB } = await import(
            "@/lib/channels/email-adapter"
          );
          const emailSeq = campaign.emailSequence as Array<{
            position: number;
            subjectLine?: string;
            body?: string;
            bodyText?: string;
            delayDays?: number;
          }>;
          await ebClient.createSequenceSteps(
            ebCampaign.id,
            campaign.name,
            buildSequenceStepsForEB(
              emailSeq,
              `Signal campaign ${campaignId} ('${campaign.name}')`,
            ),
          );
        }

        const finalized = await finalizeSignalCampaignActivation({
          campaignId,
          claimedAt: activationClaimedAt,
          targetListId: createdTargetListId ?? campaign.targetListId ?? null,
          signalEmailBisonCampaignId,
        });

        if (!finalized) {
          throw new Error(
            `Signal campaign ${campaignId} changed while activation was running. Reload and retry.`,
          );
        }

        orphanSignalEbCampaignId = null;
        createdTargetListId = null;

        const updated = await campaignOperations.getCampaign(campaignId);
        return {
          campaign: updated,
          ...(contentValidation.softWarnings.length > 0
            ? { warnings: contentValidation.softWarnings }
            : {}),
          note: `Signal campaign "${campaign.name}" is now active. The pipeline will process matching signals every 6 hours.${signalEmailBisonCampaignId ? ` EmailBison campaign #${signalEmailBisonCampaignId} pre-provisioned.` : ""}`,
        };
      } catch (error) {
        if (orphanSignalEbCampaignId && cleanupApiToken) {
          try {
            const { EmailBisonClient } = await import("@/lib/emailbison/client");
            const cleanupClient = new EmailBisonClient(cleanupApiToken);
            await cleanupClient.deleteCampaign(orphanSignalEbCampaignId);
            console.warn(
              `[campaign-agent] Deleted orphan signal EB campaign ${orphanSignalEbCampaignId} after activation failure for ${campaignId}`,
            );
          } catch (cleanupError) {
            console.warn(
              `[campaign-agent] Failed to delete orphan signal EB campaign ${orphanSignalEbCampaignId} for ${campaignId}: ${
                cleanupError instanceof Error
                  ? cleanupError.message
                  : String(cleanupError)
              }`,
            );
          }
        }

        if (createdTargetListId) {
          try {
            await prisma.targetList.delete({ where: { id: createdTargetListId } });
          } catch (cleanupError) {
            console.warn(
              `[campaign-agent] Failed to delete signal activation target list ${createdTargetListId} for ${campaignId}: ${
                cleanupError instanceof Error
                  ? cleanupError.message
                  : String(cleanupError)
              }`,
            );
          }
        }

        await rollbackSignalCampaignActivationClaim(
          campaignId,
          activationClaimedAt,
        );

        return {
          error:
            error instanceof Error
              ? error.message
              : `Failed to activate signal campaign '${campaignId}'`,
        };
      }
    },
  }),

  pauseResumeSignalCampaign: tool({
    description:
      "Pause or resume a signal campaign. Pausing stops new signal matching but allows in-flight leads to complete processing (graceful drain). Resuming immediately starts matching new signals again.",
    inputSchema: z.object({
      campaignId: z.string().describe("The campaign ID"),
      action: z.enum(["pause", "resume"]).describe("Action to take"),
    }),
    execute: async ({ campaignId, action }) => {
      const campaign = await campaignOperations.getCampaign(campaignId);
      if (!campaign) return { error: `Campaign not found: '${campaignId}'` };
      if (campaign.type !== "signal")
        return { error: `Campaign '${campaignId}' is not a signal campaign` };

      const newStatus = action === "pause" ? "paused" : "active";
      const updated = await campaignOperations.updateCampaignStatus(
        campaignId,
        newStatus,
      );
      return {
        campaign: updated,
        note:
          action === "pause"
            ? `Signal campaign "${campaign.name}" paused. In-flight leads will complete processing. No new signals will be matched.`
            : `Signal campaign "${campaign.name}" resumed. New signals will be matched starting from the next processing cycle.`,
      };
    },
  }),
};

// --- System Prompt ---

const CAMPAIGN_SYSTEM_PROMPT = `You are the Outsignal Campaign Agent — responsible for managing the campaign lifecycle for Outsignal clients.

${loadRules("campaign-rules.md")}`;

// --- Agent Configuration ---

const campaignConfig: AgentConfig = {
  name: "campaign",
  model: NOVA_MODEL,
  systemPrompt: CAMPAIGN_SYSTEM_PROMPT + USER_INPUT_GUARD,
  tools: campaignTools,
  maxSteps: 10,
  outputSchema: campaignOutputSchema,
  onComplete: async (result, options) => {
    const slug = options?.workspaceSlug;
    if (!slug) return;

    const output = result.output as CampaignOutput;
    if (output.action === "unknown" || output.action === "list" || output.action === "get") return;

    await appendToMemory(
      slug,
      "campaigns.md",
      `${output.action}: ${output.summary}`,
    );
  },
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
    parts.push(`Campaign Name: ${sanitizePromptInput(input.campaignName)}`);
  }
  if (input.feedback) {
    parts.push(`\nFeedback:\n${sanitizePromptInput(input.feedback)}`);
  }
  parts.push("", `Task: ${sanitizePromptInput(input.task)}`);

  return parts.join("\n");
}

export { campaignConfig, campaignTools };
