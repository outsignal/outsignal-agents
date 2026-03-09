# Architecture Patterns

**Domain:** Campaign Intelligence Hub — reply classification, analytics, insights, action queue
**Researched:** 2026-03-09
**Confidence:** HIGH (all integration points verified against existing codebase)

## Executive Summary

The Campaign Intelligence Hub adds a feedback loop to the existing outbound pipeline. Today, replies arrive via webhook/polling, update person status, send notifications, and stop. The intelligence layer intercepts this same flow to classify replies, aggregate performance metrics, generate AI insights, and surface actionable recommendations. The architecture integrates with 4 existing touchpoints (webhook handler, poll-replies cron, dashboard stats API, agent framework) without disrupting them.

The key architectural decision: **pre-compute analytics to CachedMetrics (already in schema, currently unused) via cron, not on-demand**. This avoids slow cross-workspace queries on Neon serverless at dashboard request time. The classifier hooks into the webhook handler using the same fire-and-forget pattern already proven by `generateReplySuggestion`.

---

## System Architecture

```
                              EXISTING                                    NEW
                           +-----------+                          +------------------+
  EmailBison webhook ----->| Webhook   |---> WebhookEvent ------->| Reply Classifier |
  Poll-replies cron ------>| Handler   |     (already stored)     | (inline + cron)  |
                           +-----------+                          +------------------+
                                                                         |
                                                                         v
                                                                  +------------------+
                                                                  | ReplyClassification |
                                                                  | (new model)       |
                                                                  +------------------+
                                                                         |
                                +----------------------------------------+
                                |                                        |
                                v                                        v
                         +------------------+                   +------------------+
                         | Analytics Cron   |                   | Insight Generator |
                         | (aggregate to    |                   | (AI agent, daily) |
                         | CachedMetrics)   |                   +------------------+
                         +------------------+                            |
                                |                                        v
                                v                                +------------------+
                         +------------------+                    | Insight          |
                         | Intelligence Hub |<-------------------| (new model)      |
                         | Dashboard Page   |                    +------------------+
                         +------------------+                            |
                                ^                                        v
                                |                                +------------------+
                                +--------------------------------| AdminAction      |
                                                                 | (action queue)   |
                                                                 +------------------+
```

---

## Component Boundaries

| Component | Responsibility | Communicates With | New or Modified |
|-----------|---------------|-------------------|-----------------|
| Reply Classifier | Classify reply intent, sentiment, objections, buying signals | WebhookEvent (reads), ReplyClassification (writes) | **NEW** `src/lib/intelligence/classifier.ts` |
| Analytics Aggregator | Compute campaign rankings, strategy comparison, cross-workspace benchmarks | ReplyClassification, Campaign, WebhookEvent, PersonWorkspace (reads), CachedMetrics (writes) | **NEW** `src/lib/intelligence/aggregator.ts` |
| Insight Generator | AI-powered analysis of aggregated data, produces actionable cards | CachedMetrics, ReplyClassification (reads), Insight (writes) | **NEW** `src/lib/intelligence/insight-generator.ts` |
| Action Queue | Store and manage admin-facing suggested optimizations | Insight (reads), AdminAction (writes/reads) | **NEW** `src/lib/intelligence/action-queue.ts` |
| Intelligence Hub Page | Dashboard page rendering insights, analytics, action queue | All intelligence API endpoints (reads) | **NEW** `src/app/(admin)/intelligence/page.tsx` |
| Webhook Handler | Process EmailBison webhooks | ReplyClassifier (calls after event storage) | **MODIFIED** — add classifier hook (3-5 lines) |
| Poll-Replies Cron | Catch missed replies | ReplyClassifier (calls after processing) | **MODIFIED** — add classifier hook (3-5 lines) |
| Dashboard Stats API | Aggregate KPIs for main dashboard | CachedMetrics (reads pre-computed data) | **MODIFIED** — add intelligence summary KPIs |
| Digest Notifier | Send periodic Slack/email summaries of top insights | Insight (reads), notifications.ts (uses) | **NEW** `src/lib/intelligence/digest.ts` |

---

## New Prisma Models

### ReplyClassification

Stores the AI classification result for each reply. One-to-one with the WebhookEvent that triggered it.

```prisma
model ReplyClassification {
  id              String   @id @default(cuid())
  webhookEventId  String   @unique  // FK to WebhookEvent.id
  workspaceSlug   String
  campaignId      String?  // Outsignal campaign ID (resolved from emailBisonCampaignId)
  campaignName    String?  // Denormalized for query convenience

  // Classification outputs
  intent          String   // "interested" | "not_interested" | "objection" | "question" | "referral" | "ooo" | "unsubscribe" | "other"
  sentiment       Float    // -1.0 to 1.0
  objectionType   String?  // "budget" | "timing" | "authority" | "need" | "competitor" | "satisfaction" | null
  buyingSignals   String?  // JSON array: ["asked_pricing", "requested_demo", "mentioned_timeline", ...]
  urgency         String   @default("normal") // "hot" | "warm" | "normal" | "cold"

  // Context
  leadEmail       String
  replySnippet    String?  // First 200 chars of reply body (for admin review without re-fetching)
  sequenceStep    Int?     // Which step triggered the reply (if resolvable)

  // Metadata
  classifiedBy    String   @default("haiku") // "haiku" | "rule" | "manual"
  confidence      Float    @default(0.8)     // 0-1 classifier confidence
  classifiedAt    DateTime @default(now())

  @@index([workspaceSlug, classifiedAt])
  @@index([campaignId])
  @@index([intent])
  @@index([workspaceSlug, intent])
}
```

**Design decisions:**
- `webhookEventId` is unique (1:1 with event) — one classification per reply event, reclassify = update in place.
- `campaignName` denormalized because analytics queries group by campaign name constantly; joining through Campaign -> emailBisonCampaignId -> WebhookEvent for every query is expensive on Neon.
- `buyingSignals` is JSON rather than a separate table — read-only after classification, never queried by individual signal.
- `sequenceStep` enables "which sequence step generates the most replies?" analysis.
- No FK to WebhookEvent — keeping it as a soft reference (same pattern as `SignalEvent.companyDomain` and `SignalCampaignLead.signalEventId`). WebhookEvent has no FK constraints on any existing references either.

### Insight

Stores AI-generated insight cards, generated periodically and presented to the admin.

```prisma
model Insight {
  id              String   @id @default(cuid())
  workspaceSlug   String?  // null = cross-workspace insight
  category        String   // "campaign_performance" | "icp_calibration" | "strategy_comparison" | "anomaly" | "benchmark"
  title           String   // Short headline: "Rise email campaign outperforms LinkedIn 3:1"
  body            String   // 2-3 sentence explanation with data points
  dataSnapshot    String?  // JSON — the metrics that support this insight (for audit)
  priority        Int      @default(5) // 1=critical, 5=informational
  status          String   @default("active") // "active" | "dismissed" | "actioned" | "expired"
  expiresAt       DateTime? // Auto-expire after 30 days if not actioned

  generatedAt     DateTime @default(now())
  generatedBy     String   @default("insight-agent") // "insight-agent" | "manual"

  actions         AdminAction[]

  @@index([status, priority])
  @@index([workspaceSlug, status])
  @@index([category])
  @@index([generatedAt])
}
```

### AdminAction

Suggested optimizations attached to insights. Admin can approve/dismiss/defer.

```prisma
model AdminAction {
  id          String   @id @default(cuid())
  insightId   String
  type        String   // "pause_campaign" | "adjust_icp_threshold" | "switch_strategy" | "increase_volume" | "retire_sender" | "custom"
  title       String   // "Pause Rise Q1 campaign - 0.2% reply rate after 500 sends"
  detail      String?  // Implementation details or rationale
  metadata    String?  // JSON — structured data for auto-execution (campaignId, threshold, etc.)
  status      String   @default("pending") // "pending" | "approved" | "dismissed" | "deferred" | "executed"
  deferUntil  DateTime? // When deferred, re-surface after this date
  decidedAt   DateTime?
  decidedBy   String?  // admin email

  insight     Insight  @relation(fields: [insightId], references: [id], onDelete: Cascade)

  createdAt   DateTime @default(now())

  @@index([status])
  @@index([insightId])
}
```

**Design decisions:**
- Actions are separate from Insights (1:many) because one insight can suggest multiple actions ("Campaign X underperforms" -> "Pause campaign" + "Switch to creative-ideas strategy").
- `metadata` JSON enables future auto-execution: if admin approves "pause_campaign", the system reads `{ campaignId: "abc123" }` and executes.
- `deferUntil` supports the "remind me later" workflow without losing the insight.

---

## Integration Points — Detailed

### 1. Reply Classification Hook

**Where:** Webhook handler (`src/app/api/webhooks/emailbison/route.ts` line ~153) and poll-replies cron (`src/app/api/cron/poll-replies/route.ts` line ~110)

**How:** After WebhookEvent is created and person status is updated, call the classifier. Classification is **non-blocking** (fire-and-forget) — same proven pattern as `generateReplySuggestion` at webhook handler line 354.

```typescript
// In webhook handler, after webhookEvent.create (line 153):
if (["LEAD_REPLIED", "LEAD_INTERESTED", "UNTRACKED_REPLY_RECEIVED"].includes(eventType) && !isAutomatedFlag) {
  classifyReply({
    webhookEventId: webhookEvent.id,
    workspaceSlug,
    leadEmail: leadEmail ?? "",
    subject,
    body: textBody,
    campaignId,
    interested,
  }).catch(err => console.error("[classify] Error:", err));
}
```

**Same hook in poll-replies cron** (after `webhookEvent.create` at line ~110):
```typescript
classifyReply({
  webhookEventId: event.id,
  workspaceSlug: ws.slug,
  leadEmail: reply.from_email_address,
  subject: reply.subject,
  body: reply.text_body,
  campaignId: reply.campaign_id?.toString() ?? null,
  interested: reply.interested,
}).catch(err => console.error("[classify] Error:", err));
```

**Important:** The classifier is a pure function (no side effects beyond writing ReplyClassification). Safe for background execution. The webhook returns 200 immediately.

### 2. Reply Classifier Implementation

**Two-tier approach:**

**Tier 1 — Rule-based (fast, free, ~60% of replies):**
```typescript
function ruleBasedClassify(reply: ReplyData): Partial<Classification> | null {
  if (reply.interested) return { intent: "interested", confidence: 0.95, classifiedBy: "rule" };
  if (/out of office|ooo|away from/i.test(reply.body)) return { intent: "ooo", confidence: 0.99, classifiedBy: "rule" };
  if (/unsubscribe|remove me|stop emailing/i.test(reply.body)) return { intent: "unsubscribe", confidence: 0.95, classifiedBy: "rule" };
  if (/not interested|no thanks|pass|not for us/i.test(reply.body)) return { intent: "not_interested", confidence: 0.85, classifiedBy: "rule" };
  return null; // Fall through to AI
}
```

**Tier 2 — AI classification (Haiku, ~$0.002 per reply):**
Use `generateObject` from the AI SDK — NOT the agent runner. Classification is a single deterministic call with structured output. The runner adds unnecessary overhead (AgentRun record, tool loop, JSON parsing).

```typescript
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

const classificationSchema = z.object({
  intent: z.enum(["interested", "not_interested", "objection", "question", "referral", "ooo", "unsubscribe", "other"]),
  sentiment: z.number().min(-1).max(1),
  objectionType: z.enum(["budget", "timing", "authority", "need", "competitor", "satisfaction"]).nullable(),
  buyingSignals: z.array(z.string()),
  urgency: z.enum(["hot", "warm", "normal", "cold"]),
  confidence: z.number().min(0).max(1),
});

const result = await generateObject({
  model: anthropic("claude-haiku-4-5-20251001"),
  schema: classificationSchema,
  prompt: `Classify this cold outreach reply. Context: outbound email campaign for ${workspaceVertical}.

Subject: ${subject}
Body: ${body}

Classify intent, sentiment (-1 to 1), any objection type, buying signals, and urgency.`,
});
```

**Why `generateObject` not `runAgent`:** Classification is a single-shot structured output. The runner creates AgentRun records, supports multi-step tool loops, and handles JSON extraction — all unnecessary overhead for classification. `generateObject` returns typed data directly.

**Cost projection:** At current volume (~50-100 replies/month, ~40% hitting AI tier), classification costs ~$0.04-0.08/month. Negligible.

### 3. Analytics Aggregation — CachedMetrics

**Strategy:** Use the existing `CachedMetrics` model (already in schema at line 241, unique constraint on `[workspace, metricType]`, currently unused in any source file). A dedicated cron job computes aggregates and writes to CachedMetrics. Dashboard reads from CachedMetrics instead of computing on-demand.

**Why not on-demand computation:**
- Cross-workspace queries on Neon serverless have cold-start latency (~50-100ms connection setup per query through Neon's proxy).
- Aggregating across WebhookEvent (growing at ~5K rows/year), Campaign, ReplyClassification requires multiple joins.
- A 6-workspace GROUP BY with date bucketing and campaign resolution: 2-5 seconds on cold connections.
- CachedMetrics reads are single-row lookups by unique `[workspace, metricType]`: fast regardless of data volume.

**MetricType keys:**

| metricType | Data Shape | Refresh Frequency |
|------------|-----------|-------------------|
| `campaign_rankings_{workspace}` | Sorted campaigns by reply rate, interested rate, intent breakdown | Every 6 hours |
| `campaign_rankings_all` | Cross-workspace rankings | Every 6 hours |
| `strategy_comparison_{workspace}` | Performance by copyStrategy (creative-ideas vs pvp vs one-liner) | Every 6 hours |
| `strategy_comparison_all` | Cross-workspace strategy comparison | Every 6 hours |
| `intent_breakdown_{workspace}` | Reply intent distribution (counts per intent type) | Every 6 hours |
| `intent_breakdown_all` | Cross-workspace intent distribution | Every 6 hours |
| `icp_calibration_{workspace}` | ICP score buckets vs conversion rate correlation | Daily |
| `sequence_step_analysis_{workspace}` | Reply rates by sequence step position | Daily |
| `workspace_benchmarks` | Cross-workspace averages (reply rate, interested rate, bounce rate) | Daily |
| `weekly_digest_{workspace}` | Summary stats for digest notification | Weekly |

**Cron endpoint:** `GET /api/cron/compute-intelligence` (protected by CRON_SECRET, same auth pattern as poll-replies)

**Query param routing:**
- `?scope=frequent` — campaign rankings, strategy comparison, intent breakdown (runs every 6 hours)
- `?scope=daily` — ICP calibration, sequence step analysis, benchmarks (runs daily at 5am UTC)
- `?scope=insights` — AI insight generation (runs daily after daily aggregation, 6am UTC)

**Scheduling:** External cron (cron-job.org) — cannot use Vercel cron (Hobby plan limit of 2 already saturated by enrichment + inbox-health). cron-job.org already used for poll-replies and inbox-health. Free tier supports unlimited jobs.

### 4. ICP Score Calibration Query

**Question:** "Do high ICP scores actually convert?"

**Data path:** `PersonWorkspace.icpScore` + `Person.status` (replied/interested) + `ReplyClassification.intent`

**Implementation:** Raw SQL via `prisma.$queryRaw` because Prisma's `groupBy` doesn't support CASE expressions.

```sql
SELECT
  CASE
    WHEN pw."icpScore" >= 80 THEN '80-100'
    WHEN pw."icpScore" >= 60 THEN '60-79'
    WHEN pw."icpScore" >= 40 THEN '40-59'
    ELSE '0-39'
  END AS score_bucket,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE p.status IN ('replied', 'interested')) AS converted,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE p.status IN ('replied', 'interested')) / NULLIF(COUNT(*), 0),
    1
  ) AS conversion_pct
FROM "LeadWorkspace" pw
JOIN "Lead" p ON p.id = pw."leadId"
WHERE pw."icpScore" IS NOT NULL
  AND pw.workspace = $1
GROUP BY 1
ORDER BY 1 DESC;
```

Result stored in `CachedMetrics` key `icp_calibration_{workspace}`.

### 5. Campaign Performance Ranking Query

**Data path:** `Campaign` + `WebhookEvent` (joined via `emailBisonCampaignId`) + `ReplyClassification`

```typescript
// For each campaign in workspace:
const campaigns = await prisma.campaign.findMany({
  where: { workspaceSlug: slug, status: { in: ["active", "paused", "completed"] } },
  select: {
    id: true, name: true, copyStrategy: true, type: true,
    emailBisonCampaignId: true, deployedAt: true,
  },
});

// For each campaign, count events by type
for (const campaign of campaigns) {
  if (!campaign.emailBisonCampaignId) continue;
  const events = await prisma.webhookEvent.groupBy({
    by: ["eventType"],
    where: {
      workspace: slug,
      campaignId: campaign.emailBisonCampaignId.toString(),
      isAutomated: false,
    },
    _count: { eventType: true },
  });
  // Compute rates: replyRate = replies/sent, interestedRate = interested/sent
}
```

**Strategy comparison** groups the same data by `Campaign.copyStrategy` instead of individual campaigns.

### 6. Insight Generator — Agent Framework Integration

Uses existing agent framework. New agent config following the established `AgentConfig` pattern.

```typescript
// src/lib/intelligence/insight-generator.ts
const intelligenceConfig: AgentConfig = {
  name: "intelligence",
  model: "claude-haiku-4-5-20251001",  // Cheap, fast — structured data analysis
  systemPrompt: `You are an outbound campaign performance analyst for a B2B lead generation agency.
You analyze pre-computed metrics and generate actionable insights.
Each insight must be specific, data-backed, and suggest a concrete action.
Do not generate generic advice. Every insight must reference specific numbers.`,
  tools: {
    getCachedMetrics,   // Read pre-computed analytics from CachedMetrics
    getRecentClassifications,  // Read recent reply classifications
    getWorkspaceContext,  // Read workspace ICP/vertical for context
    createInsight,  // Write Insight record
    createAction,   // Write AdminAction record
  },
  maxSteps: 15,
};
```

**Why Haiku:** Insight generation is high-volume, low-complexity. Inputs are already structured (CachedMetrics JSON). Haiku handles pattern matching and summarization well. Cost: ~$0.01-0.03 per daily run across 6 workspaces.

**Trigger:** Runs via the same `/api/cron/compute-intelligence?scope=insights` endpoint, 1 hour after daily aggregation completes (so aggregated data is fresh).

### 7. Intelligence Hub Dashboard Page

**Route:** `src/app/(admin)/intelligence/page.tsx`

**API Endpoints:**

| Endpoint | Method | Data Source | Purpose |
|----------|--------|------------|---------|
| `/api/intelligence/rankings` | GET | CachedMetrics `campaign_rankings_*` | Campaign performance table |
| `/api/intelligence/strategies` | GET | CachedMetrics `strategy_comparison_*` | Copy strategy comparison chart |
| `/api/intelligence/intents` | GET | CachedMetrics `intent_breakdown_*` | Reply intent distribution |
| `/api/intelligence/icp-calibration` | GET | CachedMetrics `icp_calibration_*` | ICP score vs conversion scatter |
| `/api/intelligence/insights` | GET | Insight model (active, sorted by priority) | Insights feed |
| `/api/intelligence/actions` | GET | AdminAction model (pending/deferred) | Action queue list |
| `/api/intelligence/actions/[id]` | PATCH | AdminAction model | Approve/dismiss/defer action |

**All endpoints support `?workspace=all` or `?workspace={slug}`** — same filter pattern as existing dashboard stats.

**Action queue UI interactions:**
- Approve: `PATCH /api/intelligence/actions/[id] { status: "approved" }` — optionally triggers auto-execution if `metadata` contains executable instructions
- Dismiss: `PATCH /api/intelligence/actions/[id] { status: "dismissed" }`
- Defer: `PATCH /api/intelligence/actions/[id] { status: "deferred", deferUntil: "2026-04-01" }`

### 8. Cross-Workspace Queries — Neon Performance

**Existing mitigations:**
- All relevant models have `@@index([workspaceSlug, ...])` or `@@index([workspace, ...])` indexes.
- CachedMetrics pre-computation means the dashboard never runs cross-workspace aggregation at request time.

**Additional mitigations for the aggregation cron:**
- Use `prisma.$transaction` for related queries to reuse the same connection through Neon's proxy.
- Compute per-workspace first, then derive cross-workspace from per-workspace results (sum/average). No single query spanning all data.
- The cron runs with `maxDuration=60` — plenty of time even with cold connections.

### 9. Digest Notifications

**Hook into existing `src/lib/notifications.ts`:**

Add a new notification type to the existing system. The digest cron reads `weekly_digest_{workspace}` from CachedMetrics, formats a summary, and sends via existing `postMessage` (Slack) and email infrastructure.

**Endpoint:** `GET /api/cron/intelligence-digest` (protected by CRON_SECRET)
**Schedule:** Weekly, Monday 8am UTC, via cron-job.org.

---

## File Structure — New Files

```
src/lib/intelligence/
  classifier.ts          # Reply classification (rule-based + AI)
  aggregator.ts          # Analytics computation, writes to CachedMetrics
  insight-generator.ts   # AI insight generation (uses agent framework)
  action-queue.ts        # AdminAction CRUD operations
  digest.ts              # Weekly digest notification builder
  types.ts               # Shared types for intelligence module

src/app/api/intelligence/
  rankings/route.ts      # GET campaign rankings
  strategies/route.ts    # GET strategy comparison
  intents/route.ts       # GET reply intent breakdown
  icp-calibration/route.ts # GET ICP score vs conversion
  insights/route.ts      # GET insights feed
  actions/route.ts       # GET pending actions
  actions/[id]/route.ts  # PATCH approve/dismiss/defer

src/app/api/cron/
  compute-intelligence/route.ts  # Aggregation + insight generation cron
  intelligence-digest/route.ts   # Weekly digest notification cron

src/app/(admin)/intelligence/
  page.tsx               # Intelligence Hub dashboard page
  components/
    CampaignRankings.tsx
    StrategyComparison.tsx
    IntentBreakdown.tsx
    IcpCalibration.tsx
    InsightsFeed.tsx
    ActionQueue.tsx
```

## Modified Files

| File | Change | Risk | Lines Affected |
|------|--------|------|----------------|
| `prisma/schema.prisma` | Add 3 new models (ReplyClassification, Insight, AdminAction) | LOW — purely additive | ~60 new lines |
| `src/app/api/webhooks/emailbison/route.ts` | Add classifier hook after line 153 | LOW — fire-and-forget, non-blocking | 5-8 lines added |
| `src/app/api/cron/poll-replies/route.ts` | Add classifier hook after line 110 | LOW — same pattern | 5-8 lines added |
| `src/app/(admin)/layout.tsx` | Add "Intelligence" nav link to sidebar | LOW — UI-only | 1-2 lines |
| `src/lib/agents/types.ts` | Add IntelligenceOutput type | LOW — additive | ~10 lines |

---

## Patterns to Follow

### Pattern 1: Non-Blocking Background Classification

**What:** Classify replies without blocking the webhook response. Same pattern as `generateReplySuggestion` (webhook handler lines 354-377).

**When:** Every non-automated reply event.

```typescript
// Fire-and-forget — webhook returns 200 immediately
classifyReply(params).catch(err => console.error("[classify]", err));
```

**Why:** The webhook handler already uses this for reply suggestions. Consistency + proven reliability. EmailBison expects sub-30s responses. Classification takes ~500ms-2s for AI, <10ms for rules.

### Pattern 2: CachedMetrics for Pre-Computed Analytics

**What:** Use the existing (but unused) CachedMetrics model as a key-value store for pre-computed aggregations.

**When:** Any analytics query that would require scanning large tables or joining across models.

```typescript
// Write (in cron)
await prisma.cachedMetrics.upsert({
  where: { workspace_metricType: { workspace: "rise", metricType: "campaign_rankings" } },
  create: { workspace: "rise", metricType: "campaign_rankings", data: JSON.stringify(rankings) },
  update: { data: JSON.stringify(rankings), computedAt: new Date() },
});

// Read (in API)
const cached = await prisma.cachedMetrics.findUnique({
  where: { workspace_metricType: { workspace: slug, metricType: "campaign_rankings" } },
});
const rankings = cached ? JSON.parse(cached.data) : null;
```

**Why:** Model already exists in schema with correct unique constraint `@@unique([workspace, metricType])`. Upsert is idempotent. `computedAt` timestamp lets the dashboard show data freshness ("Last updated 3 hours ago").

### Pattern 3: Agent for Multi-Step Analysis, generateObject for Classification

**What:** Use `runAgent` for insight generation (multi-step, needs tools). Use `generateObject` for reply classification (single-shot, structured output).

**Why:** The agent runner creates AgentRun audit records, supports tool loops, handles JSON extraction. Overkill for classification but valuable for insight generation where the AI reads metrics, identifies patterns, and creates multiple Insight/AdminAction records across tool calls.

### Pattern 4: External Cron for All Scheduled Work

**What:** Use cron-job.org for all new scheduled endpoints.

**When:** Analytics aggregation (every 6 hours), insight generation (daily), digest notifications (weekly).

**Why:** Vercel Hobby limited to 2 crons (both taken). cron-job.org already runs poll-replies + inbox-health. Free tier supports unlimited jobs with 30s timeout. All new endpoints respond with a trigger acknowledgment within 30s, actual computation runs with `maxDuration=60`.

### Pattern 5: Workspace Filter Consistency

**What:** All intelligence API endpoints accept `?workspace=all` or `?workspace={slug}`, matching the existing dashboard stats pattern.

**Why:** The existing dashboard stats API (`/api/dashboard/stats`) already implements this pattern with `wsFilter` and `wsFilterSlug` variables. Intelligence endpoints should be consistent so the frontend can share the workspace filter dropdown component.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Computing Analytics On-Demand in Dashboard

**What:** Running aggregate queries when the Intelligence Hub page loads.

**Why bad:** Neon serverless cold starts + complex joins across WebhookEvent/Campaign/ReplyClassification = 2-5 second page loads. Gets worse as data grows. Current dashboard stats already takes ~1-2s with simpler queries.

**Instead:** Pre-compute to CachedMetrics via cron. Dashboard reads single-row lookups. Show "Last updated: X minutes ago" timestamp.

### Anti-Pattern 2: Storing Classifications in WebhookEvent.payload

**What:** Appending classification data to the existing WebhookEvent JSON payload field.

**Why bad:** No indexing on JSON fields in Postgres without GIN indexes. Cannot query "all interested replies for campaign X" efficiently. Breaks single-responsibility (WebhookEvent = raw event storage, ReplyClassification = derived intelligence).

**Instead:** Separate ReplyClassification model with proper indexes and reference to WebhookEvent.

### Anti-Pattern 3: Using Materialized Views on Neon

**What:** Creating PostgreSQL materialized views for analytics.

**Why bad:** Prisma has no native support for materialized views — requires raw SQL for creation, refresh, and querying. `prisma db push` will not manage them. Adds operational complexity (manual migration scripts, refresh scheduling) for marginal benefit over CachedMetrics which provides the same outcome with full Prisma support.

**Instead:** CachedMetrics model — application-level materialized views with full Prisma ORM support.

### Anti-Pattern 4: Blocking Webhook Response for Classification

**What:** Awaiting classification before returning 200 to EmailBison.

**Why bad:** AI classification adds 500ms-2s. EmailBison may retry on slow responses. The existing reply suggestion already uses fire-and-forget at line 354 — classification should match.

**Instead:** Fire-and-forget, same as `generateReplySuggestion`.

### Anti-Pattern 5: One Giant Intelligence Agent

**What:** A single agent that classifies replies AND computes analytics AND generates insights AND manages actions.

**Why bad:** Context window fills up. Different tasks need different tool sets. Classification is high-frequency (every reply), insights are low-frequency (daily). Mixing wastes tokens and reduces quality.

**Instead:** Separate concerns: classifier function (no agent), aggregator function (no agent), insight agent (uses agent framework only where multi-step reasoning adds value).

### Anti-Pattern 6: Campaign Resolution via Email Text Matching

**What:** Trying to match replies to campaigns by parsing email body content or subject lines.

**Why bad:** Unreliable. Subject lines get modified by recipients. Body content varies.

**Instead:** Use `WebhookEvent.campaignId` (EmailBison's campaign ID), resolve to Outsignal campaign via `Campaign.emailBisonCampaignId`. This is the same path the existing webhook handler uses at line 188.

---

## Scalability Considerations

| Concern | Current (6 workspaces, ~100 replies/mo) | 20 Workspaces | 50+ Workspaces |
|---------|------------------------------------------|---------------|----------------|
| Reply classification | Inline fire-and-forget, <$0.10/mo | Inline, <$0.50/mo | Consider batch classification cron |
| Analytics aggregation | 6-hour cron, <30s runtime | 6-hour cron, ~60s | Split into per-workspace parallel jobs |
| CachedMetrics rows | ~60 rows | ~200 rows | Fine — single-row reads |
| Insight generation | 1 Haiku call/day (~6 workspaces) | 1-2 calls/day | Per-workspace agent runs |
| Dashboard page load | <200ms (CachedMetrics reads) | <300ms | <500ms (still just reads) |
| ReplyClassification table | ~1.2K rows/year | ~4K rows/year | No concern |
| WebhookEvent table | ~5K rows/year | ~20K rows/year | Consider date-based archival after 12 months |

---

## Suggested Build Order

Based on dependency analysis:

| Phase | Component | Depends On | Rationale |
|-------|-----------|-----------|-----------|
| 1 | Schema + Classifier | Nothing | Data foundation — everything reads from ReplyClassification |
| 2 | Analytics Aggregator + Cron | Phase 1 | Needs classified replies to compute meaningful metrics |
| 3 | Intelligence API Routes | Phase 2 | Endpoints that read from CachedMetrics |
| 4 | Intelligence Hub Page | Phase 3 | Dashboard UI consuming the APIs |
| 5 | Insight Generator Agent | Phases 1+2 | AI analysis of aggregated data |
| 6 | Action Queue | Phase 5 | Admin approve/dismiss/defer on insights |
| 7 | Digest Notifications | Phases 2+5 | Weekly summary of metrics + insights |

**Key insight on ordering:** The classifier is the data foundation — without classified replies, all analytics are just raw event counts (which the existing dashboard already does). The intelligence value comes from intent/objection/buying signal classification. Build it first, let data accumulate, then build analytics on top.

Phases 1-4 deliver immediate value (classified replies + analytics dashboard) without AI insights. Phases 5-7 add AI-powered recommendations on top. This allows incremental delivery.

---

## Sources

- Existing codebase: direct inspection of `prisma/schema.prisma`, `src/app/api/webhooks/emailbison/route.ts`, `src/app/api/dashboard/stats/route.ts`, `src/app/api/cron/poll-replies/route.ts`, `src/lib/agents/runner.ts`, `src/lib/agents/types.ts`, `src/lib/agents/writer.ts`
- CachedMetrics model verified unused via grep across `src/` directory — 0 references
- Vercel Hobby cron limit — HIGH confidence (both slots occupied, confirmed via existing cron-job.org usage)
- Neon serverless connection behavior — MEDIUM confidence (cold start estimates based on known Neon proxy architecture)
- AI SDK `generateObject` — HIGH confidence (part of `ai` package already imported in runner.ts)

---

*Architecture research for: Outsignal v3.0 Campaign Intelligence Hub*
*Researched: 2026-03-09*
