---
phase: 70-linkedin-state-machine-sequencing
plan: 03
subsystem: linkedin
tags: [linkedin, migration, state-machine, sequencing]

# Dependency graph
requires:
  - phase: 70-linkedin-state-machine-sequencing
    provides: Connection gate split (70-01) separating pre-connect and post-connect scheduling
provides:
  - One-time migration script to cancel premature pre-scheduled message actions and backfill CampaignSequenceRules
affects: [linkedin-worker, connection-poller]

# Tech tracking
tech-stack:
  added: []
  patterns: [dry-run-by-default migration scripts, batch cancel with idempotent rule creation]

key-files:
  created:
    - scripts/migrate-linkedin-state-machine.ts
  modified: []

key-decisions:
  - "Priority filter (P5 only) ensures P1 fast-track actions are never touched by migration"
  - "Dry-run is default (--dry-run flag); omit flag to apply changes"
  - "Delay schedule: 24h for first post-connect rule, position * 48h for subsequent"

patterns-established:
  - "Migration scripts use --dry-run default pattern with explicit --apply/omit to execute"

requirements-completed: [SEQ-07]

# Metrics
duration: 2min
completed: 2026-04-07
---

# Phase 70 Plan 03: LinkedIn State Machine Migration Script Summary

**One-time migration script cancelling premature pre-scheduled message actions for unconnected prospects and backfilling CampaignSequenceRules for affected campaigns**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-07T13:51:18Z
- **Completed:** 2026-04-07T13:53:04Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Migration script finds all pending P5 message actions where the prospect is not yet connected and cancels them
- Groups cancelled actions by workspace + campaign and creates CampaignSequenceRules with connection_accepted trigger for campaigns that lack them
- Idempotent: cancelled actions are skipped on re-run (status != pending), existing rules are checked before creation
- Dry-run mode previews all changes without writing to DB

## Task Commits

Each task was committed atomically:

1. **Task 1: Create migration script to cancel premature message actions and create rules** - `f210b80c` (feat)

## Files Created/Modified
- `scripts/migrate-linkedin-state-machine.ts` - One-time migration: cancel premature messages, create CampaignSequenceRules

## Decisions Made
- Used priority: 5 filter to exclude P1 fast-track actions from migration scope
- Dry-run is default behavior (pass --dry-run or omit flag); changes only applied when --dry-run is NOT passed
- Delay schedule follows same convention as deploy engine: 24h (1440 min) for first rule, position * 48h for subsequent

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - run `npx tsx scripts/migrate-linkedin-state-machine.ts --dry-run` to preview, then without flag to apply.

## Next Phase Readiness
- All 3 plans in Phase 70 are complete
- Deploy engine splits at connection gate (70-01)
- Counters and reply cancellation wired (70-02)
- Legacy pre-scheduled actions can be cleaned up with this migration script (70-03)
- System is ready for production deployment

## Self-Check: PASSED

All files exist. All commits verified.

---
*Phase: 70-linkedin-state-machine-sequencing*
*Completed: 2026-04-07*
