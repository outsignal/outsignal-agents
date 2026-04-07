---
phase: 70-linkedin-state-machine-sequencing
plan: 01
subsystem: linkedin
tags: [linkedin, sequencing, state-machine, deploy, chainActions]

requires:
  - phase: 68-linkedin-action-chaining
    provides: chainActions forward-scheduling and CampaignSequenceRule evaluation
provides:
  - Connection gate split in deploy engine — pre-connect steps scheduled, post-connect steps event-driven
  - chainActions documentation clarifying connection gate contract
affects: [70-02, 70-03, connection-poller, linkedin-sequencing]

tech-stack:
  added: []
  patterns: [connection-gate-split, event-driven-followups]

key-files:
  created: []
  modified:
    - src/lib/campaigns/deploy.ts
    - src/lib/linkedin/chain.ts

key-decisions:
  - "Connection gate uses findLastIndex for connect step — handles sequences with multiple connect steps by splitting at the last one"
  - "postConnectSteps default delayDays: 1 day for first post-connect step, 2 days for subsequent — converted to delayHours for CampaignSequenceRule"
  - "createSequenceRulesForCampaign always called (even with empty array) for idempotent redeploy support"

patterns-established:
  - "Connection gate pattern: deploy engine splits sequence at connect step, pre-connect to chainActions, post-connect to CampaignSequenceRules"

requirements-completed: [SEQ-01, SEQ-02]

duration: 2min
completed: 2026-04-07
---

# Phase 70 Plan 01: Connection Gate Split Summary

**Deploy engine splits LinkedIn sequences at the connection gate: pre-connect steps (profile_view, connect) scheduled via chainActions, post-connect messages become event-driven CampaignSequenceRules triggered by connection_accepted**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-07T13:46:21Z
- **Completed:** 2026-04-07T13:48:18Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- deployLinkedInChannel now splits sequences at the connection gate instead of pre-scheduling all steps
- Post-connect follow-up messages are stored as CampaignSequenceRules with triggerEvent "connection_accepted"
- chainActions JSDoc updated to document the connection gate contract
- Idempotent redeploy: createSequenceRulesForCampaign always called to clean up stale rules

## Task Commits

Each task was committed atomically:

1. **Task 1: Modify deployLinkedInChannel to split sequence at the connection gate** - `63cae702` (feat)
2. **Task 2: Verify chainActions and add connection gate documentation** - `bc1dafdf` (docs)

## Files Created/Modified
- `src/lib/campaigns/deploy.ts` - Split LinkedIn sequence at connection gate; pre-connect to chainActions, post-connect to CampaignSequenceRules
- `src/lib/linkedin/chain.ts` - Updated JSDoc documenting connection gate contract

## Decisions Made
- Used `findLastIndex` (ES2023) for connect step detection — handles edge case of multiple connect steps in a sequence
- Default delay for post-connect steps: 1 day for first step, 2 days for subsequent, converted to hours via `* 24` for CampaignSequenceRule delayHours field
- Always call createSequenceRulesForCampaign even with empty postConnectSteps to ensure stale rules from previous deploys are cleaned up

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Connection gate split is in place; connection-poller (Plan 02) can now evaluate CampaignSequenceRules on connection_accepted events
- chainActions receives only pre-connect steps; no functional change needed in chain.ts

---
## Self-Check: PASSED

All files exist. All commits verified.

---
*Phase: 70-linkedin-state-machine-sequencing*
*Completed: 2026-04-07*
