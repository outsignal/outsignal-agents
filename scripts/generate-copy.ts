/**
 * Writer Agent CLI — Generate email and/or LinkedIn copy for a workspace.
 *
 * Usage:
 *   npx tsx scripts/generate-copy.ts <workspace-slug> [options]
 *
 * Options:
 *   --channel email|linkedin|email_linkedin  (default: email)
 *   --campaign "Campaign Name"               (optional, for revisions)
 *   --feedback "Client feedback here"        (optional)
 *   --task "Custom task description"         (optional, overrides default)
 *
 * Examples:
 *   npx tsx scripts/generate-copy.ts rise-headwear
 *   npx tsx scripts/generate-copy.ts rise-headwear --channel email_linkedin
 *   npx tsx scripts/generate-copy.ts rise-headwear --campaign "Q1 Outreach" --feedback "Make it more casual"
 */

import { PrismaClient } from "@prisma/client";
import { generateText, stepCountIs } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { tool } from "ai";
import { z } from "zod";
import {
  crawlWebsite,
  scrapeUrl,
} from "../src/lib/firecrawl/client";

const prisma = new PrismaClient();

// --- Inline knowledge search (since we can't use path aliases) ---

async function searchKnowledge(
  query: string,
  opts?: { limit?: number; tags?: string },
) {
  const limit = opts?.limit ?? 10;
  const keywords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);

  const where = opts?.tags ? { tags: { contains: opts.tags } } : {};
  const docs = await prisma.knowledgeDocument.findMany({ where });

  const scored: { title: string; chunk: string; score: number }[] = [];
  for (const doc of docs) {
    const chunks: string[] = JSON.parse(doc.chunks);
    for (const chunk of chunks) {
      const lower = chunk.toLowerCase();
      let score = 0;
      for (const kw of keywords) {
        if (lower.includes(kw)) score++;
      }
      if (score > 0) scored.push({ title: doc.title, chunk, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

// --- Tools (duplicated from writer.ts since tsx can't use path aliases) ---

const writerTools = {
  getWorkspaceIntelligence: tool({
    description: "Get workspace data including ICP and latest website analysis.",
    inputSchema: z.object({ slug: z.string() }),
    execute: async ({ slug }) => {
      const ws = await prisma.workspace.findUnique({ where: { slug } });
      if (!ws) return { error: `Workspace '${slug}' not found` };

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
        coreOffers: ws.coreOffers,
        pricingSalesCycle: ws.pricingSalesCycle,
        differentiators: ws.differentiators,
        painPoints: ws.painPoints,
        caseStudies: ws.caseStudies,
        leadMagnets: ws.leadMagnets,
        existingMessaging: ws.existingMessaging,
        senderFullName: ws.senderFullName,
        senderJobTitle: ws.senderJobTitle,
        websiteAnalysis: analysis
          ? JSON.parse(analysis.analysis)
          : "No website analysis available yet.",
      };
    },
  }),

  searchKnowledgeBase: tool({
    description:
      "Search the knowledge base for cold email and LinkedIn outreach best practices.",
    inputSchema: z.object({
      query: z.string(),
      tags: z.string().optional(),
      limit: z.number().optional().default(8),
    }),
    execute: async ({ query, tags, limit }) => {
      const results = await searchKnowledge(query, { limit, tags });
      if (results.length === 0) {
        return { message: "No matching knowledge base entries found.", results: [] };
      }
      return {
        message: `Found ${results.length} relevant passage(s).`,
        results: results.map((r) => ({ source: r.title, content: r.chunk })),
      };
    },
  }),

  getExistingDrafts: tool({
    description: "Get existing email/LinkedIn drafts for a workspace.",
    inputSchema: z.object({
      workspaceSlug: z.string(),
      campaignName: z.string().optional(),
    }),
    execute: async ({ workspaceSlug, campaignName }) => {
      const where: Record<string, unknown> = { workspaceSlug };
      if (campaignName) where.campaignName = campaignName;

      const drafts = await prisma.emailDraft.findMany({
        where,
        orderBy: [{ campaignName: "asc" }, { sequenceStep: "asc" }],
      });

      return {
        message: drafts.length > 0 ? `Found ${drafts.length} draft(s).` : "No existing drafts found.",
        drafts: drafts.map((d) => ({
          id: d.id,
          campaignName: d.campaignName,
          channel: d.channel,
          step: d.sequenceStep,
          subject: d.subjectLine,
          body: d.bodyText,
          status: d.status,
          version: d.version,
        })),
      };
    },
  }),

  saveDraft: tool({
    description: "Save an email or LinkedIn draft to the database.",
    inputSchema: z.object({
      workspaceSlug: z.string(),
      campaignName: z.string(),
      channel: z.enum(["email", "linkedin"]),
      sequenceStep: z.number(),
      subjectLine: z.string().optional(),
      subjectVariantB: z.string().optional(),
      bodyText: z.string(),
      bodyHtml: z.string().optional(),
      delayDays: z.number().optional().default(1),
    }),
    execute: async (input) => {
      const draft = await prisma.emailDraft.create({
        data: {
          workspaceSlug: input.workspaceSlug,
          campaignName: input.campaignName,
          channel: input.channel,
          sequenceStep: input.sequenceStep,
          subjectLine: input.subjectLine ?? null,
          subjectVariantB: input.subjectVariantB ?? null,
          bodyText: input.bodyText,
          bodyHtml: input.bodyHtml ?? null,
          delayDays: input.delayDays ?? 1,
          status: "draft",
        },
      });
      return { id: draft.id, status: "saved" };
    },
  }),
};

// --- System Prompt (same as writer.ts) ---

const WRITER_SYSTEM_PROMPT = `You are the Outsignal Writer Agent — an expert cold outreach copywriter specialising in email and LinkedIn campaigns that get replies.

## Your Process
1. Call getWorkspaceIntelligence to understand the client's ICP, value props, case studies
2. Call searchKnowledgeBase to find relevant best practices and frameworks
3. Call getExistingDrafts to see if there's previous copy to build on
4. Write the sequence — compelling, personalised copy for each step
5. Call saveDraft for each step to save it to the database

## Email Copy Rules
- Subject lines: 3-6 words, lowercase, no spam triggers, create curiosity
- Always provide a subject line B variant for A/B testing
- Body: under 100 words for cold emails, under 150 for follow-ups
- Never start with "I hope this finds you well" or "My name is"
- Start with a relevant observation, pain point, or trigger
- One clear, low-friction CTA per email
- Use {{firstName}}, {{company}}, {{title}} merge tags (1-2 per email max)
- Match the client's brand voice
- Follow-ups: new angles, don't repeat the same pitch
- Plain text only — no HTML formatting

## LinkedIn Copy Rules
- Connection requests: max 300 characters, lead with relevance not a pitch
- Messages: under 100 words, conversational tone
- InMails: up to 150 words, still punchy
- No links in connection requests
- Sequence: connection request → value message (2-3 days) → follow-up (5-7 days)

## Spam Avoidance
- No ALL CAPS, excessive punctuation, or spam trigger words
- Keep formatting simple, one link max per email
- No URL shorteners

## Output Format
Return a JSON object with: campaignName, channel, emailSteps (if email), linkedinSteps (if linkedin), reviewNotes`;

// --- Main ---

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0].startsWith("--")) {
    console.error(
      `Usage: npx tsx scripts/generate-copy.ts <workspace-slug> [--channel email|linkedin|email_linkedin] [--campaign "Name"] [--feedback "..."] [--task "..."]`,
    );
    process.exit(1);
  }

  const workspaceSlug = args[0];
  let channel = "email";
  let campaignName: string | undefined;
  let feedback: string | undefined;
  let task: string | undefined;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--channel" && args[i + 1]) channel = args[++i];
    if (args[i] === "--campaign" && args[i + 1]) campaignName = args[++i];
    if (args[i] === "--feedback" && args[i + 1]) feedback = args[++i];
    if (args[i] === "--task" && args[i + 1]) task = args[++i];
  }

  // Verify workspace exists
  const ws = await prisma.workspace.findUnique({
    where: { slug: workspaceSlug },
  });
  if (!ws) {
    console.error(`Workspace '${workspaceSlug}' not found`);
    process.exit(1);
  }

  const defaultTask =
    channel === "email_linkedin"
      ? `Write a 4-step email sequence and a 3-step LinkedIn sequence for this client's outbound campaign.`
      : channel === "linkedin"
        ? `Write a 3-step LinkedIn outreach sequence for this client's outbound campaign.`
        : `Write a 4-step cold email sequence for this client's outbound campaign.`;

  const userMessage = [
    `Workspace: ${workspaceSlug}`,
    `Channel: ${channel}`,
    campaignName ? `Campaign: ${campaignName}` : "",
    feedback ? `\nFeedback to incorporate:\n${feedback}` : "",
    "",
    `Task: ${task ?? defaultTask}`,
  ]
    .filter(Boolean)
    .join("\n");

  console.log(`\n=== Writer Agent: Generating copy for ${ws.name} ===`);
  console.log(`  Channel: ${channel}`);
  if (campaignName) console.log(`  Campaign: ${campaignName}`);
  console.log();

  try {
    const startTime = Date.now();

    const result = await generateText({
      model: anthropic("claude-opus-4-20250514"),
      system: WRITER_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
      tools: writerTools,
      stopWhen: stepCountIs(10),
    });

    const durationMs = Date.now() - startTime;

    // Log tool calls
    for (const step of result.steps) {
      for (const tc of step.toolCalls) {
        console.log(`  [tool] ${tc.toolName}`);
      }
    }

    console.log(`\n--- Writer Agent Output (${(durationMs / 1000).toFixed(1)}s) ---`);
    console.log(result.text);

    // Log the agent run
    await prisma.agentRun.create({
      data: {
        agent: "writer",
        workspaceSlug,
        input: JSON.stringify({ workspaceSlug, channel, campaignName, task }),
        output: result.text,
        status: "complete",
        durationMs,
        triggeredBy: "cli",
      },
    });

    console.log("\n  Done!");
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
