---
phase: 33-api-spike-client-extensions
plan: 02
subsystem: api
tags: [linkedin, voyager, worker, typescript, messaging, conversations]

# Dependency graph
requires:
  - phase: 33-api-spike-client-extensions
    provides: VoyagerClient base class with request(), testSession(), sendMessage()
provides:
  - VoyagerConversation and VoyagerMessage TypeScript interfaces
  - VoyagerClient.fetchConversations() — fetches last 20 LinkedIn conversations with rich metadata
  - VoyagerClient.fetchMessages() — on-demand fetch of last 20 messages per conversation
  - SessionServer GET /sessions/{senderId}/conversations endpoint
  - SessionServer GET /sessions/{senderId}/conversations/{conversationId}/messages endpoint
affects: [34-linkedin-data-layer, 36-linkedin-thread-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Defensive normalized JSON parsing using entityMap (URN-keyed lookup) for LinkedIn Voyager responses
    - randomDelay(2-3s) before Voyager read calls for account safety
    - VoyagerError propagation without retry for 401/403/429 per user decision
    - On-demand messages endpoint (separate from conversations list) to minimize Voyager API calls

key-files:
  created: []
  modified:
    - worker/src/voyager-client.ts
    - worker/src/session-server.ts

key-decisions:
  - "VoyagerError 401/403 propagates without retry — SessionServer returns {error: session_expired, message: Reconnect LinkedIn in settings}"
  - "VoyagerError 429 fails fast, no retry — account safety is priority"
  - "Messages fetched on-demand (separate endpoint) not inline with conversations — minimizes Voyager API calls"
  - "randomDelay(2-3s) applied before fetchMessages API call to mimic human browsing speed"
  - "Proxy support deferred — TODO comments left in both handlers pending getSenderById() on ApiClient"
  - "Raw response logged (first 3000 chars) on first call for live schema validation of Voyager response shape"

patterns-established:
  - "EntityMap pattern: build Map<URN, entity> from included[] then resolve cross-references by URN"
  - "Defensive parsing: return empty array on unexpected structure rather than crashing"
  - "Checkpoint detection in fetch methods: check response.url for /checkpoint/ or /challenge/"

requirements-completed: [API-03, API-04]

# Metrics
duration: 8min
completed: 2026-03-11
---

# Phase 33 Plan 02: VoyagerClient Messaging API + SessionServer Endpoints Summary

**VoyagerClient extended with fetchConversations() + fetchMessages() using defensive normalized JSON parsing, plus two authenticated worker endpoints for Phase 34's LinkedIn data sync to consume.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-11T12:04:08Z
- **Completed:** 2026-03-11T12:12:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added VoyagerConversation and VoyagerMessage exported TypeScript interfaces to voyager-client.ts
- Added fetchConversations() with entityMap-based normalized response parsing, checkpoint detection, and defensive null-coalescing
- Added fetchMessages() with 2-3s random pre-call delay, 404 fallback to legacy endpoint, and defensive parsing
- Added two new authenticated routes to SessionServer: GET /sessions/{senderId}/conversations and GET /sessions/{senderId}/conversations/{conversationId}/messages
- Both endpoints use existing verifyAuth() bearer secret, load Voyager cookies via ApiClient, and return proper error responses for session_expired and rate_limited cases

## Task Commits

Each task was committed atomically:

1. **Task 1: Add fetchConversations and fetchMessages to VoyagerClient** - `73cc336` (feat)
2. **Task 2: Add two worker conversation endpoints to SessionServer** - `66a0262` (feat)

**Plan metadata:** (final commit below)

## Files Created/Modified
- `worker/src/voyager-client.ts` — Added VoyagerConversation/VoyagerMessage interfaces, randomDelay helper, fetchConversations(), fetchMessages(), parseConversations(), parseMessages()
- `worker/src/session-server.ts` — Added VoyagerClient/VoyagerError import, route matching for conversations + messages, handleGetConversations(), handleGetMessages()

## Decisions Made
- On-demand messages endpoint kept separate from conversations list — Phase 33 design decision to minimize Voyager API call volume
- randomDelay() applied only in fetchMessages() (called once per conversation on demand) not in fetchConversations() (called once per sync)
- Proxy support deferred with TODO comments — getSenderById() not yet on ApiClient, can be added in Phase 34
- Raw response logging at first call (3000 chars) is intentional — Voyager response schema must be validated against live data before parseConversations/parseMessages are finalized

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- TypeScript isolated file check (`npx tsc --noEmit src/voyager-client.ts`) showed a pre-existing error on the `generateTrackingId` Uint8Array iteration — this was unrelated to changes and passes cleanly when compiled with the full tsconfig (target: ES2022). Full project compile `npx tsc --noEmit` passes with zero errors.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 34 (LinkedIn Data Layer) can now call these worker endpoints to sync conversations and messages into the DB
- parseConversations() and parseMessages() will likely need tuning after first live run — raw response logging is in place for this
- Proxy support can be added once ApiClient.getSenderById() is available

---
*Phase: 33-api-spike-client-extensions*
*Completed: 2026-03-11*
