---
phase: 41-ai-cron-migration
plan: 01
subsystem: infra
tags: [trigger.dev, schedules, cron, anthropic, prisma, classification, insights, analytics]

# Dependency graph
requires:
  - phase: 39-webhook-reply-migration
    provides: process-reply.ts pattern (schedules.task, PrismaClient at module scope, anthropicQueue)
  - phase: 38-triggerdev-setup
    provides: Trigger.dev SDK, queues.ts, trigger.config.ts
provides:
  - trigger/retry-classification.ts — scheduled task running every 30 min, processes all unclassified replies
  - trigger/snapshot-metrics.ts — scheduled task running daily midnight UTC, fans out across all workspaces
  - trigger/generate-insights.ts — scheduled task running every 6 hours, fans out across all workspaces with weekly digest
affects: [42-inbox-health-migration, cron-job.org retirement for these 3 jobs]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "schedules.task() for Trigger.dev scheduled tasks — uses cron option directly on the task config"
    - "Fan-out pattern: Promise.all across workspaces with per-workspace try/catch for error isolation"
    - "sendDigestForWorkspace replicated from Vercel route into Trigger.dev task — digest logic stays co-located with insights generation"

key-files:
  created:
    - trigger/retry-classification.ts
    - trigger/snapshot-metrics.ts
    - trigger/generate-insights.ts
  modified: []

key-decisions:
  - "retry-classification removes take:50 batch limit — no timeout constraint in Trigger.dev, process all unclassified replies in one run"
  - "snapshot-metrics and generate-insights use Promise.all fan-out (not sequential for loop) — workspaces are independent, parallelism is safe"
  - "sendDigestForWorkspace replicated into generate-insights.ts (not extracted to lib) — matches plan spec, avoids premature abstraction"

patterns-established:
  - "schedules.task() pattern: id + cron + queue + maxDuration + retry at top level, run() receives payload with timestamp/lastTimestamp"
  - "All AI-calling scheduled tasks use anthropicQueue — prevents rate limit storm"
  - "PrismaClient at module scope in all trigger/ files — consistent with process-reply.ts established pattern"

requirements-completed: [CRON-01, CRON-02, CRON-03]

# Metrics
duration: 4min
completed: 2026-03-12
---

# Phase 41 Plan 01: AI Cron Migration — Scheduled Tasks Summary

**Three Trigger.dev scheduled tasks replacing Vercel API cron routes: retry-classification (30 min), snapshot-metrics (daily), generate-insights (6 hr) — all with no timeout constraint, full workspace fan-out, and anthropicQueue rate limiting.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-12T15:40:40Z
- **Completed:** 2026-03-12T15:44:35Z
- **Tasks:** 3
- **Files modified:** 3 created

## Accomplishments
- retry-classification now processes ALL unclassified replies (removed the Vercel route's take:50 batch limit that left replies stranded)
- snapshot-metrics fans out across all workspaces in parallel via Promise.all vs the old sequential for loop
- generate-insights fans out in parallel with digest per workspace; sendDigestForWorkspace logic replicated from Vercel route

## Task Commits

Each task was committed atomically:

1. **Task 1: retry-classification scheduled task** - `ad3c3fd` (feat)
2. **Task 2: snapshot-metrics scheduled task** - `51cf2b5` (feat)
3. **Task 3: generate-insights scheduled task** - `c581c60` (feat)

## Files Created/Modified
- `trigger/retry-classification.ts` - schedules.task, every 30 min, no batch limit, per-reply error isolation
- `trigger/snapshot-metrics.ts` - schedules.task, daily midnight UTC, Promise.all fan-out, 3 analytics steps per workspace
- `trigger/generate-insights.ts` - schedules.task, every 6 hours, Promise.all fan-out, sendDigestForWorkspace with weekly digest

## Decisions Made
- Removed `take: 50` limit from retry-classification — Vercel route was limited by 60s timeout; Trigger.dev has 300s, no reason to batch
- Fan-out via `Promise.all` not sequential `for` loop — workspaces are independent, parallelism is safe and faster
- `sendDigestForWorkspace` replicated inline (not extracted to lib) — follows plan spec and avoids premature abstraction for a function that's only called from one place

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. All three files compiled clean on first attempt.

## User Setup Required
None — task files are discoverable by Trigger.dev via `dirs: ["./trigger"]`. Deployment and cron-job.org retirement handled in a later plan.

## Next Phase Readiness
- Three scheduled tasks are complete and type-safe
- Ready for Phase 41-02: deploy to Trigger.dev and verify schedules are registered
- Cron-job.org jobs for retry-classification, generate-insights, and snapshot-metrics should be retired same day as Trigger.dev deployment verification

---
*Phase: 41-ai-cron-migration*
*Completed: 2026-03-12*
