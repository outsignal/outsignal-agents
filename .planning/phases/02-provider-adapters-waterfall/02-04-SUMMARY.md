---
phase: 02-provider-adapters-waterfall
plan: "04"
subsystem: enrichment-pipeline
tags: [waterfall, circuit-breaker, cost-cap, queue, normalizer, integration]
dependency_graph:
  requires: ["02-01", "02-02", "02-03"]
  provides: ["enrichEmail", "enrichCompany", "processNextChunk-wired", "POST-enrichment-run"]
  affects: ["03-enrichment-dashboard"]
tech_stack:
  added: []
  patterns:
    - "Waterfall provider fallback with circuit breaker"
    - "DAILY_CAP_HIT exception as control-flow for job pausing"
    - "Inline AI normalization after provider writes"
    - "Fresh circuit breaker per queue invocation"
key_files:
  created:
    - src/lib/enrichment/waterfall.ts
    - src/app/api/enrichment/run/route.ts
  modified:
    - src/lib/enrichment/log.ts
    - src/lib/enrichment/queue.ts
    - src/app/api/enrichment/jobs/process/route.ts
decisions:
  - "No LinkedIn URL → only Prospeo attempted (LeadMagic and FindyMail require LinkedIn URL, their adapters return null early anyway)"
  - "email field on Person is String @unique (never null) — run trigger relies on dedup gate inside waterfall to skip already-enriched people"
  - "DAILY_CAP_HIT thrown as Error, caught by processNextChunk, sets resumeAt = midnight UTC next day"
  - "Circuit breaker is in-memory per-invocation — resets between cron calls, protects only within a batch"
metrics:
  duration: "3 min"
  completed: "2026-02-26"
  tasks_completed: 2
  files_changed: 5
---

# Phase 2 Plan 4: Waterfall Orchestration + Queue Integration Summary

**One-liner:** End-to-end enrichment pipeline wiring Prospeo/LeadMagic/FindyMail email waterfall and AI Ark/Firecrawl company waterfall with circuit breaker, cost cap, dedup, and inline AI normalizers.

## What Was Built

### waterfall.ts — Core orchestrators

Two exported async functions connect all provider adapters into the enrichment pipeline:

**`enrichEmail(personId, input, breaker, workspaceSlug?)`**
- Waterfall order: Prospeo → LeadMagic → FindyMail (stops at first non-null email)
- When no LinkedIn URL provided: only Prospeo is tried (name+company fallback). LeadMagic and FindyMail both require LinkedIn URL and skip early anyway — this avoids unnecessary API calls.
- Per-provider: circuit breaker check → dedup gate → daily cap check → call with retry (429 backoff) → merge → normalizers

**`enrichCompany(domain, breaker, workspaceSlug?)`**
- Waterfall order: AI Ark → Firecrawl (stops at first provider returning any data field)
- Creates company DB record if it doesn't exist yet (on first successful provider result)
- Same error handling pattern as enrichEmail

**Both functions apply:**
- Circuit breaker: skips provider after 5 consecutive failures within a batch
- Exponential backoff on 429: `Math.pow(2, attempt) * 1000` → 1s, 2s, 4s (3 max retries)
- `DAILY_CAP_HIT` thrown when daily cap reached (queue catches and pauses job)
- Normalizers run inline after writes: `classifyJobTitle` + `classifyCompanyName` (person), `classifyIndustry` + `classifyCompanyName` (company)
- Seniority stored in person's `enrichmentData` JSON (no dedicated DB column)

### log.ts — workspaceSlug support

Added optional `workspaceSlug` parameter to `recordEnrichment` params and passes through to `prisma.enrichmentLog.create`. Enables cost dashboard queries by workspace.

### queue.ts — Paused job handling

- `processNextChunk` query now picks up both `status: "pending"` AND `status: "paused"` jobs where `resumeAt <= now`
- `DAILY_CAP_HIT` catch block pauses job: sets `status: "paused"`, `resumeAt = midnight UTC tomorrow`, and `processedCount` to current position
- `onProcess` callback receives `workspaceSlug` from job record

### jobs/process/route.ts — Wired waterfall

Replaced no-op placeholder with real waterfall invocation. Creates a fresh `CircuitBreaker` per request, then dispatches to `enrichEmail` or `enrichCompany` based on `job.entityType`. Entity lookup (person/company DB fetch) happens inside the callback.

### enrichment/run/route.ts — Batch trigger

`POST /api/enrichment/run` accepts `{ entityType, workspaceSlug?, limit? }` and:
- For `person`: finds records with LinkedIn URL or name+company (dedup enforced inside waterfall)
- For `company`: finds records missing industry, headcount, or description
- Enqueues via `enqueueJob` with first-provider convention (`prospeo`/`aiark`)
- Returns `{ jobId, count }` or `{ message: "No eligible records found" }`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `email: null` Prisma filter on Person model**
- **Found during:** Task 2 (TypeScript compilation)
- **Issue:** Plan specified `email: null` to find people without emails, but `Person.email` is `String @unique` (never null) in the schema. Prisma rejects null comparison on non-nullable String fields.
- **Fix:** Removed the `email: null` filter entirely. The run trigger now finds all people with enrichable data (LinkedIn URL or name+company). The dedup gate inside the waterfall (`shouldEnrich`) handles skipping already-enriched people.
- **Files modified:** `src/app/api/enrichment/run/route.ts`

## Verification

All plan success criteria confirmed:

- Email waterfall: Prospeo → LeadMagic → FindyMail, stops at first email found
- Company waterfall: AI Ark → Firecrawl, stops at first success with data
- Circuit breaker threshold: 5 consecutive failures
- Exponential backoff: `Math.pow(2, attempt) * 1000` (1s, 2s, 4s)
- DAILY_CAP_HIT pauses job with resumeAt = midnight UTC tomorrow
- Queue picks up pending + paused-with-expired-resumeAt jobs
- Normalizers fire inline after data writes
- Process route creates fresh circuit breaker per invocation
- Run route finds eligible records and enqueues job
- recordEnrichment accepts workspaceSlug

TypeScript compilation: only pre-existing errors in `src/__tests__/emailbison-client.test.ts` (fetch mock type mismatch) and `worker/src/linkedin-browser.ts` (missing @anthropic-ai/agent-browser module) — both out of scope.

## Self-Check: PASSED

Files created/modified:
- `src/lib/enrichment/waterfall.ts` — FOUND
- `src/lib/enrichment/log.ts` — FOUND (modified)
- `src/lib/enrichment/queue.ts` — FOUND (modified)
- `src/app/api/enrichment/jobs/process/route.ts` — FOUND (modified)
- `src/app/api/enrichment/run/route.ts` — FOUND

Commits:
- `cdd4f5e` feat(02-04): waterfall orchestrators enrichEmail + enrichCompany — FOUND
- `1bb3ada` feat(02-04): wire waterfall into queue, process route, and run trigger — FOUND
