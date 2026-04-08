---
phase: 72-adapter-implementations
plan: 03
subsystem: testing
tags: [vitest, adapter-contract, unit-tests, channel-adapters]

requires:
  - phase: 72-adapter-implementations (plans 01, 02)
    provides: LinkedInAdapter, EmailAdapter, sender-helpers, workspace-channels
provides:
  - Shared adapter contract test suite (reusable for future adapters)
  - Sender helper unit tests validating Prisma query construction
  - Workspace channel config tests covering all package mappings
affects: [73-deploy-refactor, future-adapter-additions]

tech-stack:
  added: []
  patterns: [parameterised-test-factory, contract-testing]

key-files:
  created:
    - src/lib/channels/__tests__/adapter-contract.test.ts
    - src/lib/channels/__tests__/sender-helpers.test.ts
    - src/lib/channels/__tests__/workspace-channels.test.ts
  modified: []

key-decisions:
  - "Used parameterised test factory pattern so future adapters run the same 8 contract tests automatically"
  - "Email adapter ref includes emailBisonCampaignId to exercise the EB client path (not early-return-empty)"
  - "MockEmailBisonClient uses class syntax (not vi.fn().mockImplementation) to satisfy `new` constructor requirement"

patterns-established:
  - "Contract test factory: runAdapterContractTests(name, createAdapter, expectedChannel, refOverrides)"
  - "Mock class pattern for EmailBisonClient in vitest (class MockEmailBisonClient with property assignments)"

requirements-completed: [ADAPT-03]

duration: 2min
completed: 2026-04-08
---

# Phase 72 Plan 03: Adapter Test Suite Summary

**Shared contract test factory validating both adapters against identical 8-test interface conformance suite, plus sender helper and workspace channel unit tests (28 new tests, 42 total)**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-08T14:10:54Z
- **Completed:** 2026-04-08T14:12:44Z
- **Tasks:** 2
- **Files created:** 3

## Accomplishments
- Parameterised contract test factory runs 8 interface conformance tests per adapter (16 total) -- both pass
- Sender helper tests verify Prisma query construction with correct channel filters and status
- Workspace channel tests cover all 4 package types plus unknown and empty string edge cases
- All 42 tests pass across 5 test files in the channels module

## Task Commits

Each task was committed atomically:

1. **Task 1: Create shared adapter contract test suite** - `934e7f63` (test)
2. **Task 2: Create sender helper and workspace channel tests** - `14aabc47` (test)

## Files Created/Modified
- `src/lib/channels/__tests__/adapter-contract.test.ts` - Parameterised contract test factory for both adapters (171 lines)
- `src/lib/channels/__tests__/sender-helpers.test.ts` - Sender channel filter and Prisma query verification (101 lines)
- `src/lib/channels/__tests__/workspace-channels.test.ts` - Package-to-channel mapping tests (35 lines)

## Decisions Made
- Used class syntax for MockEmailBisonClient instead of vi.fn().mockImplementation -- the latter fails with "is not a constructor" when the adapter calls `new EmailBisonClient()`
- Email adapter contract tests use emailBisonCampaignId: 123 to exercise the full EB client path rather than hitting the early-return-empty guard

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed EmailBisonClient mock constructor pattern**
- **Found during:** Task 1 (adapter contract tests)
- **Issue:** vi.fn().mockImplementation(() => ({...})) is not compatible with `new` keyword -- TypeError thrown
- **Fix:** Changed to class MockEmailBisonClient with instance property assignments
- **Files modified:** src/lib/channels/__tests__/adapter-contract.test.ts
- **Verification:** All 16 contract tests pass
- **Committed in:** 934e7f63 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Mock pattern fix was necessary for test correctness. No scope creep.

## Issues Encountered
None beyond the mock constructor fix documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 72 (Adapter Implementations) is now complete -- all 3 plans done
- Phase 73 (Deploy Refactor) can proceed with confidence that both adapters conform to the contract
- Any future adapter additions can use the runAdapterContractTests factory to validate conformance

## Self-Check: PASSED

All 3 created files verified on disk. Both commit hashes (934e7f63, 14aabc47) found in git log.

---
*Phase: 72-adapter-implementations*
*Completed: 2026-04-08*
