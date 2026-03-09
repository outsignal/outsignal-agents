---
phase: 24-campaign-analytics-engine
plan: 01
subsystem: analytics
tags: [prisma, cron, emailbison, linkedin, ai-sdk, anthropic, cached-metrics]

# Dependency graph
requires:
  - phase: 23-reply-storage-classification
    provides: Reply model with intent/sentiment classification and sequenceStep field
provides:
  - CachedMetrics schema with daily campaign snapshots (date + metricKey fields)
  - snapshotWorkspaceCampaigns function for daily metric collection
  - detectCopyStrategy AI classification utility
  - backfillCopyStrategies for legacy campaigns with null copyStrategy
  - /api/cron/snapshot-metrics endpoint for cron-job.org
affects: [24-02, 24-03, 25-copy-analysis, 26-benchmarking]

# Tech tracking
tech-stack:
  added: []
  patterns: [daily-snapshot-cron, ai-classification-one-shot, cachedmetrics-upsert]

key-files:
  created:
    - src/lib/analytics/snapshot.ts
    - src/lib/analytics/strategy-detect.ts
    - src/app/api/cron/snapshot-metrics/route.ts
  modified:
    - prisma/schema.prisma

key-decisions:
  - "CachedMetrics evolved with metricKey+date fields (Option A from RESEARCH.md) — model was unused so safe to modify"
  - "Default empty strings for metricKey and date to preserve backward compatibility with any existing constraint expectations"
  - "Rates rounded to 2 decimal places for readable storage"

patterns-established:
  - "CachedMetrics upsert pattern: workspace_metricType_metricKey_date compound unique key"
  - "Snapshot data shape: CampaignSnapshot interface with email + LinkedIn + classification metrics"

requirements-completed: [ANAL-01, ANAL-04]

# Metrics
duration: 3min
completed: 2026-03-09
---

# Phase 24 Plan 01: Data Foundation Summary

**Daily campaign snapshot cron with EB email metrics, LinkedIn action counts, Reply classification stats, and AI copy strategy detection using Haiku**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-09T20:28:31Z
- **Completed:** 2026-03-09T20:31:55Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- CachedMetrics schema evolved with metricKey and date fields, updated unique constraint, and query indexes
- Core snapshot logic pulls EmailBison campaign stats, computes LinkedIn metrics from LinkedInAction records, aggregates Reply classification stats, and upserts daily rows per campaign
- AI copy strategy detection classifies email body text into creative-ideas/pvp/one-liner/custom using Claude Haiku
- Cron endpoint at /api/cron/snapshot-metrics ready for cron-job.org (per-workspace invocation, cron auth, 60s max duration)

## Task Commits

Each task was committed atomically:

1. **Task 1: Evolve CachedMetrics schema and build snapshot logic** - `56ff204` (feat)
2. **Task 2: Create cron endpoint with strategy backfill integration** - `28b5955` (feat)

## Files Created/Modified
- `prisma/schema.prisma` - Added metricKey, date fields and updated unique constraint + indexes on CachedMetrics
- `src/lib/analytics/snapshot.ts` - Core snapshot logic: EB pull + LinkedIn compute + Reply stats + CachedMetrics upsert
- `src/lib/analytics/strategy-detect.ts` - AI copy strategy detection + backfill utility
- `src/app/api/cron/snapshot-metrics/route.ts` - Cron endpoint with auth, workspace param, snapshot + backfill

## Decisions Made
- CachedMetrics evolved with metricKey+date fields (Option A from RESEARCH.md) -- model was unused so safe to modify via db push
- Default empty strings for metricKey and date to preserve backward compatibility
- Rates rounded to 2 decimal places for storage efficiency
- Removed maxTokens from generateText call -- not supported in current AI SDK version

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed unsupported maxTokens parameter from generateText**
- **Found during:** Task 1 (strategy-detect.ts)
- **Issue:** AI SDK generateText does not accept maxTokens in CallSettings type
- **Fix:** Removed the parameter, letting the model determine response length naturally
- **Files modified:** src/lib/analytics/strategy-detect.ts
- **Verification:** TypeScript compiles cleanly
- **Committed in:** 56ff204 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Trivial parameter removal. No functional impact since the prompt already constrains output to a single word.

## Issues Encountered
None

## User Setup Required
Cron-job.org configuration needed for each workspace:
- URL: `https://admin.outsignal.ai/api/cron/snapshot-metrics?workspace={slug}`
- Method: GET
- Header: `Authorization: Bearer <CRON_SECRET>`
- Schedule: Daily (stagger across 7 workspaces)

## Next Phase Readiness
- CachedMetrics now populated daily with campaign snapshots
- Ready for Plan 02 (Analytics API routes) to query this data
- Ready for Plan 03 (Analytics UI) to display campaign rankings

---
*Phase: 24-campaign-analytics-engine*
*Completed: 2026-03-09*
