---
phase: 69-data-consistency-canonical-metric-sources
plan: 01
subsystem: api
tags: [prisma, dashboard, metrics, emailbison, linkedin]

requires:
  - phase: none
    provides: existing dashboard stats API
provides:
  - Admin dashboard stats API using canonical metric sources (LinkedInDailyUsage, EmailBison API, Reply table)
affects: [69-02, 69-03, admin-dashboard, portal-dashboard]

tech-stack:
  added: []
  patterns: [canonical-metric-sources, emailbison-api-with-webhook-fallback]

key-files:
  created: []
  modified:
    - src/app/api/dashboard/stats/route.ts

key-decisions:
  - "LinkedInDailyUsage replaces LinkedInAction for all LinkedIn stats; pending/failed KPIs set to 0 since LinkedInDailyUsage does not track action-level status"
  - "EmailBison API used for sent count when workspace is selected; WebhookEvent retained as fallback for all-workspaces view"
  - "Reply table (direction=inbound) is canonical source for reply counts in KPIs, time-series, and per-workspace summaries"

patterns-established:
  - "Canonical metric pattern: use aggregated/authoritative tables over raw event logs"
  - "EB API with fallback: try EmailBison API first, fall back to WebhookEvent if unavailable or all-workspaces view"

requirements-completed: [CONSIST-01, CONSIST-02, CONSIST-03]

duration: 5min
completed: 2026-04-07
---

# Phase 69 Plan 01: Admin Dashboard Canonical Metric Sources Summary

**Admin dashboard stats API switched to LinkedInDailyUsage, EmailBison API (with WebhookEvent fallback), and Reply table for consistent metrics across views**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-07T12:51:42Z
- **Completed:** 2026-04-07T12:56:57Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- LinkedIn KPIs and time-series now source from LinkedInDailyUsage (aggregated daily totals, no double-counting)
- Email sent count uses EmailBison API as primary source with WebhookEvent fallback for "all workspaces" view
- Reply counts throughout the file (KPIs, time-series sparkline, per-workspace summaries) now come from Reply table instead of WebhookEvent LEAD_REPLIED/LEAD_INTERESTED events

## Task Commits

Each task was committed atomically:

1. **Task 1+2: Replace LinkedIn queries + switch sent/reply sources** - `fea6cb46` (feat)

**Plan metadata:** pending

## Files Created/Modified
- `src/app/api/dashboard/stats/route.ts` - Admin dashboard stats API with all three canonical source replacements

## Decisions Made
- Combined Tasks 1 and 2 into a single commit since LinkedIn changes and sent/reply changes are tightly coupled in the same file
- Set linkedinPending and linkedinFailed KPIs to 0 since LinkedInDailyUsage doesn't track action-level status; these fields are preserved in the interface for backward compatibility
- Reply time-series uses a separate prisma.reply.findMany query merged into the time-series map alongside WebhookEvent sent/opens/bounces
- Per-workspace summaries use prisma.reply.groupBy for reply counts instead of extracting from perWsEmailEvents

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Previous session had partially applied LinkedIn changes (commits f1e34df2, cdcfbc71) but not committed to the dashboard stats file; current execution completed all remaining work in a single commit

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Admin dashboard now uses same canonical sources as portal dashboard
- Ready for Plan 02 (portal analytics reply rate fix) and Plan 03 (bounce threshold alignment)

---
*Phase: 69-data-consistency-canonical-metric-sources*
*Completed: 2026-04-07*
