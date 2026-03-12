---
phase: 38-trigger-dev-foundation-smoke-test
plan: 02
subsystem: infra
tags: [trigger.dev, background-jobs, neon, vercel, env-vars]

# Dependency graph
requires:
  - phase: 38-trigger-dev-foundation-smoke-test
    provides: "Trigger.dev SDK installed, trigger.config.ts with env-var-based project ref, shared queues"
provides:
  - "Trigger.dev Cloud project created (proj_difpmdhrzxdwuxzzeney)"
  - "Vercel integration connected — all env vars synced to Trigger.dev"
  - "TRIGGER_SECRET_KEY and TRIGGER_PROJECT_REF in .env.local for local dev"
affects: [38-03-smoke-test, 39-webhook-plumbing, 40-writer-agent-restoration]

# Tech tracking
tech-stack:
  added: []
  patterns: [env-var based TRIGGER_PROJECT_REF (not hardcoded in trigger.config.ts)]

key-files:
  created: []
  modified:
    - .env.local

key-decisions:
  - "DATABASE_URL override with ?connection_limit=1 is PENDING — user will add this manually in Trigger.dev dashboard"
  - "Neon IP allowlisting check is PENDING — user will verify in Neon console"
  - "TRIGGER_PROJECT_REF stored in .env.local (not committed), resolves via process.env in trigger.config.ts"
  - "PROD secret key also obtained (tr_prod_...) — user holds it; will be needed when setting Vercel env var TRIGGER_SECRET_KEY for production"

patterns-established:
  - "Trigger.dev project ref: proj_difpmdhrzxdwuxzzeney — all task files must reference this environment"

requirements-completed: [FOUND-02, FOUND-04]

# Metrics
duration: 10min
completed: 2026-03-12
---

# Phase 38 Plan 02: Trigger.dev Dashboard Setup Summary

**Trigger.dev Cloud project connected to outsignal-agents with Vercel env var sync, DEV and PROD secret keys obtained, local .env.local configured for `npx trigger.dev dev`**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-03-12T00:00:00Z
- **Completed:** 2026-03-12T00:10:00Z
- **Tasks:** 2 (Task 1 was a human-action checkpoint, Task 2 was auto)
- **Files modified:** 1

## Accomplishments
- Trigger.dev Cloud project created: `proj_difpmdhrzxdwuxzzeney`
- Vercel integration connected — all env vars (Anthropic, EmailBison, Slack, Resend, Neon, etc.) synced to Trigger.dev dashboard
- `TRIGGER_SECRET_KEY` (DEV) and `TRIGGER_PROJECT_REF` added to `.env.local` for local dev
- PROD secret key obtained and held by user for Vercel env var configuration

## Task Commits

No code commits for this plan — Task 1 was a human-action dashboard setup, Task 2 modified only `.env.local` (intentionally not committed, gitignored).

**Plan metadata:** See final docs commit.

## Files Created/Modified
- `.env.local` — Added `TRIGGER_SECRET_KEY="tr_dev_..."` and `TRIGGER_PROJECT_REF="proj_difpmdhrzxdwuxzzeney"` (gitignored, not committed)

## Decisions Made
- TRIGGER_PROJECT_REF passed via env var, not hardcoded — consistent with 38-01 decision, works with `.env.local` for local dev and Vercel env vars for production
- PROD secret key also retrieved — will be needed when configuring Vercel env var for production deployments

## Deviations from Plan

None — plan executed exactly as written. The two pending items below are documented as the user confirmed they will complete them, not as deviations.

## Pending Items (User Action Required)

These two steps from Task 1 were NOT completed and must be done before running the Phase 38-03 smoke test:

**1. DATABASE_URL override in Trigger.dev dashboard**
- Location: Trigger.dev Dashboard -> Project Settings -> Environment Variables
- Action: Find `DATABASE_URL` (synced from Vercel), edit it to append `?connection_limit=1` to the pooled Neon URL
- Why: Prevents connection exhaustion when multiple Trigger.dev tasks run concurrently
- **Must be done before 38-03 smoke test**

**2. Neon IP allowlisting check**
- Location: Neon Console -> Project Settings -> IP Allow
- Action: If IP allowlisting is enabled, add Trigger.dev Cloud IP ranges; if not enabled, document as "not enabled"
- **If allowlisting is enabled and not updated, tasks will fail to connect to the database**

## Issues Encountered
None — dashboard setup straightforward. User provided both DEV and PROD secret keys.

## Next Phase Readiness
- Local dev environment is configured: `npx trigger.dev dev` will authenticate using the DEV secret key
- **BLOCKED on pending items above** — do not run 38-03 smoke test until DATABASE_URL override is applied
- Once pending items are done, 38-03 can proceed: write smoke test task, deploy, verify Prisma query executes in Trigger.dev Cloud

---
*Phase: 38-trigger-dev-foundation-smoke-test*
*Completed: 2026-03-12*
