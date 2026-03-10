---
phase: 23-reply-storage-classification
verified: 2026-03-09T22:00:00Z
status: gaps_found
score: 4/5 must-haves verified
gaps:
  - truth: "Admin can view classification breakdown charts showing intent distribution and sentiment distribution filtered per campaign and per workspace"
    status: partial
    reason: "Charts exist and workspace filtering works, but there is no campaign filter in the replies page UI. The /api/replies/stats endpoint accepts a campaignId query parameter, but the admin page does not expose a campaign dropdown or filter chip. The admin cannot filter charts by campaign without manually constructing a URL."
    artifacts:
      - path: "src/app/(admin)/replies/page.tsx"
        issue: "No campaign filter dropdown or chip — only workspace and date range filters are exposed in the UI"
    missing:
      - "Add a campaign dropdown/filter to the replies page that passes campaignId to both /api/replies and /api/replies/stats"
---

# Phase 23: Reply Storage & Classification Verification Report

**Phase Goal:** Every reply that enters the system is persisted with full body text and automatically classified by intent, sentiment, and objection subtype -- giving the admin visibility into what replies actually say and mean
**Verified:** 2026-03-09T22:00:00Z
**Status:** gaps_found
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Admin can navigate to a reply view and see every stored reply with full body text, sender email, subject line, timestamp, and linked campaign name | VERIFIED | Reply model in schema with all required fields. `/api/replies` returns paginated list with effective fields. Admin page at `/replies` with sidebar nav link renders ReplyTable showing sender, subject, intent, sentiment, workspace, time, and body preview. Side panel shows full body text, campaign name, sequence step. |
| 2 | Each reply automatically shows an intent label (9 categories) without admin action | VERIFIED | classifyReply() in `src/lib/classification/classify-reply.ts` uses Claude Haiku with Zod-validated structured output. 9 intents defined in types.ts. Classification runs inline in webhook handler (line 421) and poll-replies cron (line 217). IntentBadge component renders in table rows and side panel. |
| 3 | Each reply automatically shows a sentiment score (positive/neutral/negative) alongside intent | VERIFIED | Sentiment is classified in the same LLM call as intent (single generateObject call). SentimentBadge component renders in table and side panel. Sentiment stored on Reply model, returned via API with effectiveSentiment computed field. |
| 4 | Replies classified as "objection" additionally show an objection subtype (6 types) | VERIFIED | 6 objection subtypes defined in types.ts. ClassificationSchema constrains objectionSubtype to only set when intent is "objection". Side panel renders objection subtype badge when present. PATCH endpoint validates objection subtype consistency. |
| 5 | Admin can view classification breakdown charts showing intent distribution and sentiment distribution filtered per campaign and per workspace | PARTIAL | ReplyStats component renders intent distribution bar chart (recharts) and sentiment stacked bar with legend. Workspace filtering works via dropdown. **BUT no campaign filter exists in the UI** -- the API supports campaignId but the admin page does not expose it. |

**Score:** 4/5 truths verified (1 partial)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `prisma/schema.prisma` (Reply model) | Reply model with all fields | VERIFIED | 50-line model with senderEmail, senderName, subject, bodyText, receivedAt, campaignId, campaignName, sequenceStep, intent, sentiment, objectionSubtype, classificationSummary, override fields, source tracking, indexes |
| `src/lib/classification/types.ts` | Intent/Sentiment/ObjectionSubtype constants | VERIFIED | 9 intents, 3 sentiments, 6 objection subtypes as const arrays with TypeScript types, labels, and color mappings |
| `src/lib/classification/classify-reply.ts` | LLM classification function | VERIFIED | Uses `generateObject` with `anthropic("claude-haiku-4-5-20251001")`, Zod schema validation, detailed prompt with intent definitions and edge case rules |
| `src/lib/classification/strip-html.ts` | HTML-to-text utility | VERIFIED | Handles br/p tags, common HTML entities, collapses newlines |
| `src/app/api/webhooks/emailbison/route.ts` | Reply persistence + classification wiring | VERIFIED | Lines 334-446: extracts reply data, upserts Reply record with dedup by emailBisonReplyId, classifies inline, stores classification on Reply, falls back gracefully on classification failure |
| `src/app/api/cron/poll-replies/route.ts` | Poll cron with classification | VERIFIED | Lines 141-241: upserts Reply record, classifies inline with same classifyReply function, graceful failure |
| `src/app/api/cron/retry-classification/route.ts` | Retry cron for failed classifications | VERIFIED | Fetches up to 50 unclassified replies (classifiedAt IS NULL), retries classification, logs results |
| `src/app/api/replies/route.ts` | Replies list API | VERIFIED | Paginated, filterable by workspace/intent/sentiment/campaignId/search/range. Returns effectiveIntent/effectiveSentiment computed fields |
| `src/app/api/replies/stats/route.ts` | Stats aggregation API | VERIFIED | Raw SQL with COALESCE for override-aware intent/sentiment distributions. Workspace counts, totals, classified/unclassified/overridden counts |
| `src/app/api/replies/[id]/route.ts` | Override API (PATCH) | VERIFIED | Validates intent/sentiment/objectionSubtype values, enforces objection-only subtype constraint, updates override fields |
| `src/app/(admin)/replies/page.tsx` | Admin replies page | VERIFIED | Full page with search, workspace dropdown, intent toggle chips, sentiment toggle chips, date range chips, pagination, ReplyTable, ReplySidePanel, ReplyStats |
| `src/components/replies/reply-table.tsx` | Reply table component | VERIFIED | Table with sender, subject, intent badge, sentiment badge, workspace tag, relative time, body preview (truncated to 100 chars). Click opens side panel |
| `src/components/replies/reply-side-panel.tsx` | Side panel detail view | VERIFIED | Sliding panel with full body text, classification section with editable IntentBadge, SentimentBadge, objection subtype badge, classification summary, outbound email collapsible, campaign info, "Reply in Outsignal" link |
| `src/components/replies/reply-stats.tsx` | Stats/charts component | VERIFIED | 3-column grid: total count card, intent distribution bar chart (recharts), sentiment stacked bar with legend |
| `src/components/replies/intent-badge.tsx` | Intent badge with override dropdown | VERIFIED | Color-coded pill, pencil icon for overrides, editable mode with dropdown listing all 9 intents |
| `src/components/replies/sentiment-badge.tsx` | Sentiment badge | VERIFIED | Color-coded pill with dot indicator |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| Webhook handler | Reply model | prisma.reply.upsert | WIRED | Lines 393-417 in webhook route |
| Webhook handler | classifyReply | Direct import + call | WIRED | Import on line 10, call on line 421 |
| Poll-replies cron | Reply model | prisma.reply.upsert | WIRED | Lines 190-213 in poll-replies route |
| Poll-replies cron | classifyReply | Direct import + call | WIRED | Import on line 10, call on line 217 |
| Retry cron | classifyReply | Direct import + call | WIRED | Import on line 4, call on line 26 |
| Admin page | /api/replies | fetch in useCallback | WIRED | Line 155 fetches replies, response sets data state |
| Admin page | /api/replies/stats | fetch in useCallback | WIRED | Line 177 fetches stats, response sets stats state |
| ReplySidePanel | /api/replies/[id] | fetch PATCH | WIRED | Line 41 sends override PATCH request |
| Sidebar | /replies page | href link | WIRED | Sidebar item at line 128 |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| REPLY-01 | 23-01 | Admin can see every reply stored with full body text, sender, subject, timestamp, and linked campaign | SATISFIED | Reply model + admin page with all fields |
| REPLY-02 | 23-01 | Each reply is automatically classified by intent (9 categories) | SATISFIED | classifyReply with 9-intent Zod schema, wired in webhook + poll cron |
| REPLY-03 | 23-01 | Each reply is automatically scored for sentiment (positive/neutral/negative) | SATISFIED | Sentiment classified in same LLM call, rendered via SentimentBadge |
| REPLY-04 | 23-01 | Objection replies are sub-classified by type (6 types) | SATISFIED | objectionSubtype in schema + LLM + UI badge |
| REPLY-05 | 23-02 | Classification runs automatically on webhook and poll-replies cron | SATISFIED | Both handlers call classifyReply inline with graceful fallback |
| REPLY-06 | 23-04 | Admin can view classification breakdown per campaign and per workspace | PARTIAL | Workspace filtering works. Campaign filtering supported by API but not exposed in admin UI |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | - | - | - | No TODOs, FIXMEs, placeholders, or stub implementations found in any Phase 23 files |

### Human Verification Required

### 1. Classification Accuracy

**Test:** Trigger a real webhook with a reply body expressing interest in a meeting, then check the Reply record in the database.
**Expected:** intent=meeting_booked or interested, sentiment=positive, objectionSubtype=null, classificationSummary contains relevant reasoning.
**Why human:** Classification quality depends on LLM behavior with real-world email content, cannot verify programmatically.

### 2. Side Panel Visual Polish

**Test:** Navigate to /replies, click a reply row, verify the side panel slides in with proper styling.
**Expected:** Panel animates from right, shows full body text in a readable format, badges are color-coded, "Reply in Outsignal" button is visible and links correctly.
**Why human:** Visual layout, animation smoothness, and readability are subjective.

### 3. Chart Rendering

**Test:** Navigate to /replies with classified replies in the database, verify charts render.
**Expected:** Intent distribution shows horizontal bar chart with correct colors. Sentiment shows stacked bar with legend. Numbers match actual data.
**Why human:** Chart rendering depends on recharts and browser environment.

### Gaps Summary

One gap was identified:

**Campaign filter missing from UI (Truth 5, REPLY-06 partial):** The `/api/replies/stats` endpoint accepts `campaignId` as a query parameter and correctly filters distributions by campaign. However, the admin replies page (`src/app/(admin)/replies/page.tsx`) does not render a campaign dropdown or filter chip. The admin can filter by workspace, intent, sentiment, date range, and search text -- but not by campaign. This means the success criterion "filtered per campaign" is satisfied at the API layer but not at the UI layer. Adding a campaign dropdown that fetches available campaigns and passes `campaignId` to both the replies list and stats endpoints would close this gap.

---

_Verified: 2026-03-09T22:00:00Z_
_Verifier: Claude (gsd-verifier)_
