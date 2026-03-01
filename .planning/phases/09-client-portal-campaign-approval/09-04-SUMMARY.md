---
phase: 09-client-portal-campaign-approval
plan: "04"
subsystem: ui
tags: [next.js, react, portal, campaign, approval, spintax, merge-tokens]

# Dependency graph
requires:
  - phase: 09-01
    provides: content-preview utilities (resolveSpintax, substituteTokens), getCampaignLeadSample, approveCampaignLeads, rejectCampaignLeads, approveCampaignContent, rejectCampaignContent
  - phase: 09-02
    provides: /api/portal/campaigns/[id]/approve-leads, request-changes-leads, approve-content, request-changes-content API routes
  - phase: 09-03
    provides: /portal/campaigns list page (back-link target), CampaignCard component pattern
provides:
  - /portal/campaigns/[id] server component detail page with getPortalSession guard
  - CampaignApprovalLeads client component (lead table + independent approval UX)
  - CampaignApprovalContent client component (email accordion + LinkedIn cards + independent approval UX)
  - Spintax-resolved, merge-token-highlighted content preview with brand color (#F0FF7A/30%)
affects: [09-05, portal-ui, campaign-approval-flow]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Server component page fetches data, passes serializable props to client components
    - router.refresh() for optimistic-free state sync after approval/rejection actions
    - PreviewText component: resolveSpintax -> regex token scan -> React.ReactNode[] with <mark> highlights
    - canAct guard (isPending && !approved) controls approval button visibility independently per section

key-files:
  created:
    - src/app/(portal)/portal/campaigns/[id]/page.tsx
    - src/components/portal/campaign-approval-leads.tsx
    - src/components/portal/campaign-approval-content.tsx
  modified: []

key-decisions:
  - "PreviewText renders token highlights inline using regex scan on afterSpintax string (not substituteTokens result) — enables granular JSX mark wrapping with title attribute showing original token name"
  - "T1+T2+T3 committed together — page.tsx imports both client components so they must coexist; single atomic commit avoids broken build state"
  - "accordion openStep useState(-1 = all closed) — clicking active step closes it; first step opens by default (index 0)"

patterns-established:
  - "Portal detail pages: server component guards -> fetch data -> pass to client children -> client calls API -> router.refresh() to re-render"
  - "Independent approval sections: each section has its own canAct guard, feedback state, and API endpoint"

requirements-completed:
  - PORTAL-01
  - PORTAL-02
  - PORTAL-03
  - PORTAL-04
  - PORTAL-05
  - PORTAL-06
  - PORTAL-07

# Metrics
duration: 2min
completed: 2026-03-01
---

# Phase 09 Plan 04: Portal Campaign Detail Page Summary

**Campaign detail page at /portal/campaigns/[id] with independent lead preview + content approval sections, spintax-resolved email accordion, and brand-color merge-token highlighting**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-01T16:13:53Z
- **Completed:** 2026-03-01T16:15:49Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- Server component detail page with getPortalSession guard and notFound() on missing/wrong-workspace campaign
- CampaignApprovalLeads: top-50 lead table ordered by ICP score (color-coded green/amber/gray), approve/request-changes with feedback textarea, amber banner for previous rejection feedback
- CampaignApprovalContent: email steps as vertical accordion (first expanded by default), LinkedIn messages as flat cards, PreviewText component resolves spintax and highlights merge tokens with #F0FF7A/30% background

## Task Commits

Each task was committed atomically:

1. **Tasks T1+T2+T3: Campaign detail page + approval components** - `148a6da` (feat)

**Plan metadata:** (committed with SUMMARY below)

## Files Created/Modified
- `src/app/(portal)/portal/campaigns/[id]/page.tsx` - Server component: session guard, campaign fetch, 404 if not found/wrong workspace, renders CampaignApprovalLeads + CampaignApprovalContent
- `src/components/portal/campaign-approval-leads.tsx` - Client component: lead table with ICP score coloring, approve leads / request changes UX with feedback textarea
- `src/components/portal/campaign-approval-content.tsx` - Client component: email step accordion, LinkedIn message cards, PreviewText with spintax + token highlighting

## Decisions Made
- Tasks T1+T2+T3 committed together since page.tsx imports both client components — committing page alone would break the build
- PreviewText highlights tokens by re-scanning the post-spintax string with regex, wrapping each known token's replacement in `<mark>` with the token name as title attribute
- accordion openStep uses index 0 as default (first step expanded); clicking open step sets to -1 to close

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Campaign detail page complete with full approval UX
- Portal approval flow (leads + content) is end-to-end functional
- 09-05 (deploy trigger / final status flow) can proceed
- TypeScript clean (npx tsc --noEmit passes)

---
*Phase: 09-client-portal-campaign-approval*
*Completed: 2026-03-01*
