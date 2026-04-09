---
phase: 75-analytics-notifications
plan: 03
subsystem: analytics
tags: [analytics, channel-metrics, cached-metrics, email, linkedin, next-js, server-component]

# Dependency graph
requires:
  - phase: 75-analytics-notifications
    plan: 01
    provides: "Per-channel CachedMetrics rows (email:{campaignId}, linkedin:{campaignId}) via adapter.getMetrics()"

provides:
  - "GET /api/workspace/[slug]/channel-metrics — aggregated per-channel metrics API"
  - "Cross-channel analytics page at /workspace/[slug]/analytics"
  - "Side-by-side email vs LinkedIn comparison with per-campaign breakdown"

affects:
  - "v10.0 complete — final plan of final phase"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Server component fetching internal API route with cache: no-store for always-fresh analytics"
    - "CachedMetrics field is workspace (not workspaceSlug) — schema uses short field names"
    - "CachedMetrics.data is a JSON string — must JSON.parse() before casting to Record<string, unknown>"

key-files:
  created:
    - src/app/api/workspace/[slug]/channel-metrics/route.ts
    - src/app/(admin)/workspace/[slug]/analytics/page.tsx
  modified: []

key-decisions:
  - "CachedMetrics.workspace field (not workspaceSlug) — schema uses the shorter field name"
  - "CachedMetrics.data is stored as a string — JSON.parse() required before reading metric values"
  - "Used density=compact on MetricCard within channel cards to keep visual density appropriate for nested metric grids"

patterns-established:
  - "Channel analytics pattern: API route aggregates CachedMetrics by channel prefix, page renders side-by-side cards"

requirements-completed:
  - ANAL-02

# Metrics
duration: 2min
completed: 2026-04-09
---

# Phase 75 Plan 03: Cross-Channel Analytics Page Summary

**New analytics page at /workspace/[slug]/analytics renders side-by-side email and LinkedIn metric cards from channel-prefixed CachedMetrics rows, completing v10.0's analytics surface**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-09T07:30:18Z
- **Completed:** 2026-04-09T07:32:38Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- GET /api/workspace/[slug]/channel-metrics aggregates per-channel metrics from CachedMetrics rows written by 75-01
- Analytics page renders email card (Sent, Replied, Reply Rate, Open Rate, Bounce Rate) and LinkedIn card (Sent, Replied, Reply Rate, Accept Rate, Connections Sent)
- Per-campaign breakdown within each channel card, sorted by reply rate descending
- Cross-channel summary row compares reply rates side-by-side when both channels have data
- Empty state displayed gracefully when no channel-prefixed CachedMetrics rows exist

## Task Commits

1. **Task 1: API route — GET /api/workspace/[slug]/channel-metrics** - `66f5e41d` (feat)
2. **Task 2: Analytics page — /workspace/[slug]/analytics** - `81f9b5c8` (feat)

**Plan metadata:** TBD (docs commit)

## Files Created/Modified
- `src/app/api/workspace/[slug]/channel-metrics/route.ts` — Aggregates per-channel CachedMetrics rows, returns { workspace, enabledChannels, channels[] }
- `src/app/(admin)/workspace/[slug]/analytics/page.tsx` — Server component, side-by-side channel comparison page with empty state

## Decisions Made
- CachedMetrics schema uses `workspace` field (not `workspaceSlug`) — corrected from plan's implied field name
- CachedMetrics.data is stored as a JSON string, not a Prisma JSON field — must call JSON.parse() before reading values
- Used `density="compact"` on MetricCard instances within channel cards to reduce vertical bulk in the nested grid layout

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] CachedMetrics field name mismatch**
- **Found during:** Task 1 (TypeScript compilation)
- **Issue:** Plan's code template used `workspaceSlug` in the Prisma where clause, but the CachedMetrics model has a field named `workspace`. TypeScript caught this as TS2561.
- **Fix:** Changed `workspaceSlug: slug` to `workspace: slug` in the findMany query.
- **Files modified:** `src/app/api/workspace/[slug]/channel-metrics/route.ts`
- **Verification:** `npx tsc --noEmit` passes with zero errors
- **Committed in:** 66f5e41d

**2. [Rule 1 - Bug] CachedMetrics.data requires JSON.parse()**
- **Found during:** Task 1 (TypeScript compilation)
- **Issue:** Plan's code template cast `row.data` directly to `Record<string, unknown>`, but `data` is a `String` column in the schema (not a JSON Prisma field). TypeScript reported TS2352 — string doesn't overlap with Record.
- **Fix:** Changed `row.data as Record<string, unknown>` to `JSON.parse(row.data) as Record<string, unknown>`.
- **Files modified:** `src/app/api/workspace/[slug]/channel-metrics/route.ts`
- **Verification:** `npx tsc --noEmit` passes with zero errors
- **Committed in:** 66f5e41d

---

**Total deviations:** 2 auto-fixed (both Rule 1 - Bug)
**Impact on plan:** Both fixes were necessary for correctness. The CachedMetrics schema pattern (string field + JSON.parse) matches what 75-01 found — consistent with how the snapshot task was already writing data.

## Issues Encountered
- None beyond the two auto-fixed schema discrepancies above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- v10.0 is complete — all 75 phases shipped
- Analytics surface: channel snapshot (75-01), notifications (75-02), comparison page (75-03) all delivered
- Admins can navigate to /workspace/{slug}/analytics to compare email vs LinkedIn performance

---
*Phase: 75-analytics-notifications*
*Completed: 2026-04-09*
