---
phase: 35-email-inbox
plan: 02
subsystem: api
tags: [portal, inbox, email, threads, emailbison, api-routes]

# Dependency graph
requires:
  - Reply model inbox fields from 35-01 (emailBisonParentId, leadEmail, htmlBody, interested, direction, ebSenderEmailId, aiSuggestedReply)
provides:
  - GET /api/portal/inbox/email/threads — grouped thread list with replyStatus and metadata
  - GET /api/portal/inbox/email/threads/[threadId] — chronological thread detail with outbound context
  - POST /api/portal/inbox/email/reply — send reply via EmailBison, persist as outbound Reply
affects: [35-03, 35-04, 35-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Thread grouping via Map<number, Reply[]> keyed on emailBisonParentId ?? emailBisonReplyId"
    - "replyStatus derived from latest message direction + notifiedAt"
    - "Outbound context prepended as synthetic message object when outboundSubject/outboundBody exists"
    - "Portal reply send uses workspace.apiToken (not emailBisonToken — field is named apiToken in schema)"

key-files:
  created:
    - src/app/api/portal/inbox/email/threads/route.ts
    - src/app/api/portal/inbox/email/threads/[threadId]/route.ts
    - src/app/api/portal/inbox/email/reply/route.ts
  modified: []

key-decisions:
  - "Workspace EmailBison token is stored as apiToken, not emailBisonToken — corrected during implementation"
  - "Thread grouping uses emailBisonParentId ?? emailBisonReplyId as key — replies with no EB ID are skipped"
  - "replyStatus: outbound latest = replied, inbound + notifiedAt=null = new, inbound + notifiedAt set = awaiting_reply"
  - "Cursor pagination included in thread list — activated when exactly 200 replies fetched"
  - "reply_all:true used in sendReply per Phase 33 spike validation"

patterns-established:
  - "Portal API routes follow getPortalSession() -> 401 on session error -> 500 on unexpected error pattern"
  - "EmailBisonError caught explicitly with its statusCode for proper HTTP propagation"

requirements-completed: [EMAIL-01, EMAIL-02, EMAIL-03]

# Metrics
duration: 2min
completed: 2026-03-11
---

# Phase 35 Plan 02: Email Inbox API Routes Summary

**3 portal API routes for email inbox: thread list grouped by parent_id chain, thread detail with outbound context, and reply send proxied through EmailBison**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-11T15:04:42Z
- **Completed:** 2026-03-11T15:06:53Z
- **Tasks:** 2
- **Files created:** 3

## Accomplishments
- Created `GET /api/portal/inbox/email/threads` — queries up to 200 replies, groups by `emailBisonParentId ?? emailBisonReplyId`, builds thread summaries with `replyStatus` (new/replied/awaiting_reply), `interested`, `hasAiSuggestion`, `lastSnippet`. Cursor pagination included.
- Created `GET /api/portal/inbox/email/threads/[threadId]` — fetches all replies in thread via `OR [emailBisonReplyId, emailBisonParentId]`, prepends synthetic outbound context message when available, returns chronological message list with `threadMeta`.
- Created `POST /api/portal/inbox/email/reply` — validates message + replyId, looks up Reply record for `emailBisonReplyId` and `ebSenderEmailId`, fetches workspace `apiToken`, calls `EmailBisonClient.sendReply` with `reply_all:true`, persists sent message as outbound Reply with `source=portal_send`.
- All 3 routes use `getPortalSession()` for portal auth, return 401 on auth failure, 500 on unexpected errors.

## Task Commits

Each task was committed atomically:

1. **Task 1: Thread list and thread detail API routes** - `0f6480f` (feat)
2. **Task 2: Reply send API route** - `a82cb91` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/app/api/portal/inbox/email/threads/route.ts` — Thread list GET endpoint
- `src/app/api/portal/inbox/email/threads/[threadId]/route.ts` — Thread detail GET endpoint
- `src/app/api/portal/inbox/email/reply/route.ts` — Reply send POST endpoint

## Decisions Made
- **Workspace token field is `apiToken` not `emailBisonToken`** — the plan referenced `emailBisonToken` but Prisma schema uses `apiToken`. Corrected during TypeScript compilation.
- Thread grouping skips replies with no `emailBisonReplyId` — they can't be reliably grouped.
- `replyStatus` logic: latest message `direction=outbound` → `replied`; `notifiedAt=null` → `new`; else → `awaiting_reply`.
- Cursor pagination activates only when exactly 200 replies are returned (signaling more may exist), appending `nextCursor` as last thread's `lastMessageAt`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Incorrect field name: emailBisonToken → apiToken**
- **Found during:** Task 2, TypeScript compilation
- **Issue:** Plan referenced `workspace.emailBisonToken` but the Prisma Workspace model stores the EmailBison API token as `apiToken`
- **Fix:** Changed `select: { emailBisonToken: true }` to `select: { apiToken: true }` and updated references
- **Files modified:** `src/app/api/portal/inbox/email/reply/route.ts`
- **Commit:** `a82cb91` (fix applied inline before commit)

## User Setup Required
None — purely application-layer code on existing schema.

## Next Phase Readiness
- All 3 API routes are ready for the portal inbox UI (Plan 03)
- Thread list endpoint provides all data needed to render the thread list view
- Thread detail provides all messages with outbound context for the conversation view
- Reply send endpoint is ready to be wired up to the reply composer

---
*Phase: 35-email-inbox*
*Completed: 2026-03-11*

## Self-Check: PASSED

- FOUND: src/app/api/portal/inbox/email/threads/route.ts
- FOUND: src/app/api/portal/inbox/email/threads/[threadId]/route.ts
- FOUND: src/app/api/portal/inbox/email/reply/route.ts
- FOUND: .planning/phases/35-email-inbox/35-02-SUMMARY.md
- FOUND commit: 0f6480f (feat(35-02): thread list and thread detail API routes)
- FOUND commit: a82cb91 (feat(35-02): reply send API route)
