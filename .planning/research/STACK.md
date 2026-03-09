# Technology Stack

**Project:** Outsignal v3.0 Campaign Intelligence Hub
**Researched:** 2026-03-09

## Core Finding: No New Dependencies Needed

The existing stack already provides everything required for the Campaign Intelligence Hub. The v3.0 milestone is an **application-layer build**, not a stack expansion. Every capability needed -- structured AI output, time-series charting, job scheduling, data aggregation -- is already present in the installed dependencies.

This is a strength, not a limitation. Zero new dependencies means zero integration risk, faster builds, and a smaller attack surface.

## Existing Stack (Validated, DO NOT change)

| Technology | Version | Purpose | v3.0 Role |
|------------|---------|---------|-----------|
| Next.js | 16.1.6 | App framework | API routes for classification, analytics, insights |
| Prisma | 6.19.2 | ORM | New models: ReplyClassification, CampaignAnalytics, Insight, ActionItem |
| PostgreSQL (Neon) | - | Database | Aggregation queries, time-series via `receivedAt` indexes |
| AI SDK (`ai`) | 6.0.97 | LLM integration | `generateObject` for reply classification (already proven in ICP scorer) |
| `@ai-sdk/anthropic` | 3.0.46 | Claude provider | Haiku for classification, Sonnet for insight generation |
| Recharts | 3.7.0 | Charts | Campaign performance charts, benchmark visualizations |
| Zod | 4.3.6 | Schema validation | Classification output schemas, API input validation |
| Radix UI | 1.4.3 | Components | Action queue cards, insight cards, filter dropdowns |
| `@slack/web-api` | 7.14.1 | Notifications | Insight digest delivery to Slack |
| Resend | 6.9.2 | Email | Insight digest delivery via email |
| Vercel | Hobby | Hosting | API routes, cron for scheduled insight generation |

## What Each v3.0 Feature Uses

### 1. Reply Classification Engine

**Uses:** `ai` (generateObject) + `@ai-sdk/anthropic` (Haiku) + `zod` (output schema) + Prisma

**Pattern:** Identical to existing `src/lib/icp/scorer.ts`. The ICP scorer already does exactly this -- takes unstructured data, passes it to Haiku with a Zod schema, gets structured output back. Reply classification is the same pattern with a different schema.

```typescript
// Example classification schema (Zod v4)
const ReplyClassificationSchema = z.object({
  intent: z.enum([
    "interested", "not_interested", "objection", "question",
    "referral", "out_of_office", "unsubscribe", "bounce", "other"
  ]),
  sentiment: z.number().min(-1).max(1), // -1 negative, 0 neutral, 1 positive
  buyingSignals: z.array(z.string()),
  objectionType: z.enum([
    "none", "timing", "budget", "authority", "need",
    "competitor", "satisfaction", "generic"
  ]),
  confidence: z.number().min(0).max(1),
  summary: z.string(),
});
```

**Model:** `claude-haiku-4-5-20251001` -- fast, cheap (~$0.001/classification), already in `AgentConfig` model list. At ~50 replies/day across 6 workspaces, monthly cost is ~$1.50.

**Integration point:** Hook into `src/app/api/webhooks/emailbison/route.ts` -- classify on webhook receipt (after notification, before response). Store result in new `ReplyClassification` Prisma model linked to `WebhookEvent`.

### 2. Campaign Performance Analytics

**Uses:** Prisma (aggregation queries) + `CachedMetrics` model (already exists) + Recharts

**No new tech needed.** The `WebhookEvent` table already stores every event with `workspace`, `eventType`, `campaignId`, `leadEmail`, `senderEmail`, and `receivedAt`. All campaign metrics (open rate, reply rate, interested rate, bounce rate) can be derived from GROUP BY queries on this table joined with EmailBison campaign data.

**Pattern:** Computed on-demand with caching via existing `CachedMetrics` model (already has `workspace` + `metricType` unique constraint). Add new `metricType` values: `campaign_performance`, `sequence_step_analysis`, `strategy_comparison`.

**Time-series:** Use `receivedAt` index on `WebhookEvent` for time bucketing. PostgreSQL `date_trunc()` via Prisma raw queries for daily/weekly/monthly aggregation.

### 3. Cross-Workspace Benchmarking

**Uses:** Prisma (cross-workspace aggregation) + Recharts

**No new tech needed.** Query across all workspaces, group by `workspace.vertical`, compute averages. The `Workspace.vertical` field already exists and is populated for all 6 clients.

**Key insight:** Benchmarks are just analytics queries without a `WHERE workspace = ?` clause. Same data, wider scope.

### 4. ICP Score Calibration

**Uses:** Prisma (join `PersonWorkspace.icpScore` with `WebhookEvent` outcomes)

**No new tech needed.** The question "do high ICP scores convert?" is a SQL join: PersonWorkspace (has icpScore) <-> Person (email) <-> WebhookEvent (has reply/interested events). Compare average ICP scores of people who replied vs. those who didn't.

### 5. AI Insight Generation

**Uses:** `ai` (generateText) + `@ai-sdk/anthropic` (Sonnet) + Prisma + Vercel Cron

**Pattern:** Follow the existing agent framework (`src/lib/agents/runner.ts`). Create a new "intelligence" agent that:
1. Reads aggregated analytics data (from cached metrics)
2. Passes to Sonnet with a system prompt asking for actionable insights
3. Stores structured output in new `Insight` Prisma model

**Model:** `claude-sonnet-4-20250514` for insight quality. Run weekly per workspace (~6 calls/week, ~$0.30/week).

**Scheduling:** Use Vercel cron (daily at 7am UTC) or external cron-job.org (already used for poll-replies and inbox-health). The insight generation endpoint follows the same `Authorization: Bearer CRON_SECRET` pattern.

### 6. Admin Action Queue

**Uses:** Prisma (new `ActionItem` model) + Radix UI + `@dnd-kit/core` (already installed for drag-and-drop)

**No new tech needed.** The action queue is a Prisma model with status lifecycle (`pending` -> `approved` | `dismissed` | `deferred`) displayed as cards in the dashboard. `@dnd-kit/core` is already installed if drag-to-reorder is desired.

### 7. Digest Notifications

**Uses:** `@slack/web-api` + `resend` (both already installed)

**No new tech needed.** Follow existing notification patterns in `src/lib/notifications.ts`. Add a new `notifyInsightDigest()` function.

## What NOT to Add

| Library | Why You Might Think You Need It | Why You Don't |
|---------|--------------------------------|---------------|
| **node-cron / cron** | Scheduling insight generation | Use Vercel cron or cron-job.org (already established pattern) |
| **bull / bullmq** | Job queue for classification | Reply classification is fast (~200ms with Haiku). Run inline in webhook handler. No queue needed at 50 replies/day volume. |
| **@langchain/core** | LLM orchestration | AI SDK already does everything needed. LangChain adds complexity without value here. |
| **compromise / natural** | NLP text processing | Haiku handles classification better than rule-based NLP. The whole point is using LLM classification, not traditional NLP. |
| **d3 / visx / nivo** | Advanced charts | Recharts 3.7 already covers bar charts, line charts, area charts, radar charts. No need for lower-level charting. |
| **redis / ioredis** | Caching layer | CachedMetrics Prisma model already serves this role. At 6 workspaces, PostgreSQL is more than fast enough. |
| **openai** (for embeddings) | Semantic similarity on replies | Already installed (6.25.0) but not needed. Reply classification via Haiku structured output is deterministic and cheaper than embedding + similarity search. |
| **pg / @neondatabase/serverless** | Raw SQL for aggregations | Prisma `$queryRaw` handles the few cases where raw SQL is needed (date_trunc, window functions). |

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Classification model | Haiku 4.5 | GPT-4o-mini, Gemini Flash | Already have Anthropic integration, Haiku is faster and cheaper for structured output. Switching providers adds no value. |
| Analytics storage | CachedMetrics (existing) | TimescaleDB, ClickHouse | Massive overkill for 6 workspaces. PostgreSQL handles this workload trivially. |
| Insight scheduling | cron-job.org | Inngest, Trigger.dev | Already use cron-job.org for 2 other jobs. Adding a new service for 1 more cron is unnecessary complexity. |
| Action queue | Prisma model | Inngest workflows | The action queue is a simple approve/dismiss/defer UI, not a workflow engine. A Prisma model with status field is the right tool. |

## Database Schema Additions (Prisma)

New models needed (all extend existing patterns):

```prisma
model ReplyClassification {
  id              String   @id @default(cuid())
  webhookEventId  String   @unique  // Links to WebhookEvent
  workspaceSlug   String
  campaignId      String?

  // Classification results
  intent          String   // "interested" | "not_interested" | "objection" | "question" | "referral" | "ooo" | "unsubscribe" | "bounce" | "other"
  sentiment       Float    // -1 to 1
  objectionType   String?  // "timing" | "budget" | "authority" | "need" | "competitor" | "satisfaction" | null
  buyingSignals   String?  // JSON array of detected signals
  confidence      Float    // 0 to 1
  summary         String   // 1-sentence summary

  // AI metadata
  modelId         String?
  durationMs      Int?

  classifiedAt    DateTime @default(now())

  @@index([workspaceSlug, intent])
  @@index([campaignId])
  @@index([classifiedAt])
}

model Insight {
  id              String   @id @default(cuid())
  workspaceSlug   String?  // null = cross-workspace insight
  category        String   // "campaign_performance" | "reply_pattern" | "icp_calibration" | "benchmark" | "anomaly"
  title           String
  body            String   // Markdown
  severity        String   @default("info") // "info" | "warning" | "critical"
  dataSnapshot    String?  // JSON -- the analytics data that produced this insight
  actionItems     String?  // JSON array of suggested actions

  status          String   @default("active") // "active" | "dismissed" | "actioned" | "expired"
  expiresAt       DateTime?

  generatedAt     DateTime @default(now())

  @@index([workspaceSlug, status])
  @@index([category])
  @@index([generatedAt])
}

model ActionItem {
  id              String   @id @default(cuid())
  insightId       String?  // Optional link to generating insight
  workspaceSlug   String?
  title           String
  description     String
  actionType      String   // "adjust_sequence" | "pause_campaign" | "update_icp" | "review_copy" | "investigate" | "custom"
  priority        Int      @default(5) // 1 = urgent, 5 = normal
  status          String   @default("pending") // "pending" | "approved" | "dismissed" | "deferred" | "completed"

  // Admin response
  adminResponse   String?  // Notes from admin when approving/dismissing
  resolvedAt      DateTime?

  createdAt       DateTime @default(now())

  @@index([status])
  @@index([workspaceSlug, status])
  @@index([priority, status])
}
```

## API Cost Estimates

| Feature | Model | Volume | Monthly Cost |
|---------|-------|--------|-------------|
| Reply classification | Haiku 4.5 | ~300 replies/month | ~$1.50 |
| Insight generation | Sonnet 4 | ~24 runs/month (weekly x 6 workspaces) | ~$7.20 |
| **Total** | | | **~$8.70/month** |

These costs are negligible compared to the $300+/month Clay subscription that was replaced.

## Installation

```bash
# No new packages to install.
# v3.0 is purely application-layer code using existing dependencies.

# Only action needed:
npx prisma db push  # After adding new models to schema.prisma
```

## Integration Points

| Existing Code | v3.0 Integration |
|---------------|-----------------|
| `src/app/api/webhooks/emailbison/route.ts` | Add classification call after notification, before response |
| `src/lib/agents/runner.ts` | Reuse for intelligence agent (no changes needed) |
| `src/lib/agents/types.ts` | Add `IntelligenceOutput` type and Zod schema |
| `src/lib/icp/scorer.ts` | Reference pattern for reply classification (generateObject + Haiku) |
| `src/lib/notifications.ts` | Add `notifyInsightDigest()` for weekly summaries |
| `src/components/dashboard/` | New intelligence hub page with Recharts components |
| `prisma/schema.prisma` | Add ReplyClassification, Insight, ActionItem models |

## Sources

- Codebase analysis: `package.json`, `prisma/schema.prisma`, `src/lib/agents/`, `src/lib/icp/scorer.ts`
- AI SDK `generateObject` usage verified in `src/lib/icp/scorer.ts` (identical pattern needed for classification)
- WebhookEvent schema verified in `prisma/schema.prisma` (all reply data already persisted)
- CachedMetrics model verified in schema (analytics caching layer already exists)
- Agent framework verified in `src/lib/agents/runner.ts` + `types.ts` (reusable for intelligence agent)
- Haiku model ID `claude-haiku-4-5-20251001` verified in `src/lib/agents/types.ts` AgentConfig type
