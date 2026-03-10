---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: Campaign Intelligence Hub
status: unknown
last_updated: "2026-03-10T12:30:00Z"
progress:
  total_phases: 23
  completed_phases: 21
  total_plans: 78
  completed_plans: 80
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-09)

**Core value:** Own the lead data pipeline end-to-end so we never pay for the same lead twice and can cancel the $300+/month Clay subscription.
**Current focus:** v3.0 Campaign Intelligence Hub — Phase 27 in progress

## Current Position

Phase: 28 of 28 (Intelligence Hub Dashboard)
Plan: 1 of 2 -- COMPLETE
Status: Phase 28 in progress (1/2 plans)
Last activity: 2026-03-10 — Completed 28-01 (Hub Page Scaffold with KPI Row & Bento Grid)

Progress: [████████░░] 80% (v3.0) -- Phase 28 plan 1/2 complete

## Performance Metrics

**Velocity:**
- Total plans completed: 103 (v1.0: 22, v1.1: 40, v2.0: 26, v3.0: 15)
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

- [26-01]: Raw SQL ($queryRawUnsafe) for ICP calibration -- Prisma cannot express cross-model JOIN on email+workspace for grouped bucket aggregation
- [26-01]: Interested count sourced from Reply table intent field rather than CachedMetrics snapshot -- more accurate for per-signal-type breakdown
- [26-01]: Bounce rate treated as normal metric in reference bands -- UI handles inverted display

- [26-02]: Recharts BarChart with dual bars (replyRate + interestedRate) for ICP bucket visualization
- [26-02]: Global toggle triggers re-fetch rather than client-side filtering for accurate server-computed aggregations
- [26-02]: Analytics page tab logic changed from binary (performance vs copy) to explicit activeTab state for 3 tabs

- [27-01]: No maxTokens param on generateObject -- AI SDK limitation per decision 24-01
- [27-01]: Latest snapshot per campaign for week-over-week averages (EB stats cumulative per decision 24-02)
- [27-01]: Dedup key pattern: category:actionType:entityId for deterministic 2-week dismissed window

- [27-02]: All 4 action types execute on approve (admin confirms in UI before calling PATCH)
- [27-02]: pause_campaign updates local campaign status only -- EmailBison API pause not available
- [27-02]: ICP threshold and signal targeting are recommendation-only actions (no auto-modify)
- [27-02]: copy_review_flag persisted as CachedMetrics entry for cross-feature visibility
- [27-02]: Weekly digest sent from cron endpoint after each workspace's insight generation

- [28-01]: Reused AnalyticsFilters component for Intelligence Hub filters instead of custom implementation
- [28-01]: KPI data sourced from 3 parallel API calls (campaigns, reply stats, insights) rather than dedicated KPI endpoint
- [28-01]: Top workspace computed by averaging reply rates per workspace across campaigns

### Blockers/Concerns

- CachedMetrics model exists in schema but has zero usage — need to verify upsert behavior and unique constraints work as expected
- EmailBison webhook payload completeness — verify sequence_step and campaign_id are available for per-step analytics
- Cron-job.org 30s timeout — analytics aggregation must complete within that window
- ICP calibration needs 50+ data points per bucket — may take 2-3 months of data accumulation at current reply volume (~50-200/month)

### Pending Todos

None.

## Session Continuity

Last session: 2026-03-10
Stopped at: Completed 28-01-PLAN.md
Resume file: None
