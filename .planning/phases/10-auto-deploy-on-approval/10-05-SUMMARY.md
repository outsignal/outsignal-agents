---
phase: 10-auto-deploy-on-approval
plan: "05"
subsystem: ui
tags: [react, next.js, campaigns, deploy, tailwind, client-components]

# Dependency graph
requires:
  - phase: 10-auto-deploy-on-approval
    provides: POST /api/campaigns/[id]/deploy and GET /api/campaigns/[id]/deploys (Plan 03)
  - phase: 08-campaign-agent
    provides: getCampaign, CampaignDetail type from campaigns/operations.ts

provides:
  - DeployButton client component with confirmation modal at (admin)/campaigns/[id]/DeployButton.tsx
  - DeployHistory client component with retry support at (admin)/campaigns/[id]/DeployHistory.tsx
  - Admin campaign detail page at (admin)/campaigns/[id]/page.tsx

affects: [admin-nav-campaign-links, future-campaign-list-page]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Server component page fetches getCampaign() directly, passes data to client components as props
    - DeployButton returns null when not in approved state — conditional rendering at component level
    - DeployHistory fetches on mount via useEffect, exposes fetchHistory for retry callback
    - Retry button calls onSuccess callback after POST to refresh table without full page reload

key-files:
  created:
    - src/app/(admin)/campaigns/[id]/DeployButton.tsx
    - src/app/(admin)/campaigns/[id]/DeployHistory.tsx
    - src/app/(admin)/campaigns/[id]/page.tsx

key-decisions:
  - "DeployButton returns null when conditions not met — no placeholder rendered, header stays clean"
  - "Campaign detail page is a server component — getCampaign() called at server, avoids client-side fetch waterfall"
  - "emailStepCount/linkedinStepCount computed from parsed sequence arrays in page.tsx — single source of truth"
  - "DeployHistory fetches independently on mount — allows page to load without blocking on deploy history"
  - "Retry buttons use onSuccess callback to re-fetch table — avoids full router.refresh() on retry"

patterns-established:
  - "Client component with server parent: server page fetches data, client child handles interactions"
  - "RetryButton onSuccess pattern: POST action -> callback to refresh parent list state"

requirements-completed: [DEPLOY-02, DEPLOY-06, DEPLOY-07]

# Metrics
duration: 3min
completed: 2026-03-03
---

# Phase 10 Plan 05: Campaign Deploy UI Summary

**DeployButton (conditional, confirmation modal) and DeployHistory (status badges, retry) embedded in new admin campaign detail page at /campaigns/[id]**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-03T12:18:08Z
- **Completed:** 2026-03-03T12:21:00Z
- **Tasks:** 2
- **Files created:** 3

## Accomplishments
- `DeployButton` renders only when `status === "approved" && leadsApproved && contentApproved` — returns null otherwise
- Confirmation modal shows campaign name, lead count, channels, conditional email/LinkedIn step counts, warning text
- POSTs to `/api/campaigns/[id]/deploy`, shows loading spinner, success/error feedback, auto-refreshes via `router.refresh()`
- Brand yellow `#F0FF7A` styling with Rocket icon (lucide-react), dark zinc-900 modal overlay
- `DeployHistory` fetches on mount, displays table with color-coded status badges, channel badges, truncated error with full tooltip
- Retry buttons (`Retry Email` / `Retry LinkedIn`) appear only for `partial_failure`/`failed` deploys on their respective failed channel
- Campaign detail page at `(admin)/campaigns/[id]/page.tsx` — server component, fetches campaign via `getCampaign()`, computes step counts from parsed sequences, renders approval status grid, sequence summary, and deploy history section

## Task Commits

Each task was committed atomically:

1. **Task 1: Create DeployButton with confirmation modal** - `83a60bc` (feat)
2. **Task 2: Create DeployHistory table and integrate into campaign detail page** - `9d272a1` (feat)

## Files Created/Modified
- `src/app/(admin)/campaigns/[id]/DeployButton.tsx` - Client component: conditional deploy button + confirmation modal (187 lines)
- `src/app/(admin)/campaigns/[id]/DeployHistory.tsx` - Client component: deploy history table + retry buttons (246 lines)
- `src/app/(admin)/campaigns/[id]/page.tsx` - Server page: campaign overview, approvals, sequence summary, deploy history (184 lines)

## Decisions Made
- DeployButton returns null when conditions not met — no placeholder rendered, header area stays clean
- Campaign detail page is a server component — getCampaign() called at server, avoids client-side fetch waterfall for initial data
- emailStepCount/linkedinStepCount computed from parsed sequence arrays in page.tsx — consistent with how deploy.ts calculates them
- DeployHistory fetches independently on mount — allows the page to render immediately without blocking on deploy history
- Retry buttons use onSuccess callback to re-fetch table state — avoids full router.refresh() on retry

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 10 all 5 plans complete: deploy lib, sequencing engine, API routes, notifications, and deploy UI
- The full auto-deploy pipeline is operational end-to-end: portal approval -> status=approved -> admin sees Deploy button -> confirmation modal -> fire-and-forget deploy -> deploy history visible on campaign detail page
- Phase 12 (Dashboard & Admin UX) may want to add campaign list page linking to /campaigns/[id]

---
*Phase: 10-auto-deploy-on-approval*
*Completed: 2026-03-03*
