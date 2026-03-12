---
phase: 45-multi-channel-sequencing-fix-if-else-upgrade
plan: 02
subsystem: api
tags: [linkedin, sequencing, prisma, typescript, if-else, conditions]

# Dependency graph
requires:
  - phase: 45-01
    provides: Fixed sequencing engine (triggerStepRef, cascade delete, bounce/unsub cancel, connect dedup)
provides:
  - CampaignSequenceRule schema with conditionType, conditionStepRef, elseActionType, elseMessageTemplate, elseDelayMinutes
  - Campaign schema with connectionTimeoutDays field (default 14)
  - evaluateCondition() handling requireConnected, hasReplied, emailBounced with backward compat
  - Else-path action descriptors with sequenceStepRef suffixed _else
  - Per-campaign connectionTimeoutDays lookup in connection-poller
affects:
  - linkedin-sequencing
  - connection-polling
  - campaign-deploy

# Tech tracking
tech-stack:
  added: []
  patterns:
    - conditionType enum strategy: null falls back to requireConnected boolean for legacy rules
    - Else-path descriptor uses _else suffix on sequenceStepRef for downstream dedup tracking
    - Per-campaign timeout via getConnectionTimeoutDaysForPerson helper (connect action -> campaign -> field)
    - DB pre-filter uses default timeout as lower bound; pollConnectionAccepts handles per-campaign precision

key-files:
  created: []
  modified:
    - prisma/schema.prisma
    - src/lib/linkedin/sequencing.ts
    - src/lib/linkedin/connection-poller.ts

key-decisions:
  - "conditionType=null + requireConnected=false => no condition, always passes — preserves exact current behavior for legacy rules"
  - "getConnectionsToCheck uses DEFAULT_CONNECTION_TIMEOUT_DAYS as DB pre-filter for efficiency — pollConnectionAccepts applies per-campaign precision in memory"
  - "emailOpened and emailClicked documented as future work — conditionStepRef field present in schema but no evaluator case added (requires engagement data polling infrastructure)"

patterns-established:
  - "New condition types added to switch in evaluateCondition() — extend without touching evaluateSequenceRules loop"
  - "Else-path always uses rule.delayMinutes as fallback when elseDelayMinutes is null"

requirements-completed: [SEQ-IFELSE-01, SEQ-IFELSE-02, SEQ-IFELSE-03, SEQ-TIMEOUT-01]

# Metrics
duration: 5min
completed: 2026-03-12
---

# Phase 45 Plan 02: If/Else Branching Conditions and Per-Campaign Timeout Summary

**If/else branching engine added to LinkedIn sequencer with 3 condition types (requireConnected, hasReplied, emailBounced), full backward compatibility, else-path action routing, and per-campaign connectionTimeoutDays**

## Performance

- **Duration:** ~5 min
- **Completed:** 2026-03-12
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Schema migrated with 6 new fields: `conditionType`, `conditionStepRef`, `elseActionType`, `elseMessageTemplate`, `elseDelayMinutes` on CampaignSequenceRule; `connectionTimeoutDays` on Campaign
- `evaluateCondition()` function evaluates 3 condition types with full backward compatibility (null conditionType falls back to legacy `requireConnected` boolean)
- `evaluateSequenceRules` loop upgraded: when condition passes → main action descriptor; when fails with elseActionType → else-path descriptor (suffixed `_else`); when fails with no else → skip (unchanged)
- `createSequenceRulesForCampaign` maps all 5 new fields from `LinkedInSequenceStep` at deploy time
- `connection-poller` reads `connectionTimeoutDays` per campaign via `getConnectionTimeoutDaysForPerson()` helper instead of a single hardcoded constant

## Task Commits

1. **Task 1: Schema migration** - `bb0b0bc` (feat)
2. **Task 2: Evaluation engine upgrade + per-campaign timeout** - `30ec97b` (feat)

## Files Created/Modified

- `prisma/schema.prisma` — CampaignSequenceRule: 5 new fields added; Campaign: connectionTimeoutDays added
- `src/lib/linkedin/sequencing.ts` — evaluateCondition() added; evaluateSequenceRules upgraded; LinkedInSequenceStep + createSequenceRulesForCampaign updated
- `src/lib/linkedin/connection-poller.ts` — CONNECTION_TIMEOUT_DAYS renamed to DEFAULT_CONNECTION_TIMEOUT_DAYS; getConnectionTimeoutDaysForPerson() helper added; pollConnectionAccepts uses per-connection timeout

## Decisions Made

- `conditionType=null` + `requireConnected=false` = no condition = always passes. This preserves exact current behavior for all existing rules with zero migration work.
- `getConnectionsToCheck` retains `DEFAULT_CONNECTION_TIMEOUT_DAYS` as DB-level pre-filter for query efficiency. `pollConnectionAccepts` does per-connection per-campaign timeout evaluation in the iteration loop.
- `emailOpened` and `emailClicked` condition types are not implemented — field `conditionStepRef` is in the schema ready to use, but evaluating them requires engagement data polling infrastructure not yet built. Documented as future work.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — schema pushed automatically. No external service configuration required.

## Next Phase Readiness

- All 4 if/else and timeout requirements fulfilled
- Phase 45 fully complete (Plan 01 + Plan 02)
- New condition types can be added to the `switch` in `evaluateCondition()` without touching the rule evaluation loop

---
*Phase: 45-multi-channel-sequencing-fix-if-else-upgrade*
*Completed: 2026-03-12*
