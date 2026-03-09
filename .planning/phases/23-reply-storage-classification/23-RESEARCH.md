# Phase 23: Reply Storage & Classification - Research

**Researched:** 2026-03-09
**Domain:** Reply persistence, LLM classification, admin UI for reply management
**Confidence:** HIGH

## Summary

Phase 23 adds a `Reply` model to persist every inbound reply with full body text, then classifies each reply by intent (9 categories), sentiment (3 levels), and objection subtype (6 types) using Claude Haiku via the Vercel AI SDK's `generateObject`. The project already has an established pattern for structured LLM output: Zod schema + `anthropic("claude-haiku-4-5-20251001")` + `generateObject`, used in ICP scoring, company normalization, job title normalization, and industry classification.

The webhook handler (`src/app/api/webhooks/emailbison/route.ts`) already captures replies as `WebhookEvent` records but only stores the raw payload JSON -- not structured reply data. The handler has `maxDuration=60` and Haiku classification takes ~200ms, so inline classification is feasible. The poll-replies cron (`src/app/api/cron/poll-replies/route.ts`) catches missed replies and must use the same classification pipeline.

The admin UI follows the established pattern: client-side pages with `nuqs` for URL state, `use-debounce` for search, recharts v3.7.0 for charts, and server API routes returning paginated JSON. The webhook-log page is the closest structural match for the replies page.

**Primary recommendation:** Create a `Reply` model, extract a `classifyReply()` function using `generateObject`, wire it into both webhook handler and poll-replies cron, and build a `/admin/replies` page with filterable table + side panel + charts.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Dedicated `/admin/replies` page with filterable list of all replies across workspaces
- Default view: all replies, newest first, with filters at top (workspace dropdown, intent filter chips, sentiment filter, date range)
- Also inline as a tab on campaign detail page, scoped to that campaign
- Each reply row shows: sender name/email, subject line, intent badge, sentiment badge, workspace tag, timestamp, first ~100 chars of body preview (dense layout)
- Click a row -> side panel slides out showing full body, all classification details, linked campaign, person info, link to reply in EmailBison inbox
- Summary stats + mini charts at top of replies page (intent distribution, sentiment bar, counts by workspace)
- Detailed classification breakdown charts also on Intelligence Hub (Phase 28)
- Admin can override a classification by clicking the intent badge -> dropdown to reclassify
- Store both original AI classification and admin override: `originalIntent`, `overrideIntent`, `overriddenAt`, `overriddenBy`
- Store reply body as plain text only (strip HTML). Link to EmailBison inbox for full formatted view
- Capture `sequenceStep` number from EmailBison webhook payload (critical for Phase 24 per-step analytics)
- Snapshot the outbound email that triggered the reply: store subject + body alongside the reply
- Store a 1-line LLM-generated summary explaining the classification reasoning
- Classify inline in the webhook handler -- Haiku is ~200ms, webhook has maxDuration=60
- Classification runs before `generateReplySuggestion()` -- classification context feeds into better reply suggestions
- Store reply first, then classify. If classification fails, reply is never lost
- Failed classifications stored with `intent=null`. A periodic retry cron picks up unclassified replies
- Poll-replies cron uses the same classification flow

### Claude's Discretion
- Visual style of intent and sentiment badges (color-coded pills, icons, etc.)
- Side panel layout and styling
- Chart types for classification breakdown (pie, bar, donut, etc.)
- Classification retry cron frequency and backoff strategy
- How to handle edge cases: multi-intent replies, very short replies, non-English text

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| REPLY-01 | Admin can see every reply stored with full body text, sender, subject, timestamp, and linked campaign | Reply model schema, webhook/poll-replies integration points, admin page pattern from webhook-log |
| REPLY-02 | Each reply is automatically classified by intent (9 categories) | `generateObject` + Zod schema pattern from ICP scorer, classification prompt design |
| REPLY-03 | Each reply is automatically scored for sentiment (3 levels) alongside intent | Combined classification in single LLM call (cheaper, faster than separate calls) |
| REPLY-04 | Objection replies are automatically sub-classified by type (6 types) | Conditional field in Zod schema -- objectionSubtype only when intent=objection |
| REPLY-05 | Classification runs automatically on webhook receipt and poll-replies cron | Webhook handler integration point identified, poll-replies cron integration point identified |
| REPLY-06 | Admin can view classification breakdown per campaign and per workspace | Recharts v3.7.0 already in project, API route pattern for aggregation queries |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Prisma | 6.19.2 | Reply model, queries, migrations | Already the ORM for all models |
| Vercel AI SDK (`ai`) | 6.0.97 | `generateObject` for structured classification | Already used in ICP scorer, normalizers |
| `@ai-sdk/anthropic` | 3.0.46 | Claude Haiku 4.5 model provider | Already used project-wide |
| Zod | 4.3.6 | Classification output schema | Already used for all `generateObject` calls |
| Recharts | 3.7.0 | Classification breakdown charts | Already used in 10+ components |
| nuqs | 2.8.8 | URL state for filters | Already used in webhook-log page |
| use-debounce | 10.1.0 | Debounced search input | Already used in webhook-log page |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lucide-react | 0.575.0 | Icons for badges, UI elements | Already installed |
| date-fns | (not installed) | Date formatting for timestamps | **Not needed** -- use native `Intl.DateTimeFormat` or `toLocaleDateString()` to avoid adding dependency |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Claude Haiku for classification | GPT-4o-mini | Haiku is already the project standard, ~200ms, cheap ($0.25/$1.25 per 1M tokens) |
| Single combined classification call | Separate intent + sentiment calls | Single call is 2x cheaper, 2x faster, and avoids race conditions |
| Storing HTML body | Plain text only | User decision: strip HTML, link to EmailBison inbox for formatted view |

**Installation:**
```bash
# No new packages needed -- everything is already installed
# Only need: prisma migrate for new Reply model
npx prisma migrate dev --name add-reply-model
```

## Architecture Patterns

### Recommended Project Structure
```
prisma/
  schema.prisma              # Add Reply model
src/
  lib/
    classification/
      classify-reply.ts      # classifyReply() using generateObject
      types.ts               # Intent, Sentiment, ObjectionSubtype enums
      strip-html.ts          # HTML to plain text converter
  app/
    api/
      replies/
        route.ts             # GET /api/replies (paginated, filtered)
        [id]/
          route.ts           # PATCH /api/replies/:id (override classification)
        stats/
          route.ts           # GET /api/replies/stats (aggregation for charts)
      cron/
        retry-classification/
          route.ts           # Retry failed classifications
    (admin)/
      replies/
        page.tsx             # Main replies page
  components/
    replies/
      reply-table.tsx        # Dense table with badge columns
      reply-side-panel.tsx   # Slide-out detail panel
      reply-stats.tsx        # Summary stats + mini charts
      intent-badge.tsx       # Color-coded intent pill with override dropdown
      sentiment-badge.tsx    # Sentiment indicator
```

### Pattern 1: Reply Model Schema
**What:** Prisma model for persisted replies with classification fields
**When to use:** Database schema design

```prisma
model Reply {
  id             String   @id @default(cuid())
  workspaceSlug  String

  // Core reply data
  senderEmail    String
  senderName     String?
  subject        String?
  bodyText       String       // Plain text, HTML stripped
  receivedAt     DateTime

  // EmailBison linkage
  emailBisonReplyId  Int?    @unique  // EB reply.id for dedup
  campaignId         String? // Outsignal campaign ID (looked up from EB campaign_id)
  campaignName       String? // Denormalized for display
  sequenceStep       Int?    // data.scheduled_email.sequence_step_order

  // Outbound email snapshot (for copy analysis in Phase 25)
  outboundSubject  String?
  outboundBody     String?

  // Classification (null = not yet classified or classification failed)
  intent           String?  // interested|meeting_booked|objection|referral|not_now|unsubscribe|out_of_office|auto_reply|not_relevant
  sentiment        String?  // positive|neutral|negative
  objectionSubtype String?  // budget|timing|competitor|authority|need|trust (only when intent=objection)
  classificationSummary String? // 1-line LLM reasoning
  classifiedAt     DateTime?

  // Override tracking
  overrideIntent       String?
  overrideSentiment    String?
  overrideObjSubtype   String?
  overriddenAt         DateTime?
  overriddenBy         String?  // admin email

  // Source tracking
  source           String   @default("webhook") // webhook|poll|backfill
  webhookEventId   String?  // Link to WebhookEvent for audit trail
  personId         String?  // Link to Person (looked up by email)

  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([workspaceSlug, receivedAt])
  @@index([workspaceSlug, intent])
  @@index([workspaceSlug, sentiment])
  @@index([campaignId])
  @@index([senderEmail])
  @@index([intent])
  @@index([classifiedAt])  // For retry cron: WHERE classifiedAt IS NULL
}
```

**Key design decisions:**
- `emailBisonReplyId` with `@unique` for dedup across webhook + poll-replies
- `campaignName` denormalized to avoid joins in list view
- `outboundSubject` + `outboundBody` snapshot avoids cross-referencing campaign sequences later
- `intent` is nullable -- null means classification pending/failed
- Separate override fields preserve the original AI classification for accuracy tracking
- `personId` is a soft link (no FK) consistent with project conventions

### Pattern 2: Classification Function
**What:** Single LLM call that returns intent + sentiment + objection subtype + summary
**When to use:** After storing the reply, before notification

```typescript
// src/lib/classification/classify-reply.ts
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

const ClassificationSchema = z.object({
  intent: z.enum([
    "interested", "meeting_booked", "objection", "referral",
    "not_now", "unsubscribe", "out_of_office", "auto_reply", "not_relevant"
  ]),
  sentiment: z.enum(["positive", "neutral", "negative"]),
  objectionSubtype: z.enum([
    "budget", "timing", "competitor", "authority", "need", "trust"
  ]).nullable().describe("Only set when intent is 'objection', null otherwise"),
  summary: z.string().max(200).describe(
    "One sentence explaining the classification reasoning"
  ),
});

export type ClassificationResult = z.infer<typeof ClassificationSchema>;

export async function classifyReply(params: {
  subject: string | null;
  bodyText: string;
  senderName: string | null;
  outboundSubject: string | null;
  outboundBody: string | null;
}): Promise<ClassificationResult> {
  const { object } = await generateObject({
    model: anthropic("claude-haiku-4-5-20251001"),
    schema: ClassificationSchema,
    prompt: `Classify this email reply from a cold outreach campaign.

REPLY:
From: ${params.senderName ?? "Unknown"}
Subject: ${params.subject ?? "(no subject)"}
Body: ${params.bodyText}

${params.outboundSubject ? `ORIGINAL OUTBOUND EMAIL:
Subject: ${params.outboundSubject}
Body: ${params.outboundBody ?? "(unavailable)"}` : ""}

Classify the reply intent, sentiment, and provide a 1-sentence summary explaining your reasoning.
If the intent is "objection", also classify the objection subtype. Otherwise set objectionSubtype to null.
For multi-intent replies, choose the PRIMARY intent (the most actionable one).
For very short replies (under 10 words), classify based on the likely meaning in a sales context.
For non-English text, classify based on your best understanding of the content.`,
  });

  return object;
}
```

### Pattern 3: Webhook Integration (Store-Then-Classify)
**What:** Insert reply first, classify second, update in place
**When to use:** In both webhook handler and poll-replies cron

```typescript
// In webhook handler, after existing WebhookEvent creation:

// 1. Upsert Reply record (store first, never lose data)
const reply = await prisma.reply.upsert({
  where: { emailBisonReplyId: replyId },
  create: { /* all fields */ },
  update: { /* update if polled earlier */ },
});

// 2. Classify (non-blocking for webhook response, but before notification)
try {
  const classification = await classifyReply({ ... });
  await prisma.reply.update({
    where: { id: reply.id },
    data: {
      intent: classification.intent,
      sentiment: classification.sentiment,
      objectionSubtype: classification.objectionSubtype,
      classificationSummary: classification.summary,
      classifiedAt: new Date(),
    },
  });
} catch (err) {
  console.error("Classification failed, will retry:", err);
  // Reply is saved with intent=null, retry cron will pick it up
}
```

### Pattern 4: Admin Page with Side Panel
**What:** Dense table with click-to-expand side panel
**When to use:** The replies list page

The webhook-log page is the closest pattern match. Key differences:
- Replies page adds a side panel (Sheet component from shadcn/ui)
- Filter chips for intent categories (like the existing ToggleChip pattern)
- Workspace dropdown filter
- Mini charts at the top (recharts PieChart or BarChart)

### Anti-Patterns to Avoid
- **Don't store HTML body:** User decision -- plain text only. Use a simple regex/DOM stripper.
- **Don't classify in a separate background job:** User wants inline classification before notification fires. Haiku is fast enough at ~200ms.
- **Don't create separate LLM calls for intent vs sentiment:** Single call is cheaper and more consistent.
- **Don't use FK for personId:** Project convention is soft links (no FK constraints) for cross-model references.
- **Don't compute chart aggregations on the client:** API route should return pre-aggregated data. `GROUP BY intent` and `GROUP BY sentiment` queries are cheap.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTML to plain text | Custom regex parser | Simple `replace(/<[^>]+>/g, '')` + decode entities | Full body isn't displayed -- just stored for classification. EB already provides `text_body` in most cases |
| Structured LLM output | JSON parsing + validation | `generateObject` from Vercel AI SDK | Handles schema validation, retries, type safety automatically |
| URL state management | useState + router.push | `nuqs` (already used) | Handles serialization, browser history, SSR compatibility |
| Paginated API responses | Custom pagination logic | Prisma `skip`/`take` + count (project pattern) | Already used in webhook-log API route |
| Date range filtering | Custom date picker | Simple preset buttons (24h, 7d, 30d) like notification-health page | One admin user, presets are faster than date pickers |

**Key insight:** EmailBison already provides `text_body` alongside `html_body` in webhook payloads and polled replies. Use `text_body` directly when available; only strip HTML as a fallback when `text_body` is null.

## Common Pitfalls

### Pitfall 1: Duplicate Replies from Webhook + Poll
**What goes wrong:** Same reply arrives via webhook AND gets picked up by poll-replies cron 10 minutes later, creating duplicate records.
**Why it happens:** Current dedup in poll-replies uses a time-window check on WebhookEvent, but with a new Reply model there's no dedup.
**How to avoid:** Use `emailBisonReplyId` (the EB `reply.id` field) as a unique constraint. Use `upsert` instead of `create`. The EB reply ID is present in both webhook (`data.reply.id`) and polled reply (`reply.id`) payloads.
**Warning signs:** Reply count is significantly higher than expected; same reply appears twice with different `source` values.

### Pitfall 2: Sequence Step Not Available for All Reply Types
**What goes wrong:** `data.scheduled_email.sequence_step_order` exists in LEAD_REPLIED webhook payloads but NOT in UNTRACKED_REPLY_RECEIVED (where `data.scheduled_email` is null) or polled replies (which have `scheduled_email_id` but not `sequence_step_order`).
**Why it happens:** Untracked replies aren't linked to a specific scheduled email. Polled replies from the EB API don't include the nested scheduled_email details.
**How to avoid:**
- For LEAD_REPLIED webhooks: extract from `data.scheduled_email.sequence_step_order` (verified in real payload)
- For polled replies: store null for `sequenceStep` -- it's a nice-to-have, not critical
- For untracked replies: store null -- these are replies to emails not tracked by EB
**Warning signs:** Large percentage of replies with null `sequenceStep`.

### Pitfall 3: Outbound Email Snapshot Availability
**What goes wrong:** User wants outbound subject + body stored with each reply, but this data isn't in the webhook payload.
**Why it happens:** The webhook payload contains the campaign ID and scheduled_email data, but not the actual outbound email content. The outbound content lives in the Campaign model's `emailSequence` JSON field.
**How to avoid:** When `campaignId` and `sequenceStep` are available, look up the Outsignal Campaign and extract the matching step's subject/body from `emailSequence`. This is a simple Prisma query + JSON parse. When not available (untracked replies), leave null.
**Warning signs:** Many replies missing outbound snapshot; verify with a count query after initial deployment.

### Pitfall 4: Classification Prompt Quality
**What goes wrong:** LLM misclassifies edge cases -- "Thanks, not interested right now" could be `not_now` or `objection`.
**Why it happens:** Cold email replies are often ambiguous, short, or contain multiple signals.
**How to avoid:**
- Include the original outbound email in the classification prompt for context
- Use clear intent definitions in the prompt (e.g., `not_now` = "explicitly says timing is wrong but doesn't rule out future", `objection` = "raises a specific concern about the product/service")
- The override system creates a training dataset to improve prompts over time
**Warning signs:** High override rate on specific intent categories.

### Pitfall 5: Campaign ID Mapping Between EmailBison and Outsignal
**What goes wrong:** EmailBison uses numeric campaign IDs; Outsignal uses cuid strings. Need to map between them.
**Why it happens:** The webhook payload provides `data.campaign.id` (EB numeric ID) but the Reply model should reference the Outsignal campaign for internal consistency.
**How to avoid:** Look up `Campaign` by `emailBisonCampaignId` (already done in webhook handler line 188-189). Store both the Outsignal `campaignId` and denormalized `campaignName` on the Reply.
**Warning signs:** Replies with null `campaignId` that should have one.

## Code Examples

### Verified: EmailBison Webhook Payload Fields (from real data)

```typescript
// LEAD_REPLIED webhook payload structure (verified from production data):
{
  event: { type: "LEAD_REPLIED", workspace_name: "Rise" },
  data: {
    reply: {
      id: 9501,                          // Use as emailBisonReplyId for dedup
      email_subject: "Re: headwear ideas",
      text_body: "Hi Charlie, ...",       // Plain text -- use directly
      html_body: "<div>...</div>",        // HTML version -- ignore per user decision
      from_name: "Tania Ahmad",
      from_email_address: "tania@example.com",
      primary_to_email_address: "charlie@riseheadwearusa.com",
      interested: false,
      automated_reply: false,
      date_received: "2026-03-06T10:39:34.000000Z",
      campaign_id: 36,                    // EB campaign ID (numeric)
    },
    scheduled_email: {
      sequence_step_id: 169,
      sequence_step_order: 1,             // <-- THIS is the sequence step number
      sequence_step_variant: null,
    },
    campaign: {
      id: 40,
      name: "Marketing_US_11:200",
    },
    lead: {
      id: 18866,
      email: "aaron.thompson@linearb.io",
      first_name: "Aaron",
      last_name: "Thompson",
    },
  }
}

// POLLED_REPLY payload structure (verified from production data):
{
  source: "poll",  // or "backfill"
  reply: {
    id: 8935,                            // EB reply ID
    subject: "Re: headwear ideas",
    text_body: "Hi Charlie, ...",
    from_name: "Tania Ahmad",
    from_email_address: "tania@example.com",
    campaign_id: 36,
    scheduled_email_id: 767931,          // Has ID but NOT sequence_step_order
    // No scheduled_email nested object with step details
  }
}
```

### Verified: Existing generateObject Pattern

```typescript
// Source: src/lib/normalizer/company.ts (verified from codebase)
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

const Schema = z.object({
  canonical: z.string().min(1).max(200),
  confidence: z.enum(["high", "medium", "low"]),
});

const { object } = await generateObject({
  model: anthropic("claude-haiku-4-5-20251001"),
  schema: Schema,
  prompt: `...`,
});
```

### Verified: Admin Page Pattern (webhook-log)

```typescript
// Source: src/app/(admin)/webhook-log/page.tsx (verified from codebase)
// Key patterns used:
// - "use client" with useState/useEffect
// - nuqs for URL state: useQueryStates with parseAsString, parseAsInteger
// - use-debounce for search input
// - ToggleChip component for filter pills
// - fetch() to internal API route for data
// - Paginated table with total/page/totalPages
```

### HTML Stripping (Simple Approach)

```typescript
// src/lib/classification/strip-html.ts
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')           // Preserve line breaks
    .replace(/<\/p>/gi, '\n\n')               // Paragraph breaks
    .replace(/<[^>]+>/g, '')                  // Strip all tags
    .replace(/&amp;/g, '&')                   // Decode common entities
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')              // Collapse excessive newlines
    .trim();
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Raw webhook JSON storage | Structured Reply model with classification | This phase | Enables analytics, filtering, and insights |
| No classification | Inline Haiku classification | This phase | 9-category intent taxonomy with sentiment |
| Manual reply review in EmailBison inbox | Admin dashboard with overview + filters | This phase | Admin sees all replies across workspaces in one place |

**Current model versions:**
- Claude Haiku 4.5: `claude-haiku-4-5-20251001` -- used in project, ~200ms latency, $0.25/$1.25 per 1M input/output tokens
- Zod v4: Project uses `zod@4.3.6` -- works with `generateObject` in AI SDK v6

## Open Questions

1. **Outbound email content for polled replies**
   - What we know: Polled replies have `campaign_id` but not `sequence_step_order`. They DO have `scheduled_email_id`.
   - What's unclear: Can we reliably determine which sequence step a polled reply came from using `scheduled_email_id`? Would need to call EB API for scheduled email details, which adds latency.
   - Recommendation: For polled replies, look up the campaign and if there's only 1 step (common), use that. Otherwise store null for `sequenceStep` and `outboundBody`. The webhook path (which handles ~83% of replies based on event counts) will have full data.

2. **Classification retry cron endpoint**
   - What we know: Cron-job.org has a 30s timeout. Classification takes ~200ms per reply.
   - What's unclear: How many failed classifications will accumulate? At current volume (~5-20 replies/day), unlikely to have many.
   - Recommendation: Retry up to 50 unclassified replies per cron run. Run every 30 minutes. Use existing cron-job.org for scheduling. Endpoint at `/api/cron/retry-classification`.

3. **Backfilling existing replies**
   - What we know: There are 63 LEAD_REPLIED + 13 POLLED_REPLY + 918 UNTRACKED_REPLY events in WebhookEvent already.
   - What's unclear: Should we backfill these into the Reply model?
   - Recommendation: Yes, create a one-time backfill script (similar to existing `backfill-replies` cron). Extract from WebhookEvent payloads. Most UNTRACKED_REPLY events are automated (DSN, OOO) so filter those out. Real reply count is likely ~100-150.

## Sources

### Primary (HIGH confidence)
- Prisma schema: `/Users/jjay/programs/outsignal-agents/prisma/schema.prisma` -- all existing models, patterns
- Webhook handler: `/Users/jjay/programs/outsignal-agents/src/app/api/webhooks/emailbison/route.ts` -- current reply handling flow
- Poll-replies cron: `/Users/jjay/programs/outsignal-agents/src/app/api/cron/poll-replies/route.ts` -- fallback reply capture
- ICP scorer: `/Users/jjay/programs/outsignal-agents/src/lib/icp/scorer.ts` -- `generateObject` pattern with Haiku
- Company normalizer: `/Users/jjay/programs/outsignal-agents/src/lib/normalizer/company.ts` -- `generateObject` pattern
- EmailBison types: `/Users/jjay/programs/outsignal-agents/src/lib/emailbison/types.ts` -- Reply interface
- Real webhook payloads: Production `WebhookEvent` records (LEAD_REPLIED, POLLED_REPLY) -- verified field availability
- Webhook-log page: `/Users/jjay/programs/outsignal-agents/src/app/(admin)/webhook-log/page.tsx` -- admin page pattern

### Secondary (MEDIUM confidence)
- Recharts v3.7.0 API: Project already has 10+ chart components using BarChart, LineChart, PieChart patterns
- Vercel AI SDK `generateObject` docs: Verified via project usage, handles schema validation and retries

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in project, zero new dependencies
- Architecture: HIGH -- patterns verified from 5+ existing implementations in codebase
- Classification design: HIGH -- `generateObject` + Haiku pattern proven in ICP scorer and normalizers
- Webhook payload fields: HIGH -- verified against real production data from WebhookEvent table
- Pitfalls: HIGH -- identified from real payload analysis and codebase inspection

**Research date:** 2026-03-09
**Valid until:** 2026-04-09 (stable -- internal project, no external API changes expected)
