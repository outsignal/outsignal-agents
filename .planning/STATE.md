---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: Lead Discovery & Intelligence
status: unknown
last_updated: "2026-03-04T20:36:01.992Z"
progress:
  total_phases: 15
  completed_phases: 13
  total_plans: 53
  completed_plans: 54
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-04)

**Core value:** Own the lead data pipeline end-to-end so we never pay for the same lead twice and can cancel the $300+/month Clay subscription.
**Current focus:** v2.0 Phase 19 — Evergreen Signal Campaign Auto-Pipeline

## Current Position

Phase: 19 of 21 (Evergreen Signal Campaign Auto-Pipeline) -- IN PROGRESS
Plan: 02 of 06 complete
Status: Phase 19 plan 02 complete — Campaign Agent signal tools + orchestrator signal delegation patterns
Last activity: 2026-03-04 -- 19-02 complete (createSignalCampaign, activateSignalCampaign, pauseResumeSignalCampaign tools; generateObject ICP extraction; orchestrator signal workflow docs)

Progress: [######░░░░] ~7% (v2.0)

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
- [18-01 schema]: SignalEvent uses @@unique([source, externalId]) — allows NULL externalId for providers without stable IDs
- [18-01 schema]: SignalDailyCost is per-workspace (not global) — each workspace tracks independent signal spend against its own cap
- [18-01 schema]: SeenSignalUrl has no workspace scoping — social post URLs deduplicated globally across all workspaces
- [18-01 signals-api]: No auth guard on /api/workspaces/[slug]/signals — consistent with all other workspace routes (15-04 decision)
- [18-02 worker-signals]: Zod v3 used in worker-signals (not v4) — matches main project pattern from 17-02
- [18-02 worker-signals]: Dockerfile copies prisma/ from repo root for prisma generate — monorepo pattern, Railway build context must be repo root
- [18-02 worker-signals]: railway.toml uses cronSchedule not restartPolicyType — cron services exit after run
- [18-02 worker-signals]: predictLeadsGet() retries on 429 and AbortError only — other 4xx/5xx thrown immediately as non-retryable
- [18-03 signal-adapters]: SignalInput defined in shared src/types.ts — avoids circular deps, single source of truth for all adapters
- [18-03 signal-adapters]: 404 from PredictLeads returns costUsd=0 — no budget charge for unknown domains
- [18-03 signal-adapters]: fetchJobOpenings returns totalJobCount for hiring spike detection (>10 threshold) — no extra API call needed
- [18-03 signal-adapters]: checkAndFlagHighIntent sets isHighIntent=false when distinctTypes < 2 — actively clears stale flags as signals expire
- [18-03 signal-adapters]: upsert extends expiresAt on re-detection — active signals get fresh 90-day TTL each cycle
- [18-04 cycle-orchestration]: Shared db.ts singleton — avoids N PrismaClient connection pools when N modules each import prisma
- [18-04 cycle-orchestration]: Fisher-Yates domain shuffle — ensures fair budget coverage when a workspace hits its cap mid-cycle
- [18-04 cycle-orchestration]: ADMIN_SLACK_CHANNEL_ID for budget alerts, not workspace channel — budget alerts are operational/admin, not client-facing
- [18-04 cycle-orchestration]: Hiring spike uses externalId=null — synthetic aggregate signal, always creates (no stable external ID to dedup on)
- [19-01 schema]: Signal campaigns use simplified 3-state machine (draft -> active -> paused/archived) independent of static 7-state machine
- [19-01 schema]: SignalCampaignLead uses soft ref for signalEventId (no FK) — consistent with project pattern of avoiding FK constraints
- [19-01 schema]: icpCriteria stored as JSON string in TEXT column — consistent with existing JSON-in-string pattern throughout schema
- [19-01 schema]: createCampaign only writes signal fields when type=signal — static campaigns remain unaffected by new optional fields
- [19-02 campaign-agent]: icpCriteria passed as JSON string throughout — operations.ts accepts string | null, not Record<string, unknown>
- [19-02 campaign-agent]: activateSignalCampaign bypasses operations state machine to allow direct DB update with signalEmailBisonCampaignId + lastSignalProcessedAt in one transaction
- [19-02 campaign-agent]: extractIcpCriteria uses claude-haiku-4-5 — ICP extraction is a simple structured task; signal type validation happens before LLM call to fail fast on invalid requests
- [19-02 campaign-agent]: maxSteps bumped 8 -> 10 in Campaign Agent to provide headroom for signal campaign creation (ICP extraction adds one step)
- [20-01 writer-agent]: PVP framework moved from shared quality rules into PVP-only strategy block — Creative Ideas, One-liner, Custom no longer forced to use PVP structure
- [20-01 writer-agent]: groundedIn is hard-reject — if creative idea cannot be traced to real offering (coreOffers/differentiators/caseStudies/KB), it must NOT be output; fewer than 3 drafts acceptable
- [20-01 writer-agent]: Signal context injected via [INTERNAL SIGNAL CONTEXT] prefix in user message — writer uses for angle selection but NEVER surfaces to recipient copy
- [20-01 writer-agent]: Tiered KB uses strategy+industry tags first (e.g. creative-ideas-branded-merchandise), fallback to strategy-only, then always-run general best practices
- [20-01 writer-agent]: generateKBExamples tool returns text for admin review only — does NOT auto-ingest; admin runs ingest-document.ts CLI after review

### Blockers/Concerns

- PredictLeads paid pricing beyond 100 free requests/month is demo-only — confirm before Phase 18 polling frequency design
- AI Ark People Search endpoint LOW confidence — verify in AI Ark dashboard before Phase 16 implementation (fallback: skip DISC-03 if unconfirmed)
- Vercel at 2-cron Hobby limit — signal worker must run on Railway only, not Vercel

### Pending Todos

None.

## Session Continuity

Last session: 2026-03-04
Stopped at: Completed 19-02-PLAN.md (Phase 19 Plan 02 -- Campaign Agent signal tools: createSignalCampaign, activateSignalCampaign, pauseResumeSignalCampaign)
Resume file: .planning/phases/19-evergreen-signal-campaign-auto-pipeline/19-03-PLAN.md
