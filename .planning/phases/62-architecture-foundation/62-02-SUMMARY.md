---
phase: 62-architecture-foundation
plan: 02
subsystem: agent-rules
tags: [monty, agent-team, rules, cli-harness, action-tiers]

# Dependency graph
requires:
  - phase: 62-01
    provides: "Directory structure and memory files"
provides:
  - "4 Monty agent rules files (orchestrator, dev, qa, security)"
  - "Dev-cli harness for Monty tool wrappers"
affects: [63-dev-cli-tools, 64-agent-definitions, 65-orchestrator, 66-security-hardening]

# Tech tracking
tech-stack:
  added: []
  patterns: ["3-tier action model (read-only/reversible/gated)", "memory write governance per agent", "team boundary enforcement with rejection instructions"]

key-files:
  created:
    - ".claude/rules/monty-orchestrator-rules.md"
    - ".claude/rules/monty-dev-rules.md"
    - ".claude/rules/monty-qa-rules.md"
    - ".claude/rules/monty-security-rules.md"
    - "scripts/dev-cli/_cli-harness.ts"
  modified: []

key-decisions:
  - "Rules files mirror Nova pattern (heading, purpose, sections) but cover platform engineering domain exclusively"
  - "Dev-cli harness is functionally identical to Nova's — namespace separation only"

patterns-established:
  - "3-tier action model: Tier 1 read-only (autonomous), Tier 2 reversible (logged to decisions.md), Tier 3 gated (explicit approval)"
  - "Memory write governance: each agent has explicit can-write and must-not-write lists"
  - "Team boundary: every agent has rejection instructions routing campaign work to Nova"
  - "QA minimum findings rule: at least 3 findings per review or explicit justification"
  - "Security deployment gate: critical/high findings block deployment until human override"

requirements-completed: [FOUND-04, FOUND-05]

# Metrics
duration: 3min
completed: 2026-04-03
---

# Phase 62 Plan 02: Agent Rules & Dev-CLI Harness Summary

**4 Monty agent rules files with 3-tier action model, team boundaries, and memory governance; dev-cli harness mirroring Nova's JSON envelope pattern**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-03T19:46:06Z
- **Completed:** 2026-04-03T19:48:42Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Created 4 rules files encoding behavioral boundaries for all Monty agents (orchestrator, dev, QA, security)
- Each rules file contains the 3-tier action model with concrete CLI commands per tier
- Established memory write governance preventing cross-agent file conflicts
- Created dev-cli harness ready for Phase 63 tool implementations

## Task Commits

Each task was committed atomically:

1. **Task 1: Create 4 Monty agent rules files** - `471d2890` (feat)
2. **Task 2: Create dev-cli harness** - `a94e5b03` (feat)

## Files Created/Modified
- `.claude/rules/monty-orchestrator-rules.md` - PM orchestrator: triage, delegation, backlog, boundary enforcement
- `.claude/rules/monty-dev-rules.md` - Dev generalist: code conventions, process flow, tier-specific commands
- `.claude/rules/monty-qa-rules.md` - QA reviewer: adversarial review, minimum findings rule, structured format
- `.claude/rules/monty-security-rules.md` - Security gate: trigger conditions, review checklist, deployment blocking
- `scripts/dev-cli/_cli-harness.ts` - Shared harness with runWithHarness export, JSON envelope, sanitization

## Decisions Made
- Rules files follow the same structural pattern as Nova rules (heading, purpose, sections) to maintain consistency
- Dev-cli harness is byte-for-byte identical in logic to Nova's harness — the only difference is the comment header and directory path

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 4 rules files are in place for agent definition in Phase 64
- Dev-cli harness is ready for Phase 63 tool implementations (git-status.ts, read-file.ts, etc.)
- Memory write governance patterns established for cross-agent coordination

---
*Phase: 62-architecture-foundation*
*Completed: 2026-04-03*
