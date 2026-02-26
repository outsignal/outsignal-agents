import { tool } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { searchKnowledge } from "@/lib/knowledge/store";
import { getClientForWorkspace } from "@/lib/workspaces";
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

  searchKnowledgeBase: tool({
    description:
      "Search the knowledge base for cold email and LinkedIn outreach best practices, frameworks, and templates. Use this to ground your copy in proven strategies.",
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          "Search query — e.g. 'subject line best practices', 'follow-up sequence', 'LinkedIn connection request'",
        ),
      tags: z
        .string()
        .optional()
        .describe("Filter by tag — e.g. 'cold-email', 'linkedin', 'subject-lines'"),
      limit: z
        .number()
        .optional()
        .default(8)
        .describe("Max results (default 8)"),
    }),
    execute: async ({ query, tags, limit }) => {
      const results = await searchKnowledge(query, { limit, tags });
      if (results.length === 0) {
        return {
          message:
            "No matching knowledge base entries found. Write based on your expertise.",
          results: [],
        };
      }
      return {
        message: `Found ${results.length} relevant passage(s).`,
        results: results.map((r) => ({
          source: r.title,
          content: r.chunk,
        })),
      };
    },
  }),

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
You write outbound sequences for our clients' cold campaigns. Your copy needs to:
1. Sound human, not robotic or salesy
2. Be concise — every word must earn its place
3. Reference specific pain points, results, and differentiators from the client's business
4. Use personalisation merge tags so messages feel individual
5. Follow proven cold outreach frameworks grounded in the knowledge base

## Your Process
1. **Understand the client**: Call getWorkspaceIntelligence to get ICP, value props, case studies, and website analysis
2. **Study what works**: Call getCampaignPerformance and getSequenceSteps to see existing campaign data (if available)
3. **Research best practices**: Call searchKnowledgeBase to find relevant frameworks, templates, and guidelines
4. **Check existing drafts**: Call getExistingDrafts to see if there's previous copy to build on or revise
5. **Write the sequence**: Create compelling, personalised copy for each step
6. **Save drafts**: Call saveDraft for each step in the sequence

## Email Copy Rules
- **Subject lines**: 3-6 words, lowercase, no spam triggers (free, guarantee, act now), create curiosity or relevance
- **A/B variants**: Always provide a subject line B variant for testing
- **Body**: Under 100 words for cold emails, under 150 for follow-ups
- **Opening**: Never start with "I hope this finds you well" or "My name is". Start with a relevant observation, pain point, or trigger
- **CTA**: One clear, low-friction ask per email. "Worth a chat?" not "Schedule a 30-minute demo call"
- **Merge tags**: Use {{firstName}}, {{company}}, {{title}} for personalisation. Don't overuse — 1-2 per email max
- **Tone**: Match the client's brand voice from the website analysis
- **Follow-ups**: Reference previous emails naturally, don't repeat the same pitch. Add new angles or proof points
- **Sign-off**: Use the sender's name and title from workspace data if available
- **Plain text**: Write as plain text. No HTML formatting, no images, no fancy signatures in the body

## LinkedIn Copy Rules
- **Connection requests**: Max 300 characters. Lead with relevance, not a sales pitch
- **Messages**: Under 100 words. More conversational than email — this is a chat, not a letter
- **InMails**: Slightly longer (up to 150 words), but still punchy
- **Tone**: Professional but casual. LinkedIn is more personal than email
- **No links in connection requests**: They reduce acceptance rates
- **Sequence**: Typically: connection request → value message (2-3 days) → follow-up (5-7 days)

## Spam Avoidance
- Never use ALL CAPS or excessive punctuation (!!!, ???)
- Avoid spam trigger words: free, guarantee, limited time, act now, exclusive offer, no obligation
- Don't use URL shorteners
- Keep formatting simple — no coloured text, no embedded images
- One link maximum per email, and only in later follow-ups

## Personalisation Strategy
- Use merge tags for names and companies
- Reference industry-specific pain points (from ICP data)
- Mention relevant case studies or results that match the prospect's industry
- If the workspace has differentiators, weave them in naturally — don't list them

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
  "reviewNotes": "Self-critique: what's strong, what could be improved, any concerns"
}

Include emailSteps if channel is "email" or "email_linkedin".
Include linkedinSteps if channel is "linkedin" or "email_linkedin".`;

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
  if (input.feedback) {
    parts.push(`\nFeedback to incorporate:\n${input.feedback}`);
  }
  parts.push("", `Task: ${input.task}`);

  return parts.join("\n");
}

export { writerConfig, writerTools };
