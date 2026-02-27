---
phase: "02"
plan: "06"
subsystem: enrichment
tags: [ai-ark, person-adapter, waterfall, gap-closure, PROV-02, ENRICH-02]
dependency_graph:
  requires: ["02-03", "02-04"]
  provides: ["PROV-02", "ENRICH-02"]
  affects: ["waterfall.ts", "aiark-person.ts", "types.ts"]
tech_stack:
  added: []
  patterns: ["PersonAdapter type pattern", "PersonProviderResult interface", "pre-email person-data enrichment step"]
key_files:
  created:
    - src/lib/enrichment/providers/aiark-person.ts
  modified:
    - src/lib/enrichment/types.ts
    - src/lib/enrichment/waterfall.ts
decisions:
  - "AI Ark person step implemented as pre-email block (not EMAIL_PROVIDERS entry) — PersonAdapter return type differs from EmailAdapter"
  - "No-cost empty result returned when neither LinkedIn URL nor name+company available — avoids unnecessary API calls"
  - "costUsd=0 guard prevents recording enrichment when no API call was made"
  - "AI Ark email result triggers early return — treated as waterfall success same as any email provider"
metrics:
  duration_minutes: 5
  completed_date: "2026-02-26"
  tasks_completed: 2
  files_modified: 3
---

# Phase 02 Plan 06: AI Ark Person Adapter + Waterfall Gap Closure Summary

**One-liner:** AI Ark `/v1/people` person adapter with PersonAdapter/PersonProviderResult types wired into enrichEmail waterfall as a pre-email person-data enrichment step, closing PROV-02 and ENRICH-02 gaps.

## What Was Built

### Task 1: AI Ark person data adapter (commit `4daccb8`)

**`src/lib/enrichment/types.ts`** — Added two new exports:
- `PersonProviderResult` interface: email, firstName, lastName, jobTitle, linkedinUrl, location, company, companyDomain, source, rawResponse, costUsd
- `PersonAdapter` type: `(input: EmailAdapterInput) => Promise<PersonProviderResult>`

**`src/lib/enrichment/providers/aiark-person.ts`** (new, 191 lines) — Full adapter implementation:
- Endpoint: `POST https://api.ai-ark.com/api/developer-portal/v1/people`
- Auth: `X-TOKEN` header (LOW confidence — same warning comment as `aiark.ts`)
- Timeout: 10 seconds via AbortController
- Input strategy: LinkedIn URL preferred → falls back to first_name + last_name + company
- Returns zero-cost empty result when neither identifier is available (no API call)
- Loose Zod schema with `.passthrough()` — maps `title` → `jobTitle`, `company.name` → `company`, `company.domain` → `companyDomain`
- Error handling: 401/403 warns about AUTH_HEADER_NAME, 429 attaches `.status` for retry, 404/422 permanent error
- Cost: `PROVIDER_COSTS.aiark` ($0.003)
- Export: `aiarkPersonAdapter: PersonAdapter`

### Task 2: Wire AI Ark person adapter into enrichEmail waterfall (commit `248ffc4`)

**`src/lib/enrichment/waterfall.ts`** — Updated enrichEmail orchestration:
- Added imports for `aiarkPersonAdapter`, `PersonAdapter`, `PersonProviderResult`
- Updated top-level comment to reflect new order: `AI Ark (person data) → Prospeo → LeadMagic → FindyMail`
- Added AI Ark person-data block BEFORE the email-finding loop:
  - Same circuit breaker check (`aiark` key, threshold 5)
  - Same dedup gate via `shouldEnrich(personId, "person", "aiark")`
  - Same daily cap check
  - Same 3-attempt retry loop with exponential backoff on 429
  - Merges all person fields via `mergePersonData()` (firstName, lastName, jobTitle, linkedinUrl, location, company, companyDomain, email)
  - Runs `classifyJobTitle` and `classifyCompanyName` normalizers inline after merge
  - If AI Ark returns an email → early return (waterfall stops, same as any email provider)
  - If AI Ark returns person data but no email → continues to email providers
  - If no API call made (costUsd=0) → no enrichment log recorded, no spend incremented

## Verification Results

- TypeScript compilation: no new errors in enrichment files (pre-existing test file error unrelated)
- `aiarkPersonAdapter` exported from `src/lib/enrichment/providers/aiark-person.ts`
- `PersonAdapter` and `PersonProviderResult` exported from `src/lib/enrichment/types.ts`
- `waterfall.ts` imports and calls `aiarkPersonAdapter` before EMAIL_PROVIDERS loop
- Effective enrichEmail waterfall order: AI Ark (person data) → Prospeo → LeadMagic → FindyMail

## Deviations from Plan

None — plan executed exactly as written.

## Decisions Made

1. **AI Ark as pre-loop block, not EMAIL_PROVIDERS entry** — The plan explicitly called for this. `PersonAdapter` returns `PersonProviderResult` (not `EmailProviderResult`) so it cannot be placed in the `EMAIL_PROVIDERS` array which expects `EmailAdapter`. Implemented as a clearly-demarcated block with identical guard patterns.

2. **Zero-cost guard for no-identifier case** — When `aiarkPersonAdapter` returns `costUsd: 0` (no API call made because no LinkedIn URL or name+company available), the waterfall skips recording an enrichment log entry and skips `incrementDailySpend`. This avoids polluting the dedup gate with a "success" record that would block future enrichment if better identifiers become available.

3. **Email in AI Ark result triggers early return** — Consistent with the plan's stated behavior: "If AI Ark returns an email, treat that as a waterfall success and return early."

## Requirements Closed

- **PROV-02**: AI Ark person data adapter now exists at `src/lib/enrichment/providers/aiark-person.ts` — previously only the company adapter existed
- **ENRICH-02**: enrichEmail waterfall now includes AI Ark, matching the documented Prospeo → AI Ark → LeadMagic → FindyMail order

## Self-Check: PASSED

Files exist:
- FOUND: src/lib/enrichment/providers/aiark-person.ts
- FOUND: src/lib/enrichment/types.ts (modified)
- FOUND: src/lib/enrichment/waterfall.ts (modified)

Commits exist:
- FOUND: 4daccb8 (Task 1)
- FOUND: 248ffc4 (Task 2)
