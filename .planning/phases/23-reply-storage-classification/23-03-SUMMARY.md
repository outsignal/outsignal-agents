---
phase: 23-reply-storage-classification
plan: 03
subsystem: api
tags: [prisma, next-api, pagination, raw-sql, classification]

requires:
  - phase: 23-reply-storage-classification (plan 01)
    provides: Reply model, classification types, classifier function
provides:
  - Paginated reply list API with filters (workspace, intent, sentiment, search, campaignId, date range)
  - Reply override API for admin reclassification
  - Aggregated classification stats API with COALESCE-based effective values
affects: [23-04 admin UI, 24-classification-analytics, 28-hub-dashboard]

tech-stack:
  added: []
  patterns: [raw SQL with COALESCE for effective override values, parameterized query builder]

key-files:
  created:
    - src/app/api/replies/route.ts
    - src/app/api/replies/[id]/route.ts
    - src/app/api/replies/stats/route.ts
  modified: []

key-decisions:
  - "Used raw SQL ($queryRawUnsafe) for intent/sentiment distributions to leverage COALESCE(overrideIntent, intent) -- Prisma groupBy does not support computed columns"
  - "Computed effectiveIntent/effectiveSentiment added to response payloads so UI does not need override fallback logic"

patterns-established:
  - "Reply API filter pattern: workspace, campaignId, date range presets (24h/7d/30d/all) as shared filter set across list and stats endpoints"
  - "Override validation pattern: validate against const arrays from types.ts, enforce objection subtype only when effective intent is objection"

requirements-completed: [REPLY-01, REPLY-06]

duration: 2min
completed: 2026-03-09
---

# Phase 23 Plan 03: Reply API Routes Summary

**Three API routes for reply list (paginated + filtered), admin override (PATCH), and classification stats (raw SQL COALESCE for effective values)**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-09T18:17:09Z
- **Completed:** 2026-03-09T18:18:46Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- GET /api/replies with 6 filter dimensions (workspace, intent multi-select, sentiment, search, campaignId, date range) and computed effectiveIntent/effectiveSentiment
- PATCH /api/replies/:id with full validation against classification type definitions, objection subtype constraint enforcement
- GET /api/replies/stats with raw SQL COALESCE for accurate effective intent/sentiment distributions, plus workspace counts and classified/overridden tallies

## Task Commits

Each task was committed atomically:

1. **Task 1: GET /api/replies with pagination and filters** - `31170b4` (feat)
2. **Task 2: PATCH /api/replies/:id override and GET /api/replies/stats** - `378ccb9` (feat)

## Files Created/Modified
- `src/app/api/replies/route.ts` - Paginated reply list with 6 filter dimensions and effectiveIntent/effectiveSentiment
- `src/app/api/replies/[id]/route.ts` - Reply override with validation against INTENTS/SENTIMENTS/OBJECTION_SUBTYPES
- `src/app/api/replies/stats/route.ts` - Classification stats with raw SQL COALESCE and Prisma groupBy

## Decisions Made
- Used `$queryRawUnsafe` with parameterized values for intent/sentiment distributions -- Prisma groupBy cannot do COALESCE on computed columns, raw SQL is cleaner than two-query merge approach
- Added effectiveIntent/effectiveSentiment computed fields to both list and override responses so UI layer stays simple

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All three API routes ready for plan 04 (admin UI) to consume
- Stats endpoint shaped for recharts consumption (array of {intent/sentiment, count} objects)
- Override endpoint returns updated record with effective values for optimistic UI updates

## Self-Check: PASSED

All 3 files verified on disk. Both commit hashes (31170b4, 378ccb9) found in git log.

---
*Phase: 23-reply-storage-classification*
*Completed: 2026-03-09*
