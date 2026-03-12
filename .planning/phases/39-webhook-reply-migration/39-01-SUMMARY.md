---
phase: 39-webhook-reply-migration
plan: 01
subsystem: infra
tags: [trigger.dev, background-jobs, reply-processing, linkedin, classification, notifications, ai]

# Dependency graph
requires:
  - phase: 38-triggerdev-foundation
    provides: trigger.config.ts, queues.ts, smoke-test pattern, PrismaClient module-scope pattern

provides:
  - trigger/process-reply.ts — Trigger.dev task for full reply processing chain (upsert, classify, notify, AI suggestion)
  - trigger/linkedin-fast-track.ts — Trigger.dev task for P1 LinkedIn connection enqueue on reply
  - ProcessReplyPayload and LinkedinFastTrackPayload types exported for webhook handler import

affects:
  - 39-02 — webhook handler migration that will trigger.dev.trigger() these tasks

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "PrismaClient at module scope in trigger/ files (not inside run()) — matches smoke-test.ts pattern"
    - "ProcessReplyPayload uses number (not string|number) for ebReplyId, replyParentId, replySenderEmailId — matches Prisma Int? schema fields"
    - "notifyReply idempotency guard (notifiedAt) makes notifications safe for task retries"
    - "classifyReply failure is non-blocking — retry-classification cron picks up intent=null replies"
    - "AI suggestion Slack posting uses postMessage() to both workspace.slackChannelId and REPLIES_SLACK_CHANNEL_ID"

key-files:
  created:
    - trigger/process-reply.ts
    - trigger/linkedin-fast-track.ts
  modified: []

key-decisions:
  - "ebReplyId typed as number (not string|number) — Prisma Reply.emailBisonReplyId is Int? in schema"
  - "replyParentId and replySenderEmailId typed as number|null — map to Int? schema fields emailBisonParentId and ebSenderEmailId"
  - "linkedin-fast-track has no queue — only DB operations, no Anthropic or EmailBison calls"
  - "Classification failure is non-blocking in process-reply — retry-classification cron handles intent=null replies"
  - "LinkedinFastTrackPayload.campaignName is string|null, converted to string|undefined for enqueueAction() compatibility"

patterns-established:
  - "Trigger.dev tasks export both the task and its payload type for type-only import in callers"
  - "Four-step process-reply flow: upsert -> classify -> notify -> AI suggestion (same order as webhook)"

requirements-completed: [WHOOK-01, WHOOK-03]

# Metrics
duration: 5min
completed: 2026-03-12
---

# Phase 39 Plan 01: Webhook Reply Migration — Trigger.dev Tasks Summary

**Two Trigger.dev background tasks created: process-reply (upsert/classify/notify/AI suggestion via anthropicQueue) and linkedin-fast-track (P1 connect enqueue with bumpPriority fallback)**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-12T15:03:30Z
- **Completed:** 2026-03-12T15:08:48Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- `trigger/process-reply.ts` — full reply processing chain outside serverless lifetime: DB upsert, classifyReply(), notifyReply() (idempotent), generateText() AI suggestion with Slack follow-ups
- `trigger/linkedin-fast-track.ts` — P1 LinkedIn fast-track: bumpPriority() or enqueueAction() with assignSenderForPerson() fallback
- Both tasks export payload interfaces for type-only import in the webhook handler (Plan 02)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create process-reply Trigger.dev task** - `e1a8765` (feat)
2. **Task 2: Create linkedin-fast-track Trigger.dev task** - `7b74082` (feat)

**Plan metadata:** (docs commit below)

## Files Created/Modified
- `trigger/process-reply.ts` — Trigger.dev task with anthropicQueue, maxDuration:120, retry maxAttempts:3; handles full reply processing chain
- `trigger/linkedin-fast-track.ts` — Trigger.dev task, no queue, maxDuration:30, retry maxAttempts:2; bumps priority or enqueues P1 connect

## Decisions Made
- `ebReplyId` payload field typed as `number` (not `string | number`) — Prisma schema has `Reply.emailBisonReplyId` as `Int?`, so string would cause TS errors
- `replyParentId` and `replySenderEmailId` typed as `number | null` for same reason (map to `Int?` schema fields)
- `linkedin-fast-track` gets no queue — it only does DB lookups and writes, no API calls to Anthropic or EmailBison
- `campaignName` is `string | null` in payload but `enqueueAction()` expects `string | undefined` — uses `?? undefined` coercion

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed payload type mismatch for numeric Prisma Int? fields**
- **Found during:** Task 1 (process-reply TypeScript check)
- **Issue:** ebReplyId was `string | number`, replyParentId/replySenderEmailId were `string | null` — Prisma schema has these as `Int?`, causing TS2322 errors
- **Fix:** Narrowed types to `number`, `number | null` respectively to match schema
- **Files modified:** trigger/process-reply.ts
- **Verification:** `npx tsc --noEmit` passed with 0 errors
- **Committed in:** e1a8765 (Task 1 commit, fixed inline)

**2. [Rule 1 - Bug] Fixed campaignName null/undefined type mismatch in linkedin-fast-track**
- **Found during:** Task 2 (TypeScript check)
- **Issue:** `campaignName: string | null` passed directly to `enqueueAction()` which expects `campaignName?: string` (undefined, not null)
- **Fix:** Changed to `campaignName: campaignName ?? undefined`
- **Files modified:** trigger/linkedin-fast-track.ts
- **Verification:** `npx tsc --noEmit` passed with 0 errors
- **Committed in:** 7b74082 (Task 2 commit, fixed inline)

---

**Total deviations:** 2 auto-fixed (both Rule 1 - type bugs caught by TypeScript)
**Impact on plan:** Both fixes necessary for TypeScript correctness. No scope creep.

## Issues Encountered
- TypeScript targeted at individual files (`npx tsc --noEmit trigger/file.ts`) shows node_modules errors from Trigger.dev/Prisma types — these are tsconfig target artifacts, not real errors. Full project `npx tsc --noEmit` (no file args) compiles cleanly.

## Next Phase Readiness
- Both task files are in `trigger/` directory and Trigger.dev will discover them via `dirs: ["./trigger"]` in trigger.config.ts
- Payload types (`ProcessReplyPayload`, `LinkedinFastTrackPayload`) are exported and ready for `import type` in Plan 02
- Plan 02 will update the webhook handler to call `tasks.trigger()` instead of inline processing

---
*Phase: 39-webhook-reply-migration*
*Completed: 2026-03-12*

## Self-Check: PASSED

- trigger/process-reply.ts: FOUND
- trigger/linkedin-fast-track.ts: FOUND
- 39-01-SUMMARY.md: FOUND
- Commit e1a8765 (process-reply): FOUND
- Commit 7b74082 (linkedin-fast-track): FOUND
