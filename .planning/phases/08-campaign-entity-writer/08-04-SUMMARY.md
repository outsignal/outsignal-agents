---
phase: 08-campaign-entity-writer
plan: "04"
subsystem: api
tags: [writer-agent, cold-email, linkedin, campaign, quality-rules, spintax, pvp-framework]

# Dependency graph
requires:
  - phase: 08-02
    provides: searchKnowledgeBase shared tool in shared-tools.ts
  - phase: 08-03
    provides: getCampaign and saveCampaignSequences from campaigns/operations.ts

provides:
  - Writer Agent with 11 mandatory quality rules hardcoded in system prompt
  - getCampaignContext tool for loading Campaign entity details during generation
  - saveCampaignSequence tool for saving sequences directly to Campaign entities
  - Smart iteration support via stepNumber field on WriterInput
  - Reply suggestion mode with scoped quality rules
  - Campaign-aware buildWriterMessage with campaignId and stepNumber context

affects:
  - 08-05 (Campaign API routes — writer tools now campaign-aware)
  - 08-06 (Client portal — content approval flow relies on sequences saved via saveCampaignSequence)
  - 09 (Client portal auth/approval UX)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Campaign-aware agent tools: getCampaignContext + saveCampaignSequence use dynamic import to load operations"
    - "Dual-flow system prompt: standard (saveDraft) vs campaign-aware (saveCampaignSequence) based on campaignId presence"
    - "Smart iteration: stepNumber in WriterInput enables targeted single-step regeneration"

key-files:
  created: []
  modified:
    - src/lib/agents/writer.ts
    - src/lib/agents/types.ts

key-decisions:
  - "getCampaignContext and saveCampaignSequence use dynamic import (not top-level) to avoid circular dependency at module load"
  - "saveCampaignSequence coexists with saveDraft — campaign-aware flow uses saveCampaignSequence, standalone drafts use saveDraft"
  - "stepNumber added to WriterInput for targeted step regeneration without rebuilding full sequence"
  - "Reply suggestion mode scoped to rules 2/5/6/7 only — no PVP or spintax for reactive replies"

patterns-established:
  - "Dual-flow system prompt: conditional tool selection based on campaignId presence at runtime"
  - "Quality rules as hardcoded system prompt constants — not configurable, always enforced"

requirements-completed: [WRITER-01, WRITER-02, WRITER-04, WRITER-05]

# Metrics
duration: 15min
completed: 2026-03-01
---

# Phase 8 Plan 4: Writer Agent Quality Rules and Campaign Awareness Summary

**Writer Agent upgraded with 11 hardcoded production quality rules (PVP, spintax, 70-word limit, merge token format), campaign-aware getCampaignContext/saveCampaignSequence tools, smart step-level iteration, and reply suggestion mode**

## Performance

- **Duration:** 15 min
- **Started:** 2026-03-01T09:11:21Z
- **Completed:** 2026-03-01T09:26:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Rewrote Writer system prompt with all 11 production quality rules hardcoded as mandatory (PVP framework, spintax 10-30%, 70-word limit, no em dashes, soft CTA questions, variable format {FIRSTNAME}, banned phrases list)
- Added getCampaignContext tool for loading Campaign entity details (channels, existing sequences, TargetList, approval status)
- Added saveCampaignSequence tool for saving sequences directly to Campaign entities instead of EmailDraft rows
- Added campaignId and stepNumber fields to WriterInput for campaign linkage and targeted step regeneration
- Added smart iteration: feedback about specific step regenerates that step only; general feedback regenerates all steps
- Added reply suggestion mode with scoped rule subset (rules 2/5/6/7 only, no PVP/spintax)
- Email defaults codified: 3 steps at day 0/3/7, always provide subject variant B
- LinkedIn defaults codified: blank connection request (no note) + 2 message follow-ups

## Task Commits

Each task was committed atomically:

1. **Task 1: Update WriterInput type and add campaign context tool** - `1b92557` (feat)
2. **Task 2: Rewrite Writer system prompt with production quality rules** - `0583683` (feat)

**Plan metadata:** (docs commit to follow)

## Files Created/Modified

- `/Users/jjay/programs/outsignal-agents/src/lib/agents/types.ts` - Added campaignId and stepNumber optional fields to WriterInput interface
- `/Users/jjay/programs/outsignal-agents/src/lib/agents/writer.ts` - Added getCampaignContext and saveCampaignSequence tools; rewrote WRITER_SYSTEM_PROMPT with all 11 quality rules, dual-flow process, smart iteration, reply mode, and email/LinkedIn defaults

## Decisions Made

- getCampaignContext and saveCampaignSequence use dynamic import (`await import("@/lib/campaigns/operations")`) to avoid potential circular dependency issues at module load time
- saveCampaignSequence coexists with saveDraft — the system prompt guides the agent to choose based on whether campaignId is present
- stepNumber added to WriterInput so callers can specify targeted regeneration without modifying the task string
- Reply suggestion mode keeps rules 2/5/6/7 only (no PVP framework, no spintax — those are cold outreach patterns only)
- LinkedIn connection requests explicitly noted as "blank (no note)" matching the user decision recorded in STATE.md decisions

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Writer Agent fully upgraded and campaign-aware — ready for Phase 8 Plan 5 (campaign API routes that call the writer)
- getCampaignContext and saveCampaignSequence tools tested via TypeScript compilation; runtime behavior tested when campaign API routes are wired up in plan 05
- All 8 tools present in writerTools: getWorkspaceIntelligence, getCampaignPerformance, getSequenceSteps, searchKnowledgeBase, getExistingDrafts, saveDraft, getCampaignContext, saveCampaignSequence

---
*Phase: 08-campaign-entity-writer*
*Completed: 2026-03-01*
