# Phase 51: Memory Accumulation and Full Validation - Context

**Gathered:** 2026-03-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Validate the full Nova CLI agent system end-to-end. Run real sessions against a real workspace, verify memory accumulates with timestamped entries, confirm context doesn't overflow, and smoke-test the dashboard bridge. This is a validation phase, not a feature-building phase — the system is built, this phase proves it works.

</domain>

<decisions>
## Implementation Decisions

### Test target and scenarios
- **Primary test workspace: Rise** — most mature client, has campaigns, reply data, full ICP. Best for proving real-world functionality.
- **Test approach: individual agents first, then full pipeline** — test `/nova-writer rise`, `/nova-leads rise`, `/nova-intelligence rise` etc. in isolation first, then run the full orchestrator pipeline via `/nova rise`.
- **Pipeline test request:** "Create a full campaign for Rise targeting UK marketing directors" — tests complete pipeline including lead discovery and campaign creation. Will create real DB records.
- **No cleanup after testing** — draft campaigns and discovered leads are harmless. Nothing gets published or sent.

### Dashboard chat validation (simplified)
- **VAL-02: smoke test only** — set `USE_CLI_AGENTS=true` locally, send one request through the dashboard chat API, confirm it doesn't crash. No quality comparison against API path. User does not use dashboard chat.
- **VAL-05: smoke test only** — set `USE_CLI_AGENTS=false`, send one request, confirm API path works without errors. The inline code paths are unchanged from pre-v7.0.

### Memory accumulation proof
- **Manual inspection** — run 2 sessions with `/nova-writer rise` and `/nova-intelligence rise`. Then cat the memory files and check for new ISO-timestamped entries. No automated diff scripts.
- **Test agents: writer + intelligence** — writer produces copy wins/preferences (writes to campaigns.md, feedback.md). Intelligence produces analytics patterns (writes to learnings.md, global-insights.md). Both have clear write targets.
- **Not all 7 agents** — onboarding and deliverability may not produce writeable insights in a test scenario. Writer + intelligence cover the memory mechanism adequately.

### Context overflow check
- **Token count estimation** — cat all Rise memory files + global-insights.md and estimate token count. Document a ceiling budget ("memory should stay under X tokens total per workspace"). No need to run a full session to prove current state doesn't overflow — files are small now.
- **The real overflow risk is future accumulation** — documenting the budget ceiling is more useful than proving today's small files fit.

### Validation format
- **One-time manual validation** — run the tests once, document results in VERIFICATION.md (pass/fail per criterion). No repeatable test scripts. This is a milestone validation, not a regression suite.

### Claude's Discretion
- Order of individual agent tests
- Exact dashboard chat API requests for smoke tests
- Token counting method (wc -c estimate vs tokenizer)
- How to structure the validation report

</decisions>

<specifics>
## Specific Ideas

- The individual agent tests should exercise each specialist's core capability: writer generates copy, leads searches people, research crawls a site, campaign creates an entity, intelligence analyzes metrics, deliverability checks domain health, onboarding shows the setup flow
- Memory write-back is at the agent's discretion — not every session will produce a writeable insight. The test should run sessions that are likely to produce insights (e.g., writer after generating copy, intelligence after reviewing metrics)
- The token budget ceiling should account for growth — if Rise has 4 files at ~500 tokens each now, document what happens when they each grow to ~5,000 tokens

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 51-memory-accumulation-and-full-validation*
*Context gathered: 2026-03-24*
