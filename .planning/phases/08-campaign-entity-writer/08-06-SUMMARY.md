---
phase: 08-campaign-entity-writer
plan: "06"
subsystem: api
tags: [writer-agent, notifications, slack, email, webhooks, reply-suggestions]

# Dependency graph
requires:
  - phase: 08-campaign-entity-writer/08-04
    provides: runWriterAgent with reply suggestion mode, smart iteration, campaign awareness
provides:
  - Reply suggestion generation on LEAD_REPLIED and LEAD_INTERESTED webhooks
  - suggestedResponse block in Slack notifications (divider + bold section)
  - suggestedResponse styled HTML block in email notifications (brand-color accent #F0FF7A)
  - Non-blocking failure handling (null fallback preserves notification delivery)
affects:
  - 09-client-portal
  - 10-deployment-pipeline

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Non-blocking AI generation: generate suggestion before notify, catch all errors, null fallback"
    - "Dynamic import in webhook handler: await import('@/lib/agents/writer') avoids circular deps at module load"
    - "Conditional Slack spread: ...(condition ? [blocks] : []) pattern for optional notification blocks"

key-files:
  created: []
  modified:
    - src/app/api/webhooks/emailbison/route.ts
    - src/lib/notifications.ts

key-decisions:
  - "generateReplySuggestion extracts emailSteps[0].body first, falls back to reviewNotes — handles both agent output paths"
  - "UNTRACKED_REPLY_RECEIVED excluded from reply suggestion trigger — follows user decision from CONTEXT.md"
  - "Reply suggestion generated before notifyReply call — adds 10-30s latency to webhook but EmailBison doesn't wait for response"
  - "textBody guard on suggestion trigger — no point calling writer if there is no reply body to respond to"

patterns-established:
  - "Optional notification blocks: spread conditional arrays into Slack block arrays"
  - "Non-blocking AI generation: any AI call in a webhook must be wrapped in try/catch returning null"

requirements-completed: [WRITER-06, WRITER-07]

# Metrics
duration: 2min
completed: 2026-03-01
---

# Phase 8 Plan 06: Reply Suggestion Generation in Webhook Notifications Summary

**AI-drafted reply suggestions injected into Slack and email notifications on LEAD_REPLIED/LEAD_INTERESTED webhooks, using runWriterAgent in reply mode (no PVP/spintax)**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-01T09:16:34Z
- **Completed:** 2026-03-01T09:17:58Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- `generateReplySuggestion()` helper added to webhook handler: calls `runWriterAgent` with reply-mode prompt (under 70 words, no PVP, no spintax, human and natural)
- Reply suggestions generated non-blocking before `notifyReply` — any failure returns null, notification still fires
- `notifyReply` updated to accept `suggestedResponse?: string | null` parameter
- Slack notification gets divider + `*Suggested Response:*` mrkdwn section block when suggestion present
- Email notification gets HR + "SUGGESTED RESPONSE" label + left-bordered box with #F0FF7A brand accent when suggestion present
- `UNTRACKED_REPLY_RECEIVED` correctly excluded from suggestion trigger (follows CONTEXT.md decision)
- TypeScript compiles cleanly with zero errors (`npx tsc --noEmit`)

## Task Commits

Both tasks committed atomically together (tightly coupled — webhook needs notifications type change to compile):

1. **Task 1 + 2: Reply suggestion generation + notification display** - `f9f5a40` (feat)

**Plan metadata:** _(docs commit — see final commit hash below)_

## Files Created/Modified

- `src/app/api/webhooks/emailbison/route.ts` - Added `generateReplySuggestion()` helper, generation call before `notifyReply`, passes `suggestedResponse`
- `src/lib/notifications.ts` - Added `suggestedResponse` param to signature, Slack divider+section block, email HR+label+styled box

## Decisions Made

- Tasks 1 and 2 were committed together because the webhook's `notifyReply` call with `suggestedResponse` requires the updated function signature in `notifications.ts` to type-check — they are a single atomic change
- `generateReplySuggestion` uses dynamic import (`await import('@/lib/agents/writer')`) consistent with the pattern established in 08-04 for avoiding circular dependency at module load time
- The function extracts `emailSteps[0].body` as primary output (writer in reply mode produces a single email step), with `reviewNotes` as fallback for edge cases where the agent doesn't produce steps
- `textBody` guard prevents calling the writer when there is nothing to respond to

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Reply suggestions are live for all LEAD_REPLIED and LEAD_INTERESTED webhook events
- Admin will see suggested responses inline in both Slack DMs and notification emails
- Admin can refine suggestions via Cmd+J ("draft a response to John's reply") — satisfied by existing orchestrator + writer reply mode from Plan 04
- Phase 8 complete: all 6 plans done (01 Campaign entity, 02 pgvector, 03 Campaign operations, 04 Writer quality rules, 05 Campaign Agent, 06 Reply suggestions)
- Ready for Phase 9 (Client Portal) or Phase 10 (Deployment Pipeline)

## Self-Check: PASSED

- FOUND: src/app/api/webhooks/emailbison/route.ts
- FOUND: src/lib/notifications.ts
- FOUND: .planning/phases/08-campaign-entity-writer/08-06-SUMMARY.md
- FOUND commit: f9f5a40

---
*Phase: 08-campaign-entity-writer*
*Completed: 2026-03-01*
