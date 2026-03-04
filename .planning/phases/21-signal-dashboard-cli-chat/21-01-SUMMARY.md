---
phase: 21-signal-dashboard-cli-chat
plan: "01"
subsystem: ui
tags: [recharts, nuqs, prisma, nextjs, signals, dashboard]

# Dependency graph
requires:
  - phase: 18-signal-monitoring-infrastructure
    provides: SignalEvent, SignalDailyCost models and signal monitoring data
  - phase: 19-evergreen-signal-campaign-auto-pipeline
    provides: SignalCampaignLead model for leads-generated metric
provides:
  - GET /api/signals endpoint aggregating feed, type distribution, costs, and per-workspace breakdown
  - Signal intelligence dashboard at /admin/signals with 30s polling
  - Sidebar Signals nav item in the overview group
affects: [cli-chat, signal-dashboard]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - nuqs useQueryState for URL-persisted workspace filter
    - Promise.all for parallel Prisma queries in aggregation endpoint
    - 30s setInterval auto-refresh with silent fetch pattern

key-files:
  created:
    - src/app/api/signals/route.ts
    - src/app/(admin)/signals/page.tsx
  modified:
    - src/components/layout/sidebar.tsx

key-decisions:
  - "21-01: totalSignals in summary is feed.length (up to limit) — reflects visible data, not a separate count query"
  - "21-01: Tooltip formatter uses number | undefined pattern (matches existing enrichment-costs page) — Recharts v3 strict types require this"
  - "21-01: labelFormatter omitted from BarChart Tooltip — Recharts v3 type constraints; XAxis tickFormatter handles human labels instead"

patterns-established:
  - "SIGNAL_TYPE_COLORS map: per-type badge classes for consistent signal type visualization"
  - "SIGNAL_TYPE_LABELS map: human-readable labels for signal type keys across UI"

requirements-completed: [DASH-01, DASH-02, DASH-03, DASH-04, DASH-05]

# Metrics
duration: 3min
completed: 2026-03-04
---

# Phase 21 Plan 01: Signal Intelligence Dashboard Summary

**GET /api/signals aggregation endpoint + live admin dashboard with per-workspace breakdown, signal type bar chart, cost cap alerting, and 30s auto-refresh polling**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-03-04T23:04:39Z
- **Completed:** 2026-03-04T23:07:33Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Built `GET /api/signals` running 6 parallel Prisma queries to aggregate feed, type distribution, 7-day costs, leads generated (via campaign join), workspace caps, and signals-per-workspace
- Created `/admin/signals` dashboard page with summary cards (total signals, daily cost with 80%/100% cap color alerting, weekly cost), Recharts bar chart, per-workspace breakdown table with utilization %, and recent signals feed with color-coded type badges
- Added `Signals` nav item with Zap icon between Campaigns and Notifications in the sidebar overview group

## Task Commits

1. **Task 1: Create GET /api/signals aggregated endpoint** - `b3c6d71` (feat)
2. **Task 2: Create signal dashboard page with polling, charts, and sidebar nav** - `17a31f2` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `src/app/api/signals/route.ts` - Aggregated signal data endpoint: feed, typeDistribution, summary, perWorkspace
- `src/app/(admin)/signals/page.tsx` - Live signal intelligence dashboard with polling, chart, tables
- `src/components/layout/sidebar.tsx` - Added Zap import and Signals nav item

## Decisions Made

- `totalSignals` in the summary uses `feed.length` (capped at limit=100) rather than a separate COUNT query — reflects visible data and avoids an extra DB round trip
- Removed `labelFormatter` from the Recharts `<Tooltip>` — Recharts v3 has strict overload types that reject string label formatters; the XAxis `tickFormatter` handles human-readable labels instead, which is functionally equivalent
- Tooltip `formatter` typed as `(value: number | undefined)` matching the existing `enrichment-costs/page.tsx` pattern

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Recharts v3 Tooltip type errors**
- **Found during:** Task 2 (TypeScript verification)
- **Issue:** `formatter` typed as `(value: number)` and `labelFormatter` prop caused two TS2322 errors due to Recharts v3 strict overload types
- **Fix:** Typed formatter as `(value: number | undefined)` and removed `labelFormatter`, using XAxis `tickFormatter` for human labels instead
- **Files modified:** src/app/(admin)/signals/page.tsx
- **Verification:** `npx tsc --noEmit` passes with zero errors
- **Committed in:** `17a31f2` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — TypeScript type bug)
**Impact on plan:** Tooltip behavior equivalent — labels still shown via XAxis tickFormatter. No functional scope change.

## Issues Encountered

None beyond the Recharts Tooltip type fix documented above.

## User Setup Required

None — no external service configuration required. Signal data populates from the Phase 18 worker-signals cron.

## Next Phase Readiness

- Signal intelligence dashboard is live at /admin/signals
- Auto-refresh and workspace filter working
- Ready for Phase 21 Plan 02 (CLI chat interface)

## Self-Check: PASSED

- FOUND: src/app/api/signals/route.ts
- FOUND: src/app/(admin)/signals/page.tsx
- FOUND: .planning/phases/21-signal-dashboard-cli-chat/21-01-SUMMARY.md
- FOUND: commit b3c6d71 (Task 1)
- FOUND: commit 17a31f2 (Task 2)

---
*Phase: 21-signal-dashboard-cli-chat*
*Completed: 2026-03-04*
