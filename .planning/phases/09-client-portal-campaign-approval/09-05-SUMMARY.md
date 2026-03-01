---
phase: 09-client-portal-campaign-approval
plan: "05"
subsystem: api
tags: [notifications, slack, email, portal, campaigns, typescript]

# Dependency graph
requires:
  - phase: 09-01
    provides: Campaign operations (approveCampaignLeads, approveCampaignContent, rejectCampaignLeads, rejectCampaignContent), workspace.approvalsSlackChannelId field
  - phase: 09-02
    provides: Four portal action API routes (approve-leads, request-changes-leads, approve-content, request-changes-content)
provides:
  - notifyApproval() function in notifications.ts for structured approval/rejection Slack + email alerts
  - Dual-approval detection triggering distinct "both_approved" notification on status === 'approved'
  - Non-blocking notification wired into all four portal action routes
affects:
  - Phase 10 (deploy trigger) — both_approved notification signals auto-deploy triggered

# Tech tracking
tech-stack:
  added: []
  patterns:
    - notifyApproval follows same postMessage + sendNotificationEmail pattern as notifyReply
    - Non-blocking fire-and-forget via .catch() keeps API routes responsive
    - Dual-approval detection reads updated.status === 'approved' from operations return value

key-files:
  created: []
  modified:
    - src/lib/notifications.ts
    - src/app/api/portal/campaigns/[id]/approve-leads/route.ts
    - src/app/api/portal/campaigns/[id]/request-changes-leads/route.ts
    - src/app/api/portal/campaigns/[id]/approve-content/route.ts
    - src/app/api/portal/campaigns/[id]/request-changes-content/route.ts

key-decisions:
  - "approvalsSlackChannelId used via direct property access — Prisma client regenerated in 09-01 has field typed correctly, no cast needed"
  - "T1+T2 committed together — wiring the function into routes requires it to exist; single atomic commit avoids broken intermediate state"
  - "Dual approval fires both_approved instead of individual action — reads updated.status from operations return value, not a second DB query"

patterns-established:
  - "Approval notification pattern: header block + campaign name section + status section + optional feedback section + optional fully-approved section + actions block"
  - "Non-blocking notification: fire-and-forget with .catch() so route responds immediately regardless of notification success"

requirements-completed: [NOTIF-01, NOTIF-02, PORTAL-06]

# Metrics
duration: 8min
completed: 2026-03-01
---

# Phase 09 Plan 05: Approval Notifications (Slack + Email) + API Route Wiring Summary

**notifyApproval() with structured Slack blocks and email HTML wired non-blocking into four portal approval/rejection routes, with dual-approval detection firing a distinct "Campaign Fully Approved" notification**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-03-01T16:18:26Z
- **Completed:** 2026-03-01T16:26:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Created `notifyApproval()` in `notifications.ts` supporting five action types: leads_approved, leads_rejected, content_approved, content_rejected, both_approved
- Slack notifications use structured block kit layout (header, campaign name, status, optional feedback, optional fully-approved banner, View Campaign button)
- Email notifications include full feedback text in styled amber block for rejections, green banner for dual approval
- Wired into all four portal action routes as non-blocking `.catch()` calls
- Dual-approval detection: reads `updated.status === 'approved'` from operations function return value — no extra DB query needed

## Task Commits

Each task was committed atomically:

1. **Tasks 1+2: notifyApproval() + wiring into 4 routes** - `6395e9e` (feat) — T1 and T2 committed together; function must exist before wiring can type-check

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/lib/notifications.ts` - Added notifyApproval() below notifyReply(); uses approvalsSlackChannelId with slackChannelId fallback
- `src/app/api/portal/campaigns/[id]/approve-leads/route.ts` - Added import + non-blocking notifyApproval() with both_approved dual detection
- `src/app/api/portal/campaigns/[id]/request-changes-leads/route.ts` - Added import + non-blocking notifyApproval() with leads_rejected action
- `src/app/api/portal/campaigns/[id]/approve-content/route.ts` - Added import + non-blocking notifyApproval() with both_approved dual detection
- `src/app/api/portal/campaigns/[id]/request-changes-content/route.ts` - Added import + non-blocking notifyApproval() with content_rejected action

## Decisions Made
- Used direct property access `workspace.approvalsSlackChannelId` rather than the safe cast pattern in the plan — Prisma client was already regenerated in 09-01 with the field properly typed
- Committed T1+T2 together — function and wiring are tightly coupled; a broken intermediate commit would prevent TypeScript from checking the route files

## Deviations from Plan

None - plan executed exactly as written. The safe-cast pattern for `approvalsSlackChannelId` was simplified to direct property access since the Prisma client had the field generated, as the plan anticipated.

## Issues Encountered
None — TypeScript compiled clean on first attempt.

## User Setup Required
None - no external service configuration required. Existing Slack and email infrastructure is reused.

## Next Phase Readiness
- Phase 9 complete — all 5 plans done
- Portal approval flow fully wired: session auth, campaign ownership check, lead/content approval operations, status auto-transition, and notifications
- Phase 10 (deploy trigger) can rely on the `both_approved` notification as the signal that auto-deploy has been initiated

---
*Phase: 09-client-portal-campaign-approval*
*Completed: 2026-03-01*
