---
phase: 02-provider-adapters-waterfall
plan: "03"
subsystem: enrichment-providers
tags: [enrichment, providers, aiark, firecrawl, company-data]
dependency_graph:
  requires: ["02-01"]
  provides: ["02-04", "02-05"]
  affects: ["enrichment-waterfall"]
tech_stack:
  added: []
  patterns:
    - "Defensive auth header pattern for low-confidence API docs"
    - "Firecrawl v2 FirecrawlClient extract() with bundled args (urls+schema+prompt)"
    - "Loose Zod schema with passthrough() for uncertain response shapes"
    - "Promise.race safety timeout pattern for slow external calls"
key_files:
  created:
    - src/lib/enrichment/providers/aiark.ts
    - src/lib/enrichment/providers/firecrawl-company.ts
  modified: []
decisions:
  - "AI Ark uses X-TOKEN as auth header (LOW confidence) — warns on 401/403 with actionable fix instructions"
  - "Firecrawl v2 FirecrawlClient (default export) uses single bundled-arg extract() — not the (urls, params) overload from FirecrawlApp v1"
  - "Zod schema cast to `any` to bridge zod v3 (project) and zod v4 (Firecrawl SDK bundled) type incompatibility"
metrics:
  duration: "~2 min"
  completed: "2026-02-26"
  tasks_completed: 2
  files_created: 2
  files_modified: 0
---

# Phase 2 Plan 03: Company Provider Adapters (AI Ark + Firecrawl) Summary

**One-liner:** AI Ark and Firecrawl company data adapters implementing CompanyAdapter with defensive auth handling and 30s safety timeout.

## What Was Built

Two company data provider adapters for the enrichment waterfall:

1. **`src/lib/enrichment/providers/aiark.ts`** — Primary company data provider. POSTs to `api.ai-ark.com` with domain filter, handles uncertain auth header with a defensive `AUTH_HEADER_NAME` constant and actionable 401/403 warning. Normalizes response (array, object, or `data`-wrapped) using `extractCompanies()`. Validates with loose Zod schema + `.passthrough()`.

2. **`src/lib/enrichment/providers/firecrawl-company.ts`** — Fallback company data provider. Uses Firecrawl v2 `FirecrawlClient.extract()` with a structured Zod schema and extraction prompt. Handles the zod v3/v4 type incompatibility with a runtime-safe cast. 30-second `Promise.race` safety timeout accounts for Firecrawl's slow extract.

## Task Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | AI Ark company data adapter | f1a0292 | src/lib/enrichment/providers/aiark.ts |
| 2 | Firecrawl company extract adapter | f166639 | src/lib/enrichment/providers/firecrawl-company.ts |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Firecrawl extract() call signature mismatch**
- **Found during:** Task 2 TypeScript verification
- **Issue:** Plan specified `client.extract(urls, params)` (2-arg form) but the default Firecrawl export is the v2 `FirecrawlClient` which only accepts 1 bundled-arg form: `client.extract({ urls, prompt, schema })`. The 2-arg form belongs to the legacy `FirecrawlApp` class.
- **Fix:** Changed to `client.extract({ urls: [...], prompt, schema })` matching the actual v2 SDK API
- **Files modified:** `src/lib/enrichment/providers/firecrawl-company.ts`
- **Commit:** f166639

**2. [Rule 2 - Missing critical functionality] Added Zod schema type cast for SDK incompatibility**
- **Found during:** Task 2 TypeScript verification
- **Issue:** Firecrawl SDK bundles its own zod v4 internally; the `schema` parameter is typed as `ZodTypeAny` from zod v4, but the project uses zod v3 — not structurally compatible at the type level (though identical at runtime)
- **Fix:** Cast `CompanyExtractSchema as any` with an explaining comment — runtime behavior unaffected
- **Files modified:** `src/lib/enrichment/providers/firecrawl-company.ts`
- **Commit:** f166639

## Decisions Made

- **AI Ark auth header:** Defaulted to `X-TOKEN` (most common pattern for "Header" auth scheme). If API returns 401/403, the adapter warns with the exact file location and fix instructions.
- **Firecrawl v2 API:** Discovered that default export is `FirecrawlClient` (v2), not `FirecrawlApp` (v1). This changes the `extract()` call signature from 2-arg to 1-arg bundled object.
- **Zod type bridge:** Used `as any` cast rather than converting schema to JSON Schema object — keeps Zod validation benefits while bypassing SDK type incompatibility. Comment documents why.

## Verification

- `npx tsc --noEmit` — 0 new errors (2 pre-existing errors in unrelated files: test mock type and missing worker module)
- `aiarkAdapter` exported, implements `CompanyAdapter`, handles auth failures defensively
- `firecrawlCompanyAdapter` exported, implements `CompanyAdapter`, uses `extract()` with Zod schema
- Neither adapter modifies existing codebase files

## Self-Check: PASSED
