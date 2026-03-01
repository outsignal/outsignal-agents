---
phase: 09-client-portal-campaign-approval
plan: "02"
subsystem: api
tags: [next.js, portal, campaign, approval, session-auth]

# Dependency graph
requires:
  - phase: 09-client-portal-campaign-approval/09-01
    provides: approveCampaignLeads, rejectCampaignLeads, approveCampaignContent, rejectCampaignContent, getCampaignLeadSample from campaigns/operations.ts
  - phase: 09-client-portal-campaign-approval/portal-auth
    provides: getPortalSession() from portal-session.ts
provides:
  - GET /api/portal/campaigns — lists all campaigns for the session workspace
  - GET /api/portal/campaigns/[id] — campaign detail + lead sample in one call
  - POST /api/portal/campaigns/[id]/approve-leads
  - POST /api/portal/campaigns/[id]/request-changes-leads
  - POST /api/portal/campaigns/[id]/approve-content
  - POST /api/portal/campaigns/[id]/request-changes-content
affects:
  - 09-03-PLAN (portal campaign list page — calls GET /api/portal/campaigns)
  - 09-04-PLAN (portal campaign detail page — calls GET /api/portal/campaigns/[id] and action routes)
  - 09-05-PLAN (notification wiring — hooks into approve/reject routes)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Portal route pattern: getPortalSession() first, 401 on failure; workspaceSlug check, 403 on mismatch
    - Combined detail+sample: GET [id] route returns campaign + leadSample in one response to avoid round-trips
    - Rejection validation: feedback field required and non-empty, returns 400 if absent

key-files:
  created:
    - src/app/api/portal/campaigns/route.ts
    - src/app/api/portal/campaigns/[id]/route.ts
    - src/app/api/portal/campaigns/[id]/approve-leads/route.ts
    - src/app/api/portal/campaigns/[id]/request-changes-leads/route.ts
    - src/app/api/portal/campaigns/[id]/approve-content/route.ts
    - src/app/api/portal/campaigns/[id]/request-changes-content/route.ts
  modified: []

key-decisions:
  - "Detail route combines campaign + leadSample in one response (no second round-trip from frontend)"
  - "Rejection routes return 400 if feedback field is missing or empty — enforces meaningful feedback"
  - "Lead and content approval routes are fully independent — approving one never touches the other"
  - "Notification wiring deferred to Plan 09-05 — routes just return updated campaign now"

patterns-established:
  - "Portal auth pattern: try { session = await getPortalSession() } catch { return 401 }"
  - "Workspace ownership check: campaign.workspaceSlug !== session.workspaceSlug -> 403"
  - "Next.js 16 params: { params }: { params: Promise<{ id: string }> }, const { id } = await params"

requirements-completed:
  - PORTAL-03
  - PORTAL-05
  - PORTAL-06
  - PORTAL-07

# Metrics
duration: 2min
completed: "2026-03-01"
---

# Phase 9 Plan 02: Portal Campaign API Routes Summary

**Six portal campaign routes with session auth, workspace ownership checks, and independent lead/content approval actions**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-01T16:08:46Z
- **Completed:** 2026-03-01T16:10:52Z
- **Tasks:** 2
- **Files modified:** 6 created

## Accomplishments

- All 6 portal campaign routes created under `/api/portal/campaigns/` (covered by middleware `PUBLIC_API_PREFIXES`)
- Every route enforces session auth via `getPortalSession()` (401 on no session) and workspace ownership (403 on mismatch)
- Detail route returns campaign + lead sample in one response to avoid frontend round-trips
- Rejection routes enforce non-empty feedback field (400 if missing/empty)
- TypeScript compiles cleanly with no errors

## Task Commits

Each task was committed atomically:

1. **Task T1: Create campaign list and detail API routes** - `c3e04d1` (feat)
2. **Task T2: Create four approval/rejection action routes** - `bcde472` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `src/app/api/portal/campaigns/route.ts` - GET list of campaigns for session workspace
- `src/app/api/portal/campaigns/[id]/route.ts` - GET campaign detail + lead sample
- `src/app/api/portal/campaigns/[id]/approve-leads/route.ts` - POST approve lead list
- `src/app/api/portal/campaigns/[id]/request-changes-leads/route.ts` - POST reject leads with feedback
- `src/app/api/portal/campaigns/[id]/approve-content/route.ts` - POST approve content sequences
- `src/app/api/portal/campaigns/[id]/request-changes-content/route.ts` - POST reject content with feedback

## Decisions Made

- Combined detail + lead sample in one GET response — avoids a second API call from the campaign detail page
- Rejection routes validate feedback is non-empty before calling the operation — meaningful feedback required
- Notification wiring is intentionally absent — Plan 09-05 will hook notifications into these routes after both routes and notification function exist

## Deviations from Plan

None - plan executed exactly as written. The approval functions in operations.ts (approveCampaignLeads, rejectCampaignLeads, approveCampaignContent, rejectCampaignContent, getCampaignLeadSample) were already present from a prior 09-01 execution, so no Rule 3 fix was needed.

## Issues Encountered

None - all route files created cleanly, TypeScript compiled with zero errors.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All 6 campaign API routes are live and ready for Plan 09-03 (campaign list UI) and Plan 09-04 (campaign detail UI)
- Plan 09-05 can wire notification calls into these routes (they currently return the updated campaign only)
- Routes are covered by middleware `PUBLIC_API_PREFIXES` entry `/api/portal/` — no middleware changes needed

---
*Phase: 09-client-portal-campaign-approval*
*Completed: 2026-03-01*
