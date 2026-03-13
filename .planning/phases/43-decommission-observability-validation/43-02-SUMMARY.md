---
phase: 43-decommission-observability-validation
plan: "02"
subsystem: infra
tags: [trigger.dev, cron, webhook, fire-and-forget, cleanup]

# Dependency graph
requires:
  - phase: 43-01
    provides: Trigger.dev tasks live for all 11 cron routes; cron-job.org retired
provides:
  - Webhook handler with no fire-and-forget patterns (BOUNCE and UNSUBSCRIBED notify calls awaited)
  - 11 old Vercel cron route files deleted from codebase
  - vercel.json crons section only contains enrichment-job-processor
affects: [44-ooo-reengagement, 45-multi-channel-sequencing-fix-if-else-upgrade]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fire-and-forget notify() replaced with try/catch await — non-throwing but observable"
    - "Intentional fire-and-forget documented with explicit comment (LinkedIn portal UX pattern)"

key-files:
  created: []
  modified:
    - src/app/api/webhooks/emailbison/route.ts
    - src/app/api/portal/inbox/linkedin/sync/route.ts
  deleted:
    - src/app/api/cron/poll-replies/route.ts
    - src/app/api/cron/bounce-monitor/route.ts
    - src/app/api/cron/bounce-snapshots/route.ts
    - src/app/api/cron/deliverability-digest/route.ts
    - src/app/api/cron/domain-health/route.ts
    - src/app/api/cron/generate-insights/route.ts
    - src/app/api/cron/retry-classification/route.ts
    - src/app/api/cron/snapshot-metrics/route.ts
    - src/app/api/cron/sync-senders/route.ts
    - src/app/api/cron/postmaster-sync/route.ts
    - src/app/api/inbox-health/check/route.ts

key-decisions:
  - "BOUNCE and UNSUBSCRIBED notify() calls converted from .catch(() => {}) to try/catch await — errors now logged via console.error"
  - "LinkedIn sync route void Promise.allSettled kept as-is — intentional portal UX pattern (202 immediate response), documented with comment"
  - "Other .catch(() => {}) patterns in portal/campaigns, onboard, stripe routes are out of scope — those are not webhook handler files"
  - "inbox-health parent directory removed after check/ subdirectory deletion left it empty"
  - ".next build cache cleared to fix stale validator.ts references to deleted route files"

patterns-established:
  - "Webhook handlers must use await with try/catch for all background calls — no .catch(() => {}) fire-and-forget"

requirements-completed: [DECOMM-02]

# Metrics
duration: 12min
completed: 2026-03-12
---

# Phase 43 Plan 02: Decommission Fire-and-Forget + Dead Cron Routes Summary

**Webhook handler BOUNCE/UNSUBSCRIBED notify() calls converted from fire-and-forget to awaited try/catch; 11 Trigger.dev-replaced cron route directories deleted; vercel.json remains clean with only enrichment-job-processor**

## Performance

- **Duration:** 12 min
- **Started:** 2026-03-12T21:45:00Z
- **Completed:** 2026-03-12T21:57:00Z
- **Tasks:** 2
- **Files modified:** 2 modified, 11 deleted

## Accomplishments
- BOUNCE event: `notify()` now awaited inside try/catch — errors logged via `console.error` instead of silently swallowed
- UNSUBSCRIBED event: same pattern applied
- 11 dead cron route directories deleted (2,012 lines of dead code removed)
- LinkedIn portal sync route documented with explicit intentional fire-and-forget comment
- TypeScript compiles cleanly (stale .next cache cleared to resolve false positives)

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix fire-and-forget patterns in webhook handler** - `3b194e1` (fix)
2. **Task 2: Delete old cron route files + update vercel.json** - `47a5cea` (chore)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/app/api/webhooks/emailbison/route.ts` - BOUNCE and UNSUBSCRIBED notify() calls now awaited
- `src/app/api/portal/inbox/linkedin/sync/route.ts` - Intentional fire-and-forget comment added
- `src/app/api/cron/poll-replies/route.ts` - DELETED
- `src/app/api/cron/bounce-monitor/route.ts` - DELETED
- `src/app/api/cron/bounce-snapshots/route.ts` - DELETED
- `src/app/api/cron/deliverability-digest/route.ts` - DELETED
- `src/app/api/cron/domain-health/route.ts` - DELETED
- `src/app/api/cron/generate-insights/route.ts` - DELETED
- `src/app/api/cron/retry-classification/route.ts` - DELETED
- `src/app/api/cron/snapshot-metrics/route.ts` - DELETED
- `src/app/api/cron/sync-senders/route.ts` - DELETED
- `src/app/api/cron/postmaster-sync/route.ts` - DELETED
- `src/app/api/inbox-health/check/route.ts` - DELETED

## Decisions Made
- BOUNCE and UNSUBSCRIBED `notify()` calls converted from `.catch(() => {})` to try/catch await — errors now logged via `console.error("[webhook] System notification failed:", err)`
- LinkedIn sync route `void Promise.allSettled(...)` kept as-is — intentional portal UX pattern (returns 202 immediately), documented with comment
- Other `.catch(() => {})` patterns in portal/campaigns, onboard, stripe/webhook routes are out of scope — those are not webhook handler files per plan scope
- `inbox-health/` parent directory removed after `check/` deletion left it empty
- `.next/` build cache cleared to fix stale `validator.ts` type references to deleted routes

## Deviations from Plan

None - plan executed exactly as written. The `.next` cache clearing was a necessary housekeeping step discovered during TypeScript verification (stale generated file), not a code deviation.

## Issues Encountered
- TypeScript `tsc --noEmit` initially failed due to `.next/dev/types/validator.ts` containing auto-generated imports for the deleted cron routes (Next.js build cache artifact). Cleared `.next/` directory and reran — clean compile.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Codebase is now clean: zero dead cron routes, zero fire-and-forget in webhook handlers
- vercel.json crons section only contains enrichment-job-processor (as designed)
- Ready for Phase 43-03 (observability validation) or final phase wrap-up

## Self-Check: PASSED

- `src/app/api/webhooks/emailbison/route.ts` — FOUND
- `43-02-SUMMARY.md` — FOUND
- `src/app/api/cron/poll-replies` — CONFIRMED DELETED
- `src/app/api/inbox-health` — CONFIRMED DELETED
- `src/app/api/cron/` — only `backfill-replies` remains
- Commits `3b194e1` and `47a5cea` — FOUND

---
*Phase: 43-decommission-observability-validation*
*Completed: 2026-03-12*
