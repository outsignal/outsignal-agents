---
phase: 10-auto-deploy-on-approval
plan: "03"
subsystem: api
tags: [next.js, prisma, emailbison, linkedin, campaigns, webhooks, sequencing]

# Dependency graph
requires:
  - phase: 10-auto-deploy-on-approval
    provides: executeDeploy, retryDeployChannel, getDeployHistory from campaigns/deploy.ts (Plan 01)
  - phase: 10-auto-deploy-on-approval
    provides: evaluateSequenceRules from linkedin/sequencing.ts (Plan 02)

provides:
  - POST /api/campaigns/[id]/deploy — validates approved status, creates CampaignDeploy, transitions to deployed (mutex), fires executeDeploy via after()
  - POST /api/campaigns/[id]/deploy?retry=email|linkedin — retries failed channel on latest deploy
  - GET /api/campaigns/[id]/deploys — returns full deploy history for a campaign
  - EMAIL_SENT webhook extension — evaluates CampaignSequenceRules and enqueues LinkedIn actions with delay

affects: [phase 12 dashboard, portal approval flow, LinkedIn worker]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - after() from next/server for fire-and-forget background execution post-response
    - Campaign.status=deployed as deploy mutex to prevent double-deploy on status=approved
    - Non-blocking webhook extensions — sequence rule errors caught, webhook always returns 200

key-files:
  created:
    - src/app/api/campaigns/[id]/deploy/route.ts
    - src/app/api/campaigns/[id]/deploys/route.ts
  modified:
    - src/app/api/webhooks/emailbison/route.ts

key-decisions:
  - "Deploy route uses next/server after() for fire-and-forget — response returns immediately with deployId, executeDeploy runs in background"
  - "Campaign.status=deployed is the mutex — prevents double-deploy; checked in executeDeploy()"
  - "Retry path validates partial_failure or failed status before allowing retry"
  - "EMAIL_SENT sequence rule evaluation only fires when campaign has LinkedIn channel — avoids unnecessary DB queries for email-only campaigns"
  - "triggerStepRef derived from data.sequence_step?.position or data.step_number — handles both EB payload shapes"

patterns-established:
  - "after() pattern: create DB record, transition status, then call after() with background work — allows immediate 200 response"
  - "Non-blocking webhook extension: wrap in try/catch, log error, never re-throw — webhook always returns 200"

requirements-completed: [DEPLOY-02, DEPLOY-06, SEQ-01, SEQ-02]

# Metrics
duration: 57min
completed: "2026-03-03"
---

# Phase 10 Plan 03: Deploy API Routes and Webhook Sequencing Summary

**Deploy endpoint (POST/GET) with fire-and-forget after() pattern, retry support, and EMAIL_SENT webhook wired to evaluate CampaignSequenceRules for LinkedIn cross-channel sequencing**

## Performance

- **Duration:** ~57 min
- **Started:** 2026-03-03T10:59:59Z
- **Completed:** 2026-03-03T11:56:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- POST /api/campaigns/[id]/deploy validates approved status + dual approval flags, creates CampaignDeploy record, transitions campaign to 'deployed' (mutex), returns `{deployId, status: "pending"}` immediately, runs executeDeploy via `after()` in background
- POST /api/campaigns/[id]/deploy?retry=email|linkedin finds latest deploy, validates failed/partial_failure status, fires retryDeployChannel via `after()`
- GET /api/campaigns/[id]/deploys returns full CampaignDeploy history newest-first
- Webhook handler extended to evaluate CampaignSequenceRules on EMAIL_SENT — looks up campaign by emailBisonCampaignId, checks for LinkedIn channel, finds person by email, evaluates rules, and enqueues each returned LinkedIn action with delayMinutes

## Task Commits

Each task was committed atomically:

1. **Task 1: Create deploy trigger and history API routes** - `b44a66c` (feat)
2. **Task 2: Wire EMAIL_SENT webhook to LinkedIn sequence rules** - `e04266f` (feat)

**Plan metadata:** (docs commit below)

## Files Created/Modified
- `src/app/api/campaigns/[id]/deploy/route.ts` - Deploy trigger (POST) and retry endpoint
- `src/app/api/campaigns/[id]/deploys/route.ts` - Deploy history list (GET)
- `src/app/api/webhooks/emailbison/route.ts` - Extended with EMAIL_SENT LinkedIn sequence rule evaluation

## Decisions Made
- Deploy route uses `after()` from next/server for fire-and-forget — response returns immediately with `{deployId, status: "pending"}`, `executeDeploy` runs in background after the HTTP response is sent
- Campaign.status transitions to 'deployed' before the after() call — this is the mutex; executeDeploy checks for 'deployed' status and aborts if not found
- Retry validates `partial_failure` or `failed` status — prevents retrying a running or complete deploy
- EMAIL_SENT sequence rule evaluation skips campaigns without LinkedIn channel — avoids unnecessary person lookup for email-only campaigns
- triggerStepRef extracted from `data.sequence_step?.position ?? data.step_number` — handles multiple possible EB payload shapes gracefully

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All three Phase 10 plans (deploy lib, sequencing engine, API routes + webhook wiring) are now complete
- The full auto-deploy pipeline is operational: portal approval triggers `approved` status, deploy endpoint creates CampaignDeploy and fires background execution, EMAIL_SENT webhook triggers LinkedIn sequencing rules
- Phase 12 (Dashboard & Admin UX) can now expose deploy triggers and history in the UI

## Self-Check: PASSED

- FOUND: src/app/api/campaigns/[id]/deploy/route.ts
- FOUND: src/app/api/campaigns/[id]/deploys/route.ts
- FOUND: src/app/api/webhooks/emailbison/route.ts
- FOUND: .planning/phases/10-auto-deploy-on-approval/10-03-SUMMARY.md
- FOUND commit b44a66c (Task 1: deploy trigger and history API routes)
- FOUND commit e04266f (Task 2: wire EMAIL_SENT webhook to LinkedIn sequence rules)

---
*Phase: 10-auto-deploy-on-approval*
*Completed: 2026-03-03*
