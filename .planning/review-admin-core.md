# Admin Core Pages - Functional Review

**Date**: 2026-03-14
**Scope**: /campaigns, /replies, /inbox, /people, /companies, /analytics
**Method**: Component -> API -> DB trace for each page

## Summary

6 page groups reviewed. Found **3 bugs** (1 data-flow break, 2 missing auth), **4 functional gaps**, and **3 minor issues**. No TODO/placeholder sections found.

## Bugs (3)

**1. HIGH -- Reply override response shape mismatch**
- `src/components/replies/reply-side-panel.tsx` line 47 expects `{ reply: Reply }` from `PATCH /api/replies/${reply.id}`
- `src/app/api/replies/[id]/route.ts` line 122-126 returns the reply object at root level (flat, no `reply` wrapper)
- Impact: Override saves to DB but UI doesn't update until page refresh. `onOverrideSuccess(updated.reply)` receives `undefined`.

**2. MEDIUM -- `/api/replies/stats` missing auth**
- `src/app/api/replies/stats/route.ts` has no `requireAdminAuth()`. Publicly accessible. Contains reply classification distributions and workspace counts.

**3. LOW -- `/api/replies/campaigns` missing auth**
- `src/app/api/replies/campaigns/route.ts` has no `requireAdminAuth()`. Returns distinct campaign IDs/names.

## Functional Gaps (4)

**1. /replies -- Hardcoded stale workspace list**
- `src/app/(admin)/replies/page.tsx` lines 83-91: `WORKSPACES` array hardcodes 7 slugs including deleted `"lab522"`, missing active `"blanktag"` and `"covenco"`.
- Fix: Fetch dynamically from `/api/workspaces` like the inbox page does.

**2. /inbox -- Mark All Read not implemented**
- `src/app/(admin)/inbox/page.tsx` lines 175-186: `handleMarkAllRead` only refreshes threads. Comment says "Admin can't use portal session". Button label says "Refresh" (accurate), but no actual mark-as-read functionality exists for admin inbox.

**3. /companies -- No detail page**
- No `/companies/[id]/page.tsx` exists. Company names in the list are plain text, not links. Users cannot drill down to see associated people, enrichment history, or company-level data. Compare: `/people/[id]` has a full 5-tab detail view.

**4. /analytics -- Copy tab ignores period filter**
- `src/components/analytics/copy-tab.tsx` receives `period` as prop but `buildParams()` (line 142-150) never includes it in API calls. Only `workspace` and `vertical` are sent. Subject lines, correlations, and templates always return all-time data regardless of selected period.

## Minor Issues (3)

1. `/campaigns` list page has no pagination -- loads all campaigns in one Prisma query. Fine at current scale but won't scale.
2. `/people/[id]` detail page doesn't display `contactPhone` field (added per session handover) in PersonHeader or tabs. May appear in enrichment JSON tab if present.
3. `/inbox` function named `handleMarkAllRead` is misleading -- it only refreshes. Rename to `handleRefresh` for clarity.

## Clean Pages (no issues)

- **/campaigns** (list + detail): Proper state machine, deploy flow, signal campaign support, deploy history with retry
- **/people** (list + detail): Full search/filter, bulk selection, 5-tab detail (timeline, email, LinkedIn, enrichment, workspaces)
- **/analytics Performance tab**: Strategy comparison + campaign rankings from CachedMetrics
- **/analytics Benchmarks tab**: Reference bands, ICP calibration, signal effectiveness -- all with proper loading/error states
- **/analytics Insights tab**: Workspace-gated, manual refresh, objection patterns, dismissed section
