---
phase: 11-linkedin-voyager-api-client
plan: 01
subsystem: infra
tags: [linkedin, voyager-api, http-client, socks5, proxy, cookies, typescript]

# Dependency graph
requires:
  - phase: 10-linkedin-browser-rewrite
    provides: worker/src/linkedin-browser.ts interface (ActionResult, ConnectionStatus) that VoyagerClient matches
provides:
  - VoyagerClient class with viewProfile, sendConnectionRequest, sendMessage, checkConnectionStatus
  - VoyagerError custom error with status + body fields
  - ActionResult and ConnectionStatus type exports for worker.ts swap
  - socks-proxy-agent dependency for SOCKS5 proxy routing
affects:
  - 11-02 (cookie-store — reads li_at/jsessionId to construct VoyagerClient)
  - 11-03 (worker integration — swaps LinkedInBrowser for VoyagerClient in executeAction())

# Tech tracking
tech-stack:
  added: [socks-proxy-agent ^8.0.5]
  patterns:
    - VoyagerClient accepts (liAt, jsessionId, proxyUrl?) — one instance per sender
    - CSRF token = jsessionId.replace(/"/g, '') — strip quotes, not a hash
    - undici dispatcher pattern for SOCKS5 (not agent — agent silently fails)
    - viewProfile() always called first to extract memberUrn for write operations
    - SocksProxyAgent created once in constructor, reused across requests

key-files:
  created:
    - worker/src/voyager-client.ts
  modified:
    - worker/package.json
    - worker/package-lock.json

key-decisions:
  - "Use Node.js native global fetch (not undici import) — compiles cleanly with @types/node 22"
  - "ConnectionStatus type defined locally in voyager-client.ts — matches worker/linkedin-browser.ts, NOT src/lib/linkedin/types.ts which uses none/failed/expired"
  - "dispatcher: proxyAgent as any — SocksProxyAgent implements undici.Dispatcher interface but TypeScript types don't align; cast required"
  - "viewProfile() extracts memberUrn from entityUrn field in Voyager API response — write ops (connect, message) always call viewProfile first"
  - "403 on sendMessage returns not_connected specifically — different from generic auth_expired 403 from other methods"

patterns-established:
  - "Voyager API header pattern: User-Agent + Accept + csrf-token + x-restli-protocol-version + x-li-lang + Cookie"
  - "Error handling: VoyagerError subclass with status/body, mapped to typed ActionResult via handleError()"
  - "Checkpoint detection: response.url check for /checkpoint/ or /challenge/ before processing response"

requirements-completed: [VOYAGER-01, VOYAGER-02, VOYAGER-03, VOYAGER-04]

# Metrics
duration: 2min
completed: 2026-03-02
---

# Phase 11 Plan 01: LinkedIn Voyager API Client Summary

**VoyagerClient HTTP client wrapping LinkedIn Voyager REST API with cookie auth, SOCKS5 proxy routing via socks-proxy-agent, and typed error handling for 429/403/401/999/checkpoint responses**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-02T11:48:46Z
- **Completed:** 2026-03-02T11:51:25Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- VoyagerClient class (385 lines) implementing all four LinkedIn action methods
- CSRF token derivation from JSESSIONID (strip quotes) — zero custom logic needed
- SocksProxyAgent wired via undici `dispatcher` (not `agent`) for correct SOCKS5 routing
- Comprehensive error mapping: 429 rate_limited, 403 auth_expired, 401 unauthorized, 999 ip_blocked, checkpoint_detected

## Task Commits

Each task was committed atomically:

1. **Task 1: Install socks-proxy-agent dependency** - `e26018b` (chore)
2. **Task 2: Create VoyagerClient class** - `565fd97` (feat)

## Files Created/Modified
- `worker/src/voyager-client.ts` - VoyagerClient class with all four LinkedIn action methods, VoyagerError, ActionResult, ConnectionStatus
- `worker/package.json` - socks-proxy-agent ^8.0.5 added to dependencies
- `worker/package-lock.json` - dependency lock file updated

## Decisions Made
- **Native fetch over undici import:** Global `fetch` (Node 18+) works cleanly with `@types/node` 22 — no explicit import needed; avoids undici type conflicts
- **Local ConnectionStatus definition:** VoyagerClient runs in worker context only; its `ConnectionStatus` matches `worker/src/linkedin-browser.ts` (connected/pending/not_connected/not_connectable/unknown), NOT the shared server type in `src/lib/linkedin/types.ts` (none/failed/expired). Comment added to source explaining this intentional divergence
- **`as any` cast for dispatcher:** `SocksProxyAgent` implements `undici.Dispatcher` at runtime but TypeScript types don't formally declare this; `as any` cast is the documented pattern per socks-proxy-agent README
- **viewProfile() as prerequisite:** Both `sendConnectionRequest()` and `sendMessage()` call `viewProfile()` first to extract `memberUrn` — LinkedIn write ops need the ACoAAA... URN, not the URL slug
- **403 special-cased in sendMessage:** A 403 from the messaging endpoint means "not connected" (can't message non-connections), not auth_expired — handled separately before the generic `handleError()` call

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered
- `socks-proxy-agent` was already in `worker/package.json` from a prior session (npm reported "up to date"). Verified it was correctly present at `^8.0.5` and committed package files to satisfy the task done criteria.

## User Setup Required

None — no external service configuration required. Proxy URL is configured via `Sender.proxyUrl` in the database, passed to `VoyagerClient` constructor at runtime.

## Next Phase Readiness
- VoyagerClient is complete and compiles without errors
- Plan 02 (cookie-store) can now build on this — reads li_at/jsessionId from Sender.sessionData and instantiates VoyagerClient
- Plan 03 (worker integration) will swap LinkedInBrowser for VoyagerClient in executeAction()
- TypeScript interface is fully compatible with existing worker.ts ActionResult handling

---
*Phase: 11-linkedin-voyager-api-client*
*Completed: 2026-03-02*
