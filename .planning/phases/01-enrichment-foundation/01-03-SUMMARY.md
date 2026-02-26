---
phase: 01-enrichment-foundation
plan: 03
subsystem: async-queue
tags: [prisma, typescript, vitest, enrichment, async-queue, batch-processing]

# Dependency graph
requires:
  - EnrichmentJob Prisma model (from Plan 01)
  - Provider, EntityType type definitions (from Plan 01)
  - enrichmentJob mock model in test setup (from Plan 01)
provides:
  - enqueueJob() — creates pending EnrichmentJob row with JSON-serialized entity IDs
  - processNextChunk() — picks up oldest pending job, processes one chunk, updates progress
  - POST /api/enrichment/jobs/process — HTTP trigger for chunk processing (Vercel Cron compatible)

affects:
  - 02-provider-adapters (Phase 2 wires provider logic into processNextChunk via onProcess callback)
  - 04-batch-enrichment (orchestrates jobs via enqueueJob + processNextChunk)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Chunk-based processing — job tracks processedCount offset, each call slices next chunk from entityIds array
    - onProcess callback pattern — queue mechanics testable without actual provider logic in Phase 1
    - Error accumulation — per-entity errors logged in errorLog JSON array, job continues; only catastrophic errors fail the whole job
    - Atomic status transitions — running status prevents concurrent workers from picking up the same job

key-files:
  created:
    - src/lib/enrichment/queue.ts
    - src/app/api/enrichment/jobs/process/route.ts
    - src/__tests__/enrichment-queue.test.ts

key-decisions:
  - "onProcess callback defaults to no-op in Phase 1 — separates queue mechanics from provider logic, enables isolated testing"
  - "Job returns to pending (not running) between chunks — ensures cron/retry picks it up naturally without special logic"
  - "Individual entity errors accumulated in errorLog without failing the job — allows partial success on large batches"

patterns-established:
  - "Chunk processing pattern: findFirst(pending) -> update(running) -> process chunk -> update(processedCount, pending|complete)"
  - "Error accumulation pattern: merge new errors with existing errorLog JSON array to preserve cross-chunk error history"
  - "API route wraps library function — route.ts is a thin wrapper, business logic lives in queue.ts"

requirements-completed: [ENRICH-07]

# Metrics
duration: 2min
completed: 2026-02-26
---

# Phase 1 Plan 03: Async Job Queue Summary

**DB-backed chunk-processing queue using EnrichmentJob rows with onProcess callback pattern enabling Vercel-timeout-safe batch enrichment**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-26T16:50:36Z
- **Completed:** 2026-02-26T16:52:30Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Created `src/lib/enrichment/queue.ts` with `enqueueJob` and `processNextChunk` — the core async queue library
- Implemented full job lifecycle: enqueue (pending) -> pick up (running) -> process chunk -> back to pending (more work) or complete (done)
- `enqueueJob` validates non-empty entity IDs, serializes to JSON, defaults chunkSize to 50
- `processNextChunk` uses `orderBy: createdAt asc` to process oldest jobs first (FIFO)
- `onProcess` callback pattern separates queue mechanics from provider logic — Phase 2 passes real provider adapters; Phase 1 tests use no-op
- Per-entity errors logged in `errorLog` JSON array without failing the job; errors from prior chunks are merged (preserved across chunks)
- Created `POST /api/enrichment/jobs/process` route — thin wrapper around `processNextChunk`, ready for Vercel Cron
- 9 unit tests covering all key scenarios: pending job creation, empty entityIds rejection, default chunkSize, no-jobs (null), full-chunk-to-complete, partial-chunk-to-pending, onProcess callback invocation, per-entity error logging, processedCount offset resume

## Task Commits

Each task was committed atomically:

1. **Task 1: Queue library** - `af27594` (feat)
2. **Task 2: Process API route and unit tests** - `bee03c9` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `src/lib/enrichment/queue.ts` — enqueueJob and processNextChunk queue library
- `src/app/api/enrichment/jobs/process/route.ts` — POST handler wrapping processNextChunk
- `src/__tests__/enrichment-queue.test.ts` — 9 unit tests for full queue lifecycle

## Decisions Made

- `onProcess` callback defaults to no-op in Phase 1 — this cleanly separates queue mechanics from provider logic, enabling isolated unit testing of the queue without mocking HTTP calls to Prospeo, AI Ark, etc.
- Job returns to "pending" (not "running") between chunks — natural FIFO pickup by cron without special "resume running jobs" logic.
- Individual entity errors are accumulated in errorLog without failing the job — large batches can partially succeed; failed entities are visible for retry later.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Pre-existing TypeScript error in `src/__tests__/emailbison-client.test.ts` (fetch mock type mismatch) — unrelated to this plan, out of scope per deviation rules, already logged from Plan 01.

## User Setup Required

None - no external service configuration required. Queue is ready; Vercel Cron configuration for `/api/enrichment/jobs/process` happens when batch enrichment (Phase 2) is wired up.

## Next Phase Readiness

- enqueueJob and processNextChunk are the stable contracts Phase 2 provider adapters build against
- POST /api/enrichment/jobs/process is ready for Vercel Cron — just needs authentication header check added in Phase 2
- onProcess callback interface is established: `(entityId: string, job: { entityType: string; provider: string }) => Promise<void>`
- No blockers for Plan 04 (batch enrichment orchestration)

---
*Phase: 01-enrichment-foundation*
*Completed: 2026-02-26*

## Self-Check: PASSED

- All 3 required files exist on disk (queue.ts, route.ts, enrichment-queue.test.ts)
- Both task commits (af27594, bee03c9) verified in git log
- 9/9 tests passing (verified via vitest run)
- TypeScript compiles cleanly for new files (pre-existing emailbison-client.test.ts error unrelated)
