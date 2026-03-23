import { tool } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getClientForWorkspace } from "@/lib/workspaces";
import { searchKnowledgeBase } from "./shared-tools";
import { runAgent } from "./runner";
import { writerOutputSchema } from "./types";
import type { AgentConfig, WriterInput, WriterOutput, SignalContext, CreativeIdeaDraft } from "./types";
import { sanitizePromptInput, USER_INPUT_GUARD } from "./utils";
import { loadRules } from "./load-rules";
import { checkCopyQuality, checkSequenceQuality, formatSequenceViolations } from "@/lib/copy-quality";

// --- Writer Agent Tools ---

const writerTools = {
  getWorkspaceIntelligence: tool({
    description:
      "Get full workspace data including ICP, campaign brief, outreach tone guidance, normalization rules, and the latest website analysis. Use this first to understand the client before writing copy. If outreachTonePrompt is set, treat it as the primary tone/style directive for all generated copy. If normalizationPrompt is set, use it to normalize company names and other lead data before inserting into copy.",
    inputSchema: z.object({
      slug: z.string().describe("The workspace slug"),
    }),
    execute: async ({ slug }) => {
      const ws = await prisma.workspace.findUnique({ where: { slug } });
      if (!ws) return { error: `Workspace '${slug}' not found` };

      // Get latest website analysis
      const analysis = await prisma.websiteAnalysis.findFirst({
        where: { workspaceSlug: slug, status: "complete" },
        orderBy: { createdAt: "desc" },
      });

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
        existingMessaging: ws.existingMessaging,
        outreachTonePrompt: ws.outreachTonePrompt ?? null,
        normalizationPrompt: ws.normalizationPrompt ?? null,
        websiteAnalysis: analysis
          ? JSON.parse(analysis.analysis)
          : "No website analysis available yet.",
      };
    },
  }),

  getCampaignPerformance: tool({
    description:
      "Get campaign performance metrics for a workspace. Use this to understand what's working and what isn't — reply rates, bounce rates, engagement data. This helps you write data-informed copy.",
    inputSchema: z.object({
      workspaceSlug: z.string().describe("The workspace slug"),
    }),
    execute: async ({ workspaceSlug }) => {
      try {
        const client = await getClientForWorkspace(workspaceSlug);
        const campaigns = await client.getCampaigns();
        return campaigns.map((c) => ({
          id: c.id,
          name: c.name,
          status: c.status,
          emails_sent: c.emails_sent,
          opened: c.opened,
          replied: c.replied,
          bounced: c.bounced,
          interested: c.interested,
          total_leads: c.total_leads,
          reply_rate:
            c.emails_sent > 0
              ? ((c.replied / c.emails_sent) * 100).toFixed(1) + "%"
              : "0%",
          open_rate:
            c.emails_sent > 0
              ? ((c.opened / c.emails_sent) * 100).toFixed(1) + "%"
              : "0%",
          bounce_rate:
            c.emails_sent > 0
              ? ((c.bounced / c.emails_sent) * 100).toFixed(1) + "%"
              : "0%",
        }));
      } catch (e) {
        return {
          error: `Failed to fetch campaigns: ${e instanceof Error ? e.message : "Unknown error"}`,
        };
      }
    },
  }),

  getSequenceSteps: tool({
    description:
      "Get the actual email copy (subject lines and body text) from an existing campaign's sequence steps. Use this to study what copy has been used before and how it performed.",
    inputSchema: z.object({
      workspaceSlug: z.string().describe("The workspace slug"),
      campaignId: z
        .number()
        .describe("The campaign ID to get sequence steps for"),
    }),
    execute: async ({ workspaceSlug, campaignId }) => {
      try {
        const client = await getClientForWorkspace(workspaceSlug);
        const steps = await client.getSequenceSteps(campaignId);
        return steps.map((s) => ({
          position: s.position,
          subject: s.subject ?? "(no subject)",
          body: s.body ?? "(no body)",
          delay_days: s.delay_days ?? 0,
        }));
      } catch (e) {
        return {
          error: `Failed to fetch sequence steps: ${e instanceof Error ? e.message : "Unknown error"}`,
        };
      }
    },
  }),

  searchKnowledgeBase,

  getExistingDrafts: tool({
    description:
      "Get existing email/LinkedIn drafts for a workspace and campaign. Use this to check for previous versions when revising copy.",
    inputSchema: z.object({
      workspaceSlug: z.string().describe("The workspace slug"),
      campaignName: z
        .string()
        .optional()
        .describe("Campaign name filter"),
    }),
    execute: async ({ workspaceSlug, campaignName }) => {
      const where: Record<string, unknown> = { workspaceSlug };
      if (campaignName) where.campaignName = campaignName;

      const drafts = await prisma.emailDraft.findMany({
        where,
        orderBy: [{ campaignName: "asc" }, { sequenceStep: "asc" }],
      });

      if (drafts.length === 0) {
        return { message: "No existing drafts found.", drafts: [] };
      }

      return {
        message: `Found ${drafts.length} draft(s).`,
        drafts: drafts.map((d) => ({
          id: d.id,
          campaignName: d.campaignName,
          channel: d.channel,
          step: d.sequenceStep,
          subject: d.subjectLine,
          body: d.bodyText,
          status: d.status,
          version: d.version,
          feedback: d.feedback,
        })),
      };
    },
  }),

  getCampaignContext: tool({
    description:
      "Get the Campaign entity details including linked TargetList info, existing sequences, and approval status. Use this when generating content for a specific campaign.",
    inputSchema: z.object({
      campaignId: z.string().describe("The campaign ID"),
    }),
    execute: async ({ campaignId }) => {
      const { getCampaign } = await import("@/lib/campaigns/operations");
      const campaign = await getCampaign(campaignId);
      if (!campaign) return { error: `Campaign '${campaignId}' not found` };
      return {
        name: campaign.name,
        status: campaign.status,
        channels: campaign.channels,
        targetListName: campaign.targetListName,
        targetListPeopleCount: campaign.targetListPeopleCount,
        hasEmailSequence: campaign.emailSequence !== null,
        hasLinkedinSequence: campaign.linkedinSequence !== null,
        emailSequence: campaign.emailSequence,
        linkedinSequence: campaign.linkedinSequence,
        leadsApproved: campaign.leadsApproved,
        contentApproved: campaign.contentApproved,
      };
    },
  }),

  saveCampaignSequence: tool({
    description:
      "Save email or LinkedIn sequence directly to a Campaign entity. Use this when generating content for a specific campaign (not standalone drafts).",
    inputSchema: z.object({
      campaignId: z.string().describe("The campaign ID"),
      emailSequence: z
        .array(
          z.object({
            position: z.number(),
            subjectLine: z.string(),
            subjectVariantB: z.string().optional(),
            body: z.string(),
            delayDays: z.number(),
            notes: z.string().optional(),
          }),
        )
        .optional()
        .describe("Email sequence steps"),
      linkedinSequence: z
        .array(
          z.object({
            position: z.number(),
            type: z.enum(["connection_request", "message", "inmail"]),
            body: z.string(),
            delayDays: z.number(),
            notes: z.string().optional(),
          }),
        )
        .optional()
        .describe("LinkedIn sequence steps"),
      copyStrategy: z
        .enum(["creative-ideas", "pvp", "one-liner", "custom"])
        .optional()
        .describe("The copy strategy used to generate this sequence"),
    }),
    execute: async ({ campaignId, emailSequence, linkedinSequence, copyStrategy }) => {
      // Quality gate: check email sequence for banned patterns before saving
      if (emailSequence && emailSequence.length > 0) {
        const violations = checkSequenceQuality(emailSequence);
        if (violations.length > 0) {
          const summary = formatSequenceViolations(violations);
          return {
            status: "quality_violation",
            message: `Banned patterns detected — rewrite these steps to remove violations before saving: ${summary}`,
            violations,
          };
        }
      }

      const { saveCampaignSequences } = await import(
        "@/lib/campaigns/operations"
      );
      const updated = await saveCampaignSequences(campaignId, {
        emailSequence: emailSequence ?? undefined,
        linkedinSequence: linkedinSequence ?? undefined,
        copyStrategy: copyStrategy ?? undefined,
      });
      return {
        status: "saved",
        campaignName: updated.name,
        emailStepCount: emailSequence?.length ?? 0,
        linkedinStepCount: linkedinSequence?.length ?? 0,
        copyStrategy: copyStrategy ?? null,
      };
    },
  }),

  saveDraft: tool({
    description:
      "Save an email or LinkedIn draft to the database for review. Call this for each step in the sequence. The draft starts in 'draft' status and can be reviewed/approved later.",
    inputSchema: z.object({
      workspaceSlug: z.string().describe("The workspace slug"),
      campaignName: z.string().describe("Campaign name"),
      channel: z
        .enum(["email", "linkedin"])
        .describe("Channel: email or linkedin"),
      sequenceStep: z.number().describe("Step position (1, 2, 3, etc.)"),
      subjectLine: z
        .string()
        .optional()
        .describe("Email subject line (null for LinkedIn)"),
      subjectVariantB: z
        .string()
        .optional()
        .describe("A/B test subject variant"),
      bodyText: z.string().describe("The message body (plain text)"),
      bodyHtml: z
        .string()
        .optional()
        .describe("HTML version of the body (for emails)"),
      delayDays: z
        .number()
        .optional()
        .default(1)
        .describe("Days to wait before sending this step"),
    }),
    execute: async ({
      workspaceSlug,
      campaignName,
      channel,
      sequenceStep,
      subjectLine,
      subjectVariantB,
      bodyText,
      bodyHtml,
      delayDays,
    }) => {
      // Quality gate: check all text fields for banned patterns before saving
      const allViolations: string[] = [];
      for (const [field, value] of [
        ["subject", subjectLine],
        ["subjectVariantB", subjectVariantB],
        ["body", bodyText],
      ] as const) {
        if (!value) continue;
        const { violations } = checkCopyQuality(value);
        if (violations.length > 0) {
          allViolations.push(`${field}: ${violations.join(", ")}`);
        }
      }

      if (allViolations.length > 0) {
        return {
          status: "quality_violation",
          message: `Banned patterns detected in step ${sequenceStep} — rewrite to remove violations before saving: ${allViolations.join("; ")}`,
          violations: allViolations,
        };
      }

      const draft = await prisma.emailDraft.create({
        data: {
          workspaceSlug,
          campaignName,
          channel,
          sequenceStep,
          subjectLine: subjectLine ?? null,
          subjectVariantB: subjectVariantB ?? null,
          bodyText,
          bodyHtml: bodyHtml ?? null,
          delayDays: delayDays ?? 1,
          status: "draft",
        },
      });
      return {
        id: draft.id,
        status: "saved",
        message: `Draft saved: ${campaignName} — ${channel} step ${sequenceStep}`,
      };
    },
  }),

  generateKBExamples: tool({
    description:
      "Generate draft copy examples from workspace intelligence for a given strategy. Output is formatted for admin review before ingestion into the Knowledge Base. Admin must review and approve before running ingest-document.ts CLI.",
    inputSchema: z.object({
      workspaceSlug: z.string().describe("The workspace slug"),
      strategy: z
        .enum(["creative-ideas", "pvp", "one-liner"])
        .describe("Strategy to generate examples for"),
      count: z
        .number()
        .optional()
        .default(2)
        .describe("Number of example emails to generate (default 2)"),
    }),
    execute: async ({ workspaceSlug, strategy, count }) => {
      const ws = await prisma.workspace.findUnique({ where: { slug: workspaceSlug } });
      if (!ws) return { error: `Workspace '${workspaceSlug}' not found` };

      const vertical = ws.vertical ?? "general";
      const industrySlug = vertical.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
      const tag = `${strategy}-${industrySlug}`;

      return {
        instruction: `Generate ${count} example emails using the "${strategy}" strategy for the "${ws.name}" workspace (vertical: ${vertical}).`,
        workspaceContext: {
          name: ws.name,
          vertical,
          coreOffers: ws.coreOffers,
          differentiators: ws.differentiators,
          painPoints: ws.painPoints,
          caseStudies: ws.caseStudies,
        },
        outputFormat: `After generating, output each example in markdown format suitable for copy-paste into a .md file. Admin will review and then ingest via:\n\nnpx tsx scripts/ingest-document.ts docs/${workspaceSlug}-${strategy}-examples.md --title "${strategy} Examples: ${vertical} (${ws.name})" --tags "${strategy},${tag}"`,
        suggestedTag: tag,
        note: "DO NOT auto-ingest. Return the examples as text for admin review.",
      };
    },
  }),
};

// --- System Prompt ---

const WRITER_SYSTEM_PROMPT = `You are the Outsignal Writer Agent — an expert cold outreach copywriter specialising in email and LinkedIn campaigns that get replies.

${loadRules("writer-rules.md")}

## Output Format

After writing all steps, return a JSON object:
{
  "campaignName": "Name of the campaign",
  "channel": "email" | "linkedin" | "email_linkedin",
  "strategy": "creative-ideas" | "pvp" | "one-liner" | "custom",
  "emailSteps": [
    {
      "position": 1,
      "subjectLine": "...",
      "subjectVariantB": "...",
      "body": "...",
      "delayDays": 0,
      "notes": "Why this approach works"
    }
  ],
  "linkedinSteps": [
    {
      "position": 1,
      "type": "connection_request" | "message" | "inmail",
      "body": "...",
      "delayDays": 0,
      "notes": "Why this approach works"
    }
  ],
  "creativeIdeas": [
    {
      "position": 1,
      "title": "Idea title",
      "groundedIn": "Exact offering name from coreOffers: ...",
      "subjectLine": "...",
      "subjectVariantB": "...",
      "body": "...",
      "notes": "Why this idea works for this prospect"
    }
  ],
  "references": ["KB doc title (strategy examples)", "KB doc title (best practices)"],
  "reviewNotes": "Self-critique: what is strong, what could be improved, any concerns"
}

Include emailSteps if channel is "email" or "email_linkedin" AND strategy is NOT "creative-ideas".
Include linkedinSteps if channel is "linkedin" or "email_linkedin".
Include creativeIdeas (instead of emailSteps) when strategy is "creative-ideas".
If content was saved to a Campaign entity via saveCampaignSequence, include "campaignId" in the root of the JSON object.
Always include "strategy" and "references" fields.`;

const writerConfig: AgentConfig = {
  name: "writer",
  model: "claude-sonnet-4-20250514",
  systemPrompt: WRITER_SYSTEM_PROMPT + USER_INPUT_GUARD,
  tools: writerTools,
  maxSteps: 20,
  outputSchema: writerOutputSchema,
};

// --- Public API ---

/**
 * Run the Writer Agent to generate email and/or LinkedIn copy.
 *
 * Can be called from:
 * - CLI scripts: `runWriterAgent({ workspaceSlug, task: "..." })`
 * - Dashboard chat: via orchestrator's delegateToWriter tool
 * - API routes: automated pipeline
 */
export async function runWriterAgent(
  input: WriterInput,
): Promise<WriterOutput> {
  const userMessage = buildWriterMessage(input);

  const result = await runAgent<WriterOutput>(writerConfig, userMessage, {
    triggeredBy: "cli",
    workspaceSlug: input.workspaceSlug,
  });

  return result.output;
}

function buildWriterMessage(input: WriterInput): string {
  const parts: string[] = [];

  parts.push(`Workspace: ${input.workspaceSlug}`);
  if (input.channel) {
    parts.push(`Channel: ${input.channel}`);
  }
  if (input.campaignName) {
    parts.push(`Campaign: ${sanitizePromptInput(input.campaignName)}`);
  }
  if (input.campaignId) {
    parts.push(`Campaign ID: ${input.campaignId}`);
  }
  if (input.stepNumber !== undefined) {
    parts.push(
      `Target step: ${input.stepNumber} (regenerate only this step, preserve others)`,
    );
  }
  // Phase 20: Copy strategy selection
  if (input.copyStrategy) {
    parts.push(`Copy strategy: ${input.copyStrategy}`);
  }
  if (input.copyStrategy === "custom" && input.customStrategyPrompt) {
    parts.push(`Custom strategy instructions:\n${sanitizePromptInput(input.customStrategyPrompt)}`);
  }
  // Phase 20: Signal context (internal only — writer uses for angle selection)
  if (input.signalContext) {
    parts.push("");
    parts.push("[INTERNAL SIGNAL CONTEXT — never mention to recipient]");
    parts.push(`Signal type: ${input.signalContext.signalType}`);
    parts.push(`Target company: ${sanitizePromptInput(input.signalContext.companyName ?? input.signalContext.companyDomain)}`);
    parts.push(`Company domain: ${sanitizePromptInput(input.signalContext.companyDomain)}`);
    parts.push(`High intent: ${input.signalContext.isHighIntent}`);
  }
  if (input.feedback) {
    parts.push(`\nFeedback to incorporate:\n${sanitizePromptInput(input.feedback)}`);
  }
  parts.push("", `Task: ${sanitizePromptInput(input.task)}`);

  return parts.join("\n");
}

export { writerConfig, writerTools };
