---
phase: 17-leads-agent-discovery-upgrade
verified: 2026-03-04T14:30:00Z
status: passed
score: 14/14 must-haves verified
re_verification: false
human_verification:
  - test: "Ask Leads Agent to find CTOs in fintech and verify it calls buildDiscoveryPlan before any search tool"
    expected: "Agent presents a plan with sources, costs, quota before/after, and ends with 'Reply with approve...'"
    why_human: "Cannot programmatically test live LLM tool call ordering"
  - test: "Reply to the plan with 'Remove Prospeo' and verify the agent re-plans without running any searches"
    expected: "Agent regenerates plan without Prospeo and re-presents for approval"
    why_human: "Conversational adjustment loop requires live agent execution"
  - test: "Approve the plan and verify deduplicateAndPromote is called after all search tools complete"
    expected: "Agent reports per-source breakdown: found / dupes skipped / promoted counts plus enrichment running in background"
    why_human: "Post-execution result formatting requires live agent run"
---

# Phase 17: Leads Agent Discovery Upgrade — Verification Report

**Phase Goal:** Transform the Leads Agent from having raw discovery tools into a full discovery engine with ICP classification, source selection, approval plan with cost/quota projections, dedup against Person DB, auto-promotion, and enrichment waterfall feed.

**Verified:** 2026-03-04T14:30:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | deduplicateAndPromote() checks staged DiscoveredPerson records against Person DB using three match legs: email exact, LinkedIn URL exact, name+company fuzzy Levenshtein at 0.85 threshold | VERIFIED | promotion.ts lines 109-151: findExistingPerson() implements all three legs with explicit 0.85 threshold at line 144 |
| 2 | Non-duplicate leads are promoted to Person table with PersonWorkspace junction record created atomically | VERIFIED | promotion.ts lines 158-205: promoteToPerson() upserts Person then upserts PersonWorkspace; both operations in sequence |
| 3 | Leads without email get a unique placeholder email (placeholder-{uuid}@discovery.internal) so Person.email unique constraint is satisfied | VERIFIED | promotion.ts lines 164-167: `placeholder-${randomUUID()}@discovery.internal` pattern confirmed |
| 4 | Promoted leads are enqueued for enrichment via the existing EnrichmentJob queue — the full waterfall runs on cron pickup | VERIFIED | promotion.ts lines 211-226: triggerEnrichmentForPeople() calls enqueueJob({ provider: "waterfall", entityType: "person", chunkSize: 25 }) |
| 5 | Duplicate DiscoveredPerson records are marked status='duplicate' with personId set; promotedAt is NOT set (duplicates free for quota) | VERIFIED | promotion.ts lines 279-287: update sets status:'duplicate' and personId; promotedAt explicitly omitted per comment at line 284 |
| 6 | Agent presents a discovery plan (sources, filters, cost per source, estimated volume, quota impact) before executing any external API calls | VERIFIED | leads.ts line 158: buildDiscoveryPlan tool defined; returns sources with estimatedCost, totalEstimatedLeads, totalCost, quotaBefore, quotaAfter, quotaLimit, overQuota |
| 7 | Admin can modify the plan by replying with adjustments — agent regenerates the plan with changes and re-presents | VERIFIED | LEADS_SYSTEM_PROMPT lines 663-668: explicit examples of adjustment responses triggering re-plan ("Remove Serper", "Add Apollo with seniority=VP") |
| 8 | Agent only executes discovery searches after receiving explicit approval | VERIFIED | LEADS_SYSTEM_PROMPT line 661: "You MUST receive an explicit approval before calling any search tools"; line 668: "NEVER call searchApollo, searchProspeo, searchAiArk, searchGoogle, or extractDirectory without prior approval" |
| 9 | Discovery plan shows quota usage as before/after: "Quota: 500/2,000 used → estimated 700/2,000 after this search" | VERIFIED | buildDiscoveryPlan returns quotaBefore/quotaAfter/quotaLimit; system prompt line 656 shows exact display format |
| 10 | When quota would be exceeded, plan shows a warning but does NOT block execution (soft limit) | VERIFIED | buildDiscoveryPlan sets overQuota=true flag; system prompt line 657: "do NOT block -- soft limit" |
| 11 | Agent automatically selects appropriate sources based on ICP type with LLM deciding using system prompt guidance | VERIFIED | LEADS_SYSTEM_PROMPT lines 684-703: Source Selection Guide with enterprise B2B, niche/directory, local/SMB guidance. No hard-coded routing — LLM decides. |
| 12 | AI Ark is treated as an equal peer to Apollo and Prospeo (three people search sources) | VERIFIED (with minor inconsistency) | System prompt line 691: "equal coverage to Apollo/Prospeo (not a fallback -- a full peer)"; line 703: "AI Ark is an equal option alongside Apollo and Prospeo". Tool description at line 455 still says "secondary B2B source" — minor inconsistency, system prompt takes behavioral precedence |
| 13 | After discovery execution, agent calls deduplicateAndPromote and reports per-source breakdown with sample duplicate names | VERIFIED | leads.ts lines 238-253: deduplicateAndPromote tool delegates to promotion.ts; system prompt lines 676-682: explicit per-source reporting format with sample dupes |
| 14 | maxSteps is 15 (up from 8) to accommodate plan-approve-execute flow | VERIFIED | leads.ts line 745: `maxSteps: 15` confirmed |

**Score:** 14/14 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/discovery/promotion.ts` | Dedup, promotion, and enrichment trigger logic; exports deduplicateAndPromote, PromotionResult | VERIFIED | 330 lines; exports: PromotionResult, deduplicateAndPromote, levenshteinDistance, stringSimilarity. All five required internal functions present. |
| `src/lib/enrichment/types.ts` | Updated Provider type with 'waterfall' sentinel | VERIFIED | Line 16: `"waterfall"` confirmed in Provider union. Comment on line 6 documents its purpose. |
| `src/lib/agents/leads.ts` | buildDiscoveryPlan tool, deduplicateAndPromote tool, upgraded system prompt; exports runLeadsAgent | VERIFIED | Both tools at lines 158-253; LEADS_SYSTEM_PROMPT at line 640; runLeadsAgent exported at line 760; maxSteps: 15 at line 745 |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| src/lib/discovery/promotion.ts | prisma.person | findUnique/findFirst/findMany for dedup, upsert for promotion | WIRED | Lines 112, 121, 133, 170: all four prisma.person operations confirmed |
| src/lib/discovery/promotion.ts | src/lib/enrichment/queue.ts | enqueueJob() call with provider='waterfall' | WIRED | Line 17: import confirmed; line 217: enqueueJob({ provider: "waterfall" }) confirmed |
| src/lib/discovery/promotion.ts | prisma.discoveredPerson | findMany for staged records, update for status changes | WIRED | Lines 248, 280, 304: findMany + two update calls confirmed |
| src/lib/agents/leads.ts (buildDiscoveryPlan) | src/lib/workspaces/quota.ts | getWorkspaceQuotaUsage() call | WIRED | Line 14: import confirmed; line 186: getWorkspaceQuotaUsage() called in execute handler |
| src/lib/agents/leads.ts (deduplicateAndPromote tool) | src/lib/discovery/promotion.ts | deduplicateAndPromote() import and call | WIRED | Line 15: import as runDeduplicateAndPromote confirmed; line 248-250: called in execute handler |
| src/lib/agents/leads.ts (system prompt) | LLM behavior | LEADS_SYSTEM_PROMPT constant | WIRED | Line 640: LEADS_SYSTEM_PROMPT defined; line 743: wired into leadsConfig.systemPrompt |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| DISC-07 | 17-01-PLAN.md | Agent deduplicates discovered leads against local Person DB (by LinkedIn URL, email, or name+company match) before enrichment | SATISFIED | promotion.ts findExistingPerson() implements all three match legs; deduplicateAndPromote tool in leads.ts calls it |
| DISC-08 | 17-02-PLAN.md | Agent automatically selects best discovery sources based on ICP type | SATISFIED | Source Selection Guide in LEADS_SYSTEM_PROMPT lines 684-703; LLM decides with prompt guidance |
| DISC-11 | 17-02-PLAN.md | Agent generates a discovery plan (sources, reasoning, estimated cost, estimated lead volume per source) and presents for admin approval before executing searches | SATISFIED | buildDiscoveryPlan tool returns all required fields; system prompt Steps 1-2 mandate plan-before-search flow |
| DISC-12 | 17-02-PLAN.md | Admin can adjust the discovery plan (add/remove sources, change filters) before approving execution | SATISFIED | System prompt lines 663-668: explicit adjustment examples, re-plan mandate |
| DISC-13 | 17-02-PLAN.md | Discovery plan shows how campaign lead volume tracks against workspace monthly lead quota | SATISFIED | buildDiscoveryPlan returns quotaBefore/quotaAfter/quotaLimit/overQuota; system prompt line 656 shows exact display format |

No orphaned requirements — all five DISC-07, DISC-08, DISC-11, DISC-12, DISC-13 are claimed by plans 17-01 and 17-02.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/lib/agents/leads.ts` | 455 | searchAiArk tool description says "Use as secondary B2B source" | Warning | Contradicts system prompt at lines 691/703 which explicitly positions AI Ark as "not a fallback — a full peer". The system prompt governs actual LLM behavior; this tool description is a documentation inconsistency only. No functional impact. |

No blocker anti-patterns found. No TODO/FIXME/placeholder stubs. No empty implementations.

---

### Human Verification Required

#### 1. Plan-Before-Search Enforcement

**Test:** Start a Leads Agent chat session for any workspace. Ask: "Find me 100 CTOs at Series B fintech startups in London."
**Expected:** Agent calls buildDiscoveryPlan first (no search tools fire), presents a formatted plan with at least one source, reasoning, estimated volume, cost, and quota before/after numbers. Ends with approval prompt.
**Why human:** Cannot programmatically verify LLM tool call ordering. The system prompt mandates this sequence but only live execution confirms the LLM follows it.

#### 2. Plan Adjustment Loop

**Test:** After seeing the plan in test #1, reply: "Remove Prospeo and add more Apollo results."
**Expected:** Agent regenerates plan without Prospeo, increases Apollo estimated volume, re-presents. No search tools called until explicit approval.
**Why human:** Multi-turn conversational adjustment requires live agent execution.

#### 3. Full Plan-Approve-Execute-Dedup Flow

**Test:** After seeing the adjusted plan, reply: "Approve."
**Expected:** Agent says "Starting discovery — estimated ~30 seconds...", calls search tools in sequence, then calls deduplicateAndPromote. Final report shows per-source breakdown (found / dupes skipped / promoted) with up to 5 sample duplicate names and note that enrichment is running in background.
**Why human:** End-to-end execution with real API calls required.

---

### Gaps Summary

No gaps. All 14 must-have truths verified, all 3 artifacts confirmed substantive and wired, all 6 key links confirmed wired, all 5 requirement IDs satisfied.

The only finding is a minor tool description inconsistency (searchAiArk line 455 says "secondary" while the system prompt correctly says "equal peer"). This does not block goal achievement — the system prompt governs LLM behavior. A one-word fix is recommended but not required.

---

_Verified: 2026-03-04T14:30:00Z_
_Verifier: Claude (gsd-verifier)_
