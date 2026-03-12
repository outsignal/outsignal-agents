---
phase: 42-remaining-cron-lift-and-shift
plan: 01
subsystem: infra
tags: [trigger.dev, schedules, cron, bounce-monitor, sync-senders, deliverability]

# Dependency graph
requires:
  - phase: 41-ai-cron-migration
    provides: schedules.task pattern, queues.ts, trigger/ directory structure
provides:
  - trigger/sync-senders.ts — Trigger.dev scheduled task replacing cron/sync-senders route
  - trigger/bounce-snapshots.ts — Trigger.dev scheduled task replacing cron/bounce-snapshots route
  - trigger/deliverability-digest.ts — Trigger.dev scheduled task replacing cron/deliverability-digest route
  - trigger/bounce-monitor.ts — Trigger.dev scheduled task replacing cron/bounce-monitor route (full orchestration)
affects: [cron-job.org job disablement, Phase 42 plan 02+]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Thin wrapper pattern: schedules.task() calling one lib function, no PrismaClient needed"
    - "Full lift-and-shift pattern: bounce-monitor replicates all route orchestration logic verbatim"
    - "No anthropicQueue on non-AI tasks — queues only needed for Anthropic/EmailBison concurrency"

key-files:
  created:
    - trigger/sync-senders.ts
    - trigger/bounce-snapshots.ts
    - trigger/deliverability-digest.ts
    - trigger/bounce-monitor.ts
  modified: []

key-decisions:
  - "sync-senders, bounce-snapshots, deliverability-digest use no queue — lib functions handle prisma internally, no AI/EB concurrency risk"
  - "bounce-monitor uses PrismaClient at module scope for insight creation and sender queries"
  - "bounce-monitor retry minTimeoutInMs: 5_000 / maxTimeoutInMs: 60_000 (longer than thin wrappers — heavier operation)"
  - "No anthropicQueue on any of these four tasks — none call Anthropic"

patterns-established:
  - "Thin wrapper: import one lib function, call it in run(), log summary, return result — no prisma needed"
  - "Full lift: copy route handler body verbatim, remove Next.js response wrappers, replace prisma import with module-scope PrismaClient"

requirements-completed: [CRON-06, CRON-07, CRON-08, CRON-09]

# Metrics
duration: 2min
completed: 2026-03-12
---

# Phase 42 Plan 01: Remaining Cron Lift-and-Shift Summary

**Four Trigger.dev scheduled tasks created: three thin lib-function wrappers (sync-senders, bounce-snapshots, deliverability-digest) plus a full orchestration lift of the bounce-monitor route**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-12T18:50:26Z
- **Completed:** 2026-03-12T18:52:37Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- sync-senders task: daily 5am UTC, wraps `syncSendersForAllWorkspaces()`, logs result summary
- bounce-snapshots task: daily 8am UTC, wraps `captureAllWorkspaces()`, logs result summary
- deliverability-digest task: weekly Monday 8am UTC, wraps `notifyDeliverabilityDigest()`, returns `{ ok: true }`
- bounce-monitor task: every 4 hours, full route orchestration — transitions, replacement finder, Slack notifications, prisma insight creation with dedup, bounce rate trend detection, reply trend monitoring, combined digest email

## Task Commits

Each task was committed atomically:

1. **Task 1: Create sync-senders, bounce-snapshots, deliverability-digest** - `849fded` (feat)
2. **Task 2: Create bounce-monitor scheduled task** - `07e52a0` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `trigger/sync-senders.ts` - Daily sender sync via `syncSendersForAllWorkspaces()`, cron `0 5 * * *`
- `trigger/bounce-snapshots.ts` - Daily bounce snapshot via `captureAllWorkspaces()`, cron `0 8 * * *`
- `trigger/deliverability-digest.ts` - Weekly deliverability digest via `notifyDeliverabilityDigest()`, cron `0 8 * * 1`
- `trigger/bounce-monitor.ts` - Every 4h bounce monitor with full orchestration, cron `0 */4 * * *`

## Decisions Made
- sync-senders, bounce-snapshots, deliverability-digest use no queue: their lib functions handle prisma internally and make no AI or EmailBison calls, so no concurrency concern
- bounce-monitor PrismaClient at module scope: needed for insight dedup queries and active sender queries (not abstracted in lib)
- bounce-monitor retry uses wider timeout window (5s–60s) vs 2s–30s for thin wrappers — heavier operation with more DB and notification calls
- No anthropicQueue on any of the four tasks — none trigger Anthropic APIs

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- `npx tsc --noEmit trigger/sync-senders.ts` fails when specifying files directly because `@/` alias cannot be resolved without tsconfig context. Full project `npx tsc --noEmit` (no file args) resolves correctly using tsconfig.json paths. Same behavior as Phase 41 tasks. Clean compile confirmed.

## User Setup Required
None - no external service configuration required. Cron-job.org job disablement for these four crons is handled separately (per project protocol: same day as Trigger.dev verification).

## Next Phase Readiness
- All four scheduled tasks compiled and committed
- Ready for Phase 42 plan 02+ (poll-replies, inbox-check, etc.)
- Cron-job.org jobs for these four endpoints can be disabled once Trigger.dev tasks are verified in production

---
*Phase: 42-remaining-cron-lift-and-shift*
*Completed: 2026-03-12*
