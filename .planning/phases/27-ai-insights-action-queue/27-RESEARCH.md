# Phase 27: AI Insights & Action Queue - Research

**Researched:** 2026-03-10
**Domain:** AI-powered analytics insights, action queue, weekly digest notifications
**Confidence:** HIGH

## Summary

This phase adds an AI insight generation system that analyzes existing analytics data (CachedMetrics campaign snapshots, Reply classifications, ICP calibration, benchmarks) and produces 3-5 actionable insights per workspace per week. The admin manages these through an approve/dismiss/defer queue on a new "Insights" tab on the existing analytics page. Approved actions auto-execute (safe) or require inline confirmation (destructive). A weekly digest notification summarizes top insights via Slack + email.

The project already has all the data infrastructure needed: CachedMetrics stores campaign snapshots, Reply table has intent/sentiment/objection classifications, ICP calibration data exists in PersonWorkspace, and industry benchmarks are defined. The AI pattern is established via Vercel AI SDK (`generateObject` with `@ai-sdk/anthropic` and Zod schemas). The notification system with audit logging is mature. The main new work is: (1) an Insight data model, (2) an AI analysis pipeline that reads existing data and produces structured insights, (3) action execution handlers, (4) the Insights tab UI, and (5) a weekly digest cron + notification.

**Primary recommendation:** Use `generateObject` with a Zod schema to produce structured insights from pre-aggregated data. Store insights in a new `Insight` model. Leverage existing CachedMetrics, Reply, and benchmark data -- no new data collection needed.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- All analytics data feeds in -- CachedMetrics (campaign performance), Reply classifications (intent/sentiment/objections), benchmarks (vs global/industry), ICP calibration, copy performance, signal effectiveness
- 3-5 insights per workspace per week -- system picks the most actionable findings
- Weekly cron + manual refresh -- external cron (cron-job.org) pre-generates insights weekly per workspace, plus a "Refresh insights" button for on-demand regeneration
- Objection patterns: dedicated section + AI commentary -- always-on objection cluster distribution as a dedicated section, plus AI-generated insights that interpret trends
- Auto-execute safe actions -- safe actions (update ICP threshold, flag for copy review, adjust signal targeting) execute automatically on approve. Destructive actions (pause campaign) show inline confirmation before executing
- 4 action types: pause campaign, update ICP threshold, flag for copy review, adjust signal targeting
- Audit trail with before/after -- record who approved, when, what changed, and outcome. Stored on the Insight record
- Inline confirmation for destructive actions -- button changes to "Confirm pause?" with cancel option, right on the card. No modal
- Direct and data-first tone -- lead with the number/finding. No fluff
- High/Medium/Low confidence badge -- color-coded: green High, yellow Medium, gray Low
- Numbers with trend arrows -- key metrics with up/down arrows and percentage change
- Category badge + color accent -- each card has a category badge (Performance, Copy, Objections, ICP) with subtle left-border color
- Preset snooze durations -- 3 options: 3 days, 1 week, 2 weeks
- Dismissed: hidden but viewable -- dismissed insights move to a collapsed "Dismissed" section
- Recurrence with 2-week dedup window -- same insight type can recur after 2 weeks, but not if exact finding was dismissed within that window
- "Insights" tab on analytics page -- 4th tab alongside Performance, Copy, Benchmarks

### Claude's Discretion
- AI prompt design for insight generation (what analysis to run, how to prioritize findings)
- Confidence level thresholds (what makes High vs Medium vs Low)
- Category color accent choices
- Insight deduplication algorithm (how to detect "same insight")
- Cron scheduling pattern (weekly timing, workspace rotation)
- Data model design for Insight records (fields, relations)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INSIGHT-01 | System generates AI-powered insights weekly per workspace analyzing reply patterns, campaign performance, and cross-workspace comparisons | Insight model + generateObject pipeline reading CachedMetrics/Reply/benchmark data + weekly cron endpoint |
| INSIGHT-02 | Each insight includes observation, supporting evidence (data), suggested action, and confidence level | Zod schema for generateObject output with observation, evidence, suggestedAction, confidence fields |
| INSIGHT-03 | Admin can approve, dismiss, or defer (snooze N days) each suggested action via the action queue | Insight model status lifecycle (active/approved/dismissed/snoozed) + PATCH API + InsightCard UI component |
| INSIGHT-04 | Approved actions execute the suggestion (pause campaign, update ICP threshold, flag for copy review) | Action executor functions per type; pause campaign needs new EmailBison API call or local status update |
| INSIGHT-05 | Admin can see objection pattern clusters across campaigns | Dedicated objection cluster section aggregating Reply.objectionSubtype counts + AI commentary insight |
| INSIGHT-06 | Admin receives weekly digest notification (Slack + email) summarizing top insights, best/worst campaigns, and pending action queue items | New notifyWeeklyDigest function using existing notification audit pattern |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ai (Vercel AI SDK) | ^6.0.97 | LLM calls for insight generation | Already used project-wide for classification, body elements, strategy detection |
| @ai-sdk/anthropic | ^3.0.46 | Anthropic model provider | Project standard -- all AI calls use Anthropic |
| zod | (via ai SDK) | Schema validation for generateObject | Project pattern for structured LLM output (see classify-reply.ts) |
| @prisma/client | ^6.19.2 | Database access for Insight model | Project ORM |
| nuqs | ^2.8.8 | URL state for tab management | Already used on analytics page |
| recharts | ^3.7.0 | Charts for objection cluster visualization | Already used in benchmarks tab |
| resend | ^6.9.2 | Weekly digest email | Project email provider |
| @slack/web-api | ^7.14.1 | Weekly digest Slack notification | Project Slack integration |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lucide-react | ^0.575.0 | Icons for insight cards (TrendingUp, TrendingDown, etc.) | Card UI |
| class-variance-authority | ^0.7.1 | Card variant styling (category colors) | Insight card component |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| generateObject | generateText + JSON.parse | generateObject is type-safe with Zod; project already uses both patterns but generateObject is preferred for structured data |
| Separate insight model | Store in CachedMetrics | Insights need status lifecycle (active/approved/dismissed/snoozed), audit trail, snooze dates -- too complex for CachedMetrics |

## Architecture Patterns

### Recommended Project Structure
```
src/
├── lib/
│   └── insights/
│       ├── generate.ts           # AI insight generation pipeline
│       ├── types.ts              # Insight types, categories, action types
│       ├── actions.ts            # Action executor (pause, update ICP, flag copy, adjust signal)
│       └── dedup.ts              # Deduplication logic (2-week window)
├── app/
│   ├── api/
│   │   ├── insights/
│   │   │   ├── route.ts          # GET (list insights) + POST (manual refresh)
│   │   │   └── [id]/
│   │   │       └── route.ts      # PATCH (approve/dismiss/defer)
│   │   └── cron/
│   │       └── generate-insights/
│   │           └── route.ts      # Weekly cron endpoint
│   └── (admin)/
│       └── analytics/
│           └── page.tsx          # Add "Insights" tab (4th tab)
└── components/
    └── analytics/
        ├── insights-tab.tsx      # Main insights tab container
        ├── insight-card.tsx       # Individual insight card with actions
        ├── objection-clusters.tsx # Dedicated objection pattern section
        └── insight-digest.tsx     # (optional) digest preview
```

### Pattern 1: Insight Generation Pipeline
**What:** Gather all analytics data for a workspace, send to LLM as structured context, get back structured insights via generateObject.
**When to use:** Weekly cron and manual refresh.
**Example:**
```typescript
// Source: Project pattern from src/lib/classification/classify-reply.ts
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

const InsightSchema = z.object({
  insights: z.array(z.object({
    category: z.enum(["performance", "copy", "objections", "icp"]),
    observation: z.string().describe("Data-first finding, e.g. 'Reply rate dropped 40% this week'"),
    evidence: z.array(z.object({
      metric: z.string(),
      value: z.string(),
      change: z.string().nullable(),
    })),
    suggestedAction: z.object({
      type: z.enum(["pause_campaign", "update_icp_threshold", "flag_copy_review", "adjust_signal_targeting"]),
      description: z.string(),
      params: z.record(z.string()).nullable(), // e.g. { campaignId: "xxx", newThreshold: "72" }
    }),
    confidence: z.enum(["high", "medium", "low"]),
    priority: z.number().min(1).max(10),
  })).min(1).max(5),
});

const { object } = await generateObject({
  model: anthropic("claude-haiku-4-5-20251001"),
  schema: InsightSchema,
  prompt: buildInsightPrompt(workspaceData),
});
```

### Pattern 2: Action Execution with Audit Trail
**What:** On approve, execute the action and record before/after state on the Insight record.
**When to use:** When admin clicks "Approve" on an insight card.
**Example:**
```typescript
// Action executor pattern
async function executeAction(insight: Insight): Promise<{ before: string; after: string }> {
  switch (insight.actionType) {
    case "update_icp_threshold": {
      const campaign = await prisma.campaign.findUnique({ where: { id: insight.actionParams.campaignId } });
      const before = campaign.icpScoreThreshold;
      await prisma.campaign.update({
        where: { id: insight.actionParams.campaignId },
        data: { icpScoreThreshold: parseInt(insight.actionParams.newThreshold) },
      });
      return { before: `ICP threshold: ${before}`, after: `ICP threshold: ${insight.actionParams.newThreshold}` };
    }
    // ... other action types
  }
}
```

### Pattern 3: Cron Endpoint (Project Convention)
**What:** External cron (cron-job.org) calls a GET endpoint with Bearer auth.
**When to use:** Weekly insight generation.
**Example:**
```typescript
// Source: src/app/api/cron/snapshot-metrics/route.ts
import { validateCronSecret } from "@/lib/cron-auth";

export const maxDuration = 60;

export async function GET(request: Request) {
  if (!validateCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Process each workspace sequentially to stay within 30s cron-job.org timeout
  // Or accept ?workspace= param and run per-workspace (same as snapshot-metrics)
}
```

### Pattern 4: Tab Addition on Analytics Page
**What:** Add "Insights" as 4th TabChip on existing analytics page.
**When to use:** UI integration.
**Example:**
```typescript
// Source: src/app/(admin)/analytics/page.tsx line 230-246
// Existing pattern: TabChip components with nuqs state
const isInsightsTab = activeTab === "insights";

<TabChip label="Insights" active={isInsightsTab} onClick={() => handleTabChange("insights")} />

{isInsightsTab && (
  <InsightsTab workspace={params.workspace || null} />
)}
```

### Anti-Patterns to Avoid
- **Running raw aggregation at request time:** All data sources (CachedMetrics, Reply stats) are already pre-computed. The insight generation prompt should consume pre-aggregated data, not run heavy queries.
- **Storing insights in CachedMetrics:** Insights have a lifecycle (active -> approved/dismissed/snoozed) that CachedMetrics can't express. Use a dedicated model.
- **Modal confirmation for destructive actions:** User explicitly said inline confirmation, no modals.
- **Generating insights on page load:** Pre-generate weekly via cron. Page load just reads from DB.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Structured LLM output | Custom JSON parsing | `generateObject` with Zod schema | Type-safe, handles retries, validated output |
| Notification audit | Manual try/catch logging | `audited()` wrapper from `@/lib/notification-audit` | Consistent with all 17+ existing notification types |
| Cron authentication | Custom auth logic | `validateCronSecret()` from `@/lib/cron-auth` | Timing-safe comparison, project standard |
| URL state management | useState + pushState | `nuqs` with `parseAsString` | Already used on analytics page |
| Objection distribution | Manual SQL aggregation | Prisma groupBy on Reply.objectionSubtype | Simple count by workspace, no need for raw SQL |

## Common Pitfalls

### Pitfall 1: Cron-job.org 30s Timeout
**What goes wrong:** Insight generation involves an LLM call per workspace. With 6 workspaces, sequential processing could exceed 30s.
**Why it happens:** Each generateObject call to Claude takes 3-8 seconds.
**How to avoid:** Accept `?workspace=` parameter (same as snapshot-metrics cron). Set up 6 cron jobs in cron-job.org, one per workspace, staggered by 5 minutes. Or use a single cron that hits all workspaces but processes them sequentially with early-return if approaching timeout.
**Warning signs:** HTTP 408/504 from cron-job.org.

### Pitfall 2: Deduplication Complexity
**What goes wrong:** Same insight regenerated every week despite being dismissed.
**Why it happens:** LLM generates similar findings from similar data.
**How to avoid:** Store a `dedupKey` on each insight -- a deterministic hash of `category + actionType + targetEntityId` (e.g., "performance:pause_campaign:campaign_xyz"). On generation, check if same dedupKey was dismissed within 2 weeks. Skip if so.
**Warning signs:** Admin dismissing the same insight repeatedly.

### Pitfall 3: EmailBison Campaign Pause Not in Client
**What goes wrong:** "Pause campaign" action type can't actually pause on EmailBison.
**Why it happens:** `EmailBisonClient` only has create/duplicate/get methods, no update/pause endpoint.
**How to avoid:** For pause action, update local Campaign status to "paused" in the DB. If EmailBison API supports PATCH/PUT for campaign status, add a `pauseCampaign` method. Otherwise, "pause" means local status update + admin manually pauses in EmailBison. Document this clearly.
**Warning signs:** Action "succeeds" in DB but campaign keeps sending.

### Pitfall 4: Insight Staleness After Action
**What goes wrong:** Insight says "reply rate dropped" but admin already paused the campaign manually.
**Why it happens:** Insights are generated weekly but data changes daily.
**How to avoid:** On manual refresh, regenerate from current data. Include generation timestamp on each card. Consider marking insights as "stale" if referenced campaign status changed since generation.
**Warning signs:** Admin seeing outdated recommendations.

### Pitfall 5: AI SDK maxTokens Not Supported
**What goes wrong:** Passing maxTokens to generateText/generateObject causes errors.
**Why it happens:** Decision [24-01] documented this -- AI SDK generateText does not support maxTokens param.
**How to avoid:** Constrain output via prompt instructions and Zod schema limits (e.g., `.max(5)` on insights array, `.max(200)` on strings).
**Warning signs:** Runtime errors from AI SDK.

## Code Examples

### Insight Data Model (Prisma)
```prisma
// New model for Phase 27
model Insight {
  id            String   @id @default(cuid())
  workspaceSlug String

  // Content
  category      String   // "performance" | "copy" | "objections" | "icp"
  observation   String   // Data-first finding text
  evidence      String   // JSON array of { metric, value, change }
  confidence    String   // "high" | "medium" | "low"
  priority      Int      @default(5) // 1-10, lower = higher priority

  // Suggested action
  actionType    String   // "pause_campaign" | "update_icp_threshold" | "flag_copy_review" | "adjust_signal_targeting"
  actionDescription String
  actionParams  String?  // JSON: { campaignId, newThreshold, etc. }

  // Lifecycle
  status        String   @default("active") // "active" | "approved" | "dismissed" | "snoozed" | "executed" | "failed"
  snoozedUntil  DateTime?
  resolvedAt    DateTime?
  resolvedBy    String?  // admin email

  // Audit trail (populated on approve/execute)
  executionResult String?  // JSON: { before, after, outcome }

  // Deduplication
  dedupKey      String   // Hash for 2-week dedup window

  // Timestamps
  generatedAt   DateTime @default(now())
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([workspaceSlug, status])
  @@index([workspaceSlug, generatedAt])
  @@index([dedupKey, status])
}
```

### Objection Cluster Aggregation
```typescript
// Source: Prisma groupBy pattern used in project
const clusters = await prisma.reply.groupBy({
  by: ["objectionSubtype"],
  where: {
    workspaceSlug: workspace,
    intent: "objection",
    objectionSubtype: { not: null },
  },
  _count: { id: true },
  orderBy: { _count: { id: "desc" } },
});

// Calculate percentages
const total = clusters.reduce((sum, c) => sum + c._count.id, 0);
const distribution = clusters.map(c => ({
  type: c.objectionSubtype,
  count: c._count.id,
  percentage: Math.round((c._count.id / total) * 100),
}));
```

### Weekly Digest Notification
```typescript
// Source: Pattern from src/lib/notifications.ts
import { audited } from "@/lib/notification-audit";
import { postMessage } from "@/lib/slack";
import { sendNotificationEmail } from "@/lib/resend";

export async function notifyWeeklyDigest(params: {
  workspaceSlug: string;
  topInsights: Array<{ observation: string; category: string; confidence: string }>;
  bestCampaign: { name: string; replyRate: number } | null;
  worstCampaign: { name: string; replyRate: number } | null;
  pendingActions: number;
}): Promise<void> {
  // Follow existing notification pattern with audited() wrapper
  // Send to admin Slack channel + notification emails
}
```

### Insight Card UI Pattern
```typescript
// Category colors (Claude's discretion - recommendation)
const CATEGORY_COLORS: Record<string, string> = {
  performance: "border-l-blue-500",
  copy: "border-l-purple-500",
  objections: "border-l-orange-500",
  icp: "border-l-emerald-500",
};

const CONFIDENCE_COLORS: Record<string, string> = {
  high: "bg-green-100 text-green-800",
  medium: "bg-yellow-100 text-yellow-800",
  low: "bg-gray-100 text-gray-600",
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| generateText + JSON.parse | generateObject with Zod | AI SDK v3+ | Type-safe structured output; project uses both patterns |
| maxTokens param | Prompt + schema constraints | AI SDK v6 (decision 24-01) | maxTokens not supported; use schema .max() instead |
| Single cron for all workspaces | Per-workspace cron param | Phase 24 pattern | Avoids 30s timeout; proven in snapshot-metrics |

## Open Questions

1. **EmailBison Campaign Pause API**
   - What we know: EmailBisonClient has no pause/update method. EB campaign type includes `paused` status.
   - What's unclear: Whether EmailBison API supports PATCH to update campaign status.
   - Recommendation: Implement local DB pause first. Add EB API call if available. Document that admin may need to manually pause in EmailBison until API support confirmed.

2. **Adjust Signal Targeting Action Execution**
   - What we know: Signal campaigns have `signalTypes` (JSON array) and `icpCriteria` (JSON) fields.
   - What's unclear: What specific adjustment the AI would suggest (add/remove signal types? change ICP criteria?).
   - Recommendation: Start with ICP score threshold adjustment for signal campaigns (same as `update_icp_threshold` but targeting signal campaigns). Expand if needed.

3. **Confidence Level Thresholds (Claude's Discretion)**
   - Recommendation:
     - **HIGH**: 50+ data points supporting the finding, clear trend (>20% change)
     - **MEDIUM**: 20-49 data points, or moderate trend (10-20% change)
     - **LOW**: <20 data points, or marginal trend (<10% change)
   - Include data volume and trend magnitude in prompt so LLM can assess.

4. **Cron Scheduling Pattern (Claude's Discretion)**
   - Recommendation: Monday morning 7am UTC. One cron-job.org entry per workspace staggered by 2 minutes (7:00, 7:02, 7:04, etc.). URL: `GET /api/cron/generate-insights?workspace={slug}`
   - Alternative: Single cron at 7am that iterates workspaces internally (riskier re timeout).

## Sources

### Primary (HIGH confidence)
- Project codebase: `prisma/schema.prisma` -- full data model, CachedMetrics pattern
- Project codebase: `src/lib/classification/classify-reply.ts` -- generateObject + Zod pattern
- Project codebase: `src/lib/analytics/snapshot.ts` -- CampaignSnapshot data shape
- Project codebase: `src/lib/analytics/industry-benchmarks.ts` -- benchmark reference data
- Project codebase: `src/lib/analytics/body-elements.ts` -- generateText AI pattern
- Project codebase: `src/app/(admin)/analytics/page.tsx` -- existing tab structure
- Project codebase: `src/lib/notifications.ts` -- notification + audit pattern
- Project codebase: `src/lib/cron-auth.ts` -- cron authentication
- Project codebase: `src/app/api/cron/snapshot-metrics/route.ts` -- cron endpoint pattern
- STATE.md decisions: [24-01] AI SDK maxTokens limitation, CachedMetrics evolution

### Secondary (MEDIUM confidence)
- CONTEXT.md: User decisions on action types, UI behavior, tone, dedup window

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in use, no new dependencies needed
- Architecture: HIGH -- follows established project patterns (cron, generateObject, notifications, analytics tabs)
- Pitfalls: HIGH -- identified from direct codebase analysis (EB client limitations, cron timeouts, AI SDK constraints)
- Data model: MEDIUM -- Insight model is new, but follows Prisma conventions established in project

**Research date:** 2026-03-10
**Valid until:** 2026-04-10 (stable domain, no external API changes expected)
