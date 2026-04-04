---
phase: 66-security-agent
plan: 01
subsystem: agents
tags: [security, owasp, npm-audit, monty, agent]

requires:
  - phase: 65-qa-agent
    provides: QA agent pattern (monty-qa.ts) cloned for security agent
  - phase: 64-orchestrator-dev-generalist
    provides: Dev-CLI tools, runner.ts, memory utilities, AgentConfig pattern
provides:
  - MontySecurityInput/Output/Finding types and montySecurityOutputSchema in types.ts
  - monty-security.ts agent module with 7 tools, OWASP system prompt, onComplete hooks
  - runMontySecurityAgent export for orchestrator integration
affects: [66-02 orchestrator-security-integration]

tech-stack:
  added: []
  patterns: [security-agent-pattern, npm-audit-non-zero-exit-handling, deployment-gate-via-blockDeploy]

key-files:
  created: [src/lib/agents/monty-security.ts]
  modified: [src/lib/agents/types.ts]

key-decisions:
  - "MontyMemoryFile already includes security.md -- no change needed to memory.ts"
  - "npmAudit tool handles non-zero exit codes by catching execSync error and parsing error.stdout"
  - "No minimum findings rule for security (unlike QA) -- false positives erode trust"
  - "Security findings use remediation (not suggestion) and have no info severity level"

patterns-established:
  - "Security agent pattern: read-only reviewer with deployment gate (blockDeploy + gateReason)"
  - "npmAudit non-zero exit handling: try/catch with error.stdout parsing for npm audit --json"

requirements-completed: [SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, SEC-06, SEC-07]

duration: 2min
completed: 2026-04-04
---

# Phase 66 Plan 01: Security Agent Module Summary

**Security agent with 7 tools (6 dev-cli + npmAudit), OWASP Top 10:2025 system prompt, deployment gate via blockDeploy, and memory write-back hooks for security.md and global-insights.md**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-04T07:50:34Z
- **Completed:** 2026-04-04T07:52:53Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- MontySecurityInput, MontySecurityFinding, MontySecurityOutput types and montySecurityOutputSchema added to types.ts
- monty-security.ts created with 7 tools, OWASP Top 10:2025 system prompt, credential scanning guidance, auth flow review checklist
- onComplete hooks write critical/high findings to .monty/memory/security.md and cross-team notifications to .nova/memory/global-insights.md
- npmAudit tool correctly handles non-zero exit codes from npm audit

## Task Commits

Each task was committed atomically:

1. **Task 1: Add MontySecurityInput/Output/Finding types and output schema to types.ts** - `2984a568` (feat)
2. **Task 2: Create monty-security.ts agent module** - `c9882997` (feat)

## Files Created/Modified
- `src/lib/agents/types.ts` - Added MontySecurityInput/Output/Finding interfaces and montySecurityOutputSchema
- `src/lib/agents/monty-security.ts` - Security agent with 7 tools, OWASP system prompt, deployment gate, memory hooks

## Decisions Made
- MontyMemoryFile type in memory.ts already includes "security.md" (added in Phase 62) -- no modification needed
- npmAudit tool uses try/catch with error.stdout parsing since npm audit exits non-zero when vulnerabilities exist
- Security agent has NO minimum findings rule (unlike QA agent which requires 3+) -- only real vulnerabilities reported
- Security findings use "remediation" field instead of "suggestion" to emphasize actionable fixes
- Severity levels exclude "info" (QA has it) -- security findings must always be actionable

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- monty-security.ts ready for orchestrator integration in 66-02
- runMontySecurityAgent export available for delegateToSecurity tool replacement
- blockDeploy flag ready for orchestrator pipeline gating

---
*Phase: 66-security-agent*
*Completed: 2026-04-04*
