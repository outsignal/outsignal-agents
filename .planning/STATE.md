---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: Campaign Intelligence Hub
status: unknown
last_updated: "2026-03-10T09:37:19Z"
progress:
  total_phases: 21
  completed_phases: 20
  total_plans: 73
  completed_plans: 76
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-09)

**Core value:** Own the lead data pipeline end-to-end so we never pay for the same lead twice and can cancel the $300+/month Clay subscription.
**Current focus:** v3.0 Campaign Intelligence Hub — Phase 25 complete, Phase 26 next

## Current Position

Phase: 26 of 28 (Benchmarking)
Plan: 1 of 3
Status: Phase 25 complete, starting Phase 26
Last activity: 2026-03-10 — Completed 25-03 (Copy Tab UI)

Progress: [████░░░░░░] 35% (v3.0) -- Phase 25 complete (3/3 plans)

## Performance Metrics

**Velocity:**
- Total plans completed: 98 (v1.0: 22, v1.1: 40, v2.0: 26, v3.0: 10)
- Average duration: ~15 min
- Total execution time: ~22 hours

**Recent Trend:**
- v2.0 phases shipped in 1 day (2026-03-04)
- Trend: Stable

*Updated after each plan completion*

## Accumulated Context

### Decisions

- [23-01]: Used prisma db push instead of migrate dev due to existing migration drift — no data loss
- [23-01]: Single LLM call for intent + sentiment + objectionSubtype — cheaper and more consistent than separate calls
- [23-01]: No FK constraints on Reply model — consistent with project convention for soft links
- [23-02]: Outbound email snapshot: webhook uses sequence step position match, poll uses single-step campaign heuristic
- [23-02]: WebhookEvent ID captured and linked to Reply record for audit trail
- [23-03]: Raw SQL ($queryRawUnsafe) for stats distributions — Prisma groupBy cannot COALESCE override columns
- [23-03]: effectiveIntent/effectiveSentiment computed in API response — keeps UI logic simple
- [23-04]: All reply components are client components using nuqs for URL state management
- [23-04]: Side panel uses translate-x CSS transition instead of dialog/sheet for lightweight slide-out
- [23-04]: Stats charts kept compact as summary strip above main table content
- [v3.0 Roadmap]: Data-flows-downhill ordering — Reply -> Classification -> Aggregation -> Copy Analysis -> Benchmarking -> Insights -> Dashboard
- [v3.0 Roadmap]: Phase 25 (Copy Analysis) and Phase 26 (Benchmarking) can run in parallel — both depend on Phase 24 but not each other
- [v3.0 Roadmap]: Hub dashboard (Phase 28) is the final integration phase — reads from all pre-computed data, no raw aggregation at request time
- [v3.0 Roadmap]: CachedMetrics model (exists in schema, currently unused) designated for all pre-computed analytics storage
- [v3.0 Roadmap]: External cron via cron-job.org for analytics computation and insight generation — Vercel Hobby 2-cron limit already hit

- [24-01]: CachedMetrics evolved with metricKey+date fields (Option A) — model was unused, safe to modify via db push
- [24-01]: Default empty strings for metricKey/date for backward compat; rates rounded to 2 decimal places
- [24-01]: AI SDK generateText does not support maxTokens param — removed, prompt constrains output naturally
- [24-02]: Latest snapshot per campaign (not sum across days) since EB stats are cumulative
- [24-02]: Campaigns with <10 sends excluded for statistical significance
- [24-02]: Intent distribution per step always queried fresh from Reply table
- [24-03]: Analytics link placed in Email nav group after Replies — contextually grouped
- [24-03]: Expandable rows use client-side cache to avoid re-fetching step data on toggle

- [25-01]: Content hash (MD5) stored alongside body element flags in CachedMetrics for change detection
- [25-01]: Empty date string for body_elements metric type since elements are content-dependent not time-dependent

- [25-02]: Campaign-level emailsSent used as denominator for step-level reply rates (step-level sent not available)
- [25-02]: Global view deduplicates subject lines case-insensitively with weighted-average aggregation
- [25-02]: Composite score formula: (interestedRate * 0.6) + (replyRate * 0.4) for template ranking
- [25-02]: Low confidence threshold set at 20 total samples (with + without)

- [25-03]: Tab state persisted in URL via nuqs for deep-linkable Copy tab
- [25-03]: Vertical filter populated dynamically from workspaces API rather than hardcoded
- [25-03]: Performance tab data only fetched when active (lazy loading)
- [25-03]: Template detail panel uses translate-x slide-out pattern consistent with replies side panel

### Blockers/Concerns

- CachedMetrics model exists in schema but has zero usage — need to verify upsert behavior and unique constraints work as expected
- EmailBison webhook payload completeness — verify sequence_step and campaign_id are available for per-step analytics
- Cron-job.org 30s timeout — analytics aggregation must complete within that window
- ICP calibration needs 50+ data points per bucket — may take 2-3 months of data accumulation at current reply volume (~50-200/month)

### Pending Todos

None.

## Session Continuity

Last session: 2026-03-10
Stopped at: Completed 25-03-PLAN.md
Resume file: None
