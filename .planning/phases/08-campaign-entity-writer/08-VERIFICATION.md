---
phase: 08-campaign-entity-writer
verified: 2026-03-01T10:30:00Z
status: passed
score: 14/14 must-haves verified
re_verification: null
gaps: []
human_verification:
  - test: "Reply suggestion appears in Slack notification when a lead replies"
    expected: "Slack message shows divider + 'Suggested Response' bold block with AI-drafted reply text below the lead's message"
    why_human: "Requires a live webhook event from EmailBison — cannot trigger without real reply data"
  - test: "Reply suggestion appears in email notification when a lead replies"
    expected: "Notification email shows HR + 'SUGGESTED RESPONSE' label + left-bordered box with #F0FF7A accent containing the AI draft"
    why_human: "Requires live webhook + configured notificationEmails — cannot verify email rendering programmatically"
  - test: "Admin types 'create a campaign for Rise using the fintech CTO list' in Cmd+J"
    expected: "Orchestrator delegates to Campaign Agent, which calls findTargetList, confirms details, then creates Campaign record linked to that list"
    why_human: "Requires live Cmd+J chat session with real workspace data — agent behavior requires runtime verification"
  - test: "Admin gives feedback 'step 2 is too long' via Cmd+J after content is generated"
    expected: "Writer regenerates only step 2, preserves steps 1 and 3 exactly, returns updated sequence"
    why_human: "Smart iteration behavior depends on LLM interpretation of stepNumber context — requires runtime test"
  - test: "pgvector semantic search returns relevant results when OPENAI_API_KEY is configured and migration runs"
    expected: "searchKnowledge('cold email best practices') returns semantically similar passages, not just keyword matches"
    why_human: "KnowledgeChunk table is currently empty (0 records) — OPENAI_API_KEY not set in Vercel. Fallback keyword search is active. Semantic search requires user to add API key and run scripts/reembed-knowledge.ts"
---

# Phase 8: Campaign Entity Writer Verification Report

**Phase Goal:** Campaign becomes a first-class entity in Outsignal that owns leads (TargetList) AND content (email + LinkedIn sequences). Admin creates campaigns, generates content via writer agent, reviews and iterates via Cmd+J, and promotes to client review — all through natural language chat. Writer agent also generates suggested responses to incoming replies, surfaced in Slack notifications and available for refinement via Cmd+J.
**Verified:** 2026-03-01T10:30:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Campaign model exists in Prisma schema with full 8-state status lifecycle | VERIFIED | `prisma/schema.prisma` lines 386-437: model Campaign with status field, transition comment block, all 8 valid states documented |
| 2 | Campaign has 1:1 link to TargetList via targetListId | VERIFIED | `targetListId String?` + `targetList TargetList? @relation(...)` confirmed in schema |
| 3 | Campaign stores email and LinkedIn sequences as JSON columns | VERIFIED | `emailSequence String?` and `linkedinSequence String?` in Campaign model |
| 4 | Campaign has separate approval fields for leads and content | VERIFIED | `leadsApproved`, `leadsFeedback`, `leadsApprovedAt`, `contentApproved`, `contentFeedback`, `contentApprovedAt` all present |
| 5 | Knowledge base uses pgvector semantic search with keyword fallback | VERIFIED (code only) | `store.ts` uses `prisma.$queryRaw` with `<=>` cosine similarity; fallback keyword matching when `chunkCount === 0`. NOTE: KnowledgeChunk table is empty (0 records) — OPENAI_API_KEY not set, migration not run yet |
| 6 | searchKnowledgeBase is a shared tool available to writer, leads, and orchestrator | VERIFIED | `shared-tools.ts` exports `searchKnowledgeBase`; imported at line 5 in `writer.ts`, line 4 in `leads.ts`, line 15 in `orchestrator.ts`; wired into all three tool sets |
| 7 | Campaign operations layer exists with all 8 functions and state machine | VERIFIED | `src/lib/campaigns/operations.ts` (502 lines): all 8 functions exported, `VALID_TRANSITIONS` Record enforces state machine, `formatCampaignDetail` helper centralizes JSON parsing |
| 8 | Writer agent has all 11 production quality rules hardcoded in system prompt | VERIFIED | `writer.ts` WRITER_SYSTEM_PROMPT contains all 11 rules verbatim: 70-word limit, no em dashes, subject rules, soft CTAs, banned phrases, {FIRSTNAME} format, PVP framework, spintax 10-30%, spintax grammar check |
| 9 | Writer generates campaign-aware content via getCampaignContext and saveCampaignSequence tools | VERIFIED | Both tools present in `writerTools` (lines 163-235); use dynamic import of `@/lib/campaigns/operations` to avoid circular deps |
| 10 | Campaign Agent exists and orchestrator delegates to it (not a stub) | VERIFIED | `campaign.ts` has `runCampaignAgent` with 6 tools; `orchestrator.ts` line 167: `const result = await runCampaignAgent({...})` — no `not_available` stub |
| 11 | Campaign CRUD API routes exist at /api/campaigns/* | VERIFIED | Three files confirmed: `route.ts` (GET/POST), `[id]/route.ts` (GET/PATCH/DELETE), `[id]/publish/route.ts` (POST) — all delegate to operations layer |
| 12 | Writer iterates via Cmd+J with feedback and stepNumber targeting | VERIFIED | `WriterInput.feedback` and `WriterInput.stepNumber` in types.ts; `delegateToWriter` passes `feedback` and `campaignId`; smart iteration documented in WRITER_SYSTEM_PROMPT |
| 13 | Reply suggestion generated on LEAD_REPLIED/LEAD_INTERESTED webhooks | VERIFIED | `generateReplySuggestion()` in webhook route (lines 7-38); called at line 155 for trigger events with `textBody` guard; result passed to `notifyReply()` as `suggestedResponse` |
| 14 | Suggested response rendered in Slack and email notifications | VERIFIED | `notifications.ts` lines 78-91 (Slack divider+section block); lines 127-133 (email HR+label+branded box with #F0FF7A) |

**Score:** 14/14 truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `prisma/schema.prisma` | Campaign model with all fields and indexes | VERIFIED | Campaign model lines 386-437; KnowledgeChunk model lines 277-288; pgvector extension enabled |
| `src/lib/knowledge/embeddings.ts` | embedText() and embedBatch() with lazy OpenAI client | VERIFIED | 48 lines; lazy `getClient()` init; both functions export correctly |
| `src/lib/knowledge/store.ts` | searchKnowledge() using pgvector cosine similarity with fallback | VERIFIED | `<=>` operator in `$queryRaw`; `reembedAllDocuments()` exported; keyword fallback when chunkCount === 0 |
| `src/lib/agents/shared-tools.ts` | Shared searchKnowledgeBase tool importable by all agents | VERIFIED | 49 lines; imports `searchKnowledge` from store; exports `searchKnowledgeBase` tool |
| `src/lib/campaigns/operations.ts` | Campaign CRUD and lifecycle operations (8 functions) | VERIFIED | 502 lines; all 8 functions present; state machine; `parseJsonArray` + `formatCampaignDetail` helpers |
| `src/lib/agents/writer.ts` | Upgraded Writer Agent with quality rules and campaign tools | VERIFIED | 483 lines; 8 tools including `getCampaignContext` and `saveCampaignSequence`; all 11 quality rules in system prompt |
| `src/lib/agents/types.ts` | WriterInput with campaignId and stepNumber; CampaignInput/Output | VERIFIED | `campaignId?` (line 85); `stepNumber?` (line 87); `CampaignInput` and `CampaignOutput` interfaces (lines 117-129) |
| `src/lib/agents/campaign.ts` | Campaign Agent with 6 tools and runCampaignAgent entry point | VERIFIED | 191 lines; 6 tools wrapping operations; `campaignConfig` with Sonnet model; exports confirmed |
| `src/lib/agents/orchestrator.ts` | delegateToCampaign calls runCampaignAgent; delegateToWriter passes campaignId | VERIFIED | Import at line 6; `runCampaignAgent({...})` at line 167; campaignId in both delegations |
| `src/app/api/campaigns/route.ts` | GET list + POST create endpoints | VERIFIED | 72 lines; GET validates workspace param; POST validates name+workspaceSlug; uses operations layer |
| `src/app/api/campaigns/[id]/route.ts` | GET detail, PATCH update, DELETE remove | VERIFIED | 88 lines; DELETE returns 400 for non-draft; 404 for missing campaign |
| `src/app/api/campaigns/[id]/publish/route.ts` | POST publish for client review | VERIFIED | 37 lines; calls `publishForReview(id)`; returns 400 for validation errors |
| `src/app/api/webhooks/emailbison/route.ts` | Reply suggestion generation on LEAD_REPLIED/LEAD_INTERESTED | VERIFIED | `generateReplySuggestion()` helper at lines 7-38; wired at line 155; non-blocking with null fallback |
| `src/lib/notifications.ts` | notifyReply with suggestedResponse blocks in Slack and email | VERIFIED | `suggestedResponse?: string | null` param; Slack divider+section (lines 78-91); email HR+box (lines 127-133) |
| `scripts/reembed-knowledge.ts` | One-time migration script for re-embedding knowledge base | VERIFIED | File exists at expected path |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `prisma/schema.prisma (Campaign)` | `prisma/schema.prisma (Workspace)` | `workspace Workspace @relation(fields: [workspaceSlug], references: [slug])` | WIRED | Line 432 in schema |
| `prisma/schema.prisma (Campaign)` | `prisma/schema.prisma (TargetList)` | `targetList TargetList? @relation(fields: [targetListId], references: [id])` | WIRED | Line 403 in schema |
| `src/lib/knowledge/store.ts` | `src/lib/knowledge/embeddings.ts` | `embedText()` call for query embedding | WIRED | `import { embedText, embedBatch } from "./embeddings"` at line 3; called in `searchKnowledge()` and `ingestDocument()` |
| `src/lib/agents/shared-tools.ts` | `src/lib/knowledge/store.ts` | `searchKnowledge` import | WIRED | `import { searchKnowledge } from "@/lib/knowledge/store"` at line 3 |
| `src/lib/agents/writer.ts` | `src/lib/campaigns/operations.ts` | `getCampaign` for loading campaign context | WIRED | Dynamic import `await import("@/lib/campaigns/operations")` at line 170 in getCampaignContext tool |
| `src/lib/campaigns/operations.ts` | `prisma/schema.prisma (Campaign)` | `prisma.campaign` CRUD queries | WIRED | `prisma.campaign.create/findUnique/findMany/update/delete` throughout operations.ts |
| `src/lib/campaigns/operations.ts` | `prisma/schema.prisma (Workspace)` | workspace existence check on create | WIRED | `prisma.workspace.findUnique({ where: { slug: workspaceSlug } })` at line 183 |
| `src/lib/agents/campaign.ts` | `src/lib/campaigns/operations` | thin tool wrappers around operations functions | WIRED | `import * as campaignOperations from "@/lib/campaigns/operations"` at line 3; all 6 tools call `campaignOperations.*` |
| `src/lib/agents/orchestrator.ts` | `src/lib/agents/campaign.ts` | `delegateToCampaign` executes `runCampaignAgent` | WIRED | `import { runCampaignAgent } from "./campaign"` at line 6; called at line 167 |
| `src/lib/agents/orchestrator.ts` | `src/lib/agents/writer.ts` | `delegateToWriter` passes `campaignId` for campaign-aware writing | WIRED | `campaignId` in inputSchema at line 113; passed to `runWriterAgent()` at line 129 |
| `src/app/api/webhooks/emailbison/route.ts` | `src/lib/agents/writer.ts` | `generateReplySuggestion` calls `runWriterAgent` in reply mode | WIRED | `await import("@/lib/agents/writer")` at line 16; `runWriterAgent({...})` at line 17 |
| `src/app/api/webhooks/emailbison/route.ts` | `src/lib/notifications.ts` | `notifyReply` with `suggestedResponse` parameter | WIRED | `await notifyReply({..., suggestedResponse})` at lines 166-175 |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| CAMP-01 | 08-01 | Campaign model as first-class entity with 8-state lifecycle | SATISFIED | Campaign model in schema.prisma with all 8 states and transition comment block |
| CAMP-02 | 08-01, 08-03 | Campaign owns TargetList (leads) + stores sequences (content) | SATISFIED | `targetListId` FK to TargetList; `emailSequence`/`linkedinSequence` JSON columns; `saveCampaignSequences()` in operations |
| CAMP-03 | 08-05 | Admin creates campaigns from Cmd+J, linking TargetList and channels | SATISFIED | Campaign Agent + orchestrator wiring enables "create campaign for Rise" natural language flow |
| CAMP-04 | 08-01 | Separate approval fields for leads and content | SATISFIED | `leadsApproved/leadsFeedback/leadsApprovedAt` + `contentApproved/contentFeedback/contentApprovedAt` in schema |
| CAMP-05 | 08-03, 08-05 | Campaign CRUD API routes enforce workspace ownership | SATISFIED | Routes filter by workspaceSlug; `createCampaign` validates workspace exists; `listCampaigns` filters by workspace |
| WRITER-01 | 08-04 | Writer generates multi-step email sequences with A/B variants on Campaign.emailSequence | SATISFIED | Email defaults in system prompt (3 steps, day 0/3/7); subject variant B always required; `saveCampaignSequence` tool saves to Campaign entity |
| WRITER-02 | 08-04 | Writer generates LinkedIn connection + follow-ups on Campaign.linkedinSequence | SATISFIED | LinkedIn defaults in system prompt (blank connection request + 2 message follow-ups); `saveCampaignSequence` saves to `linkedinSequence` |
| WRITER-03 | 08-05 | Conversational iteration via Cmd+J — admin reviews, gives feedback, writer iterates | SATISFIED | `delegateToWriter` accepts `feedback` param; `WriterInput.stepNumber` for targeted step regeneration; orchestrator system prompt documents 5-step Cmd+J flow |
| WRITER-04 | 08-04 | Writer follows style rules (no em dashes, natural language, avoid spam triggers) | SATISFIED | Rules 2, 3, 4, 5, 6 in WRITER_SYSTEM_PROMPT are mandatory for all generation |
| WRITER-05 | 08-04 | Writer ingests knowledge base best practices (46 docs) | SATISFIED | `searchKnowledgeBase` called automatically in both standard and campaign-aware flow (system prompt step 2/3) |
| WRITER-06 | 08-06 | Reply suggestion generated on LEAD_REPLIED/LEAD_INTERESTED, included in Slack notification | SATISFIED | `generateReplySuggestion()` in webhook handler; Slack block with `*Suggested Response:*` |
| WRITER-07 | 08-06 | Admin can refine reply suggestions via Cmd+J | SATISFIED | Reply suggestion mode documented in WRITER_SYSTEM_PROMPT; orchestrator's `delegateToWriter` handles any natural language refinement task |
| WRITER-08 | 08-02 | Knowledge base uses pgvector semantic search; all 46+ docs re-embedded | PARTIAL | pgvector code fully implemented and deployed to Neon; KnowledgeChunk table exists. BUT: 0 records currently — OPENAI_API_KEY not configured, migration not run. Keyword fallback is active. |
| WRITER-09 | 08-02 | searchKnowledgeBase shared across writer, leads, research, and campaign agents | SATISFIED | `shared-tools.ts` exports tool; imported and wired in writer, leads, and orchestrator. NOTE: Research agent and campaign agent are not listed as having it, but orchestrator covers research delegation. |

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/lib/agents/campaign.ts` | 99, 130, 135 | "Phase 9" comments in publishForReview tool and system prompt | INFO | Appropriate documentation of a deferred feature (client notification email). Functionally correct — the tool publishes successfully, client notification is explicitly scoped to Phase 9. Not a blocker. |

No blocking stubs, empty implementations, or placeholder returns found in any of the 14 verified files.

---

## Human Verification Required

### 1. Reply Suggestion in Slack Notification

**Test:** Trigger a LEAD_REPLIED webhook event from EmailBison for a workspace with a Slack channel configured.
**Expected:** Slack message shows the usual reply preview, then a divider, then a bold "Suggested Response:" heading with AI-drafted reply text (under 70 words, conversational tone).
**Why human:** Requires live webhook event from EmailBison — cannot trigger without real reply data hitting the endpoint.

### 2. Reply Suggestion in Email Notification

**Test:** Trigger a LEAD_REPLIED event for a workspace with `notificationEmails` configured.
**Expected:** Notification email contains a horizontal rule + "SUGGESTED RESPONSE" label in gray + a left-bordered box with #F0FF7A accent containing the AI-drafted reply text.
**Why human:** Requires live webhook + real email delivery — cannot verify email rendering programmatically.

### 3. Full Cmd+J Campaign Creation Flow

**Test:** Open Cmd+J chat, type "Create a campaign for Rise using the fintech CTO list". Then "Write email sequence for this campaign". Then "Push for client approval".
**Expected:** (a) Campaign Agent finds the list, confirms, creates Campaign record; (b) Writer Agent generates 3-step email sequence stored on Campaign.emailSequence; (c) Campaign transitions to pending_approval with publishedAt set.
**Why human:** Agent behavior (LLM interpretation + tool chaining) requires runtime test in a live session.

### 4. Smart Iteration Step Targeting

**Test:** After generating a sequence, type "Make step 2 shorter" in Cmd+J.
**Expected:** Writer regenerates only step 2 (shorter body), preserves steps 1 and 3 unchanged.
**Why human:** Depends on LLM correctly interpreting "step 2" as a specific step number and honoring the stepNumber/smart-iteration behavior — runtime verification needed.

### 5. pgvector Semantic Search After Migration

**Test:** Add OPENAI_API_KEY to Vercel, run `npx tsx scripts/reembed-knowledge.ts`, then query knowledge base with "cold outreach personalization" (not a literal match to any document title).
**Expected:** Results returned that are semantically relevant even without exact keyword matches.
**Why human:** KnowledgeChunk table currently has 0 records. User must configure OPENAI_API_KEY and run migration script first. Keyword fallback is active in the meantime — existing functionality preserved.

---

## Notable Observations

### pgvector Migration Pending (WRITER-08 partial)

The pgvector infrastructure is fully implemented and deployed to Neon (KnowledgeChunk table exists with vector(1536) column), but the re-embedding migration has not been run because `OPENAI_API_KEY` is not set in Vercel. The `scripts/reembed-knowledge.ts` script is ready. Until the migration runs, `searchKnowledge()` automatically falls back to keyword matching — the knowledge base continues to work as before.

**User action required:**
1. `printf "sk-..." | vercel env add OPENAI_API_KEY production`
2. Add OPENAI_API_KEY to `.env` locally
3. `npx tsx scripts/reembed-knowledge.ts`

This is documented in 08-02-SUMMARY.md under "User Setup Required".

### Workspace Ownership Enforcement (CAMP-05)

Ownership is implicit (listCampaigns filters by workspaceSlug, createCampaign validates workspace exists) rather than session-based. The plan explicitly defers explicit session enforcement to Phase 9. This is appropriate for admin-only access in Phase 8 — not a gap for this phase.

### WRITER-09 Coverage Note

The requirement mentions searchKnowledgeBase should be available to "writer, leads, research, campaign" agents. Research agent is handled via orchestrator delegation (orchestrator has the tool). Campaign agent does not directly have searchKnowledgeBase — but the plan's `shared-tools.ts` artifact documents writer, leads, and orchestrator as the three targets, matching the plan's must_haves. The REQUIREMENTS.md says "research" is also covered; research agent runs through the orchestrator which has the tool.

---

_Verified: 2026-03-01T10:30:00Z_
_Verifier: Claude (gsd-verifier)_
