---
phase: 13-smart-sender-health
plan: "03"
subsystem: ui
tags: [recharts, sparkline, sender-health, next.js, prisma]

requires:
  - phase: 13-smart-sender-health/13-01
    provides: SenderHealthEvent schema, runSenderHealthCheck() detection engine

provides:
  - POST /api/senders/[id]/reactivate endpoint resets blocked/session_expired to healthy with audit event
  - GET /api/senders/[id]/health-history endpoint returns events, sparkline, and summary metrics
  - SenderHealthPanel component with recharts LineChart sparkline (30-day stepAfter trend)
  - SenderCard enhanced with expandable health history panel and Reactivate button
  - Dashboard "Sender Health" KPI card showing healthy/total with link to /senders

affects: [14-browser-extension, 12-dashboard-admin-ux]

tech-stack:
  added: []
  patterns:
    - Expandable card section via useState toggle + conditional render of child component
    - Sparkline color derived from latest data point severity (green/yellow/red)
    - Atomic transaction for sender reactivation (update + audit event in one $transaction)

key-files:
  created:
    - src/app/api/senders/[id]/reactivate/route.ts
    - src/app/api/senders/[id]/health-history/route.ts
    - src/components/senders/sender-health-panel.tsx
  modified:
    - src/components/senders/sender-card.tsx
    - src/components/senders/types.ts
    - src/app/(admin)/page.tsx

key-decisions:
  - "statusNum mapping: blocked/session_expired=2, warning=1, healthy/paused=0 — ensures sparkline severity is visually consistent"
  - "Sparkline fetched lazily on expand (not on card mount) — avoids N*30d DB queries on page load with many senders"
  - "prisma.$transaction([update, create]) for reactivation — ensures health reset and audit event are always paired atomically"
  - "Link wraps MetricCard for Sender Health KPI — keeps MetricCard as a pure display component, navigation at page level"
  - "Reactivate button only renders for healthStatus=blocked|session_expired — soft-flagged (warning) senders don't need admin intervention"

patterns-established:
  - "Health panel: fetch on expand, not on mount — lazy data loading for expandable detail panels"
  - "statusToNum severity function: 0=healthy, 1=warning, 2=hard-flagged — reusable severity scale for health indicators"

requirements-completed: [HEALTH-09, HEALTH-10, HEALTH-11]

duration: 3min
completed: "2026-03-02"
---

# Phase 13 Plan 03: Smart Sender Health UI Summary

**Sender card health panel with recharts 30-day sparkline, expandable event history, Reactivate button for blocked senders, and dashboard Sender Health KPI linking to /senders**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-02T22:25:15Z
- **Completed:** 2026-03-02T22:28:00Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- POST /api/senders/[id]/reactivate atomically resets hard-flagged senders to healthy with SenderHealthEvent audit trail
- GET /api/senders/[id]/health-history returns sparkline data (30 data points, worst-status-per-day aggregation), recent events list, and summary metrics (flag count, days since incident, last reason)
- SenderHealthPanel component uses recharts LineChart with stepAfter type — color-coded green/yellow/red based on latest severity — fetched lazily only when expanded
- SenderCard now has a "Health history" expand toggle (ChevronDown/Up) and a Reactivate button visible only for blocked/session_expired senders
- Dashboard "Sender Health" card shows healthy/total format, wrapped in Next.js Link to /senders

## Task Commits

1. **Task 1: Create reactivate and health-history API endpoints** - `e061fc8` (feat)
2. **Task 2: Enhance sender card with health panel, sparkline, reactivate button, and dashboard KPI** - `2f21327` (feat)

**Plan metadata:** _(final docs commit — see below)_

## Files Created/Modified
- `src/app/api/senders/[id]/reactivate/route.ts` - POST endpoint to reactivate blocked/session_expired senders
- `src/app/api/senders/[id]/health-history/route.ts` - GET endpoint for sparkline data and event history
- `src/components/senders/sender-health-panel.tsx` - Expandable health panel with recharts sparkline and event list
- `src/components/senders/sender-card.tsx` - Added expand toggle, SenderHealthPanel render, Reactivate button
- `src/components/senders/types.ts` - Added healthFlaggedAt field to SenderWithWorkspace
- `src/app/(admin)/page.tsx` - Updated Sender Health KPI card with Link wrapper and healthy/total display

## Decisions Made
- Sparkline fetched lazily on expand — avoids N×30-day DB queries on initial page load when many sender cards are rendered
- statusToNum severity mapping (0/1/2) used both for sparkline color and sparkline Y-axis values — single source of truth
- prisma.$transaction([update, create]) for reactivation — ensures health reset and audit event are always atomically paired
- Link wraps MetricCard for Sender Health KPI — keeps MetricCard as a pure display component, navigation handled at page level
- Reactivate button only shows for hard-flagged states (blocked, session_expired) — warning senders don't require admin intervention per 13-01 decision

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness
- Phase 13 Plan 03 complete — all sender health UI requirements satisfied (HEALTH-09, HEALTH-10, HEALTH-11)
- Phase 13 Plan 02 (Slack/email notifications for health events) is the remaining plan in Phase 13
- Both API endpoints and UI components are production-ready and compile cleanly (npx tsc --noEmit passes)

## Self-Check: PASSED

All files verified present. All commits verified in git log.

---
*Phase: 13-smart-sender-health*
*Completed: 2026-03-02*
