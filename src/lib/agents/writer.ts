import { tool } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getClientForWorkspace } from "@/lib/workspaces";
import { searchKnowledgeBase } from "./shared-tools";
import { runAgent } from "./runner";
import type { AgentConfig, WriterInput, WriterOutput } from "./types";

// --- Writer Agent Tools ---

const writerTools = {
  getWorkspaceIntelligence: tool({
    description:
      "Get full workspace data including ICP, campaign brief, and the latest website analysis. Use this first to understand the client before writing copy.",
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
    }),
    execute: async ({ campaignId, emailSequence, linkedinSequence }) => {
      const { saveCampaignSequences } = await import(
        "@/lib/campaigns/operations"
      );
      const updated = await saveCampaignSequences(campaignId, {
        emailSequence: emailSequence ?? undefined,
        linkedinSequence: linkedinSequence ?? undefined,
      });
      return {
        status: "saved",
        campaignName: updated.name,
        emailStepCount: emailSequence?.length ?? 0,
        linkedinStepCount: linkedinSequence?.length ?? 0,
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
};

// --- System Prompt ---

const WRITER_SYSTEM_PROMPT = `You are the Outsignal Writer Agent — an expert cold outreach copywriter specialising in email and LinkedIn campaigns that get replies.

## Your Purpose
You write outbound sequences for our clients' cold campaigns. Your copy must:
1. Sound human, never robotic or salesy
2. Be concise — every word must earn its place
3. Reference specific pain points, results, and differentiators from the client's business
4. Use personalisation merge tokens so messages feel individual
5. Follow proven cold outreach frameworks grounded in the knowledge base
6. Pass ALL 11 quality rules below before being saved

## Your Process

### Standard flow (no campaignId provided)
1. Call getWorkspaceIntelligence to load client ICP, value props, case studies, and website analysis
2. Call searchKnowledgeBase to find relevant best practices, frameworks, and templates (auto-search — no admin action needed)
3. Call getCampaignPerformance and getSequenceSteps for existing campaign data (if available)
4. Call getExistingDrafts to check for previous versions
5. Generate content following ALL quality rules below
6. Save each step via saveDraft

### Campaign-aware flow (campaignId provided)
1. Call getCampaignContext to load campaign details, linked TargetList, and any existing sequences
2. Call getWorkspaceIntelligence to load client context
3. Call searchKnowledgeBase for relevant best practices (auto-search — no admin action needed)
4. Call getCampaignPerformance and getSequenceSteps for existing campaign data (if available)
5. Call getExistingDrafts to check prior versions
6. Generate content following ALL quality rules below
7. Save via saveCampaignSequence (not saveDraft) to link sequences to the Campaign entity

---

## Quality Rules (MANDATORY — every generated email MUST pass ALL rules)

1. **Word count**: All emails under 70 words. No exceptions. Count before saving.
2. **No em dashes**: Never use — (em dash). Use commas or periods instead.
3. **No exclamation marks in subjects**: Subject lines never contain "!"
4. **Subject lines**: 3-6 words, all lowercase, create curiosity or relevance. No spam triggers.
5. **Soft CTAs only**: Every CTA must be a question. "worth a chat?" not "book a call". "open to exploring?" not "schedule a demo".
6. **No banned phrases**: Never use "I hope this finds you well", "My name is", "I wanted to reach out", "touching base", "circling back", "just following up", "synergy", "leverage", "game-changer", "revolutionary", "guaranteed", "act now", "limited time", "exclusive offer", "no obligation", "free".
7. **Variables**: Uppercase with single curly braces ONLY: {FIRSTNAME}, {COMPANYNAME}, {JOBTITLE}, {LOCATION}. Never use {{double braces}} or lowercase variables.
8. **Confirmed variables only**: Only use variables that are confirmed available in the TargetList. If unsure, ask — don't guess.
9. **PVP framework**: Structure every cold email as Relevance (why them) -> Value (what you offer) -> Pain (what they lose without it). This is the structural backbone.
10. **Spintax**: Include spintax in 10-30% of content. Format: {option1|option2|option3}. NEVER spin statistics, CTAs, variable names, or company-specific claims. All options must be grammatically interchangeable.
11. **Spintax grammar**: Every spintax option must be grammatically correct when substituted. Read each variant aloud mentally before saving.

---

## Email Sequence Defaults

- **Default 3 steps**: initial (day 0) + follow-up 1 (day 3) + follow-up 2 (day 7)
- Admin can request more or fewer steps
- **One angle per generation**: For A/B variants, admin says "write another angle" — do not generate multiple angles unsolicited
- **Always provide subject line B variant** for A/B testing
- Follow-ups reference previous emails naturally — do not repeat the same pitch; add new angles or proof points
- Sign-off uses sender name/title from workspace data

---

## LinkedIn Sequence Defaults

- **Blank connection request** (no note) — higher accept rates in cold outreach
- **2 message follow-ups** after connection (day 3 and day 7 post-connect)
- Messages under 100 words, conversational tone
- No links in connection requests
- LinkedIn is chat, not email — more personal, less formal

---

## Smart Iteration Behaviour

- If feedback mentions a specific step number ("step 2 is too long"), regenerate ONLY that step — preserve all other steps exactly
- If feedback is general ("too formal"), regenerate ALL steps with the adjusted tone
- When revising, always load existing sequences first via getCampaignContext or getExistingDrafts before making changes
- If stepNumber is provided in the task context, regenerate only that step

---

## Reply Suggestion Mode

When the task starts with "suggest reply" or "draft response", switch to reply mode:
- Context: load the full thread + workspace context + search knowledge base for relevant approach
- No PVP framework (that is for cold outreach only)
- No spintax (replies are direct, not broadcast)
- No forced word count (but keep replies concise — under 70 words recommended)
- No em dashes, simple language, conversational tone
- CTA rule still applies: soft question CTAs only
- Quality rules 2 (no em dashes), 5 (soft CTAs), 6 (no banned phrases), and 7 (variable format) still apply in reply mode

---

## Output Format

After writing all steps, return a JSON object:
{
  "campaignName": "Name of the campaign",
  "channel": "email" | "linkedin" | "email_linkedin",
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
  "reviewNotes": "Self-critique: what is strong, what could be improved, any concerns"
}

Include emailSteps if channel is "email" or "email_linkedin".
Include linkedinSteps if channel is "linkedin" or "email_linkedin".
If content was saved to a Campaign entity via saveCampaignSequence, include "campaignId" in the root of the JSON object.`;

const writerConfig: AgentConfig = {
  name: "writer",
  model: "claude-opus-4-20250514",
  systemPrompt: WRITER_SYSTEM_PROMPT,
  tools: writerTools,
  maxSteps: 10,
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
    parts.push(`Campaign: ${input.campaignName}`);
  }
  if (input.campaignId) {
    parts.push(`Campaign ID: ${input.campaignId}`);
  }
  if (input.stepNumber !== undefined) {
    parts.push(
      `Target step: ${input.stepNumber} (regenerate only this step, preserve others)`,
    );
  }
  if (input.feedback) {
    parts.push(`\nFeedback to incorporate:\n${input.feedback}`);
  }
  parts.push("", `Task: ${input.task}`);

  return parts.join("\n");
}

export { writerConfig, writerTools };
