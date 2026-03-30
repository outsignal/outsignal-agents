# Phase 58: End-to-End Validation - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning

<domain>
## Phase Boundary

The complete v8.0 quality system is confirmed working as a unit — all gates fire correctly in sequence, no silent failures, and the audit trail captures quality decisions end-to-end. This phase validates the work from Phases 52-57, it does not add new capabilities.

</domain>

<decisions>
## Implementation Decisions

### Test Scenarios + Coverage
- **Mocked unit tests + real API integration tests** — mocked tests for fast repeatable validation, real API tests for manual E2E walkthroughs that prove the actual pipeline works
- **4 core scenarios + additional edge cases**:
  1. Full happy path (discovery → quality gate → list build → write → validate → save)
  2. Deliberate violation + rewrite loop (banned phrases + wrong variables → validator catches → writer rewrites → clean save)
  3. LinkedIn-only channel routing (email enrichment skipped, cost report confirms, list has LinkedIn URLs only)
  4. Portal 422 hard-block (structural violations → HTTP 422 → error surfaced to user)
  5. Additional: budget exceeded warning, domain resolution with failures, cross-campaign overlap detection
- **Manual agent walkthrough** — run the agent through each scenario via CLI, verify outputs. Proves agent behaviour in real conditions. Faster to build than automated test harness.

### Test Workspace Setup
- **Dedicated test workspace** (e.g. slug: 'e2e-test') — isolated from real client data. Clean separation.
- **Pre-seeded data** — known set of leads, campaigns, and sequences. Tests validate behaviour against known data. Reproducible across runs.
- **Pre-configured memory** (.nova/memory/e2e-test/) — seed profile, ICP, tone prompt, etc. Tests validate agent behaviour with known context. Consistent across runs.

### Audit Trail Verification
- **All four audit types captured per quality gate**:
  1. Gate pass/fail result — check name, severity, outcome
  2. Rewrite loop details — original violation, attempt number, what changed, final result
  3. Cost per stage — discovery, enrichment, verification costs per pipeline run
  4. Validator findings — full ValidationResult logged alongside saved sequence
- **Stored in existing AgentRun model** — extend metadata/output fields to include quality gate results. No new tables.
- **Verify both outputs + audit entries** — E2E tests confirm correct pipeline outputs AND that audit trail entries exist for each gate. Proves nothing is silently swallowed.

### Failure Handling + Regression
- **Structured failure report** — each failure produces: scenario name, expected vs actual, which gate failed, reproduction steps. Saved to a file for review.
- **Individual scenario re-run** — each scenario can be run independently. Fix the issue, re-run just that scenario to confirm.
- **Key paths become regression tests** — the 4 core scenarios become repeatable tests that can be run before any future agent changes. Prevents regressions in v9.0+.

### Claude's Discretion
- Exact test workspace seed data (leads, companies, campaigns)
- Memory seed content for the test workspace
- How structured failure reports are formatted and stored
- Which edge case scenarios are prioritised beyond the core 4
- How regression test runner is structured for future use

</decisions>

<specifics>
## Specific Ideas

- The deliberate violation scenario is the most important test — it proves the full rewrite loop works: bad copy → structural check catches it → writer rewrites → validator confirms → clean save with audit trail
- Pre-seeded test workspace means anyone can reproduce the E2E validation at any time — useful for onboarding new team members or validating after changes
- Real API integration tests cost a few credits but prove the actual pipeline works end-to-end, which mocked tests cannot guarantee

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 58-end-to-end-validation*
*Context gathered: 2026-03-30*
