---
phase: 02-provider-adapters-waterfall
plan: "05"
subsystem: api
tags: [recharts, prisma, nextjs, cost-tracking, dashboard, enrichment]

# Dependency graph
requires:
  - phase: 02-provider-adapters-waterfall
    provides: EnrichmentLog + DailyCostTotal schema, costs.ts with todayUtc/getDailyCap, PROVIDER_COSTS

provides:
  - GET /api/enrichment/costs endpoint with period/provider/workspace/date aggregation
  - Admin dashboard page at /enrichment-costs with Recharts visualizations
  - Cost visibility for paid enrichment API pipeline

affects: [03-batch-enrichment-ui, 05-campaign-automation]

# Tech tracking
tech-stack:
  added: []
  patterns: [Recharts client component with useState+useEffect data fetching, Prisma groupBy for cost aggregation, DailyCostTotal for efficient date-range queries]

key-files:
  created:
    - src/app/api/enrichment/costs/route.ts
    - src/app/(admin)/enrichment-costs/page.tsx
  modified: []

key-decisions:
  - "Dashboard placed in (admin) route group (not /admin) — consistent with existing admin pages that use AppShell layout"
  - "PieChart for provider breakdown, horizontal BarChart for workspace — better visual hierarchy for sparse data"
  - "DailyCostTotal used for byDate query — avoids expensive groupBy on EnrichmentLog by date; O(days) vs O(log_rows)"
  - "ReferenceLine at daily cap value on trend chart — immediate visual feedback when approaching/hitting cap"

patterns-established:
  - "Recharts in client components: use ResponsiveContainer wrapper, dark theme contentStyle on tooltips"
  - "Cost formatter pattern: fmt() for 4 decimal precision, fmtShort() for 2 decimal display"

requirements-completed: []

# Metrics
duration: 2min
completed: 2026-02-26
---

# Phase 2 Plan 05: Cost Dashboard Summary

**GET /api/enrichment/costs endpoint with Prisma groupBy aggregation and a Recharts admin dashboard showing provider/workspace spend breakdowns and daily cap progress**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-02-26T18:28:29Z
- **Completed:** 2026-02-26T18:30:30Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- GET /api/enrichment/costs returns period, dailyCap, todaySpend, capHit, totalSpend, byProvider, byWorkspace, byDate from EnrichmentLog
- Admin dashboard at /enrichment-costs with PieChart (provider breakdown), horizontal BarChart (workspace), daily trend BarChart with daily cap reference line
- Summary cards showing today's spend vs cap with progress bar (red when cap hit)

## Task Commits

1. **Task 1: Cost aggregation API endpoint** - `145293f` (feat)
2. **Task 2: Cost dashboard page with Recharts** - `ef0b0ef` (feat)

## Files Created/Modified

- `src/app/api/enrichment/costs/route.ts` — GET endpoint aggregating EnrichmentLog by provider/workspace/date; returns full cost summary with daily cap state
- `src/app/(admin)/enrichment-costs/page.tsx` — Client-side dashboard with PieChart/BarChart/ReferenceLine visualizations, loading skeletons, error retry, date range inputs

## Decisions Made

- Dashboard placed in `(admin)` route group (not `/admin`) — consistent with all existing admin pages that benefit from the AppShell layout with sidebar navigation
- Used `DailyCostTotal` for `byDate` query rather than grouping `EnrichmentLog` by date — much more efficient since DailyCostTotal is already aggregated
- PieChart for providers (good for "share of spend" view), horizontal BarChart for workspaces (good for comparing named entities)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Recharts TypeScript type errors on Tooltip formatter and PieChart label**
- **Found during:** Task 2 (Cost dashboard page implementation)
- **Issue:** Recharts v3.7.0 Tooltip `formatter` expects `value: number | undefined`; PieChart `label` callback uses `PieLabelRenderProps` not custom destructured props
- **Fix:** Updated formatter signature to `(value: number | undefined)` with nullish coalescing; updated label callback to use `props: { name?: string; percent?: number }` typing
- **Files modified:** src/app/(admin)/enrichment-costs/page.tsx
- **Verification:** `npx tsc --noEmit` — 0 errors in enrichment-costs files
- **Committed in:** ef0b0ef (Task 2 commit)

**2. [Rule 1 - Bug] Created page in (admin) route group instead of /admin**
- **Found during:** Task 2 (initial directory creation)
- **Issue:** Plan specified `src/app/admin/enrichment-costs/page.tsx` but project uses `(admin)` route group at `src/app/(admin)/` for all admin pages (layout, AppShell, etc.)
- **Fix:** Created page at `src/app/(admin)/enrichment-costs/page.tsx` to inherit the existing admin layout with sidebar navigation
- **Files modified:** src/app/(admin)/enrichment-costs/page.tsx
- **Verification:** Consistent with all other admin pages (people, settings, workspace, etc.)
- **Committed in:** ef0b0ef (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 - Bug)
**Impact on plan:** Both fixes necessary for correctness. No scope creep. Recharts type fix required for compilation; route group fix required for correct admin layout behavior.

## Issues Encountered

None beyond the auto-fixed deviations above.

## User Setup Required

None — no external service configuration required. Page is accessible at `/enrichment-costs` once deployed.

## Next Phase Readiness

- Phase 2 is now complete (all 5 plans done)
- Cost visibility dashboard ready for monitoring enrichment spend
- Phase 3 (batch enrichment UI) can build on cost data awareness
- EnrichmentLog + DailyCostTotal + costs API fully operational

---
*Phase: 02-provider-adapters-waterfall*
*Completed: 2026-02-26*
