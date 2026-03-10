---
phase: 29-domain-health-foundation
plan: 02
subsystem: database
tags: [prisma, emailbison, bounce-tracking, warmup, cron]

# Dependency graph
requires:
  - phase: 29-01
    provides: DomainHealth model, domain-health lib directory foundation
provides:
  - BounceSnapshot Prisma model with per-sender daily cumulative metrics
  - captureSnapshots function for per-workspace EmailBison metric polling
  - computeDeltas function for daily delta computation with counter-reset handling
  - computeDomainRollup function for per-domain aggregate rollup
  - captureAllWorkspaces function for full workspace iteration
  - fetchWarmupData / fetchWarmupDetail warmup API client (graceful degradation)
  - /api/cron/bounce-snapshots endpoint for daily scheduled capture
affects:
  - 31-auto-rotation (reads BounceSnapshot for rotation decisions)
  - 32-deliverability-dashboard (reads BounceSnapshot for UI display)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Bounce snapshot upsert pattern: @@unique([senderEmail, snapshotDate]) ensures idempotent daily runs"
    - "Counter reset detection: if current cumulative < previous, null that day's delta"
    - "20-send minimum gate: bounceRate stays null until emailsSent >= 20"
    - "Graceful warmup API degradation: 404/401 returns empty array, never throws"

key-files:
  created:
    - prisma/schema.prisma (BounceSnapshot model added)
    - src/lib/domain-health/snapshots.ts
    - src/lib/domain-health/warmup.ts
    - src/app/api/cron/bounce-snapshots/route.ts
  modified: []

key-decisions:
  - "Cron endpoint path changed to /api/cron/bounce-snapshots — /api/cron/snapshot-metrics already exists for campaign analytics snapshots"
  - "Warmup data fetched via dynamic import within captureSnapshots to avoid circular dependencies"
  - "bounceRate computed as daily delta rate when delta available; falls back to cumulative on first snapshot"
  - "BounceSnapshot.opened stores unique_opened_count (not total_opened_count) from SenderEmail"

patterns-established:
  - "domain-health: all functions log with [domain-health] prefix"
  - "domain-health: per-workspace errors collected and returned, not thrown — caller decides severity"

requirements-completed: [BOUNCE-01, BOUNCE-02, BOUNCE-03, BOUNCE-04]

# Metrics
duration: 4min
completed: 2026-03-10
---

# Phase 29 Plan 02: Bounce Snapshot System Summary

**BounceSnapshot Prisma model with daily per-sender metric capture from EmailBison, delta computation with counter-reset handling, domain rollup, and warmup API integration**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-10T20:45:25Z
- **Completed:** 2026-03-10T20:48:18Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- BounceSnapshot model in database with unique constraint on (senderEmail, snapshotDate) for idempotent daily runs
- captureSnapshots function polls EmailBison sender emails, computes deltas, and upserts snapshots per sender
- computeDeltas handles counter resets gracefully (current < previous = null delta, not negative)
- 20-send minimum gate: bounceRate stays null when emailsSent < 20
- computeDomainRollup aggregates all senders for a domain on a given date with volume-weighted bounce rate
- fetchWarmupData and fetchWarmupDetail gracefully handle API unavailability (return empty, never throw)
- Daily cron endpoint at /api/cron/bounce-snapshots ready for cron-job.org scheduling

## Task Commits

Each task was committed atomically:

1. **Task 1: BounceSnapshot model and snapshot capture logic** - `d099a3a` (feat)
2. **Task 2: Warmup API client and snapshot cron endpoint** - `0c0ff22` (feat)

## Files Created/Modified
- `prisma/schema.prisma` - Added BounceSnapshot model (already committed in 29-01 commit, this plan extended it)
- `src/lib/domain-health/snapshots.ts` - captureSnapshots, computeDeltas, computeDomainRollup, captureAllWorkspaces
- `src/lib/domain-health/warmup.ts` - fetchWarmupData, fetchWarmupDetail for EmailBison dedicated instance
- `src/app/api/cron/bounce-snapshots/route.ts` - Daily cron endpoint (CRON_SECRET protected, maxDuration=60)

## Decisions Made
- Cron endpoint uses `/api/cron/bounce-snapshots` path instead of plan's `/api/cron/snapshot-metrics` because the latter already exists for campaign analytics (a different subsystem). Deviation Rule 3 applied.
- bounceRate uses daily delta (deltaBounced/deltaSent) when delta is available; on first snapshot or counter reset falls back to cumulative bounced/emailsSent if >= 20 total sends.
- Warmup data fetched via dynamic import to avoid any potential circular dependency issues at module load time.
- BounceSnapshot.opened stores `unique_opened_count` from SenderEmail (consistent with other sender metrics in the codebase).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Cron endpoint path conflict**
- **Found during:** Task 2 (snapshot cron endpoint)
- **Issue:** `/api/cron/snapshot-metrics/route.ts` already exists for campaign analytics snapshots (snapshotWorkspaceCampaigns, backfillCopyStrategies, classifyWorkspaceBodyElements) — overwriting would break existing functionality
- **Fix:** Created `/api/cron/bounce-snapshots/route.ts` instead — same implementation, different path
- **Files modified:** src/app/api/cron/bounce-snapshots/route.ts (created instead of snapshot-metrics)
- **Verification:** Import test passes, existing snapshot-metrics route unchanged
- **Committed in:** 0c0ff22 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to avoid overwriting existing cron endpoint. New path is semantically cleaner (bounce-snapshots vs the general snapshot-metrics name). Phase 31/32 should reference /api/cron/bounce-snapshots.

## Issues Encountered
None beyond the path conflict above.

## User Setup Required
Schedule cron-job.org job at 8am UTC daily:
- URL: `https://admin.outsignal.ai/api/cron/bounce-snapshots`
- Method: GET
- Headers: `Authorization: Bearer <CRON_SECRET>`

## Next Phase Readiness
- BounceSnapshot table populated daily once cron-job.org is configured
- Phase 31 (auto-rotation) can read BounceSnapshot for rotation decisions
- Phase 32 (deliverability dashboard) can query BounceSnapshot for trend display
- 30+ days retention by default (no cleanup job — data accumulates)

---
*Phase: 29-domain-health-foundation*
*Completed: 2026-03-10*
