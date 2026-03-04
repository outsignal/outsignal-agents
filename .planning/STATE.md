---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Lead Discovery & Intelligence
status: ready_to_plan
last_updated: "2026-03-04"
progress:
  total_phases: 7
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-04)

**Core value:** Own the lead data pipeline end-to-end so we never pay for the same lead twice and can cancel the $300+/month Clay subscription.
**Current focus:** v2.0 Phase 15 — Foundation

## Current Position

Phase: 15 of 21 (Foundation)
Plan: —
Status: Ready to plan
Last activity: 2026-03-04 — v2.0 roadmap created (7 phases, 56 requirements mapped)

Progress: [░░░░░░░░░░] 0% (v2.0)

## Accumulated Context

### Decisions

- [v2.0 Roadmap]: Phase 20 (Creative Ideas) and Phase 21 (CLI Chat) are independent of Phase 18-19 (signal pipeline) — can be parallelized
- [v2.0 Roadmap]: Phase 15 groups FIX-01/02, schema additions, workspace config, and adapter interface — all are blocking dependencies
- [v2.0 Roadmap]: Apollo per-workspace key architecture locked in Phase 15 schema — cannot retrofit later
- [Phase 15 Context]: Apollo key is single Outsignal-level env var, NOT per-workspace — DISC-09 simplified
- [Phase 15 Context]: Workspace packages are modular (email, email-signals, linkedin, linkedin-signals) — no fixed tiers
- [Phase 15 Context]: Two approval gates for discovery: plan approval before API spend, batch review before enrichment
- [Phase 15 Context]: Separate quota pools for signal vs static campaigns, rolling 30-day reset
- [v2.0 Roadmap]: Signal budget governor is Phase 18 prerequisite, not an optimization

### Blockers/Concerns

- PredictLeads paid pricing beyond 100 free requests/month is demo-only — confirm before Phase 18 polling frequency design
- AI Ark People Search endpoint LOW confidence — verify in AI Ark dashboard before Phase 16 implementation (fallback: skip DISC-03 if unconfirmed)
- Vercel at 2-cron Hobby limit — signal worker must run on Railway only, not Vercel

### Pending Todos

None.

## Session Continuity

Last session: 2026-03-04
Stopped at: Phase 15 context gathered. All gray areas discussed (workspace packages, staging table, admin config UX, quota enforcement).
Resume file: .planning/phases/15-foundation/15-CONTEXT.md
