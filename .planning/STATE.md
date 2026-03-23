---
gsd_state_version: 1.0
milestone: v7.0
milestone_name: Nova CLI Agent Teams — Client-Specific Intelligence
status: active
last_updated: "2026-03-23"
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-23)

**Core value:** Own the lead data pipeline end-to-end so we never pay for the same lead twice and can cancel the $300+/month Clay subscription.
**Current focus:** v7.0 — Nova CLI Agent Teams with client-specific memory

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-03-23 — Milestone v7.0 started

Progress: v7.0 [░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 112 (v1.0: 22, v1.1: 40, v2.0: 26, v3.0: 16, v4.0: 11, v5.0: 11 + 3 quick tasks)
- Average duration: ~15 min
- Total execution time: ~28 hours

**Recent Trend:**
- v5.0 (7 phases) shipped same day as v4.0 — fast execution
- Trend: Stable

*Updated after each plan completion*

## Accumulated Context

### Decisions

v6.0 Phase 43-03 decisions:
- [Phase 43-03]: Trigger.dev REST API proxied via Next.js route using plain fetch with Bearer token — no SDK overhead, avoids build-time complexity
- [Phase 43-03]: Workspace tag filter options derived dynamically from live run data (tags not starting with run_) — no hardcoded workspace list needed
- [Phase 43-03]: Failed task errors displayed as inline red row below task row — per DECOMM-04 locked decision, not hidden behind a click

v6.0 Phase 43-02 decisions:
- [Phase 43-02]: BOUNCE and UNSUBSCRIBED notify() calls converted from .catch(() => {}) to try/catch await — errors now logged, not silently swallowed
- [Phase 43-02]: LinkedIn sync route void Promise.allSettled kept as-is — intentional portal UX pattern (202 immediate response), documented with comment
- [Phase 43-02]: Other .catch(() => {}) patterns in portal/campaigns, onboard, stripe routes are out of scope (not webhook handler files)
- [Phase 43-02]: inbox-health parent directory removed after check/ subdirectory deletion left it empty
- [Phase 43-02]: .next build cache cleared to fix stale validator.ts references to deleted route files

v6.0 Phase 43-01 decisions:
- [Phase 43-01]: Two-step deploy required to swap sync-senders for postmaster-stats-sync — adding before removing hits 11/10 limit; remove first (10→9), then add (9→10)
- [Phase 43-01]: onFailure hook uses inline fetch to Slack API — not src/lib/slack import (build-time import risk)
- [Phase 43-01]: runSyncSenders() exported as plain async function; inbox-check calls it as Step 3 after sender health check
- [Phase 43-01]: .trigger/ local dev cache added to .gitignore (was untracked, not in any previous .gitignore)

v6.0 Phase 41-01 decisions:
- [Phase 41-01]: retry-classification removes take:50 batch limit — no timeout constraint in Trigger.dev (300s), process all unclassified replies in one run
- [Phase 41-01]: snapshot-metrics and generate-insights use Promise.all fan-out (not sequential for loop) — workspaces are independent, parallelism is safe
- [Phase 41-01]: sendDigestForWorkspace replicated inline in generate-insights.ts (not extracted to lib) — avoids premature abstraction for a function only called from one place

v6.0 Phase 40-01 decisions:
- [Phase 40-01]: Writer in reply mode returns plain text (not JSON) — use result.text directly as suggestion, not result.output
- [Phase 40-01]: generate-suggestion retry maxAttempts: 2 (not 3) — Opus calls are expensive, avoid excess retries
- [Phase 40-01]: Thread context via emailBisonParentId preferred; leadEmail fallback for replies without parent
- [Phase 40-01]: Both Slack postMessage calls wrapped in .catch(() => {}) — Slack failure must not block task

v6.0 Phase 39-01 decisions:
- [Phase 39-01]: ebReplyId typed as number (not string|number) — Prisma Reply.emailBisonReplyId is Int? in schema
- [Phase 39-01]: replyParentId and replySenderEmailId typed as number|null — map to Int? schema fields emailBisonParentId and ebSenderEmailId
- [Phase 39-01]: linkedin-fast-track has no queue — only DB operations, no Anthropic or EmailBison calls
- [Phase 39-01]: Classification failure in process-reply is non-blocking — retry-classification cron handles intent=null replies

v6.0 Phase 38-03 decisions:
- [Phase 38-03]: Smoke test allPassed=true — Prisma (943ms), Anthropic (656ms), Slack (190ms), EmailBison (428ms), Resend (210ms) all confirmed operational
- [Phase 38-03]: EmailBison check uses workspace-scoped URL (/workspaces/myacq/leads) — /api/workspaces returns 404
- [Phase 38-03]: Resend check uses domains.list() — apiKeys.list() fails with restricted send-only key
- [Phase 38-03]: smoke-test.ts kept as permanent diagnostic tool for post-deploy verification

v6.0 Phase 38-02 decisions:
- [Phase 38-02]: Trigger.dev Cloud project ref is proj_difpmdhrzxdwuxzzeney — all tasks must target this project
- [Phase 38-02]: DATABASE_URL override (?connection_limit=1) PENDING — must be applied in Trigger.dev dashboard before 38-03 smoke test
- [Phase 38-02]: Neon IP allowlisting check PENDING — verify in Neon console before 38-03 smoke test
- [Phase 38-02]: PROD secret key obtained (tr_prod_...) — user holds it; needed for Vercel env var TRIGGER_SECRET_KEY on production

v6.0 Phase 38-01 decisions:
- [Phase 38-01]: TRIGGER_PROJECT_REF from env var, not hardcoded — user creates project in Trigger.dev dashboard during 38-02 setup
- [Phase 38-01]: No migrate: true in prismaExtension — project uses prisma db push (per Phase 35-01, would break production if migrations ran)
- [Phase 38-01]: No syncVercelEnvVars extension — using Vercel dashboard integration (documented conflict, v6.0 locked decision confirmed)

Key v6.0 pre-milestone decisions:
- [v6.0 Pre-Milestone]: Trigger.dev Cloud Hobby ($20/mo) — 25 concurrent runs + 100 schedules; free tier (10 schedules) insufficient
- [v6.0 Pre-Milestone]: Vercel integration for env var sync — NOT syncVercelEnvVars extension (documented conflict; use one or the other)
- [v6.0 Pre-Milestone]: LinkedIn Railway worker stays on Railway for v6.0 — stateful ProxyAgent does not map to Trigger.dev invocation model
- [v6.0 Pre-Milestone]: anthropicQueue concurrencyLimit: 3 — prevents rate limit storm when Vercel's accidental throttle is removed
- [v6.0 Pre-Milestone]: Cron-job.org retirement is per-job, same day as verification — never run both systems on same schedule
- [v6.0 Pre-Milestone]: inbox-health MUST be split into separate tasks — currently tries to do 9 things in 60s, will fail reliably under Trigger.dev
- [v6.0 Pre-Milestone]: Phase 38 smoke test is the gate — Prisma binary target + env var presence must be confirmed before any real task is written
- [v6.0 Pre-Milestone]: Writer agent restoration (Phase 40) is separate from webhook plumbing (Phase 39) — Opus upgrade is a distinct delivery

Recent v5.0 decisions carried forward (still relevant):
- [Phase 35-01]: prisma db push used instead of migrate dev — pre-existing migration drift, reset would destroy production data
- [Phase 37-03]: requireAdminAuth() not getPortalSession() for admin routes
- [Phase 39-02]: Relative path used for import type (trigger/ is at project root, not under src/)
- [Phase 39-02]: bumpPriority removed from webhook — fully handled inside linkedin-fast-track Trigger.dev task
- [Phase 42-04]: campaign-deploy has no queue — infrequent deploys, no concurrency concern
- [Phase 42-04]: await tasks.trigger() used (not void) — ensures task registered before route responds
- [Phase 42-01]: sync-senders, bounce-snapshots, deliverability-digest use no queue — lib functions handle prisma internally, no AI/EB concurrency risk
- [Phase 42-01]: bounce-monitor uses PrismaClient at module scope for insight creation and sender queries
- [Phase 42-01]: No anthropicQueue on any of the four tasks — none call Anthropic
- [Phase 42]: inbox-linkedin-maintenance runs every 6h (not daily) — LinkedIn warmup/acceptance rates benefit from more frequent updates
- [Phase 42]: enrichment-job-processor loops until done — processes all pending chunks vs one chunk per Vercel cron invocation
- [Phase 42-02]: poll-replies uses emailBisonQueue — applies concurrency limit to prevent spike when all 9 workspaces poll simultaneously
- [Phase 42-02]: domain-health removes MAX_DOMAINS_PER_RUN=4 cap — Trigger.dev 300s maxDuration allows checking all domains; cap was Vercel 60s workaround
- [Phase 42-02]: domain-health uses Promise.allSettled for concurrent checking — domains are independent, settled pattern provides per-domain error isolation
- [Phase 45-01]: triggerStepRef derived as email_${step.position} for email_sent rules — webhook query now matches rules created at deploy time
- [Phase 45-01]: Connect dedup scoped per workspace via sender relation filter — cross-workspace campaigns remain independent
- [Phase 45]: conditionType=null + requireConnected=false => always passes — backward compat for legacy rules without migration
- [Phase 45]: getConnectionsToCheck uses DEFAULT_CONNECTION_TIMEOUT_DAYS as DB pre-filter; pollConnectionAccepts applies per-campaign timeout per connection
- [Phase 44-01]: ooo-reengage task payload passes reengagementId as empty string — Plan 02 task will look up OooReengagement record by personEmail+workspaceSlug+status=pending at run time
- [Phase 44-01]: runs.reschedule() used for duplicate OOO dedup — existing pending record updated, not replaced, preserving triggerRunId integrity
- [Phase 44-01]: extractOooDetails uses receivedAt (not now()) as the anchor for default date calculation
- [Phase 44-02]: OooReengagement record looked up by personEmail+workspaceSlug+status=pending at run time (reengagementId is empty string in payload)
- [Phase 44-02]: Haiku campaign copy adaptation is non-blocking — failure falls back to generic Welcome Back message
- [Phase 44-02]: Welcome Back campaign resolved from local DB (name contains 'Welcome Back') with fallback to original campaign's latest CampaignDeploy
- [Phase 44-03]: Trigger.dev SDK calls wrapped in try/catch — run may have already fired; local DB record updated regardless
- [Phase 44-03]: Inline date editor replaces date cell in-place on pending rows — no modal

### Pending Todos

None.

### Roadmap Evolution

- Phase 44 added: OOO Re-engagement Pipeline — AI-extracted return dates, Trigger.dev delayed tasks, personalised Welcome Back campaigns
- Phase 45 added: Multi-Channel Sequencing Fix & If/Else Upgrade — fix triggerStepRef bug, bounce/unsub cancellation, connection dedup, if/else branching conditions, engagement-based routing

### Blockers/Concerns

- WHOOK-02 writer agent restoration depends on current Haiku shortcut implementation in src/lib/agents/runner.ts — review before scoping Phase 40 plans

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 4 | Platform Costs dashboard page | 2026-03-13 | 96880f1 | [4-platform-costs-dashboard-page](./quick/4-platform-costs-dashboard-page/) |

## Session Continuity

Last session: 2026-03-12
Stopped at: Completed 44-03-PLAN.md (OOO Queue dashboard — Phase 44 complete)
Resume file: None
