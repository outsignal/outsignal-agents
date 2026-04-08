---
phase: 74-portal-unification
plan: 03
subsystem: api
tags: [channel-adapters, prisma, nextjs, portal, activity-feed]

# Dependency graph
requires:
  - phase: 72-adapter-implementations
    provides: LinkedInAdapter + EmailAdapter implementing ChannelAdapter.getActions()
  - phase: 74-portal-unification
    plan: 01
    provides: buildRef() helper in src/lib/channels/helpers.ts
provides:
  - Global portal activity API calls adapter.getActions() for campaign-scoped data
  - Non-campaign LinkedIn sources (messages, connections) retained as direct Prisma queries with documentation
affects: [74-portal-unification, portal-activity-consumers]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Call initAdapters() before getAdapter() in Next.js route handlers"
    - "Campaign channels stored as JSON string — parse with try/catch before iterating"
    - "Date range filtering done post-adapter-call (adapters return all, route filters to window)"
    - "Batch person lookup for LinkedIn adapter actions (adapter returns personId, not resolved person)"

key-files:
  created: []
  modified:
    - src/app/api/portal/activity/route.ts

key-decisions:
  - "74-03: LinkedIn adapter actions have personId but no resolved person — batch-fetch persons after adapter call"
  - "74-03: Adapters return all actions without date filtering — apply date window filter post-fetch in route"
  - "74-03: channels field is JSON string on Campaign model — parse per campaign with try/catch fallback to email"
  - "74-03: buildRef() imported from helpers.ts (74-01 ran first); inline fallback was prepared but not needed"
  - "74-03: Pre-existing TypeScript errors in portal/campaigns/[id]/page.tsx are out of scope (existed before this change)"

patterns-established:
  - "Route bootstrap: initAdapters() called once at start of GET handler before any getAdapter() calls"
  - "Partial migration documented: comment block marks non-campaign direct queries as intentional"

requirements-completed: [PORT-03]

# Metrics
duration: 12min
completed: 2026-04-08
---

# Phase 74 Plan 03: Portal Activity API Adapter Migration Summary

**Global activity API migrated to adapter.getActions() for campaign-scoped data; non-campaign LinkedIn sources retained with partial-migration documentation**

## Performance

- **Duration:** 12 min
- **Started:** 2026-04-08T19:46:34Z
- **Completed:** 2026-04-08T19:58:00Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Removed direct LinkedInAction and Reply Prisma queries from global activity route
- Replaced them with per-campaign, per-channel adapter.getActions() calls via initAdapters() + getAdapter()
- Retained direct LinkedInMessage and LinkedInConnection queries with explanatory comment block documenting intentional partial migration
- Preserved existing response shape exactly (`{ items, total, page, totalPages }`)
- Added batch Person lookup for LinkedIn adapter actions (adapter returns personId only, not resolved person data)
- Identified and used `buildRef()` import from helpers.ts (created by 74-01 running in parallel)

## Task Commits

Each task was committed atomically:

1. **Task 1: Refactor global activity API to use adapter.getActions() for campaign-scoped data** - `cfb11529` (feat)

**Plan metadata:** _(final docs commit — created below)_

## Files Created/Modified
- `src/app/api/portal/activity/route.ts` - Refactored to call adapter.getActions() for LinkedInAction + Reply campaign data; retained direct Prisma queries for LinkedInMessage + LinkedInConnection non-campaign entities

## Decisions Made
- **Adapter post-fetch date filtering:** The adapter.getActions() interface has no date range parameter. Applied the from/to window filter post-fetch in the route, consistent with the merge-then-filter pattern already used for the non-campaign sources.
- **Batch person lookup pattern retained:** LinkedIn adapter returns personId but no resolved person fields. Added batch prisma.person.findMany() after the adapter calls, mirroring the existing pattern in the pre-refactor code.
- **channels JSON parsing:** Campaign.channels is stored as a JSON string (e.g. `["email","linkedin"]`). Added try/catch parse with fallback to `["email"]` to avoid runtime crashes on malformed data.
- **buildRef import vs inline:** The plan specified using inline buildRef if 74-01 hadn't run yet. Since helpers.ts was already present as an untracked file from 74-01 running in parallel, switched to the import.

## Deviations from Plan

None - plan executed exactly as written. The `buildRef` inline-vs-import decision was explicitly anticipated by the plan and handled as instructed.

## Issues Encountered
- Pre-existing TypeScript errors in `src/app/(portal)/portal/campaigns/[id]/page.tsx` (SequenceStep type mismatch). These existed before this change and are out of scope per deviation rules. Logged for deferred fix.

## Next Phase Readiness
- Global activity API now uses adapter pattern for campaign-scoped data
- Pattern established for future route migrations in phase 74
- TypeScript compiles cleanly for route.ts (pre-existing unrelated errors in another file don't block)

---
*Phase: 74-portal-unification*
*Completed: 2026-04-08*
