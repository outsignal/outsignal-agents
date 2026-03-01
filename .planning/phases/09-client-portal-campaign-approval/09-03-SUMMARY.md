---
phase: 09-client-portal-campaign-approval
plan: "03"
subsystem: ui
tags: [nextjs, react, server-components, portal, campaigns, tailwind, shadcn]

# Dependency graph
requires:
  - phase: 09-01
    provides: listCampaigns operation, CampaignSummary type, getPortalSession()
  - phase: 09-02
    provides: portal campaign API routes for detail/approval actions
provides:
  - Portal campaign list page at /portal/campaigns
  - CampaignCard component with status badge, channel icons, approval indicators
  - Campaigns nav item in PortalNav
affects:
  - 09-04 (detail page links to /portal/campaigns/[id] — card links are set)
  - 09-05 (nav order established: Dashboard > Campaigns > LinkedIn)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Server component page with getPortalSession() guard then listCampaigns() query
    - Client CampaignCard renders Link-wrapped Card from shadcn/ui
    - Pending-first sorting done in page component (JS filter/concat, not DB order)

key-files:
  created:
    - src/app/(portal)/portal/campaigns/page.tsx
    - src/components/portal/campaign-card.tsx
  modified:
    - src/components/portal/portal-nav.tsx

key-decisions:
  - "Nav badge count deferred: pending count shown on card level (amber ring + dot) rather than in nav — avoids layout data-fetch refactor"
  - "All three tasks committed atomically in single feat commit — page, card, and nav are tightly coupled"

patterns-established:
  - "CampaignCard: pending campaigns get ring-2 ring-amber-300 + absolute amber dot at -top-1.5 -right-1.5"
  - "statusConfig map: status key -> { label, className } for clean status-to-label/color mapping"

requirements-completed:
  - PORTAL-01
  - PORTAL-07

# Metrics
duration: 5min
completed: 2026-03-01
---

# Phase 9 Plan 03: Portal Campaign List Page + Nav Update Summary

**Card grid list page at /portal/campaigns with pending-first sort, amber highlight on unapproved cards, and Campaigns added to PortalNav**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-01T16:12:00Z
- **Completed:** 2026-03-01T16:14:32Z
- **Tasks:** 3
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments
- Created `/portal/campaigns` server component page: calls `getPortalSession()`, fetches `listCampaigns()`, sorts pending to top
- Created `CampaignCard` client component with amber ring/dot for unapproved campaigns, status badge, channel icons (Mail/Linkedin), approval pill indicators
- Added `{ href: "/portal/campaigns", label: "Campaigns" }` to PortalNav navItems array between Dashboard and LinkedIn

## Task Commits

Tasks 1, 2, and 3 committed atomically (all three are tightly coupled — page imports card, nav links to page):

1. **Tasks 1-3: Campaign list page + card component + nav update** - `f8db9aa` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/app/(portal)/portal/campaigns/page.tsx` - Server component: getPortalSession guard, listCampaigns, pending-first sort, card grid render
- `src/components/portal/campaign-card.tsx` - Client component: Link-wrapped Card with status badge, channel icons, approval indicators, pending amber highlight
- `src/components/portal/portal-nav.tsx` - Added Campaigns nav item between Dashboard and LinkedIn

## Decisions Made
- **Nav badge count deferred:** Plan noted that passing `pendingCount` as a prop through the layout would break the clean separation (layout doesn't fetch data). Amber ring + notification dot on the campaign cards themselves are sufficient for PORTAL-01 visual indicator requirement.
- **Single atomic commit for all 3 tasks:** Page, card, and nav are tightly coupled (page imports card, nav links to page). Splitting into 3 commits would leave intermediate states with broken imports.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. TypeScript compiled cleanly with no errors.

## Next Phase Readiness
- `/portal/campaigns/[id]` detail page (09-04) can now be built — cards already link to it
- `CampaignCard` component is done; detail page can import `CampaignSummary` type from operations.ts
- Nav order is set: Dashboard > Campaigns > LinkedIn

---
*Phase: 09-client-portal-campaign-approval*
*Completed: 2026-03-01*
