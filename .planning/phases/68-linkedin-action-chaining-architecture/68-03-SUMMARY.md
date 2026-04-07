---
phase: 68-linkedin-action-chaining-architecture
plan: 03
subsystem: scripts
tags: [linkedin, prisma, migration, action-chaining]

# Dependency graph
requires:
  - phase: 68-01
    provides: parentActionId field on LinkedInAction model
provides:
  - One-time migration script for validating and fixing misordered pre_warm_view actions
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Select-only queries to avoid fetching columns not yet pushed to DB"
    - "Dry-run-first migration pattern with explicit --apply flag"

key-files:
  created:
    - scripts/migrate-prewarm-actions.ts
  modified: []

key-decisions:
  - "Used select queries instead of findMany(*) to avoid parentActionId column not yet pushed to DB"
  - "4-hour reschedule gap (or 5-min fallback) matches chainActions() MIN_GAP_MS from 68-01"

patterns-established:
  - "Migration scripts default to dry-run with --apply flag for safety"

requirements-completed: [CHAIN-05]

# Metrics
duration: 3min
completed: 2026-04-07
---

# Phase 68 Plan 03: Pre-Warm Action Migration Summary

**One-time migration script validating 1011 pending pre_warm_view actions with dry-run/apply modes and select-only queries for DB compatibility**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-07T11:16:17Z
- **Completed:** 2026-04-07T11:19:17Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Created migration script that finds all pending pre_warm_view actions and checks ordering vs their associated connect actions
- Dry-run mode (default) reports summary without modifying data; --apply flag writes corrections
- Script correctly identifies misordered actions and reschedules views to 4 hours (or 5 minutes) before their connect
- Live dry-run found 1011 pending pre_warm_view actions, all correctly ordered (zero corrections needed)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create migration script for pending pre_warm_view actions** - `8033d8d7` (feat)

## Files Created/Modified
- `scripts/migrate-prewarm-actions.ts` - One-time migration script with dry-run/apply modes for fixing misordered pre_warm_view actions

## Decisions Made
- Used Prisma `select` to fetch only needed columns, avoiding `parentActionId` which exists in schema but hasn't been pushed to the database yet (Tier 3 gated action from 68-01)
- 4-hour gap matches the MIN_GAP_MS constant established in chainActions() from 68-01

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added select queries to avoid parentActionId column error**
- **Found during:** Task 1 (migration script creation)
- **Issue:** Default findMany fetches all columns including parentActionId, which hasn't been pushed to the DB yet (Tier 3 gated action). Prisma throws P2022 error.
- **Fix:** Added explicit `select` clauses to both findMany and findFirst queries, fetching only the columns needed for the migration logic
- **Files modified:** scripts/migrate-prewarm-actions.ts
- **Verification:** Script runs successfully against production DB in dry-run mode
- **Committed in:** 8033d8d7 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential fix for DB compatibility. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviation above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Migration script is ready to run with --apply when needed during the transition period
- All 1011 current pending pre_warm_view actions are already correctly ordered (no corrections needed)
- 68-02 (deploy.ts and signal-campaigns.ts integration) is the remaining plan in this phase

## Self-Check: PASSED

- scripts/migrate-prewarm-actions.ts: FOUND
- Commit 8033d8d7: FOUND
- No delete/remove/destroy in script: VERIFIED
- --apply flag support: VERIFIED
- Dry-run produces summary output: VERIFIED

---
*Phase: 68-linkedin-action-chaining-architecture*
*Completed: 2026-04-07*
