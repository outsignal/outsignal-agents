---
phase: 60-intelligence-closed-loop
plan: 03
subsystem: agents
tags: [reply-analysis, trigger-dev, cron, memory, cli, prisma]

requires:
  - phase: 60-intelligence-closed-loop
    provides: analyzeWorkspace, analyzeCrossWorkspace, synthesizeInsights from reply-analysis.ts
  - phase: 54.1-agent-memory-write-back
    provides: appendToMemory utility with 200-line cap
  - phase: 60-02
    provides: appendToGlobalMemory for capped global-insights.md writes

provides:
  - CLI script for full reply analysis pipeline (scripts/run-reply-analysis.ts)
  - Sync script for hybrid Trigger.dev/local workflow (scripts/sync-insights-to-memory.ts)
  - Trigger.dev weekly cron at Monday 09:00 UTC (trigger/weekly-analysis.ts)

affects: [intelligence-closed-loop, agent-memory, weekly-automation]

tech-stack:
  added: []
  patterns: [hybrid-remote-local-sync, insight-db-storage-with-real-schema]

key-files:
  created:
    - scripts/run-reply-analysis.ts
    - scripts/sync-insights-to-memory.ts
    - trigger/weekly-analysis.ts
  modified: []

key-decisions:
  - "Insight DB storage uses real Insight schema (category, observation, evidence, confidence, actionType, dedupKey) not simplified type/content assumed by plan"
  - "Analysis results stored in evidence JSON field with globalInsights and workspaceInsights arrays"
  - "dedupKey format: weekly_analysis:{slug}:{YYYY-MM-DD} for idempotent reruns"
  - "Sync script uses dedupKey prefix startsWith filter instead of type field"
  - "Trigger.dev task uses anthropicQueue (shared with generate-insights) for LLM rate limiting"

patterns-established:
  - "Hybrid sync pattern: Trigger.dev stores to DB, local script pulls to .nova/memory/ files"
  - "CLI --dry-run pattern for cost-free validation of data pipelines"

requirements-completed: [INTEL-05, INTEL-06]

duration: 5min
completed: 2026-04-01
---

# Phase 60 Plan 03: Analysis Pipeline + Weekly Cron Summary

**CLI script for reply analysis with --dry-run, sync script for hybrid Trigger.dev workflow, and Monday 09:00 UTC weekly cron storing insights in Insight DB table**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-01T16:29:44Z
- **Completed:** 2026-04-01T16:34:44Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- CLI script runs full analysis pipeline across 6 workspaces (439 replies), with --dry-run validated against live data
- Sync script enables hybrid workflow: Trigger.dev stores analysis in DB remotely, local script pulls into .nova/memory/ files
- Weekly cron (Monday 09:00 UTC) automates the entire pipeline via Trigger.dev scheduled task

## Task Commits

Each task was committed atomically:

1. **Task 1: Create reply analysis CLI script with --dry-run support** - `18e05152` (feat)
2. **Task 2: Create sync-insights-to-memory script** - `feda3cc2` (feat)
3. **Task 3: Create weekly-analysis Trigger.dev cron task** - `89f91c1a` (feat)

## Files Created/Modified
- `scripts/run-reply-analysis.ts` - Full pipeline CLI: gather data, synthesize via LLM, write to memory + DB
- `scripts/sync-insights-to-memory.ts` - Pulls weekly_analysis Insight rows from DB into local memory files
- `trigger/weekly-analysis.ts` - Trigger.dev scheduled task, Monday 09:00 UTC, anthropicQueue

## Decisions Made
- Adapted Insight DB storage to use the real schema (required fields: category, observation, evidence, confidence, actionType, actionDescription, dedupKey) instead of the simplified type/content schema assumed by the plan interfaces
- Analysis results stored in the `evidence` JSON field with `globalInsights` and `workspaceInsights` arrays, making them parseable by the sync script
- dedupKey format `weekly_analysis:{slug}:{YYYY-MM-DD}` ensures idempotent reruns on the same day
- Sync script filters by `dedupKey startsWith "weekly_analysis:"` instead of a non-existent `type` field
- Weekly cron uses shared anthropicQueue for LLM rate limiting (same queue as generate-insights)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Adapted Insight DB storage to real schema**
- **Found during:** Task 1 (CLI script creation)
- **Issue:** Plan assumed simple Insight schema with `type` and `content` fields. Real schema has required fields: `category`, `observation`, `evidence`, `confidence`, `actionType`, `actionDescription`, `dedupKey`
- **Fix:** Used real schema fields, storing analysis results in `evidence` JSON field, using `dedupKey` prefix for filtering instead of `type` field
- **Files modified:** scripts/run-reply-analysis.ts, scripts/sync-insights-to-memory.ts, trigger/weekly-analysis.ts
- **Verification:** --dry-run passes, tsc --noEmit clean
- **Committed in:** All three task commits

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Schema adaptation was necessary for correctness. No scope creep. All functionality preserved.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required. Trigger.dev task requires `npx trigger.dev@latest deploy` to activate the weekly cron.

## Next Phase Readiness
- Full analysis pipeline operational: CLI for local runs, Trigger.dev cron for automated weekly runs
- Memory files will be populated after first full run (without --dry-run)
- Sync script ready for pulling remote Trigger.dev results to local memory files
- Phase 60 (Intelligence Closed Loop) is now complete

---
*Phase: 60-intelligence-closed-loop*
*Completed: 2026-04-01*
