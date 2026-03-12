---
phase: 44-ooo-re-engagement-pipeline
plan: 03
subsystem: admin-ui
tags: [nextjs, prisma, trigger.dev, ooo, admin-dashboard, api-routes]

requires:
  - phase: 44-01
    provides: OooReengagement schema, ooo-reengage stub task

provides:
  - GET /api/ooo — list OOO records with workspace/status filter and summary stats
  - PATCH /api/ooo/[id] — reschedule pending OOO record (updates oooUntil + calls runs.reschedule)
  - DELETE /api/ooo/[id] — cancel pending OOO record (calls runs.cancel + marks cancelled)
  - /ooo-queue admin dashboard page with summary cards, filters, and sortable table
  - Sidebar OOO Queue link in Overview group (after Campaigns)

affects: [sidebar navigation, admin dashboard navigation]

tech-stack:
  added: []
  patterns:
    - Client component page with inline fetch from API route (same as background-tasks pattern)
    - Inline date editor in table cell with save/cancel UX
    - AlertDialog confirm for destructive actions
    - Trigger.dev runs.reschedule/runs.cancel wrapped in try/catch for graceful handling

key-files:
  created:
    - src/app/api/ooo/route.ts
    - src/app/api/ooo/[id]/route.ts
    - src/app/(admin)/ooo-queue/page.tsx
    - src/app/(admin)/ooo-queue/loading.tsx
  modified:
    - src/components/layout/sidebar.tsx

key-decisions:
  - "Trigger.dev SDK calls (runs.reschedule, runs.cancel) wrapped in try/catch — run may have already fired/been cancelled; local DB record updated regardless"
  - "Summary stats always scoped to workspaceSlug filter when set — counts reflect visible data"
  - "Inline date editor replaces date cell in-place on pending rows — no modal, no navigation"

patterns-established:
  - "OOO admin pattern: API route queries OooReengagement + enriches with Person name via separate findMany + personMap"

requirements-completed: [OOO-05]

duration: 3min
completed: 2026-03-12
---

# Phase 44 Plan 03: OOO Queue Dashboard Summary

**Admin OOO Queue dashboard with REST API (list/reschedule/cancel), summary cards, inline date editing, and sidebar navigation link using Trigger.dev runs management SDK.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-12T22:41:10Z
- **Completed:** 2026-03-12T22:44:26Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- GET /api/ooo returns OooReengagement records enriched with Person name + 4-stat summary (total, returning this week, re-engaged, failed)
- PATCH /api/ooo/[id] reschedules Trigger.dev delayed task and updates oooUntil in DB; DELETE cancels task and marks record cancelled
- /ooo-queue page: 4 metric cards, workspace + status filter dropdowns, table with inline date editor and AlertDialog cancel confirm
- needsManualReview=true records show amber "Review" badge next to return date
- Sidebar CalendarClock link to /ooo-queue inserted after Campaigns in Overview group

## Task Commits

1. **Task 1: OOO API routes (list + reschedule + cancel)** - `fd71037` (feat)
2. **Task 2: OOO Queue admin dashboard page + sidebar link** - `86a6532` (feat)

## Files Created/Modified

- `src/app/api/ooo/route.ts` — GET /api/ooo: list records with workspace/status filter, enrich with person name, compute summary stats
- `src/app/api/ooo/[id]/route.ts` — PATCH (reschedule): updates oooUntil + runs.reschedule; DELETE (cancel): runs.cancel + status=cancelled
- `src/app/(admin)/ooo-queue/page.tsx` — Client component dashboard: summary cards, workspace/status filters, table with inline date editor and cancel confirm
- `src/app/(admin)/ooo-queue/loading.tsx` — Skeleton loader matching background-tasks pattern
- `src/components/layout/sidebar.tsx` — Added CalendarClock import + OOO Queue nav item after Campaigns in Overview group

## Decisions Made

- Trigger.dev SDK calls wrapped in try/catch: if run has already completed or been cancelled, log a warning but still update the local DB record (idempotent behavior)
- Summary stats use the same workspaceSlug filter as the record list so counts match visible data
- Inline date editor UX: click Pencil icon → date input replaces date text in-place → Save/Cancel buttons → PATCH on save

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Phase 44 is now complete: OOO detection (44-01), re-engagement task (44-02), and admin dashboard (44-03) all shipped.
- OOO Queue visible in sidebar and functional. Ready for production verification once leads start returning from OOO.

---
*Phase: 44-ooo-re-engagement-pipeline*
*Completed: 2026-03-12*
