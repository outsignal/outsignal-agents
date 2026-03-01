---
phase: 08-campaign-entity-writer
plan: "03"
subsystem: api
tags: [prisma, typescript, campaigns, operations, state-machine]

# Dependency graph
requires:
  - phase: 08-campaign-entity-writer
    provides: Campaign Prisma model deployed to Neon (08-01)

provides:
  - Campaign CRUD and lifecycle operations layer (src/lib/campaigns/operations.ts)
  - State machine for campaign status transitions
  - CampaignDetail and CampaignSummary typed interfaces

affects:
  - 08-02-writer-agent
  - 08-04-campaign-api-routes
  - 09-client-portal
  - 10-deploy

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Operations layer pattern (zero-Prisma-in-agents) extended to Campaign entity — matching leads/operations.ts"
    - "State machine as Record<string, string[]> constant enforcing valid transitions at runtime"
    - "formatCampaignDetail helper centralizes JSON parsing and shape mapping — parse once, type everywhere"

key-files:
  created:
    - src/lib/campaigns/operations.ts
  modified: []

key-decisions:
  - "State machine implemented as VALID_TRANSITIONS constant — any->completed always allowed without listing in every status"
  - "parseJsonArray helper used for channels, emailSequence, linkedinSequence — safe null handling, returns null on invalid JSON"
  - "formatCampaignDetail centralizes JSON column parsing and record shaping — all 8 functions reuse this"
  - "deleteCampaign restricted to draft/internal_review — protects against accidental deletion of active campaigns"
  - "publishForReview validates both sequence presence AND targetListId — prevents publishing incomplete campaigns"

patterns-established:
  - "targetListInclude constant shared across all functions that need TargetList name + people count — single definition"
  - "updateCampaign builds data object with only defined keys — avoids overwriting fields with undefined"

requirements-completed:
  - CAMP-02
  - CAMP-05

# Metrics
duration: 1min
completed: 2026-03-01
---

# Phase 8 Plan 03: Campaign Operations Layer Summary

**Campaign CRUD and lifecycle operations layer with 8 exported functions, typed interfaces, and state machine validation — zero Prisma in agent tools**

## Performance

- **Duration:** 1 min
- **Started:** 2026-03-01T09:03:32Z
- **Completed:** 2026-03-01T09:04:42Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Created `src/lib/campaigns/operations.ts` with all 8 required exported functions following leads/operations.ts pattern exactly
- Implemented state machine validator: `VALID_TRANSITIONS` Record blocks invalid transitions (e.g., draft -> approved throws descriptive error)
- `createCampaign` validates workspace existence before creating, defaults channels to ["email"]
- `publishForReview` enforces 3 pre-conditions: status must be internal_review, must have sequence content, must have targetListId
- `deleteCampaign` restricted to draft/internal_review status — protects live campaigns
- TypeScript compiles clean (`npx tsc --noEmit` — zero errors)
- All JSON columns (channels, emailSequence, linkedinSequence) parsed transparently via `parseJsonArray` helper

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Campaign operations layer with CRUD and lifecycle functions** - `3590c72` (feat)

## Files Created/Modified
- `src/lib/campaigns/operations.ts` - Campaign operations layer: 8 functions, 4 interfaces, state machine, JSON helpers (501 lines)

## Decisions Made
- `parseJsonArray` returns `null` on invalid JSON rather than throwing — defensive for legacy data
- `formatCampaignDetail` helper created to centralize JSON parsing and shape mapping across all 8 functions
- `targetListInclude` constant defined once and reused — avoids drift between function include clauses
- `any -> completed` transition always allowed via early-return check before state machine lookup

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `src/lib/campaigns/operations.ts` is ready for 08-02 (Writer Agent) — agent tools will be thin wrappers
- `src/lib/campaigns/operations.ts` is ready for 08-04 (Campaign API routes) — API routes will call operations functions
- `src/lib/campaigns/operations.ts` is ready for 09 (Client Portal) — publishForReview, approval flows available
- No blockers

## Self-Check: PASSED

- `src/lib/campaigns/operations.ts` — FOUND
- Commit `3590c72` — FOUND

---
*Phase: 08-campaign-entity-writer*
*Completed: 2026-03-01*
