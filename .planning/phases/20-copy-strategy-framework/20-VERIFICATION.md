---
phase: 20-copy-strategy-framework
verified: 2026-03-04T23:15:00Z
status: passed
score: 15/15 must-haves verified
---

# Phase 20: Copy Strategy Framework Verification Report

**Phase Goal:** The Writer Agent supports multiple copy strategies (Creative Ideas, PVP, one-liner, custom) with admin/agent selection per campaign, per-client KB examples tagged by strategy, groundedIn validation for Creative Ideas, and full Knowledge Base consultation regardless of strategy
**Verified:** 2026-03-04T23:15:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Writer Agent system prompt contains separate strategy blocks for Creative Ideas, PVP, One-liner, and Custom | VERIFIED | `writer.ts` lines 387-419: `### PVP`, `### Creative Ideas`, `### One-liner`, `### Custom` strategy blocks under `## Copy Strategies` |
| 2 | Quality rule #9 (PVP framework) is scoped to PVP strategy only, not applied universally | VERIFIED | `writer.ts` line 452: "NOTE: Former universal rule 'PVP framework' is now scoped to the PVP strategy block only." Shared quality rule #9 is Spintax |
| 3 | Creative Ideas strategy block requires exactly 3 separate email drafts, each with a groundedIn field | VERIFIED | `writer.ts` line 394: "Generate EXACTLY 3 full email drafts"; lines 396-401: `groundedIn` is REQUIRED with hard-reject validation |
| 4 | Signal-aware copy rules section exists with signal-type-to-angle mapping and NEVER-MENTION rule | VERIFIED | `writer.ts` lines 423-435: full signal-type to copy angle mapping; explicit FORBIDDEN phrases list |
| 5 | Tiered KB retrieval instructions (strategy+industry, then strategy-only, then general) are in system prompt | VERIFIED | `writer.ts` lines 362-365: steps a, b, c for tiered retrieval in both standard and campaign-aware flows |
| 6 | WriterInput type has copyStrategy, customStrategyPrompt, and signalContext fields | VERIFIED | `types.ts` lines 106-108: all three fields present with correct types |
| 7 | WriterOutput type has creativeIdeas, strategy, and references fields | VERIFIED | `types.ts` lines 134-136: all three fields present |
| 8 | Campaign model has copyStrategy String? column | VERIFIED | `schema.prisma` line 529: `copyStrategy String?` with Phase 20 comment |
| 9 | generateKBExamples tool exists in writerTools | VERIFIED | `writer.ts` lines 305-342: full tool implementation |
| 10 | Orchestrator's delegateToWriter accepts copyStrategy, customStrategyPrompt, signalContext | VERIFIED | `orchestrator.ts` lines 123-138: all three in inputSchema |
| 11 | Orchestrator passes all strategy params through to runWriterAgent | VERIFIED | `orchestrator.ts` lines 140-152: destructured and passed through |
| 12 | Orchestrator system prompt documents Copy Strategy workflow and multi-variant generation | VERIFIED | `orchestrator.ts` lines 629-650: "Copy Strategy Selection" and "Multi-Strategy Variants" sections |
| 13 | saveCampaignSequences saves copyStrategy to Campaign record when provided | VERIFIED | `operations.ts` lines 548-572: copyStrategy in data param; persisted at line 562 |
| 14 | Admin can request multiple strategy variants for same campaign (COPY-11) | VERIFIED | Orchestrator prompt lines 643-650: explicit multi-strategy variant workflow with example |
| 15 | Campaign record tracks which strategy was used (COPY-12) | VERIFIED | `CampaignDetail.copyStrategy: string | null` field; `formatCampaignDetail` returns `raw.copyStrategy ?? null` at line 175 |

**Score:** 15/15 truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `prisma/schema.prisma` | Campaign.copyStrategy column | VERIFIED | Line 529: `copyStrategy String?` with Phase 20 comment |
| `src/lib/agents/types.ts` | Extended WriterInput, WriterOutput, SignalContext, CreativeIdeaDraft | VERIFIED | All four interfaces/types present and exported (lines 80-137) |
| `src/lib/agents/writer.ts` | Multi-strategy Writer Agent with tiered KB, groundedIn validation, signal overlay, generateKBExamples | VERIFIED | WRITER_SYSTEM_PROMPT contains all required sections; writerTools has 9 tools |
| `src/lib/agents/orchestrator.ts` | Extended delegateToWriter with strategy params + updated system prompt | VERIFIED | delegateToWriter inputSchema has 3 new fields; system prompt has 3 new sections |
| `src/lib/campaigns/operations.ts` | saveCampaignSequences with copyStrategy persistence | VERIFIED | Data param accepts copyStrategy; persisted in updateData block |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `writer.ts` | `types.ts` | `import WriterInput, WriterOutput, SignalContext, CreativeIdeaDraft` | VERIFIED | Line 7: `import type { AgentConfig, WriterInput, WriterOutput, SignalContext, CreativeIdeaDraft } from "./types"` |
| `writer.ts` | `shared-tools.ts` | `import searchKnowledgeBase` | VERIFIED | Line 5: `import { searchKnowledgeBase } from "./shared-tools"` — used in writerTools at line 121 |
| `orchestrator.ts` | `writer.ts` | `delegateToWriter calls runWriterAgent with copyStrategy` | VERIFIED | Lines 142-152: `runWriterAgent({ ..., copyStrategy, customStrategyPrompt, signalContext })` |
| `writer.ts` | `campaigns/operations.ts` | `saveCampaignSequence tool calls saveCampaignSequences` | VERIFIED | Lines 225-232: dynamic import + `saveCampaignSequences(campaignId, { ..., copyStrategy })` |

---

## Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|--------------|-------------|--------|---------|
| COPY-01 | 20-01, 20-02 | Writer Agent supports multiple copy strategies; admin/agent selects per campaign | SATISFIED | 4 strategy blocks in WRITER_SYSTEM_PROMPT; orchestrator delegateToWriter accepts copyStrategy; saveCampaignSequences persists it |
| COPY-02 | 20-01 | Creative Ideas generates 3 constrained, personalized ideas per prospect | SATISFIED | System prompt: "Generate EXACTLY 3 full email drafts"; personalization via websiteAnalysis, ICP data |
| COPY-03 | 20-01 | Each Creative Idea constrained to a specific client offering (no hallucination) | SATISFIED | groundedIn VALIDATION (hard rule): writer must trace to coreOffers, differentiators, caseStudies, or KB doc |
| COPY-04 | 20-01 | Ideas personalized using company description, website analysis, ICP data | SATISFIED | Prompt: "use company description from websiteAnalysis, ICP data, and prospect context — ideas must be specific" |
| COPY-05 | 20-01 | Writer produces 3-idea format AND one-liner variant | SATISFIED | Separate `### Creative Ideas` and `### One-liner` strategy blocks; one-liner format defined |
| COPY-06 | 20-01 | Per-client copy examples stored in KB with strategy-specific tags; agent retrieves based on strategy | SATISFIED (with design change) | Tags use `strategy-{industrySlug}` not `strategy-{workspaceSlug}` — intentional change documented in CONTEXT.md pre-planning. Agent retrieves by strategy tag as required. |
| COPY-07 | 20-01 | AI generates draft copy examples; admin reviews before ingestion | SATISFIED | generateKBExamples tool returns examples as text with CLI command; "DO NOT auto-ingest" explicitly enforced |
| COPY-08 | 20-01 | Writer validates groundedIn field — every idea traces to real client offering | SATISFIED | Hard-reject rule in system prompt: "If you CANNOT trace the idea, DO NOT output that draft" |
| COPY-09 | 20-01 | Signal-triggered emails never mention the signal to recipient | SATISFIED | Signal-Aware Copy Rules section; NEVER-MENTION rule; forbidden phrases list |
| COPY-10 | 20-01 | Writer consults full KB for best practices regardless of strategy | SATISFIED | Step c of tiered KB retrieval: "ALWAYS, regardless of a/b results" — general best practices always consulted |
| COPY-11 | 20-02 | Multiple strategy variants per campaign for A/B split testing | SATISFIED | Orchestrator prompt "Multi-Strategy Variants" section with explicit workflow; delegateToWriter supports repeated calls with different strategies |
| COPY-12 | 20-02 | Campaign tracks which strategy variant was used | SATISFIED | Campaign.copyStrategy column; saveCampaignSequences persists it; CampaignDetail exposes it |

**Orphaned requirements check:** COPY-01 through COPY-12 are all mapped to Phase 20 in REQUIREMENTS.md. Plans 20-01 (COPY-01 through COPY-10) and 20-02 (COPY-01, COPY-11, COPY-12) cover all 12. No orphaned requirements.

---

## Design Change Note: COPY-06 Tag Format

REQUIREMENTS.md COPY-06 shows `creative-ideas-{workspaceSlug}` as an example tag format. The implementation uses `creative-ideas-{industrySlug}` (e.g., `creative-ideas-branded-merchandise`). This was a deliberate pre-planning decision documented in `20-CONTEXT.md`:

> "Tags use **strategy + industry** (e.g., `creative-ideas-branded-merchandise`, `pvp-recruitment`) — more reusable than strategy + client slug"

The requirement's stated intent — "agent retrieves relevant examples based on selected strategy" — is fully satisfied. The tag format change improves reusability by allowing examples to be shared across clients in the same industry. This is not a gap; it is an accepted design improvement.

---

## Anti-Patterns Found

No anti-patterns found in the key modified files. No TODO/FIXME/placeholder comments, no stub implementations, no empty handlers in Phase 20 code paths.

Specific checks:
- `writer.ts`: No `return null`, no placeholder blocks. `generateKBExamples.execute` returns real workspace data.
- `orchestrator.ts`: `delegateToWriter.execute` calls real `runWriterAgent` with strategy params; return includes `strategy`, `creativeIdeas`, `references`.
- `operations.ts`: `saveCampaignSequences` actually writes `copyStrategy` to DB when provided.
- `types.ts`: No stub interfaces — all fields have real types.

---

## Human Verification Required

### 1. Creative Ideas groundedIn enforcement at runtime

**Test:** Ask the Writer Agent to generate Creative Ideas copy for a workspace with a well-defined `coreOffers`. Inspect the output JSON for `groundedIn` fields.
**Expected:** Each of the 3 creative idea drafts has a non-empty `groundedIn` value containing an exact phrase from the workspace's `coreOffers`, `differentiators`, or `caseStudies`.
**Why human:** The hard-reject rule is in the system prompt — a language model instruction, not an executable code check. Its enforcement requires observing actual LLM output at runtime.

### 2. Tiered KB retrieval execution

**Test:** Trigger a Writer Agent run for a workspace with no strategy+industry tagged KB documents. Observe agent tool calls in the log.
**Expected:** Agent attempts `searchKnowledgeBase` with strategy+industry tag, then falls back to strategy-only, then always calls general best practices as the third tier.
**Why human:** The tiered retrieval is a prompt instruction. Verification requires observing the actual sequence of `searchKnowledgeBase` tool calls in a live AgentRun.steps log.

### 3. Signal-Aware copy never mentions signal

**Test:** Call `runWriterAgent` with a `signalContext: { signalType: "funding", ... }`. Read the generated email body.
**Expected:** No phrases like "your funding," "recently raised," "I saw you raised," "congratulations on your round" appear in any generated email. Copy leads with a growth/scale value angle.
**Why human:** Requires inspecting LLM-generated text at runtime for forbidden patterns.

### 4. Strategy pass-through end-to-end via orchestrator chat

**Test:** In the orchestrator chat, type: "Write creative ideas emails for Rise." Observe what parameters are passed to the Writer Agent.
**Expected:** `delegateToWriter` is called with `copyStrategy: "creative-ideas"` and the Writer returns 3 separate `creativeIdeas` drafts rather than `emailSteps`.
**Why human:** Requires running the full orchestrator chat flow to verify correct parameter detection and delegation.

---

## Gaps Summary

No gaps found. All 15 must-have truths verified. All 12 COPY requirements satisfied. TypeScript compilation passes (exit code 0). All key links wired. No anti-patterns.

---

_Verified: 2026-03-04T23:15:00Z_
_Verifier: Claude (gsd-verifier)_
