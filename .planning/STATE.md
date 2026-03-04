---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: Lead Discovery & Intelligence
status: unknown
last_updated: "2026-03-04T13:59:00Z"
progress:
  total_phases: 13
  completed_phases: 12
  total_plans: 47
  completed_plans: 50
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-04)

**Core value:** Own the lead data pipeline end-to-end so we never pay for the same lead twice and can cancel the $300+/month Clay subscription.
**Current focus:** v2.0 Phase 17 — Leads Agent Discovery Upgrade

## Current Position

Phase: 17 of 21 (Leads Agent Discovery Upgrade) -- COMPLETE
Plan: 02 of 02 complete
Status: Phase 17 complete
Last activity: 2026-03-04 -- 17-02 complete (buildDiscoveryPlan + deduplicateAndPromote tools, system prompt rewrite, maxSteps 15)

Progress: [######░░░░] ~6% (v2.0)

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
- [15-01 FIX-01]: searchKnowledgeBase added to Research Agent so it can ground ICP recommendations in documented best practices
- [15-01 FIX-02]: Waterfall reordered FindyMail ($0.001) → Prospeo ($0.002) → LeadMagic ($0.005) for ~50% cost savings; LinkedIn gate uses named filter to skip FindyMail safely
- [Phase 15-foundation]: DISC-09 resolved: single APOLLO_API_KEY env var, no per-workspace storage
- [Phase 15-foundation]: prisma db push over migrate dev — database had no migration history, db push applied changes safely
- [Phase 15-foundation]: DiscoveredPerson uses soft references only — no FK constraints for audit trail flexibility
- [15-04 admin-ui]: API route /api/workspaces/[slug]/package created in Plan 04 (not Plan 03) — Plan 03 not yet run, was blocking dependency
- [15-04 admin-ui]: No auth guard on package API route — consistent with all other workspace API routes in this project
- [15-03 agents]: Campaign allowance is soft limit — canProceedWithConfirmation pattern, not hard block
- [15-03 agents]: updateWorkspacePackage placed in dashboardTools (direct exec), not as delegation tool — admin management, not specialist task
- [16-01 discovery]: Apollo search returns no emails — email field always undefined; enrichment deferred to Phase 17
- [16-01 discovery]: stageDiscoveredPeople uses skipDuplicates: false intentionally — dedup is Phase 17 responsibility
- [16-01 discovery]: ProspeoSearchAdapter.search() has optional extras param for Prospeo-specific filters (company_funding, person_department) beyond the DiscoveryAdapter interface
- [16-01 discovery]: prisma db push applied rawResponse column safely (no migration history)
- [Phase 16-discovery-sources]: Serper adapter exports const object (not class), does NOT implement DiscoveryAdapter — query-based search, not filter-based
- [Phase 16-discovery-sources]: Social search results (searchSocial) returned raw — NOT staged to DiscoveredPerson; signal data reserved for Phase 18 SignalEvent creation
- [Phase 16-discovery-sources]: Maps results are company-level records with null person fields — staged with discoverySource: serper-maps in Plan 03
- [16-03 leads-agent]: searchGoogle web mode returns informational results only — NOT staged (no person data); agent uses URLs to feed extractDirectory
- [16-03 leads-agent]: Apollo tool omits incrementDailySpend — search is free, costUsd=0 from adapter
- [16-03 leads-agent]: Prospeo extras built inline in tool execute — fundingStages/departments mapped to company_funding/person_department before passing to adapter.search() extras param
- [17-01 promotion]: promotedAt set only on promoted records (not duplicates) — duplicates free for quota; quota function filters by promotedAt date window
- [17-01 promotion]: "waterfall" sentinel provider value used for enrichment queue — cron calls enrichEmail() for all person jobs regardless of provider
- [17-01 promotion]: Placeholder email pattern placeholder-{uuid}@discovery.internal for leads without email to satisfy Person.email unique constraint
- [17-01 promotion]: Fuzzy name match threshold 0.85 Levenshtein similarity — only fires when firstName + lastName + companyDomain all present
- [17-02 agent-tools]: AI Ark positioned as equal peer to Apollo/Prospeo in system prompt -- not a fallback source
- [17-02 agent-tools]: Quota exceeded = soft warning only, agent does not block execution (user decision)
- [17-02 agent-tools]: maxSteps 15 provides headroom for plan + 5 search calls + dedup + adjustments
- [17-02 agent-tools]: z.record(z.string(), z.unknown()) for source filters -- Zod v3 requires explicit key type

### Blockers/Concerns

- PredictLeads paid pricing beyond 100 free requests/month is demo-only — confirm before Phase 18 polling frequency design
- AI Ark People Search endpoint LOW confidence — verify in AI Ark dashboard before Phase 16 implementation (fallback: skip DISC-03 if unconfirmed)
- Vercel at 2-cron Hobby limit — signal worker must run on Railway only, not Vercel

### Pending Todos

None.

## Session Continuity

Last session: 2026-03-04
Stopped at: Completed 17-02-PLAN.md (Phase 17 complete -- agent tools + system prompt + maxSteps)
Resume file: .planning/phases/ (Phase 18 next)
