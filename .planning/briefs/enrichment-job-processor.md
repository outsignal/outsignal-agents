# Brief: Enrichment Job Processor — No Automated Processing

## Problem
Enrichment jobs are created in the `EnrichmentJob` table with status `pending`, but **nothing processes them**. The processor endpoint exists at `POST /api/enrichment/jobs/process` but it needs to be called repeatedly to process chunks. No cron or Trigger.dev task calls it.

**Result:** 8 enrichment jobs spanning March 24 — April 2 were stuck at `pending` with 0 processed, totalling 1,800+ people that never got email verification. Every lead promoted through `discovery-promote.js` creates an enrichment job that silently goes nowhere.

This is a **critical pipeline break** — leads are promoted but never enriched, meaning email campaigns launch with unverified emails (or don't launch at all because emails are missing).

## Current Architecture
- `scripts/cli/discovery-promote.js` → creates `EnrichmentJob` record with `status: pending`
- `POST /api/enrichment/jobs/process` → picks up next pending job, processes one chunk (25 people) through the waterfall (Prospeo → AI Ark → FindyMail → BounceBan), updates processedCount
- **Gap:** Nothing calls the process endpoint. It requires repeated calls until `done: true`.

## Fix Required

Create a Trigger.dev scheduled task that:

1. **Polls every 5 minutes** for pending enrichment jobs
2. Calls `POST /api/enrichment/jobs/process` with the API secret
3. Keeps calling until the response says `done: true` or `no pending jobs`
4. Handles rate limiting between chunks (200ms delay)
5. Logs progress: "Enrichment: processed 25/638 for 1210-solutions"
6. Alerts via Slack (#outsignal-ops) when a job completes or fails

### Alternative approach
Instead of calling the API endpoint, move the processing logic into a Trigger.dev task directly. The task would:
1. Query for pending `EnrichmentJob` records
2. Process chunks inline (import `processNextChunk` from `src/lib/enrichment/queue`)
3. Loop until done
4. This avoids the API roundtrip and auth overhead

The Trigger.dev approach is cleaner since the enrichment waterfall makes external API calls (Prospeo, AI Ark, BounceBan) which can be slow — Trigger.dev handles long-running tasks better than Vercel API routes (which have execution time limits).

## Key Files
- `src/app/api/enrichment/jobs/process/route.ts` — existing chunk processor
- `src/lib/enrichment/queue.ts` — `processNextChunk()` function
- `src/lib/enrichment/waterfall.ts` — `enrichEmail()`, `enrichCompany()`, `createCircuitBreaker()`
- `trigger/` — where the new task should go

## Bugs Found During Code Review (2026-04-03)

The initial `trigger/enrichment-processor.ts` was built and reviewed. Four issues were identified that need fixing:

### BUG 1: Credit exhaustion orphans jobs permanently (CRITICAL)
**File:** `src/lib/enrichment/queue.ts` lines 121-128
**Problem:** When `isCreditExhaustion(err)` fires, the job is set to `status: "paused"` with NO `resumeAt`. The pickup query (lines 78-83) requires `resumeAt <= now()` — Prisma treats `null` as false for `lte`, so these jobs are stuck forever.
**Fix:** Set `resumeAt` to 1 hour from now on credit exhaustion pause:
```typescript
const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
await prisma.enrichmentJob.update({
  where: { id: job.id },
  data: {
    status: "paused",
    resumeAt: oneHourFromNow,
    processedCount: chunkStart + processedInChunk,
  },
});
```

### GAP 2: Stale "running" jobs never recovered
**File:** `trigger/enrichment-processor.ts` (add at top of run function) and/or `src/lib/enrichment/queue.ts`
**Problem:** If the task crashes mid-chunk, the job stays in `"running"` status permanently. `processNextChunk` only picks up `"pending"` or `"paused"` jobs. No recovery mechanism exists.
**Fix:** Add recovery query at the start of the task's run function:
```typescript
// Recover jobs stuck in "running" for >10 minutes (crashed previous run)
await prisma.enrichmentJob.updateMany({
  where: { status: "running", updatedAt: { lt: new Date(Date.now() - 10 * 60 * 1000) } },
  data: { status: "pending" },
});
```

### RISK 3: No elapsed-time guard — task can exceed maxDuration
**File:** `trigger/enrichment-processor.ts`
**Problem:** The `while(true)` loop processes chunks indefinitely. A job with 1,800 entities (36 chunks) could run for 30+ minutes. When maxDuration (300s) kills the task, the current job is left in "running" (see GAP 2).
**Fix:** Track elapsed time, break when approaching 240s:
```typescript
const startTime = Date.now();
const MAX_RUN_MS = 240_000; // 240s — leave 60s buffer before maxDuration kills us

while (true) {
  if (Date.now() - startTime > MAX_RUN_MS) {
    console.log(`${LOG_PREFIX} Approaching maxDuration, exiting loop`);
    break;
  }
  // ... rest of loop
}
```

### RISK 4: Race condition on concurrent pickup
**File:** `src/lib/enrichment/queue.ts` lines 76-91
**Problem:** `findFirst` + `update` to "running" are separate queries. Two overlapping task runs could pick up the same job.
**Fix:** Either add `concurrencyLimit: 1` on the Trigger.dev task definition, OR wrap the find+update in a Prisma `$transaction` with serializable isolation. Simplest fix is adding to the task:
```typescript
export const enrichmentProcessorTask = schedules.task({
  id: "enrichment-processor",
  cron: "*/5 * * * *",
  maxDuration: 300,
  // Prevent overlapping runs picking up the same job
  queue: { concurrencyLimit: 1 },
  // ...
});
```

## Success Criteria
1. Pending enrichment jobs are automatically processed without manual intervention
2. Processing starts within 5 minutes of job creation
3. Completion/failure alerts fire to Slack
4. No more orphaned pending jobs
5. Credit-exhaustion-paused jobs resume after 1 hour (BUG 1 fix)
6. Crashed jobs recover automatically after 10 minutes (GAP 2 fix)
7. Task exits gracefully before maxDuration (RISK 3 fix)
8. No duplicate processing from overlapping runs (RISK 4 fix)
