---
phase: 11-linkedin-voyager-api-client
plan: "02"
subsystem: api
tags: [linkedin, voyager, cookies, encryption, worker, api-client]

# Dependency graph
requires:
  - phase: 11-linkedin-voyager-api-client
    provides: Plan 01 VoyagerClient — Voyager API HTTP client needing li_at + JSESSIONID to authenticate

provides:
  - extractVoyagerCookies() on LinkedInBrowser — extracts li_at + JSESSIONID after login
  - saveVoyagerCookies() on ApiClient — persists Voyager cookies via existing session endpoint
  - getVoyagerCookies() on ApiClient — loads decrypted Voyager cookies from /cookies endpoint
  - updateSenderHealth() on ApiClient — patches Sender.healthStatus via /health endpoint
  - GET /api/linkedin/senders/{id}/cookies — decrypts and returns sessionData cookies
  - PATCH /api/linkedin/senders/{id}/health — validates and updates Sender.healthStatus

affects:
  - 11-03 (Plan 03 worker uses getVoyagerCookies() and updateSenderHealth() to drive Voyager actions)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Worker-only endpoint pattern: verifyWorkerAuth() + decrypt() + JSON.parse() — same as credentials endpoint"
    - "Voyager cookie format: type:voyager marker in cookies array distinguishes from old browser cookie format"
    - "Cookie extraction: document.cookie JS eval as primary, CDP fallback for HttpOnly cookies"

key-files:
  created:
    - worker/src/linkedin-browser.ts (extractVoyagerCookies, extractCookiesViaCDP, parseCookieValue methods added)
    - src/app/api/linkedin/senders/[id]/cookies/route.ts
    - src/app/api/linkedin/senders/[id]/health/route.ts
  modified:
    - worker/src/api-client.ts (saveVoyagerCookies, getVoyagerCookies, updateSenderHealth added)

key-decisions:
  - "saveVoyagerCookies wraps cookies with type:voyager marker in existing session POST array — no endpoint changes needed"
  - "getVoyagerCookies uses new /cookies GET (not /session GET) — /session GET returns only status fields, not sessionData"
  - "Health endpoint validates against explicit allowlist: healthy/warning/paused/blocked/session_expired"
  - "Full npx tsc --noEmit used for Next.js endpoint verification — targeted file compile fails due to path alias resolution outside project context"

patterns-established:
  - "Worker GET endpoint for decrypted fields: verifyWorkerAuth → findUnique → null guard → decrypt → JSON.parse → return"
  - "Worker PATCH for status updates: verifyWorkerAuth → params → body → allowlist validation → prisma.update → return ok"

requirements-completed:
  - VOYAGER-05
  - VOYAGER-04

# Metrics
duration: 3min
completed: 2026-03-02
---

# Phase 11 Plan 02: Cookie Extraction Bridge and API Endpoints Summary

**Voyager cookie extraction bridge: LinkedInBrowser extracts li_at + JSESSIONID post-login; ApiClient persists/loads via encrypted sessionData; two new worker-only endpoints provide cookie retrieval and sender health updates**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-03-02T11:49:24Z
- **Completed:** 2026-03-02T11:52:15Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- LinkedInBrowser gains `extractVoyagerCookies()` that runs automatically after successful login and stores cookies on the instance
- ApiClient gains three new methods: `saveVoyagerCookies()`, `getVoyagerCookies()`, and `updateSenderHealth()` — completing the cookie persistence and health reporting loop
- Two new worker-only API endpoints: GET `/api/linkedin/senders/{id}/cookies` (decrypts sessionData) and PATCH `/api/linkedin/senders/{id}/health` (validates + updates healthStatus)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add extractVoyagerCookies() to LinkedInBrowser** - `ac55f80` (feat)
2. **Task 2: Add Voyager cookie persistence and health update methods to ApiClient** - `2b2297b` (feat)
3. **Task 3: Create API endpoints for cookie retrieval and health updates** - `8ba0b7c` (feat)

## Files Created/Modified

- `worker/src/linkedin-browser.ts` - Added `voyagerCookies` property, `extractVoyagerCookies()`, `extractCookiesViaCDP()`, `parseCookieValue()`, and login() integration
- `worker/src/api-client.ts` - Added `saveVoyagerCookies()`, `getVoyagerCookies()`, and `updateSenderHealth()` methods
- `src/app/api/linkedin/senders/[id]/cookies/route.ts` - New: GET endpoint returning decrypted session cookies (worker-only)
- `src/app/api/linkedin/senders/[id]/health/route.ts` - New: PATCH endpoint updating Sender.healthStatus with allowlist validation (worker-only)

## Decisions Made

- `saveVoyagerCookies` wraps the li_at + JSESSIONID pair in the existing `cookies` array format with a `type: "voyager"` marker — the existing `POST /session` endpoint accepts it without modification, and `getVoyagerCookies` knows to look for the type marker when loading.
- `getVoyagerCookies` calls the new `/cookies` endpoint (not `/session`) — the `/session` GET only returns `{ sessionStatus, healthStatus, lastActiveAt }` for dashboard polling; it does not expose `sessionData`.
- Health endpoint validates against an explicit allowlist (`healthy`, `warning`, `paused`, `blocked`, `session_expired`) matching `SenderHealthStatus` type values in `src/lib/linkedin/types.ts`.
- Full `npx tsc --noEmit` used for Next.js endpoints instead of targeted file compile — targeted invocation fails on path alias resolution (`@/lib/*`) and pre-existing Next.js type conflicts when run outside project context.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

The plan's verification command for Task 3 (`npx tsc --noEmit route.ts route.ts`) fails due to path alias resolution (`@/lib/*`) when running tsc on individual files outside the Next.js project context. This is a pre-existing limitation. Full `npx tsc --noEmit` passes cleanly with zero errors, confirming both endpoint files are valid.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 02 complete: the cookie extraction bridge and API endpoints are in place
- Plan 03 (worker Voyager integration) can now use `getVoyagerCookies()` to load li_at + JSESSIONID for VoyagerClient, and `updateSenderHealth()` to report `ip_blocked`/`checkpoint_detected` errors
- All links in the plan's `key_links` dependency graph are implemented and verified

---
*Phase: 11-linkedin-voyager-api-client*
*Completed: 2026-03-02*
