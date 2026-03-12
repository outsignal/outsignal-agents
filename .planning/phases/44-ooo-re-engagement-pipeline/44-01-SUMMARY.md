---
phase: 44-ooo-re-engagement-pipeline
plan: 01
subsystem: ooo-pipeline
tags: [prisma, trigger.dev, ai-extraction, ooo, classification]
dependency_graph:
  requires: []
  provides: [ooo-schema, ooo-extraction-lib, ooo-pipeline-in-process-reply, ooo-reengage-stub]
  affects: [trigger/process-reply.ts, prisma/schema.prisma]
tech_stack:
  added: [src/lib/ooo/extract-ooo.ts, trigger/ooo-reengage.ts]
  patterns: [generateObject with claude-haiku-4-5-20251001, Trigger.dev delayed tasks, runs.reschedule for dedup]
key_files:
  created:
    - src/lib/ooo/extract-ooo.ts
    - trigger/ooo-reengage.ts
  modified:
    - prisma/schema.prisma
    - trigger/process-reply.ts
decisions:
  - "ooo-reengage task payload passes reengagementId as empty string — Plan 02 task will look up OooReengagement record by personEmail+workspaceSlug+status=pending at run time (Trigger.dev delayed task payload is immutable after trigger)"
  - "runs.reschedule() used for duplicate OOO dedup — existing pending record updated, not replaced, preserving triggerRunId integrity"
  - "extractOooDetails uses receivedAt (not now()) as the anchor for default date calculation — ensures 14-day default is from when the reply arrived, not when the task runs"
metrics:
  duration: "3 min"
  completed: "2026-03-12"
  tasks_completed: 2
  files_changed: 4
---

# Phase 44 Plan 01: OOO Detection + Scheduling Foundation Summary

OOO detection pipeline integrated into process-reply: Haiku extracts return date/reason, OooReengagement record created, Trigger.dev delayed task scheduled for D+1 after return date, with 90-day cap and 14-day defaulted fallback.

## What Was Built

### Task 1: Schema migration + OOO extraction library

Added three OOO tracking fields to the `Person` model (`oooUntil`, `oooReason`, `oooDetectedAt`) and created the `OooReengagement` model with full tracking fields including `triggerRunId` for admin cancel/reschedule, `needsManualReview` flag for defaulted dates, and a unique constraint on `(personEmail, workspaceSlug, status)` to prevent duplicate pending records.

Created `src/lib/ooo/extract-ooo.ts` exporting `extractOooDetails()`:
- Uses `generateObject` with `claude-haiku-4-5-20251001` (cheap, fast)
- Zod schema enforces `oooReason` enum, `oooUntil` as ISO date string, `confidence` enum, and nullable `eventName`
- Provides today's date and a pre-calculated 14-day default in the prompt for reliable relative date resolution
- Returns `{ oooUntil: Date, oooReason, confidence, eventName }`

Schema applied to Neon via `prisma db push`.

### Task 2: OOO pipeline in process-reply + ooo-reengage stub

Modified `trigger/process-reply.ts` with a new Step 2b between classification and notification:
- Only fires when `classificationIntent === "out_of_office"`
- Calls `extractOooDetails`, caps return date at 90 days
- Calculates `sendDate = returnDate + 1 day`
- Checks for existing pending `OooReengagement` record:
  - **Found:** calls `runs.reschedule()` + updates record (no duplicate task)
  - **Not found:** `tasks.trigger("ooo-reengage", payload, { delay: sendDate, tags: [...] })` + creates record
- Updates `Person.oooUntil/oooReason/oooDetectedAt` via `updateMany`
- Entire block wrapped in `try/catch` — non-blocking
- Return value extended with `oooScheduled: boolean`

Created `trigger/ooo-reengage.ts` stub with `OooReengagePayload` interface and placeholder `run()` — full Welcome Back campaign implementation in Plan 02.

## Deviations from Plan

None — plan executed exactly as written.

## Verification

- `npx prisma validate` — passes
- `npx tsc --noEmit` (full project) — zero errors
- `OooReengagement` model confirmed in generated Prisma client at `node_modules/.prisma/client/index.d.ts`
- `Person` OOO fields confirmed in generated types

## Commits

| Hash | Description |
|------|-------------|
| 192e0ab | feat(44-01): schema migration + OOO extraction library |
| b228fb9 | feat(44-01): OOO pipeline in process-reply + ooo-reengage stub |
