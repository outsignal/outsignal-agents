---
phase: 38-trigger-dev-foundation-smoke-test
plan: 03
subsystem: infra
tags: [trigger.dev, prisma, anthropic, slack, emailbison, resend, smoke-test, connectivity]

# Dependency graph
requires:
  - phase: 38-01
    provides: Trigger.dev SDK, trigger.config.ts with Prisma extension, binary targets, shared queues
  - phase: 38-02
    provides: Trigger.dev Cloud project, Vercel integration, .env.local configured with all API keys
provides:
  - "smoke-test.ts — permanent diagnostic task verifying all 5 service connections"
  - "Confirmed end-to-end: Prisma/Neon DB read, Anthropic API, Slack auth, EmailBison API, Resend API"
  - "Phase 38 complete — all downstream phases (39-43) unblocked"
affects:
  - 39-webhook-migration
  - 40-writer-agent
  - 41-inbox-health-tasks
  - 42-cron-retirement
  - 43-production-rollout

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Smoke test pattern: per-service try/catch with timing (Date.now() before/after), ok/ms/detail/error shape"
    - "Self-contained task pattern: no src/lib/ imports, direct PrismaClient instantiation, runtime env var reads"

key-files:
  created:
    - trigger/smoke-test.ts
  modified: []

key-decisions:
  - "All 5 services confirmed operational: Prisma (943ms), Anthropic (656ms), Slack (190ms), EmailBison (428ms), Resend (210ms)"
  - "smoke-test.ts kept as permanent diagnostic tool — not throwaway — for post-deploy connectivity verification"
  - "Phase 38 gate passed: Prisma binary target correct, all env vars present, Trigger.dev infrastructure fully operational"

patterns-established:
  - "Smoke test pattern: run as on-demand Trigger.dev task, no queue/schedule, returns {summary, results} shape"

requirements-completed:
  - FOUND-05

# Metrics
duration: 45min
completed: 2026-03-12
---

# Phase 38 Plan 03: Smoke Test Summary

**Trigger.dev smoke test confirms all 5 services operational: Prisma/Neon DB read (943ms), Anthropic claude-haiku (656ms), Slack auth.test (190ms), EmailBison workspace list (428ms), Resend API key validation (210ms) — allPassed=true, Phase 38 gate cleared**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-03-12
- **Completed:** 2026-03-12
- **Tasks:** 2 (1 auto + 1 checkpoint:human-verify)
- **Files modified:** 1

## Accomplishments
- Created `trigger/smoke-test.ts` as a permanent diagnostic task with per-service pass/fail and timing for all 5 integrations
- Fixed EmailBison check (workspace-scoped fetch) and Resend check (domains.list instead of apiKeys.list) during implementation
- Ran smoke test in Trigger.dev Cloud — all 5 services returned ok: true, allPassed: true, 5/5 passed
- Phase 38 gate cleared — all v6.0 downstream phases (39-43) are now unblocked

## Task Commits

Each task was committed atomically:

1. **Task 1: Create smoke test task with per-service diagnostics** - `fc27cf7` (feat)
2. **Task 1 fix: Fix smoke test EmailBison + Resend checks** - `27be6c3` (fix)

**Plan metadata:** (this commit — docs: complete plan)

## Files Created/Modified
- `trigger/smoke-test.ts` - Permanent diagnostic Trigger.dev task; tests Prisma, Anthropic, Slack, EmailBison, Resend with per-service ok/ms/detail results

## Decisions Made
- Smoke test kept permanent (not throwaway) — useful for post-deploy connectivity verification after each phase rollout
- EmailBison check uses workspace-scoped URL with myacq slug rather than /workspaces list (which returned 404)
- Resend check uses `domains.list()` (available on restricted send-only key) rather than `apiKeys.list()` (requires full access key)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed EmailBison API check URL**
- **Found during:** Task 1 (Create smoke test)
- **Issue:** `/api/workspaces` returned 404; correct endpoint is workspace-scoped
- **Fix:** Changed to `https://app.outsignal.ai/api/workspaces/myacq/leads?limit=1`
- **Files modified:** trigger/smoke-test.ts
- **Verification:** EmailBison check returned ok: true, status=200, workspace=myacq
- **Committed in:** 27be6c3 (fix commit)

**2. [Rule 1 - Bug] Fixed Resend API check method**
- **Found during:** Task 1 (Create smoke test)
- **Issue:** `resend.apiKeys.list()` fails with restricted send-only key; method requires admin access
- **Fix:** Changed to `resend.domains.list()` which works with restricted keys
- **Files modified:** trigger/smoke-test.ts
- **Verification:** Resend check returned ok: true, "key valid send-only restricted"
- **Committed in:** 27be6c3 (fix commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 - Bug)
**Impact on plan:** Both fixes necessary for correct connectivity verification. No scope creep.

## Issues Encountered
None beyond the two auto-fixed API endpoint/method mismatches above.

## User Setup Required
None - smoke test verified all existing env vars are present and operational.

## Next Phase Readiness
- Phase 38 complete — all infrastructure confirmed operational
- Phase 39 (Webhook Migration) is unblocked: EmailBison webhook handler can now be migrated to Trigger.dev
- Phase 40 (Writer Agent) is unblocked: Anthropic connectivity confirmed
- Phases 41-43 are unblocked: all env vars and service connections verified

---
*Phase: 38-trigger-dev-foundation-smoke-test*
*Completed: 2026-03-12*
