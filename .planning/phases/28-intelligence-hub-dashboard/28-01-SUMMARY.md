---
phase: 28-intelligence-hub-dashboard
plan: 01
subsystem: ui
tags: [react, nuqs, lucide, intelligence-hub, kpi, bento-grid]

# Dependency graph
requires:
  - phase: 27-ai-insights-action-queue
    provides: Insights model, insights API endpoint, insight generation
  - phase: 24-reply-classification-aggregation
    provides: Reply stats API, campaign analytics API
provides:
  - Intelligence Hub page at /intelligence with KPI row and bento grid layout
  - Global insights API mode (omit workspace = return all)
  - Sidebar navigation entry for Intelligence Hub
affects: [28-02-PLAN]

# Tech tracking
tech-stack:
  added: []
  patterns: [bento-grid-layout, kpi-stat-cards, global-api-mode]

key-files:
  created:
    - src/app/(admin)/intelligence/page.tsx
    - src/components/intelligence/kpi-row.tsx
  modified:
    - src/app/api/insights/route.ts
    - src/components/layout/sidebar.tsx

key-decisions:
  - "Reused AnalyticsFilters component for workspace/period filtering instead of custom filters"
  - "KPI data sourced from 3 parallel API calls: campaigns, reply stats, and insights"
  - "Top workspace computed by averaging reply rates per workspace across campaigns"

patterns-established:
  - "KPI stat card pattern: icon + label + value + subtext in grid layout"
  - "Bento grid with placeholder sections and drill-down links to analytics tabs"

requirements-completed: [HUB-01]

# Metrics
duration: 2min
completed: 2026-03-10
---

# Phase 28 Plan 01: Intelligence Hub Page Scaffold Summary

**Intelligence Hub page with 5-stat KPI row, workspace/period filters via nuqs, and bento grid layout with drill-down links to analytics tabs**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-10T13:27:45Z
- **Completed:** 2026-03-10T13:29:54Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Patched insights API to support global mode (omit workspace param returns all workspaces)
- Added Intelligence Hub sidebar entry with Brain icon in Email nav group
- Created KPI row component with 5 headline stats (total replies, avg reply rate, active insights, top workspace, interested rate)
- Built hub page with nuqs-managed filters, parallel API fetches, and bento grid layout with 5 placeholder sections

## Task Commits

Each task was committed atomically:

1. **Task 1: Patch insights API for global mode + add sidebar entry** - `1b0ade9` (feat)
2. **Task 2: Hub page scaffold with filters, KPI row, and bento grid shell** - `8e2d486` (feat)

## Files Created/Modified
- `src/app/api/insights/route.ts` - Made workspace param optional for global insights aggregation
- `src/components/layout/sidebar.tsx` - Added Intelligence Hub nav item with Brain icon after Analytics
- `src/components/intelligence/kpi-row.tsx` - KPI stat cards row (5 cards with loading skeletons)
- `src/app/(admin)/intelligence/page.tsx` - Hub page with filters, KPI row, and bento grid placeholders

## Decisions Made
- Reused existing AnalyticsFilters component for consistent filter UX across analytics and intelligence pages
- KPI data aggregated from 3 parallel API calls (campaigns, reply stats, insights) rather than a dedicated KPI endpoint
- Top workspace determined by averaging campaign reply rates per workspace slug

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Bento grid layout ready for Plan 02 to populate with section components (insights, rankings, classification, benchmarks, ICP)
- All 5 placeholder sections have correct drill-down links to analytics tabs
- KPI row functional with real API data

## Self-Check: PASSED

All 4 files verified present. Both task commits (1b0ade9, 8e2d486) verified in git log.

---
*Phase: 28-intelligence-hub-dashboard*
*Completed: 2026-03-10*
