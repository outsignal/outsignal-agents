---
phase: 42-remaining-cron-lift-and-shift
plan: 02
subsystem: infra
tags: [trigger.dev, cron, scheduled-tasks, emailbison, domain-health, blacklist, dns, prisma]

# Dependency graph
requires:
  - phase: 42-01
    provides: inbox-health scheduled task — established pattern for scheduled task structure
  - phase: 41-01
    provides: retry-classification, snapshot-metrics, generate-insights scheduled tasks
  - phase: 38-01
    provides: trigger.dev SDK setup, queues.ts, emailBisonQueue

provides:
  - poll-replies Trigger.dev scheduled task (every 10 min, replaces Vercel cron route)
  - domain-health Trigger.dev scheduled task (twice daily, removes 4-domain cap, adds concurrent checking)

affects: [phase-43, cron-job-org-retirement, trigger-dev-deploy]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "schedules.task with queue: emailBisonQueue for concurrency control on EmailBison API calls"
    - "Promise.allSettled for concurrent domain checking — isolated failure per domain"
    - "Full route logic lifted into run() with NextResponse/validateCronSecret stripped"
    - "PrismaClient at module scope (not inside run()) per established pattern"

key-files:
  created:
    - trigger/poll-replies.ts
    - trigger/domain-health.ts
  modified: []

key-decisions:
  - "poll-replies uses emailBisonQueue — applies concurrency limit to prevent spike when all 9 workspaces poll simultaneously"
  - "domain-health has no queue — DNS lookups are external I/O not rate-limited by a shared resource"
  - "domain-health removes MAX_DOMAINS_PER_RUN=4 cap — Trigger.dev 300s maxDuration allows checking all domains"
  - "domain-health uses Promise.allSettled (not sequential for loop) — domains are independent, failure isolation via settled status"

patterns-established:
  - "schedules.task pattern: id, cron, optional queue, maxDuration: 300, retry: { maxAttempts: 2, factor: 2, minTimeoutInMs: 5_000, maxTimeoutInMs: 60_000 }"
  - "Helper functions defined at module scope (not inside run()) for complex tasks with shared logic"

requirements-completed: [CRON-04, CRON-05]

# Metrics
duration: 4min
completed: 2026-03-12
---

# Phase 42 Plan 02: Remaining Cron Lift-and-Shift (Complex Tasks) Summary

**poll-replies and domain-health Trigger.dev scheduled tasks created — domain-health now checks ALL domains concurrently (no 4-domain cap) and poll-replies uses emailBisonQueue for concurrency control across 9 workspaces**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-12T18:50:34Z
- **Completed:** 2026-03-12T18:54:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Created `trigger/poll-replies.ts` — full lift of 337-line route with complete reply processing pipeline (dedup, classification, notification, LinkedIn fast-track)
- Created `trigger/domain-health.ts` — full lift of 563-line route with key improvement: removed 4-domain cap and switched sequential loop to `Promise.allSettled` for concurrent checking
- Both compile cleanly against project tsconfig with no errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Create poll-replies scheduled task** - `faaa4f8` (feat)
2. **Task 2: Create domain-health scheduled task with cap removed** - `fee4d9a` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `trigger/poll-replies.ts` — Schedules.task every 10 min, emailBisonQueue, full reply processing pipeline
- `trigger/domain-health.ts` — Schedules.task twice daily 8am+8pm UTC, concurrent checking, all helper functions lifted from route

## Decisions Made
- poll-replies uses `queue: emailBisonQueue` — prevents concurrency spike when 9 workspaces all poll simultaneously at the 10-min mark
- domain-health has no queue — DNS lookups hit external resolvers, not a shared rate-limited API
- domain-health MAX_DOMAINS_PER_RUN=4 cap removed entirely — Trigger.dev 300s maxDuration is enough for the full fleet; cap was only a workaround for Vercel's 60s timeout
- domain-health concurrent checking via `Promise.allSettled` — each domain is independent, settled pattern gives per-domain error isolation

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required. Tasks will be picked up by Trigger.dev on next deploy.

## Next Phase Readiness
- Both critical cron tasks created as Trigger.dev scheduled tasks
- Phase 43 can proceed to disable the corresponding cron-job.org jobs (7363961 for domain-health) once Trigger.dev tasks are deployed and verified
- poll-replies Trigger.dev task replaces the cron-job.org reply poller job entirely

---
*Phase: 42-remaining-cron-lift-and-shift*
*Completed: 2026-03-12*
