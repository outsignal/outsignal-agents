---
phase: 01-enrichment-foundation
plan: 02
subsystem: api
tags: [ai-sdk, anthropic, zod, normalizer, classification, vitest]

# Dependency graph
requires:
  - phase: none
    provides: src/lib/normalize.ts (existing rule-based normalizeCompanyName used as fast path)
provides:
  - CANONICAL_VERTICALS (23 items) and SENIORITY_LEVELS (8 items) controlled vocabulary
  - classifyIndustry — maps raw industry strings to canonical verticals via exact match + Claude Haiku
  - classifyCompanyName — normalizes company names via rule-based fast path + Claude Haiku for noisy inputs
  - classifyJobTitle — extracts canonical title and seniority level via regex patterns + Claude Haiku
  - Barrel index at src/lib/normalizer/index.ts re-exporting all classifiers and vocabulary
affects: [01-03, 01-04, 01-05, enrichment-pipeline, people-enrich, companies-enrich]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Rule-based fast path + AI fallback: exact/regex match (free) before Claude Haiku call (cheap)"
    - "generateObject with Zod enum schema to constrain AI output to controlled vocabulary"
    - "Graceful degradation: all classifiers catch errors and return safe fallback (null or rule-based result)"

key-files:
  created:
    - src/lib/normalizer/vocabulary.ts
    - src/lib/normalizer/industry.ts
    - src/lib/normalizer/company.ts
    - src/lib/normalizer/job-title.ts
    - src/lib/normalizer/index.ts
    - src/__tests__/normalizer.test.ts
  modified: []

key-decisions:
  - "Rule-based fast path before AI: exact case-insensitive match for industry, mixed-case heuristic for company, regex seniority patterns for job titles — avoids AI cost on clean data"
  - "Low confidence AI returns are treated as null/fallback rather than propagating uncertain data"
  - "classifyCompanyName falls back to rule-based normalizeCompanyName (not null) on AI failure — preserves some normalization"
  - "CEO and all-uppercase titles bypass rule-based path (isCleanTitle condition) and go to AI — tested explicitly"

patterns-established:
  - "Normalizer pattern: rule-based fast path with AI escalation for ambiguous/noisy inputs"
  - "Zod enum from const array: z.enum(ARRAY as unknown as [string, ...string[]]) for tuple constraint"
  - "Test mocking: vi.mock('ai') + vi.mock('@ai-sdk/anthropic') before classifier imports"

requirements-completed: [AI-01, AI-02, AI-03]

# Metrics
duration: 3min
completed: 2026-02-26
---

# Phase 1 Plan 02: AI Normalizer Classifiers Summary

**Three Claude Haiku classifiers (industry, company name, job title) with rule-based fast paths and Zod-constrained generateObject output — replacing Clay's AI normalization with a self-hosted pipeline.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-26T16:41:07Z
- **Completed:** 2026-02-26T16:44:30Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Controlled vocabulary constants: 23 canonical verticals, 8 seniority levels (type-safe `as const` arrays)
- classifyIndustry: case-insensitive exact match fast path, Claude Haiku fallback, low-confidence returns null
- classifyCompanyName: imports existing normalizeCompanyName for clean inputs, AI for all-caps/noisy/legal-suffix names
- classifyJobTitle: regex seniority pattern matching for clean mixed-case titles, AI for all-caps/messy titles, result includes canonical + seniority
- 18 unit tests covering rule-based fast paths (no AI calls), mocked AI paths, and error handling

## Task Commits

Each task was committed atomically:

1. **Task 1: Vocabulary constants and three classifier modules** - `797b5ff` (feat)
2. **Task 2: Unit tests for all three classifiers** - `e1fca46` (test)

**Plan metadata:** (docs commit pending)

## Files Created/Modified
- `src/lib/normalizer/vocabulary.ts` - CANONICAL_VERTICALS (23 items) and SENIORITY_LEVELS (8 items) as const arrays with TypeScript types
- `src/lib/normalizer/industry.ts` - classifyIndustry: exact match fast path + Claude Haiku via generateObject with Zod enum
- `src/lib/normalizer/company.ts` - classifyCompanyName: rule-based fast path (imports normalizeCompanyName) + AI for noisy inputs
- `src/lib/normalizer/job-title.ts` - classifyJobTitle: regex seniority patterns + AI fallback, returns JobTitleResult {canonical, seniority}
- `src/lib/normalizer/index.ts` - barrel re-exports for all classifiers, types, and vocabulary constants
- `src/__tests__/normalizer.test.ts` - 18 tests: fast paths skip AI, AI paths use mocked generateObject, errors handled gracefully

## Decisions Made
- Rule-based fast paths before AI calls prevent unnecessary spend on clean/exact-match data
- Low-confidence AI responses (confidence: "low") are discarded (returns null or falls back to rule-based) — prevents propagation of uncertain data
- classifyCompanyName falls back to rule-based result on AI error rather than null — preserves some normalization quality
- isCleanTitle heuristic: `trimmed !== trimmed.toUpperCase()` excludes all-caps inputs (like "CEO") from fast path, ensuring they get AI treatment for proper canonical form

## Deviations from Plan

**1. Adjusted test for "CEO" fast path behavior (plan clarification, not a code change)**
- The plan noted CEO's behavior was ambiguous and said to "adjust test expectations to match actual classifier behavior"
- Traced the isCleanTitle logic: "CEO".toUpperCase() === "CEO" → isCleanTitle is false → AI path taken
- Wrote test accordingly: `escalates all-caps title to AI (CEO bypasses rule-based fast path)` with mock setup
- No code was changed from the plan — tests were written to match actual behavior as instructed

---

**Total deviations:** 1 clarification (not an auto-fix, plan explicitly anticipated this)
**Impact on plan:** None — code matches plan exactly. Test behavior clarification was expected per plan instructions.

## Issues Encountered
- Pre-existing TypeScript error in `src/__tests__/emailbison-client.test.ts:76` (unrelated `global.fetch` mock type mismatch) — out of scope, not modified
- All normalizer files compile cleanly with zero errors

## User Setup Required
None - no external service configuration required. The classifiers use the existing `ANTHROPIC_API_KEY` environment variable via the already-installed `@ai-sdk/anthropic` package.

## Next Phase Readiness
- All three classifier functions are ready for use by enrichment pipeline in subsequent plans
- Import from `@/lib/normalizer` to access classifyIndustry, classifyCompanyName, classifyJobTitle
- Vocabulary constants available for schema validation or UI display
- Rule-based fast paths ensure zero AI cost for exact-match / already-clean data

---
*Phase: 01-enrichment-foundation*
*Completed: 2026-02-26*

## Self-Check: PASSED

- FOUND: src/lib/normalizer/vocabulary.ts
- FOUND: src/lib/normalizer/industry.ts
- FOUND: src/lib/normalizer/company.ts
- FOUND: src/lib/normalizer/job-title.ts
- FOUND: src/lib/normalizer/index.ts
- FOUND: src/__tests__/normalizer.test.ts
- FOUND commit: 797b5ff (feat: vocabulary + classifiers)
- FOUND commit: e1fca46 (test: normalizer tests)
