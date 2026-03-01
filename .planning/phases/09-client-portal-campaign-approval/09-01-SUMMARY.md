---
phase: 09-client-portal-campaign-approval
plan: "01"
subsystem: database
tags: [prisma, postgresql, campaigns, approval, spintax, merge-tokens]

# Dependency graph
requires:
  - phase: 08-campaign-entity-writer
    provides: Campaign model with approval fields (leadsApproved, contentApproved, etc.) and operations.ts foundation
provides:
  - Workspace.approvalsSlackChannelId and approvalsSlackChannelName fields in DB
  - approveCampaignLeads / rejectCampaignLeads functions in operations.ts
  - approveCampaignContent / rejectCampaignContent functions in operations.ts
  - getCampaignLeadSample with ICP-score ordering and workspace-scoped scoring
  - content-preview.ts with resolveSpintax, substituteTokens, renderContentPreview
affects: [09-02-portal-api-routes, 09-03-portal-ui, 09-04-portal-campaign-detail, 09-05-slack-approval-notifications]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dual approval auto-transition: when both leadsApproved AND contentApproved become true in pending_approval, status auto-advances to approved"
    - "Feedback cleared on approval (set to null) — approval replaces a rejection"
    - "ICP score always filtered by workspaceSlug via PersonWorkspace.workspace to prevent cross-workspace leakage"
    - "Spintax pipeline: resolveSpintax first (picks first variant), then substituteTokens — order is mandatory"

key-files:
  created:
    - src/lib/content-preview.ts
  modified:
    - prisma/schema.prisma
    - src/lib/campaigns/operations.ts

key-decisions:
  - "Used prisma db push instead of prisma migrate dev — project has no migrations directory, uses push-based schema workflow"
  - "getCampaignLeadSample fetches all members then sorts/slices in JS (not SQL LIMIT) — avoids complex ICP score join ordering in Prisma; acceptable for target list sizes"
  - "substituteTokens returns tokensFound list alongside result — enables UI highlighting of resolved tokens in portal"

patterns-established:
  - "Approval mutations check current state first (findUnique) then update — allows conditional status transitions without separate update call"
  - "All approval functions reuse existing targetListInclude and formatCampaignDetail helpers for consistent return shape"

requirements-completed: [PORTAL-02, PORTAL-03, PORTAL-04, PORTAL-05, PORTAL-06]

# Metrics
duration: 2min
completed: 2026-03-01
---

# Phase 9 Plan 01: Schema Migration + Approval Operations + Content Preview Utilities Summary

**Prisma Workspace schema extended with approvals Slack fields, five approval/lead-sample functions added to campaigns/operations.ts, and content-preview.ts created with spintax + merge-token pipeline**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-01T16:08:04Z
- **Completed:** 2026-03-01T16:10:14Z
- **Tasks:** 3
- **Files modified:** 3 (schema, operations.ts, content-preview.ts new)

## Accomplishments
- Workspace model extended with `approvalsSlackChannelId` and `approvalsSlackChannelName` fields (applied via `prisma db push`, Prisma client regenerated)
- Five new exported functions in `campaigns/operations.ts`: `approveCampaignLeads`, `rejectCampaignLeads`, `approveCampaignContent`, `rejectCampaignContent`, `getCampaignLeadSample`
- Dual approval auto-transition logic: when both leads and content approved while in `pending_approval`, status advances to `approved` automatically
- New `src/lib/content-preview.ts` module with `resolveSpintax`, `substituteTokens` (returns tokensFound for UI), and `renderContentPreview` pipeline function

## Task Commits

Each task was committed atomically:

1. **Task 1: Add approvalsSlackChannelId to Workspace schema** - `b23acf4` (feat)
2. **Task 2: Add approval operations and lead sample query** - `8270967` (feat)
3. **Task 3: Create content-preview.ts** - `413186b` (feat)

## Files Created/Modified
- `prisma/schema.prisma` - Added `approvalsSlackChannelId String?` and `approvalsSlackChannelName String?` to Workspace model
- `src/lib/campaigns/operations.ts` - Added 5 new exported functions and `LeadSample` interface
- `src/lib/content-preview.ts` - New module: spintax resolution + merge token substitution + preview pipeline

## Decisions Made
- Used `prisma db push` instead of `prisma migrate dev` — project has no migrations directory (uses push-based workflow). `migrate dev` would have prompted to reset the DB due to drift between migration history and actual schema.
- `getCampaignLeadSample` fetches all members then sorts/slices in JavaScript rather than using SQL LIMIT — Prisma doesn't support ordering by a related model's field in a single query, and target list sizes are manageable in-memory.
- `substituteTokens` returns `tokensFound` alongside the rendered result to support future UI token highlighting on the portal campaign detail page.

## Deviations from Plan

None — plan executed exactly as written. The only adaptation was using `prisma db push` instead of `prisma migrate dev` (which the plan mentioned as one option; the project's schema-push workflow made this the correct choice).

## Issues Encountered

`prisma migrate dev` detected schema drift (DB has tables from push-based history, no migration files exist) and prompted to reset the database. Switched to `prisma db push` which synced the new fields without touching existing data.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness
- All five approval operation functions ready for use by Phase 9 portal API routes (09-02)
- `content-preview.ts` ready for portal campaign detail page (09-03/09-04)
- Workspace `approvalsSlackChannelId` field ready for Slack approval notification routing (09-05)
- TypeScript compiles cleanly with zero errors

---
*Phase: 09-client-portal-campaign-approval*
*Completed: 2026-03-01*
