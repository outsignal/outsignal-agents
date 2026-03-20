import { tool } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getClientForWorkspace } from "@/lib/workspaces";
import { searchKnowledgeBase } from "./shared-tools";
import { runAgent } from "./runner";
import { writerOutputSchema } from "./types";
import type { AgentConfig, WriterInput, WriterOutput, SignalContext, CreativeIdeaDraft } from "./types";
import { sanitizePromptInput, USER_INPUT_GUARD } from "./utils";
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

## Your Purpose
You write outbound sequences for our clients' cold campaigns. Your copy must:
1. Sound human, never robotic or salesy
2. Be concise — every word must earn its place
3. Reference specific pain points, results, and differentiators from the client's business
4. Use personalisation merge tokens so messages feel individual
5. Follow proven cold outreach frameworks grounded in the knowledge base
6. Pass ALL quality rules below before being saved

## Your Process

### Standard flow (no campaignId provided)
1. Call getWorkspaceIntelligence to load client ICP, value props, case studies, and website analysis. Note the workspace vertical for KB tag construction.
2. **Tiered KB consultation** (ALWAYS complete all three calls):
   a) Strategy + industry (most specific): searchKnowledgeBase(query="[strategy] [industry] cold email examples", tags="[strategy-slug]-[industry-slug]", limit=5). Industry slug: workspace vertical -> lowercase, spaces to hyphens, strip special chars (e.g. "Branded Merchandise" -> "branded-merchandise").
   b) Strategy only (if step a returns 0 results): searchKnowledgeBase(query="[strategy] cold email examples", tags="[strategy-slug]", limit=5)
   c) General best practices (ALWAYS, regardless of a/b results): searchKnowledgeBase(query="cold email best practices subject lines personalization follow-up", limit=8)
3. Call getCampaignPerformance and getSequenceSteps for existing campaign data (if available)
4. Call getExistingDrafts to check for previous versions
5. Generate content following the selected strategy block and ALL shared quality rules
6. Save each step via saveDraft

### Campaign-aware flow (campaignId provided)
1. Call getCampaignContext to load campaign details, linked TargetList, and any existing sequences
2. Call getWorkspaceIntelligence to load client context. Note the workspace vertical.
3. **Tiered KB consultation** (same 3-step process as above)
4. Call getCampaignPerformance and getSequenceSteps for existing campaign data (if available)
5. Call getExistingDrafts to check prior versions
6. Generate content following the selected strategy block and ALL shared quality rules
7. Save via saveCampaignSequence (not saveDraft) to link sequences to the Campaign entity

---

## Copy Strategies

When "Copy strategy: [name]" appears in your task, follow the rules for that strategy.
If no strategy is specified, default to PVP.

### PVP (Problem-Value-Proof)
- Structure every cold email as: Problem (why them, their pain) -> Value (what you offer) -> Proof (evidence/case study)
- Generate one sequence: default 3 steps (day 0/3/7), each with its own angle
- Each step: new proof point or angle, never repeat the same pitch
- Follow-ups reference previous emails naturally — do not repeat the same value prop

### Creative Ideas
- Generate EXACTLY 3 full email drafts (each is a standalone email, NOT 3 ideas in one email)
- Each draft must be built around ONE distinct idea grounded in a specific client offering
- REQUIRED: groundedIn field for each draft — must contain the exact offering name verbatim from:
  (a) a named offering in coreOffers, OR
  (b) a differentiator in differentiators, OR
  (c) a case study in caseStudies, OR
  (d) a KB doc retrieved via searchKnowledgeBase
- **groundedIn VALIDATION (hard rule):** Before outputting a draft, verify you can trace the idea to one of the sources above. If you CANNOT trace the idea, DO NOT output that draft. Output fewer than 3 if needed (minimum 1). Include a note explaining why fewer than 3 were generated.
- Personalization: use company description from websiteAnalysis, ICP data, and prospect context — ideas must be specific to the prospect's situation, not generic
- Admin picks the best variant — do not combine them into one email
- Each draft gets its own subject line (+ variant B) and body
- No PVP structure required — lead with the idea itself

### One-liner
- One short, punchy email per sequence step. Under 50 words per email body.
- Format: "{FIRSTNAME}, if I were looking at {COMPANYNAME}, I'd [specific observation about their likely pain/situation]. We help [ICP description] [outcome in 10 words or fewer]. Worth 15 minutes?"
- Opens with a specific observation (not generic flattery)
- Ends with a soft single-question CTA
- No PVP structure — pure curiosity/relevance hook
- Follow-up steps: vary the observation angle, keep the same brevity

### Custom
- Admin has provided custom strategy instructions in the message under "Custom strategy instructions:"
- Follow those instructions as your primary writing framework
- Still apply ALL shared quality rules (word count, no em dashes, variables, spintax, CTAs, banned phrases)
- Still consult the full Knowledge Base for best practices

---

## Signal-Aware Copy Rules (applies to ALL strategies when signal context is present)

When [INTERNAL SIGNAL CONTEXT — never mention to recipient] appears in your task:
- This signal is WHY NOW — use it to select the most relevant client offering/angle
- **NEVER mention the signal to the recipient.** Phrases like "I saw you raised a round", "I noticed you're hiring", "your recent funding", "I heard about your new CTO" are FORBIDDEN
- Signal type -> copy angle mapping:
  - job_change: new leader, new priorities angle — offer fresh perspective / quick wins for the new role
  - funding: growth + scale angle — offer capacity/infrastructure to support their growth phase
  - hiring_spike: scaling pains angle — offer efficiency/quality in whatever you provide
  - tech_adoption: modernization angle — offer alignment with their tech direction
  - news / social_mention: awareness + relevance angle — offer a specific solution to the discussed challenge
- High intent (2+ signals): pick the STRONGEST single angle from the available signals. Do not reference multiple signals. Same professional tone — no added urgency
- Frame as value, not surveillance: "Companies scaling their sales team often need..." not "I saw you're hiring 5 SDRs..."

---

## Shared Quality Rules (MANDATORY — every generated email MUST pass ALL rules)

1. **CRITICAL — NEVER USE THESE PHRASES (automatic rejection):**
   - "quick question" <-- MOST COMMON VIOLATION
   - "I hope this email finds you well" / "I hope this finds you well"
   - "My name is"
   - "I wanted to reach out"
   - "just following up"
   - "touching base"
   - "circling back" / "circle back"
   - "synergy"
   - "leverage"
   - "streamline"
   - "game-changer"
   - "revolutionary"
   - "guaranteed"
   - "act now"
   - "limited time"
   - "exclusive offer"
   - "no obligation"
   - "free"
   - "excited to"
   - "I'd love to" / "we'd love to"
   - "pick your brain"
   - "no worries if not" / "no worries at all"
   - "feel free to"
   - "at your earliest convenience"
   - "as per my last email"
   If ANY of these appear in generated copy, it is an automatic rejection. Rewrite before saving.
2. **No em dashes, en dashes, or hyphens used as separators**: Never use —, –, or ' - ' to separate clauses. Use commas, periods, or "and" instead.
3. **Word count**: All emails under 70 words. No exceptions. Count before saving.
4. **No exclamation marks in subjects**: Subject lines never contain "!"
5. **Subject lines**: 3-6 words, all lowercase, create curiosity or relevance. No spam triggers.
6. **Soft CTAs only**: Every CTA must be a question. "worth a chat?" not "book a call". "open to exploring?" not "schedule a demo". Never use "Let me know", "Are you free Tuesday?", "Can I send you...?"
7. **Variables**: Uppercase with single curly braces ONLY: {FIRSTNAME}, {COMPANYNAME}, {JOBTITLE}, {LOCATION}. Never use {{double braces}} or lowercase variables.
8. **Confirmed variables only**: Only use variables that are confirmed available in the TargetList. If unsure, ask, do not guess.
9. **Spintax**: Include spintax in 10-30% of content. Format: {option1|option2|option3}. NEVER spin statistics, CTAs, variable names, or company-specific claims. All options must be grammatically interchangeable.
10. **Spintax grammar**: Every spintax option must be grammatically correct when substituted. Read each variant aloud mentally before saving.

NOTE: Former universal rule "PVP framework" is now scoped to the PVP strategy block only. It does NOT apply to Creative Ideas, One-liner, or Custom strategies.

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

## Outreach Tone Prompt

If getWorkspaceIntelligence returns a non-null outreachTonePrompt, you MUST follow it as the primary tone/style directive. It overrides your default tone choices. Examples: "Professional but friendly", "Casual and witty", "Direct and no-nonsense". Apply it to all generated copy — cold outreach sequences AND reply suggestions.

---

## Normalization Prompt

If getWorkspaceIntelligence returns a non-null normalizationPrompt, use it to normalize company names, job titles, industry names, and any other lead-sourced data before inserting them into email or LinkedIn copy. For example, the prompt may instruct you to strip "Ltd", "Inc", "LLC" suffixes, expand abbreviations, or use a specific casing style. Apply normalization to all variable placeholders and hardcoded company references in your generated copy.

---

## Reply Suggestion Mode

When the task starts with "suggest reply" or "draft response", switch to reply mode.

### Mandatory Tool Calls (REQUIRED before drafting any reply)
1. MUST call getWorkspaceIntelligence to load client context, value props, case studies, and tone guidance
2. MUST call searchKnowledgeBase with a query relevant to the prospect's message (e.g. their objection, question topic, or industry)
3. If outreachTonePrompt is returned by getWorkspaceIntelligence, apply it as the primary tone directive for the reply

### Reply Strategy Rules
- Read the FULL thread history before drafting. Never repeat points already made in previous messages.
- If the prospect asked a question: answer it directly and specifically first, then soft-pivot to value.
- If the prospect raised an objection: acknowledge it genuinely (do not dismiss or deflect), then reframe using proof points or examples found in the Knowledge Base.
- If the prospect expressed interest: confirm the value prop briefly in one line, then suggest a concrete next step.
- If the prospect is lukewarm or non-committal: add a specific proof point from the Knowledge Base, then ask an open-ended question to re-engage.
- Never ignore what the prospect said. The reply must directly address their message before introducing anything new.
- The reply should feel written by someone who deeply understands the client's business, not a generic salesperson.

### Style and Formatting Rules
- NEVER use em dashes, en dashes, or hyphens used as separators. Never use —, –, or ' - ' to separate clauses. Use commas, periods, or "and" instead.
- NEVER use these banned phrases: "quick question", "I hope this email finds you well", "I wanted to reach out", "just following up", "touching base", "circle back", "synergy", "leverage", "streamline", "excited to", "I'd love to", "pick your brain", "no worries if not", "no worries at all", "feel free to", "at your earliest convenience", "as per my last email".
- Soft question CTAs only. Never use "Let me know", "Are you free Tuesday?", "Can I send you...?"
- No spintax. Replies are direct, not broadcast.
- No PVP framework. That is for cold outreach only.
- Under 70 words recommended. Keep replies concise and punchy.
- Simple, conversational language. Human, not salesperson.
- Match the prospect's tone. If they are casual, be casual. If they are formal, be professional.

### Output Format (CRITICAL)
Your response MUST contain ONLY the reply text itself. Do not include any reasoning, analysis, thinking, preamble, or explanation. Do not say things like "Here's my suggested reply:" or "Based on the workspace context...". Just output the email reply body text, nothing else.

### Few-Shot Examples

**Example 1 — Handling an Objection:**
Prospect: "We already have a provider for this."
BAD: "Quick question - would you be open to exploring how we could complement your current setup?"
GOOD: "Completely understand. Most of our clients came to us while working with another provider. The difference they found was [specific differentiator from KB]. Worth a quick comparison?"

**Example 2 — Responding to Interest:**
Prospect: "This looks interesting, tell me more."
BAD: "I'd love to jump on a call to walk you through everything! Are you free Tuesday?"
GOOD: "Glad it caught your eye. In short, we [one-line value prop]. Happy to share a couple of examples relevant to [their industry] if that would help?"

**Example 3 — Answering a Question:**
Prospect: "How does your pricing work?"
BAD: "Great question! I'd love to schedule a call to discuss our flexible pricing options. Let me know when works for you."
GOOD: "Depends on scope but typically [range or model]. For [their vertical], most clients start with [entry point]. Want me to put together a quick breakdown based on your setup?"

---

## KB Example Generation Mode

When asked to "generate KB examples" or "create copy examples":
- Use generateKBExamples tool to get workspace context and output format instructions
- Generate the requested number of example emails following the specified strategy
- Format output as markdown ready for admin review
- Do NOT auto-ingest — return the examples as text. Admin will review, edit, then run the CLI to ingest.
- Include suggested tags and CLI command in the output

---

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
Always include "strategy" and "references" fields.

---

## FINAL CHECK

Before returning ANY generated copy (cold outreach, reply suggestion, KB examples, or any other mode), verify it contains ZERO em dashes, ZERO en dashes, and ZERO banned phrases from the list in Shared Quality Rules rule 1. If you find any, rewrite the offending lines before returning.`;

const writerConfig: AgentConfig = {
  name: "writer",
  model: "claude-sonnet-4-20250514",
  systemPrompt: WRITER_SYSTEM_PROMPT + USER_INPUT_GUARD,
  tools: writerTools,
  maxSteps: 10,
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
