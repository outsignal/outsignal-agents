---
phase: 02-provider-adapters-waterfall
plan: "02"
subsystem: api
tags: [enrichment, email-finding, prospeo, leadmagic, findymail, zod, abortcontroller]

# Dependency graph
requires:
  - phase: 02-01
    provides: EmailAdapter type, EmailProviderResult interface, PROVIDER_COSTS map

provides:
  - prospeoAdapter — email finding via LinkedIn URL or name+company fallback (POST /enrich-person)
  - leadmagicAdapter — email finding via LinkedIn URL (POST /v1/people/b2b-profile-to-email)
  - findymailAdapter — email finding via LinkedIn URL, defensive schema (POST /api/search/linkedin)

affects:
  - 02-04-waterfall (these are the adapters the waterfall orchestrator calls)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - AbortController with 10s timeout on all external fetch calls
    - Zod safeParse for provider response validation (never hard-throw on schema mismatch)
    - .passthrough() Zod schema for unconfirmed/unstable API shapes
    - Fallback email extraction from alternative response paths
    - Early return with costUsd=0 when insufficient input (no API call made)
    - Throw with .status property for HTTP errors (waterfall reads this for retry/skip logic)

key-files:
  created:
    - src/lib/enrichment/providers/prospeo.ts
    - src/lib/enrichment/providers/leadmagic.ts
    - src/lib/enrichment/providers/findymail.ts

key-decisions:
  - "Prospeo /enrich-person used exclusively — /social-url-finder was removed March 2026"
  - "Fixed PROVIDER_COSTS used for costUsd tracking, not dynamic credits_consumed from response — consistent cost model"
  - "FindyMail uses .passthrough() Zod + fallback extraction paths — API shape is MEDIUM confidence"
  - "FindyMail logs rawResponse on every call — needed for schema discovery during initial integration"
  - "LeadMagic and FindyMail return early (costUsd=0) with no API call when LinkedIn URL missing"
  - "Prospeo returns early (costUsd=0) when neither LinkedIn URL nor name+company available"

patterns-established:
  - "EmailAdapter pattern: early-return guard → getApiKey() → AbortController → fetch → error handling → Zod safeParse → return EmailProviderResult"
  - "HTTP error throw pattern: (err as any).status = N for waterfall to read"

requirements-completed: [PROV-01, PROV-03, PROV-04, ENRICH-04]

# Metrics
duration: 2min
completed: "2026-02-26"
---

# Phase 02 Plan 02: Provider Adapters (Prospeo, LeadMagic, FindyMail) Summary

**Three email-finding adapters built as typed fetch wrappers with Zod validation, AbortController timeouts, and .status-tagged error throws for the waterfall orchestrator**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-02-26T18:16:31Z
- **Completed:** 2026-02-26T18:18:34Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Prospeo adapter: LinkedIn URL path and name+company fallback, Zod-validated response, 10s timeout
- LeadMagic adapter: LinkedIn URL required, X-API-Key auth, fixed cost tracking
- FindyMail adapter: defensive .passthrough() Zod schema with fallback email extraction from 3 alternative paths, rawResponse logging on every call for schema discovery

## Task Commits

Each task was committed atomically:

1. **Task 1: Prospeo email adapter** - `5a031d2` (feat)
2. **Task 2: LeadMagic and FindyMail email adapters** - `1dc804b` (feat)

## Files Created/Modified

- `src/lib/enrichment/providers/prospeo.ts` - Prospeo adapter with LinkedIn URL + name/company fallback, Zod validation
- `src/lib/enrichment/providers/leadmagic.ts` - LeadMagic adapter, LinkedIn URL required, X-API-Key header
- `src/lib/enrichment/providers/findymail.ts` - FindyMail adapter, defensive schema, fallback email extraction, raw response logging

## Decisions Made

- Used fixed `PROVIDER_COSTS` values instead of `credits_consumed` from LeadMagic response — consistent with cost model established in Plan 01
- FindyMail uses `.passthrough()` Zod schema because the API response shape is MEDIUM confidence (research noted field names unconfirmed)
- FindyMail logs `rawResponse` on every call (not just errors) for schema discovery during initial integration period
- Prospeo early returns with `costUsd=0` for insufficient input — no API call means no charge

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Pre-existing TypeScript errors in unrelated files (`src/__tests__/emailbison-client.test.ts`, `worker/src/linkedin-browser.ts`, `src/lib/enrichment/providers/firecrawl-company.ts`) — out of scope, not caused by this plan. New adapter files compile without errors.

## User Setup Required

**External services require manual configuration before these adapters can be used:**

- `PROSPEO_API_KEY` — Prospeo dashboard -> API Keys (prospeo.io)
- `LEADMAGIC_API_KEY` — LeadMagic dashboard -> API Settings (leadmagic.io)
- `FINDYMAIL_API_KEY` — FindyMail dashboard -> API (findymail.com)

## Next Phase Readiness

- All three email-finding adapters ready for the waterfall orchestrator (Plan 04)
- Provider adapter pattern established — Plan 03 (AI Ark) can follow same structure
- FindyMail field name uncertainty resolved at runtime — rawResponse logging will reveal actual schema on first production call

---
*Phase: 02-provider-adapters-waterfall*
*Completed: 2026-02-26*
