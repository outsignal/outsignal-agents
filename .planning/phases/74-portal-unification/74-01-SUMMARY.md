---
phase: 74-portal-unification
plan: 01
subsystem: portal
tags: [adapters, refactor, portal, channel-unification]
dependency_graph:
  requires: [72-01, 72-02, 73-01]
  provides: [PORT-01]
  affects: [portal-campaign-detail, portal-leads-api, portal-activity-api]
tech_stack:
  added: []
  patterns: [channel-adapter-pattern, buildRef-helper, unified-types-in-client-components]
key_files:
  created:
    - src/lib/channels/helpers.ts
  modified:
    - src/lib/channels/index.ts
    - src/app/(portal)/portal/campaigns/[id]/page.tsx
    - src/app/api/portal/campaigns/[id]/leads/route.ts
    - src/app/api/portal/campaigns/[id]/activity/route.ts
    - src/components/portal/campaign-detail-tabs.tsx
decisions:
  - "buildRef helper centralises CampaignChannelRef construction — avoids emailBisonCampaignId being forgotten (pitfall 6 from research)"
  - "LinkedIn chart data uses adapter.getActions() with server-side date bucketing — adapters return flat actions, chart aggregation stays in page.tsx"
  - "ebSequenceStepsForApproval remapped from UnifiedStep[] to EB SequenceStep shape for CampaignApprovalContent (which still expects EB format — out of scope for this plan)"
  - "WebhookEvent direct Prisma query retained for email chart data (permitted by plan — chart bucketing is server-side aggregation not adapter concern)"
  - "Reply query retained as direct Prisma query (channel-agnostic, not part of adapter interface)"
  - "Unified leads table replaces channel-branched CampaignLeadsTable/LinkedInLeadsTable components"
metrics:
  duration: 8min
  completed: 2026-04-08
  tasks_completed: 2
  files_modified: 6
---

# Phase 74 Plan 01: Campaign Detail Adapter Refactor Summary

One-liner: Replace dual EmailBisonClient/prisma.linkedInAction code paths in campaign detail page, tabs, leads API, and activity API with channel adapter calls returning UnifiedMetrics[], UnifiedLead[], UnifiedAction[], and UnifiedStep[].

## Tasks Completed

| Task | Commit | Files |
|------|--------|-------|
| 1: buildRef helper + page.tsx + leads/activity API routes | 562fc90b | helpers.ts, index.ts, page.tsx, leads/route.ts, activity/route.ts |
| 2: CampaignDetailTabs unified types | 562fc90b | campaign-detail-tabs.tsx |

Note: Both tasks committed together because TypeScript requires page.tsx (which passes UnifiedStep[] to CampaignDetailTabs) and the tabs component (which accepts UnifiedStep[]) to be in sync — intermediate state would not compile.

## Verification Checks

All pass:
1. `npx tsc --noEmit` — zero errors
2. `grep -c "EmailBisonClient"` — 0 in all 4 target files
3. `grep -c "isLinkedInOnly"` — 0 in all 4 target files
4. `grep -c "prisma.linkedInAction"` — 0 in all 3 target API/page files
5. `initAdapters` and `getAdapter` present in page.tsx, leads/route.ts, activity/route.ts

## Deviations from Plan

### Auto-fixed Issues

None. Plan executed as written.

### Notes

**Task 1 note:** The `ebSequenceStepsForApproval` mapping in page.tsx reshapes `UnifiedStep[]` to the EB `SequenceStep` shape expected by `CampaignApprovalContent`. This is a compatibility shim — `CampaignApprovalContent` is out of scope for this plan and still expects the EmailBison type. Added `campaign_id` field to satisfy the TypeScript constraint.

**Task 1 note:** LinkedIn chart data now uses `getAdapter("linkedin").getActions(ref)` rather than a direct `prisma.linkedInAction.findMany()` call. The `performedAt` timestamp on `UnifiedAction` is used for date bucketing. This eliminates the last direct `prisma.linkedInAction` reference from the page.

**Task 2 note:** The `CampaignLeadsTable` component (which fetches leads directly from EmailBison via the old leads API) is no longer used in `CampaignDetailTabs`. Replaced by a new `UnifiedLeadsTable` component that fetches from the adapter-backed `/api/portal/campaigns/[id]/leads` endpoint. The old `CampaignLeadsTable` file still exists but is no longer imported — cleanup is deferred.

## Self-Check: PASSED

- `src/lib/channels/helpers.ts` — exists (created)
- `src/lib/channels/index.ts` — modified (buildRef re-export added)
- `src/app/(portal)/portal/campaigns/[id]/page.tsx` — modified (adapter imports, no EmailBisonClient)
- `src/app/api/portal/campaigns/[id]/leads/route.ts` — modified (adapter.getLeads)
- `src/app/api/portal/campaigns/[id]/activity/route.ts` — modified (adapter.getActions)
- `src/components/portal/campaign-detail-tabs.tsx` — modified (UnifiedMetrics[], UnifiedStep[] props)
- Commit `562fc90b` — exists in git log
