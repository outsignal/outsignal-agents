---
gsd_state_version: 1.0
milestone: v6.0
milestone_name: Trigger.dev Migration — Background Jobs Infrastructure
status: ready_to_plan
last_updated: "2026-03-12T00:00:00.000Z"
progress:
  total_phases: 6
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-12)

**Core value:** Own the lead data pipeline end-to-end so we never pay for the same lead twice and can cancel the $300+/month Clay subscription.
**Current focus:** v6.0 Phase 38 — Trigger.dev Foundation + Smoke Test

## Current Position

Phase: 38 of 43 (Trigger.dev Foundation + Smoke Test)
Plan: 0 of TBD
Status: Ready to plan
Last activity: 2026-03-12 — v6.0 roadmap created, phases 38-43 defined

Progress: v6.0 [░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 0%

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

### Pending Todos

None.

### Blockers/Concerns

- Neon IP allowlisting status unknown — verify in Neon console before Phase 38 starts; if enabled, add Trigger.dev IP ranges
- WHOOK-02 writer agent restoration depends on current Haiku shortcut implementation in src/lib/agents/runner.ts — review before scoping Phase 40 plans

## Session Continuity

Last session: 2026-03-12
Stopped at: v6.0 roadmap created — phases 38-43 defined, requirements mapped, ready to plan Phase 38
Resume file: None
