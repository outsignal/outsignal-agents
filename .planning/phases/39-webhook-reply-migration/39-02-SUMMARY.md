---
phase: 39-webhook-reply-migration
plan: "02"
subsystem: webhooks
tags: [trigger.dev, webhook, reply-processing, refactor]
dependency_graph:
  requires: [39-01]
  provides: [WHOOK-04, WHOOK-05]
  affects: [src/app/api/webhooks/emailbison/route.ts]
tech_stack:
  added: ["@trigger.dev/sdk tasks.trigger()"]
  patterns: ["import type for task types", "try/catch fallback instead of fire-and-forget", "idempotencyKey for dedup"]
key_files:
  modified:
    - src/app/api/webhooks/emailbison/route.ts
decisions:
  - "Relative path used for import type (../../../../../trigger/) — @/ alias maps to src/ only, trigger/ is at project root"
  - "bumpPriority import removed from webhook — now fully handled inside linkedin-fast-track Trigger.dev task"
  - "LEAD_INTERESTED system notify() call removed — redundant, task handles interested flag in payload"
  - "No idempotencyKey for linkedin-fast-track — task itself is idempotent (bumpPriority + existingConnection checks)"
metrics:
  duration: "9 minutes"
  completed_date: "2026-03-12"
  tasks_completed: 2
  files_modified: 1
---

# Phase 39 Plan 02: Webhook Handler Migration to Trigger.dev Summary

Webhook handler refactored to return 200 in <500ms by offloading reply processing to Trigger.dev tasks, with a robust inline fallback for when Trigger.dev is unavailable.

## What Was Built

The EmailBison webhook handler at `src/app/api/webhooks/emailbison/route.ts` was refactored to:

- **Fire `tasks.trigger("process-reply", ...)` with `idempotencyKey: reply-${ebReplyId}` and `tags: [workspaceSlug]`** on LEAD_REPLIED, LEAD_INTERESTED, and UNTRACKED_REPLY_RECEIVED events
- **Fire `tasks.trigger("linkedin-fast-track", ...)` with `tags: [workspaceSlug]`** on LEAD_REPLIED and LEAD_INTERESTED events
- **Provide a full inline fallback** when Trigger.dev is unavailable: upsert Reply + classifyReply + notifyReply, all awaited (no fire-and-forget)
- **Log-and-skip fallback** for linkedin-fast-track (no inline fallback needed — it's an enhancement, not critical path)

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Refactor webhook handler to trigger tasks with fallback | 479ae9b | src/app/api/webhooks/emailbison/route.ts |
| 2 | Verify end-to-end TypeScript compilation and no fire-and-forget patterns | (no code changes — verification only) | — |

## Verification Results

- TypeScript: `npx tsc --noEmit` passes with zero errors
- Fire-and-forget eliminated: `grep -c '.then(' route.ts` → 0
- maxDuration confirmed: `export const maxDuration = 10`
- Type-only imports confirmed: `import type { processReply }` and `import type { linkedinFastTrack }`
- Both task files confirmed in `trigger/` directory

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Relative import path used instead of @/ alias**
- **Found during:** Task 1
- **Issue:** `import type { processReply } from "@/trigger/process-reply"` failed with TS2307 — the `@/` path alias maps to `./src/*`, but `trigger/` lives at the project root outside `src/`
- **Fix:** Changed to relative path `../../../../../trigger/process-reply` (5 levels up from `src/app/api/webhooks/emailbison/`)
- **Files modified:** src/app/api/webhooks/emailbison/route.ts
- **Commit:** 479ae9b

**2. [Rule 1 - Cleanup] Removed unused bumpPriority import**
- **Found during:** Task 1
- **Issue:** After removing the inline LinkedIn fast-track block, `bumpPriority` was imported but never used (TS6133 hint)
- **Fix:** Removed `bumpPriority` from the `@/lib/linkedin/queue` import — this logic now lives entirely inside the `linkedin-fast-track` Trigger.dev task
- **Files modified:** src/app/api/webhooks/emailbison/route.ts
- **Commit:** 479ae9b

## Self-Check

## Self-Check: PASSED

- route.ts: FOUND
- commit 479ae9b: FOUND
