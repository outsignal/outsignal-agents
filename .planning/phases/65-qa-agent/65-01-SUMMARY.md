---
phase: 65-qa-agent
plan: 01
subsystem: agents
tags: [monty, qa, adversarial-review, zod, ai-sdk]

requires:
  - phase: 64-orchestrator-dev-generalist
    provides: "AgentConfig, runAgent, memory utilities, dev-cli pattern"
provides:
  - "MontyQAInput, MontyQAFinding, MontyQAOutput types"
  - "montyQAOutputSchema Zod runtime validation"
  - "monty-qa.ts agent module with 6 read-only tools"
  - "runMontyQAAgent export for orchestrator delegation"
affects: [65-02 orchestrator integration, 66-security-agent]

tech-stack:
  added: []
  patterns: ["QA agent as adversarial reviewer with minimum findings rule", "Read-only tool subset for QA (no git write, no deploy)"]

key-files:
  created: [src/lib/agents/monty-qa.ts]
  modified: [src/lib/agents/types.ts]

key-decisions:
  - "QA agent gets 6 of 9 dev tools (no gitStatus, gitLog, deployStatus) — read-only review scope"
  - "Minimum 3 findings rule enforced via system prompt — prevents rubber-stamping"
  - "onComplete filters for critical/high severity only when writing to incidents.md"

patterns-established:
  - "QA agent onComplete: critical/high -> incidents.md, affectsNova -> global-insights.md"
  - "buildQAMessage formats task + optional changedFiles list for orchestrator handoff"

requirements-completed: [QA-01, QA-02, QA-03, QA-04, QA-05, QA-06, QA-07, QA-08]

duration: 2min
completed: 2026-04-04
---

# Phase 65 Plan 01: QA Agent Module Summary

**Adversarial QA agent with 6 read-only tools, minimum 3 findings enforcement, and cross-team incident reporting via memory hooks**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-04T07:30:25Z
- **Completed:** 2026-04-04T07:32:47Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- MontyQAInput, MontyQAFinding, MontyQAOutput types and montyQAOutputSchema added to types.ts
- monty-qa.ts created with 6 read-only tools (checkTypes, runTests, readFile, listFiles, searchCode, gitDiff)
- Adversarial system prompt enforces minimum 3 findings per review with severity-based categorisation
- onComplete hook writes critical/high findings to .monty/memory/incidents.md and cross-team findings to .nova/memory/global-insights.md

## Task Commits

Each task was committed atomically:

1. **Task 1: Add MontyQA types and output schema** - `e7059d58` (feat)
2. **Task 2: Create monty-qa.ts agent module** - `557aca81` (feat)

## Files Created/Modified
- `src/lib/agents/types.ts` - Added MontyQAInput, MontyQAFinding, MontyQAOutput interfaces and montyQAOutputSchema
- `src/lib/agents/monty-qa.ts` - QA agent with 6 tools, adversarial system prompt, onComplete hooks, runMontyQAAgent export

## Decisions Made
- QA agent gets 6 of 9 dev tools (excluded gitStatus, gitLog, deployStatus) to enforce read-only review scope
- Minimum 3 findings rule enforced via system prompt, not code — keeps the constraint flexible for the LLM to justify clean reviews
- onComplete filters findings by severity (critical/high only) before writing to incidents.md to avoid noise

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- runMontyQAAgent is exported and ready for orchestrator delegation in Plan 02
- montyQAConfig follows the exact AgentConfig pattern for registration in the orchestrator

## Self-Check: PASSED

All files exist, all commits verified.

---
*Phase: 65-qa-agent*
*Completed: 2026-04-04*
