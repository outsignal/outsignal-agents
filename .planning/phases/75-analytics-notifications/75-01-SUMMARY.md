---
phase: 75-analytics-notifications
plan: 01
subsystem: analytics
tags: [channel-adapters, cached-metrics, snapshot, linkedin, email, prisma]

# Dependency graph
requires:
  - phase: 72-channel-adapters
    provides: "EmailAdapter and LinkedInAdapter with getMetrics() contract"
  - phase: 74-portal-unification
    provides: "getEnabledChannels(), buildRef(), adapter-based channel resolution pattern"
provides:
  - "Per-channel CachedMetrics rows (email:{campaignId}, linkedin:{campaignId}) via adapter.getMetrics()"
  - "LinkedIn metrics now stored in CachedMetrics for the first time"
  - "Backwards-compatible combined snapshot row preserved (metricKey = campaignId)"
affects:
  - 75-analytics-notifications (plans 02, 03 read per-channel CachedMetrics)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "initAdapters() at module scope (idempotent, safe for re-import)"
    - "Direct prisma.workspace query for package when apiToken absent (LinkedIn-only workspaces)"
    - "Per-channel CachedMetrics rows alongside combined aggregate row"

key-files:
  created: []
  modified:
    - src/lib/analytics/snapshot.ts

key-decisions:
  - "Query workspace.package directly via Prisma instead of relying on getWorkspaceBySlug() — that function returns undefined when apiToken is absent, breaking LinkedIn-only workspaces"
  - "Use campaign.id (not campaign.name) as metricKey base to match existing code — plan described campaign.name but actual code uses campaign.id"
  - "Keep existing combined snapshot with direct EB + Prisma LinkedIn queries for backwards compat — adapter calls are additive, not replacement"
  - "ChannelType imported from @/lib/channels/constants not @/lib/channels/types — types.ts re-exports it but does not export the type alias directly"

patterns-established:
  - "Per-channel adapter metrics: iterate campaignChannels, skip channels not in enabledChannels, call adapter.getMetrics(ref), upsert with channel-prefixed key"

requirements-completed:
  - ANAL-01

# Metrics
duration: 2min
completed: 2026-04-08
---

# Phase 75 Plan 01: Channel-Adapter Metrics Snapshot Summary

**snapshotWorkspaceCampaigns now writes per-channel CachedMetrics rows via adapter.getMetrics(), enabling LinkedIn metrics in CachedMetrics for the first time alongside the existing combined aggregate row**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-08T20:04:08Z
- **Completed:** 2026-04-08T20:06:20Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Per-channel CachedMetrics rows written with keys `email:{campaignId}` and `linkedin:{campaignId}` via adapter pattern
- LinkedIn-only workspaces now produce LinkedIn metrics without any EB API call
- Combined backwards-compatible snapshot row (metricKey = campaignId) preserved for existing consumers
- trigger/snapshot-metrics.ts unchanged — still calls snapshotWorkspaceCampaigns(slug) with same return shape

## Task Commits

1. **Task 1: Refactor snapshotWorkspaceCampaigns to use channel adapters** - `ae458d83` (feat)

**Plan metadata:** TBD (docs commit)

## Files Created/Modified
- `src/lib/analytics/snapshot.ts` - Added adapter-based per-channel metrics collection alongside existing combined snapshot

## Decisions Made
- Queried `workspace.package` directly via Prisma instead of using `getWorkspaceBySlug()`. That helper returns `undefined` when `apiToken` is null (LinkedIn-only workspaces have no EB token), which would produce empty `enabledChannels` and skip LinkedIn metrics collection entirely.
- Used `campaign.id` (not `campaign.name`) as the metricKey base. The plan's interface examples described `campaign.name` but the existing code uses `campaign.id` — following the actual code avoids breaking existing CachedMetrics reads.
- Kept the existing combined snapshot (direct EB + Prisma LinkedIn queries) unchanged rather than deriving it from adapter results. This avoids double-counting risk and preserves the rich `CampaignSnapshot` shape that existing dashboard pages depend on.
- Imported `ChannelType` from `@/lib/channels/constants` — it is declared there and re-exported through the barrel, but `@/lib/channels/types` imports it as a type-only import and does not re-export it as a public type, causing a TS2459 error when importing directly from types.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] LinkedIn-only workspace package resolution**
- **Found during:** Task 1 (implementing adapter-based per-channel metrics)
- **Issue:** `getWorkspaceBySlug()` returns `undefined` when `apiToken` is null. LinkedIn-only workspaces have no EB token, so `wsConfig` would be undefined and `enabledChannels` would be `[]`, preventing LinkedIn metrics from being collected.
- **Fix:** Added a direct `prisma.workspace.findUnique({ select: { package: true } })` call to resolve channels independently of apiToken availability.
- **Files modified:** `src/lib/analytics/snapshot.ts`
- **Verification:** TypeScript compiles cleanly, `getEnabledChannels()` receives the package string regardless of apiToken
- **Committed in:** ae458d83

**2. [Rule 1 - Bug] ChannelType import path**
- **Found during:** Task 1 (TypeScript compilation)
- **Issue:** Import `ChannelType` from `@/lib/channels/types` caused TS2459 (module declares locally, not exported). The type originates in `constants.ts`.
- **Fix:** Changed import to `@/lib/channels/constants`.
- **Files modified:** `src/lib/analytics/snapshot.ts`
- **Verification:** `npx tsc --noEmit` passes with zero errors
- **Committed in:** ae458d83

---

**Total deviations:** 2 auto-fixed (both Rule 1 - Bug)
**Impact on plan:** Both fixes were necessary for correctness. No scope creep.

## Issues Encountered
- Plan described using `campaign.name` as the metricKey but existing code uses `campaign.id` — used `campaign.id` to match the actual codebase pattern, avoiding broken reads in existing consumers.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Per-channel CachedMetrics rows are now written daily — Plans 02 and 03 can read `email:{campaignId}` and `linkedin:{campaignId}` rows to build the comparison view
- Combined snapshot unchanged — existing analytics pages continue to work unmodified

---
*Phase: 75-analytics-notifications*
*Completed: 2026-04-08*
