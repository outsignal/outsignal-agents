# Phase 41 Context: AI Cron Migration

**Phase Goal:** retry-classification, generate-insights, and snapshot-metrics run as Trigger.dev scheduled tasks — eliminating the silent failures caused by multi-workspace Anthropic chains exceeding Vercel's 60s ceiling.

**Requirements:** CRON-01, CRON-02, CRON-03

---

## Decisions

### 1. Each cron becomes a `schedules.task()` in Trigger.dev

All three crons migrate from cron-job.org + Vercel API route pattern to Trigger.dev `schedules.task()`. Schedules match current cron-job.org timing.

### 2. retry-classification: No batch size limit

Currently limited to ~10-20 unclassified replies per run due to Vercel 60s timeout. With Trigger.dev, process ALL unclassified replies in a single run. Use `anthropicQueue` for rate limiting.

Source: `src/app/api/cron/retry-classification/route.ts`

### 3. generate-insights: Per-workspace fan-out

Currently runs workspaces sequentially, often timing out at workspace 3-4. With Trigger.dev, fan out to process all workspaces in parallel using `batchTrigger` or Promise.all pattern. Each workspace's insight generation uses `anthropicQueue`.

Source: `src/app/api/cron/generate-insights/route.ts`

### 4. snapshot-metrics: Full AI classification

Currently skips or truncates AI body element classification due to timeout risk. With Trigger.dev, run full classification on all campaign snapshots. Uses `anthropicQueue`.

Source: `src/app/api/cron/snapshot-metrics/route.ts`

### 5. All three use anthropicQueue

Every task that calls Anthropic must use `anthropicQueue` (concurrencyLimit: 3) from `trigger/queues.ts`. This prevents rate limiting across concurrent tasks.

### 6. Vercel API routes kept as manual triggers

The existing Vercel API route endpoints stay temporarily — they're useful as manual trigger endpoints for debugging. But cron-job.org stops calling them. The routes can be removed in Phase 43 (decommission).

### 7. cron-job.org jobs disabled same day

Each cron-job.org job is disabled the same day its Trigger.dev scheduled task is verified stable. No double-processing window. Use the cron-job.org REST API for programmatic job management.

### 8. Schedule matching

| Cron | Current Schedule (cron-job.org) | Trigger.dev Schedule |
|------|-------------------------------|---------------------|
| retry-classification | Every 30 min | `"*/30 * * * *"` |
| generate-insights | Every 6 hours | `"0 */6 * * *"` |
| snapshot-metrics | Daily at midnight UTC | `"0 0 * * *"` |

Note: Exact current schedules should be verified from cron-job.org during research — the above are estimates.

---

## Architecture Summary

```
trigger/retry-classification.ts     → schedules.task(), cron: "*/30 * * * *"
  └── Query Reply where intent IS NULL → classifyReply() each → update DB

trigger/generate-insights.ts        → schedules.task(), cron: "0 */6 * * *"
  └── Fan out per workspace → generate insight per workspace → save to DB

trigger/snapshot-metrics.ts         → schedules.task(), cron: "0 0 * * *"
  └── Snapshot all campaigns → AI classify body elements → save to DB
```

## Scope Boundaries

- Three new task files in `trigger/`
- No modifications to the existing Vercel API routes (keep for manual use)
- No changes to the classification, insights, or metrics logic itself — just the execution wrapper
- cron-job.org job disabling is a manual step (or scripted via API)

## Deferred Ideas

_None identified._
