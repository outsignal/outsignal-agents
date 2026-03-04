---
phase: 19-evergreen-signal-campaign-auto-pipeline
plan: 03
subsystem: api
tags: [prisma, apollo, icp-scoring, emailbison, linkedin, slack, pipeline]

# Dependency graph
requires:
  - phase: 19-01-schema
    provides: Campaign signal fields (type, signalTypes, icpCriteria, dailyLeadCap, icpScoreThreshold, signalEmailBisonCampaignId, lastSignalProcessedAt, targetListId), SignalCampaignLead junction model, SignalEvent model
  - phase: 19-02-campaign-agent
    provides: createSignalCampaign, activateSignalCampaign tools that set up campaign correctly before pipeline processes it
  - phase: 16-discovery-sources
    provides: apolloAdapter.search with companyDomains filter
  - phase: 17-leads-agent-discovery-upgrade
    provides: stageDiscoveredPeople, deduplicateAndPromote, enrichment pipeline
  - phase: 18-signal-monitoring
    provides: SignalEvent records that pipeline reads

provides:
  - processSignalCampaigns() — core signal-to-lead pipeline function in src/lib/pipeline/signal-campaigns.ts
  - POST /api/pipeline/signal-campaigns/process — Railway worker trigger endpoint

affects:
  - 19-04-signal-dashboard (uses processSignalCampaigns result shape for display)
  - 19-05-cron-integration (Railway worker calls POST /api/pipeline/signal-campaigns/process)
  - 19-06-testing (tests processSignalCampaigns end-to-end)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Signal-to-lead pipeline: SignalEvent -> Apollo discovery -> staging -> dedup/promote -> ICP score -> SignalCampaignLead -> target list -> deploy
    - Daily cap enforcement via count query on SignalCampaignLead.addedAt with outcome="added"
    - Campaign-level domain dedup: skip companyDomains already in SignalCampaignLead for this campaign
    - Per-person ICP score failure isolation: catch per-person, skip on error
    - Pipeline auth pattern: x-pipeline-secret header with timing-safe comparison vs PIPELINE_INTERNAL_SECRET

key-files:
  created:
    - src/lib/pipeline/signal-campaigns.ts
    - src/app/api/pipeline/signal-campaigns/process/route.ts
  modified: []

key-decisions:
  - "processSignalCampaigns auto-updates lastSignalProcessedAt even when 0 signals found — prevents re-processing old signals on every run"
  - "Domain dedup via SignalCampaignLead.companyDomain — prevents reprocessing a domain that already produced leads in this campaign across multiple signal cycles"
  - "ICP scoring uses forceRecrawl=false — relies on cached company crawlMarkdown rather than triggering fresh Firecrawl scrapes per pipeline run"
  - "Apollo fetches 2x the daily cap for a scoring buffer — extra leads are scored but filtered at threshold; no wasted API cost (Apollo search is free)"
  - "Below-threshold leads recorded in SignalCampaignLead with outcome=below_threshold — provides audit trail and prevents repeated scoring across runs"
  - "Pipeline auth fails closed — PIPELINE_INTERNAL_SECRET unset means all requests rejected, not permitted"
  - "LinkedIn stagger: 15 minutes per deployed lead — respects LinkedIn rate limits and matches existing queue patterns"

patterns-established:
  - "Pipeline processor pattern: findMany active campaigns -> per-campaign try/catch -> aggregate PipelineResult"
  - "Signal dedup window: signals since lastSignalProcessedAt (default 7h back) with distinct companyDomain to collapse multiple signal types per company"
  - "Deploy throttle: 100ms between EmailBison createLead calls, same as existing deployEmailChannel pattern"

requirements-completed: [PIPE-03, PIPE-04, PIPE-05, PIPE-06]

# Metrics
duration: 3min
completed: 2026-03-04
---

# Phase 19 Plan 03: Signal Campaign Pipeline Processor Summary

**Automated signal-to-lead pipeline connecting SignalEvents to Apollo discovery, ICP scoring, EmailBison/LinkedIn deployment, and batch Slack notifications — with daily cap and campaign-level dedup**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-04T22:25:34Z
- **Completed:** 2026-03-04T22:28:14Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Built processSignalCampaigns() — the core Phase 19 pipeline that runs end-to-end without admin intervention
- Created POST /api/pipeline/signal-campaigns/process with timing-safe PIPELINE_INTERNAL_SECRET auth
- Connected all existing adapters (Apollo, staging, dedup/promote, ICP scorer, EmailBison client, LinkedIn queue) into a single orchestrated flow

## Task Commits

Each task was committed atomically:

1. **Task 1: Build signal campaign pipeline processor** - `c81b36a` (feat)
2. **Task 2: Create pipeline trigger API route** - `ab478e4` (feat)

**Plan metadata:** (committed with this SUMMARY)

## Files Created/Modified
- `src/lib/pipeline/signal-campaigns.ts` - processSignalCampaigns() — full pipeline: cap check, signal lookup, domain dedup, Apollo discovery, staging, promote, ICP score, record, list add, EmailBison deploy, LinkedIn queue, Slack notification
- `src/app/api/pipeline/signal-campaigns/process/route.ts` - POST endpoint with x-pipeline-secret auth, maxDuration=60s, force-dynamic

## Decisions Made
- processSignalCampaigns updates lastSignalProcessedAt even when 0 signals found, preventing re-processing old signals on repeated calls
- Domain-level dedup via SignalCampaignLead.companyDomain prevents the same company from being processed across multiple signal cycles
- ICP scoring uses forceRecrawl=false to rely on cached crawlMarkdown — avoids triggering fresh Firecrawl scrapes during pipeline runs
- Apollo fetches 2× the daily cap as a scoring buffer since Apollo search is free
- Below-threshold leads are still recorded in SignalCampaignLead (outcome=below_threshold) for audit trail and to prevent re-scoring
- PIPELINE_INTERNAL_SECRET unset = fail-closed (all requests rejected)

## Deviations from Plan

None — plan executed exactly as written. One minor observation: the plan's interface spec showed `enqueueAction` returning `{ id: string }`, but the actual implementation returns `string`. The code was written to match the actual implementation (no assignment of return value needed).

## Issues Encountered

None.

## User Setup Required

One new environment variable required for the trigger endpoint:

- `PIPELINE_INTERNAL_SECRET` — shared secret between Railway worker and this endpoint. Generate with `openssl rand -hex 32`. Set on both Vercel (admin dashboard) and Railway (worker-signals service).

## Next Phase Readiness

- processSignalCampaigns() is complete and ready for Phase 19 Plan 04 (UI) to surface results
- The Railway worker-signals service needs to call POST /api/pipeline/signal-campaigns/process after its polling cycle
- PIPELINE_INTERNAL_SECRET env var must be provisioned on both Vercel and Railway before the pipeline goes live

---
*Phase: 19-evergreen-signal-campaign-auto-pipeline*
*Completed: 2026-03-04*
