---
phase: 19-evergreen-signal-campaign-auto-pipeline
plan: 02
subsystem: agents
tags: [ai-sdk, generateObject, campaign-agent, orchestrator, signal-campaigns, icp-extraction]

# Dependency graph
requires:
  - phase: 19-evergreen-signal-campaign-auto-pipeline
    provides: "Campaign model signal fields (type, icpCriteria, signalTypes, dailyLeadCap, icpScoreThreshold, signalEmailBisonCampaignId, lastSignalProcessedAt) + SignalCampaignLead junction table from 19-01"

provides:
  - "createSignalCampaign tool in Campaign Agent (natural language ICP -> structured criteria + signal campaign creation)"
  - "activateSignalCampaign tool (validates content, auto-creates target list, pre-provisions EmailBison, transitions draft -> active)"
  - "pauseResumeSignalCampaign tool (pause/resume signal campaigns via graceful state transitions)"
  - "icpCriteriaSchema + extractIcpCriteria helper (generateObject with Claude Haiku for ICP extraction)"
  - "Updated operations.ts: signal campaign state machine + full signal field support in all CRUD functions"
  - "Updated orchestrator system prompt with signal campaign delegation patterns"

affects:
  - "19-03 signal pipeline processor (needs activateSignalCampaign output format + campaign fields)"
  - "19-04 chat integration (Campaign Agent tools now exposed to dashboard chat)"
  - "21-signal-dashboard (CLI chat uses Campaign Agent signal tools)"

# Tech tracking
tech-stack:
  added:
    - "generateObject from ai SDK (structured extraction via Zod schema)"
    - "anthropic claude-haiku-4-5 (cost-efficient ICP extraction)"
  patterns:
    - "generateObject for structured data extraction from natural language (icpCriteriaSchema)"
    - "Signal campaign tools use direct prisma for activation (not operations layer) to handle target list auto-creation + EB provisioning"
    - "SIGNAL_CAMPAIGN_TRANSITIONS separate from VALID_TRANSITIONS — type-aware state machine dispatch"

key-files:
  created: []
  modified:
    - "src/lib/agents/campaign.ts"
    - "src/lib/agents/orchestrator.ts"
    - "src/lib/campaigns/operations.ts"

key-decisions:
  - "icpCriteria stored as JSON string in DB, passed as JSON.stringify'd string from campaign.ts to operations.ts — avoids double-serialization"
  - "activateSignalCampaign uses direct prisma.campaign.update (not operations.updateCampaignStatus) to bypass state machine validation — activation is done directly with full field updates including signalEmailBisonCampaignId and lastSignalProcessedAt"
  - "extractIcpCriteria uses claude-haiku-4-5 for cost efficiency — ICP extraction is a simple structured task, not creative work"
  - "maxSteps bumped from 8 to 10 in Campaign Agent to provide headroom for signal campaign creation (ICP extraction adds one LLM call step)"
  - "Signal type validation checks workspace signalEnabledTypes before calling extractIcpCriteria — fail-fast avoids spending LLM tokens on invalid requests"
  - "[Rule 3 - Blocking] operations.ts dual state machine was incomplete from 19-01 — applied missing changes (signalEmailBisonCampaignId in CampaignDetail, type in formatCampaignDetail return, SIGNAL_CAMPAIGN_TRANSITIONS in updateCampaignStatus, type in listCampaigns mapping)"

patterns-established:
  - "Signal campaign tools follow 'validate -> extract -> create' pattern for createSignalCampaign"
  - "Activation gate pattern: check content exists -> auto-provision infrastructure -> transition status"
  - "Orchestrator delegation examples use direct task quotes matching admin natural language"

requirements-completed: [PIPE-01, PIPE-02]

# Metrics
duration: 6min
completed: 2026-03-04
---

# Phase 19 Plan 02: Campaign Agent Signal Tools Summary

**Campaign Agent extended with createSignalCampaign (NL ICP extraction via generateObject/Haiku), activateSignalCampaign (EB pre-provisioning), and pauseResumeSignalCampaign tools; orchestrator updated with signal campaign delegation patterns**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-04T22:16:07Z
- **Completed:** 2026-03-04T22:22:07Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Campaign Agent has 3 new tools for the full signal campaign lifecycle (create, activate, pause/resume)
- ICP extraction from natural language uses generateObject with Claude Haiku and a typed Zod schema (industries, titles, companySizes, locations, keywords)
- activateSignalCampaign auto-creates target list if missing, pre-provisions EmailBison campaign + sequence steps for email channels, then transitions campaign to active
- Orchestrator system prompt now documents signal campaign delegation patterns matching admin's natural language
- operations.ts fully supports signal campaigns: dual state machines, type field in all outputs, signal fields in CampaignDetail

## Task Commits

Each task was committed atomically:

1. **Task 1: Add signal campaign tools to Campaign Agent** - `5f17d29` (feat)
2. **Task 2: Update orchestrator system prompt for signal campaign delegation** - `2fdd8d6` (feat)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified

- `src/lib/agents/campaign.ts` - Added createSignalCampaign, activateSignalCampaign, pauseResumeSignalCampaign tools; icpCriteriaSchema + extractIcpCriteria helper; updated CAMPAIGN_SYSTEM_PROMPT; maxSteps 8 -> 10
- `src/lib/agents/orchestrator.ts` - Added signal campaign delegation examples to 'When to Delegate' section; added Signal Campaign Workflow (Cmd+J) section
- `src/lib/campaigns/operations.ts` - Complete signal campaign support: signalEmailBisonCampaignId in CampaignDetail, type in formatCampaignDetail + listCampaigns, SIGNAL_CAMPAIGN_TRANSITIONS in updateCampaignStatus, signal field storage in createCampaign

## Decisions Made

- Used `claude-haiku-4-5` for ICP extraction — simple extraction task, cost efficiency over accuracy (Haiku is sufficient for structured field mapping)
- activateSignalCampaign bypasses the operations state machine to allow direct DB update with signalEmailBisonCampaignId + lastSignalProcessedAt in one transaction
- Signal type validation before ICP extraction fails fast and saves LLM tokens when workspace config is wrong
- icpCriteria passed as JSON string throughout — operations.ts accepts `string | null`, not `Record<string, unknown>`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Completed missing operations.ts signal campaign support from plan 19-01**
- **Found during:** Pre-execution discovery (checking 19-01 completion status)
- **Issue:** Plan 19-01 was never executed as a committed unit. The schema was pushed (fields exist in DB) but operations.ts was only partially updated: `signalEmailBisonCampaignId` missing from CampaignDetail interface and formatCampaignDetail, `type` not included in formatCampaignDetail return value, `type` not mapped in listCampaigns, createCampaign not storing signal fields, updateCampaignStatus not dispatching to SIGNAL_CAMPAIGN_TRANSITIONS
- **Fix:** Applied all missing operations.ts changes: added signalEmailBisonCampaignId to CampaignDetail interface, updated formatCampaignDetail raw parameter type and return value, fixed listCampaigns to include type, updated createCampaign to store signal fields, updated updateCampaignStatus to use type-aware state machine dispatch
- **Files modified:** `src/lib/campaigns/operations.ts`
- **Verification:** `npx tsc --noEmit` passes with 0 errors
- **Committed in:** `5f17d29` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking — missing prerequisite)
**Impact on plan:** Auto-fix was essential for plan 19-02 to function correctly. No scope creep beyond what 19-01 specified.

## Issues Encountered

- operations.ts was modified between sessions (appears 19-01 was partially applied but never committed). The SIGNAL_CAMPAIGN_TRANSITIONS constant and basic structure were already in place from a prior session, but key return values were incomplete. Self-consistent fix applied.

## User Setup Required

None - no external service configuration required. Signal campaigns require workspace `signalEnabledTypes` to be configured (existing workspace config), and EmailBison API token must be set for activation with email channels (existing workspace requirement).

## Next Phase Readiness

- Campaign Agent is ready for signal campaign creation via dashboard chat
- Phase 19-03 (signal pipeline processor) can now call `getCampaign` to read `icpCriteria`, `signalTypes`, `dailyLeadCap`, `icpScoreThreshold`, and `signalEmailBisonCampaignId`
- Phase 19-04 can wire Campaign Agent signal tools to the chat API

---
*Phase: 19-evergreen-signal-campaign-auto-pipeline*
*Completed: 2026-03-04*
