---
phase: 67-cross-team-integration
plan: 01
subsystem: agents
tags: [cross-team, memory, notifications, monty, nova, orchestrator]

requires:
  - phase: 64-dev-agent
    provides: MontyDevOutput with affectsNova field, appendToMontyMemory function
  - phase: 65-qa-agent
    provides: MontyQAOutput with affectsNova field
  - phase: 66-security-agent
    provides: MontySecurityOutput with affectsNova field
provides:
  - Structured [CROSS-TEAM] prefix format on all Monty-to-Nova writes
  - Nova-to-Monty write helpers (notifyMontyOfPlatformIssue, notifyMontyOfApiError)
  - parseCrossTeamEntries utility for parsing cross-team entries from memory files
  - NovaCrossTeamFields interface for orchestrator use
  - changeType field on all Monty output types
affects: [67-02-PLAN, radar-health, monty-orchestrator]

tech-stack:
  added: []
  patterns: [structured cross-team prefix format, bidirectional agent memory writes]

key-files:
  created: []
  modified:
    - src/lib/agents/types.ts
    - src/lib/agents/memory.ts
    - src/lib/agents/monty-dev.ts
    - src/lib/agents/monty-qa.ts
    - src/lib/agents/monty-security.ts
    - src/lib/agents/orchestrator.ts

key-decisions:
  - "Cross-team prefix format: [CROSS-TEAM] [Source: X] [Type: Y] with optional [Workspace: Z] for Nova-to-Monty"
  - "Nova-to-Monty writes go to .monty/memory/incidents.md (platform issues and API errors)"
  - "parseCrossTeamEntries regex handles both em-dash and plain dash separators from appendToGlobalMemory/appendToMontyMemory"

patterns-established:
  - "Cross-team notification format: [CROSS-TEAM] [Source: agent-name] [Type: change-type] message"
  - "Nova-to-Monty direction includes [Workspace: slug] tag for workspace-scoped issues"

requirements-completed: [FOUND-09]

duration: 3min
completed: 2026-04-04
---

# Phase 67 Plan 01: Cross-Team Notification Format Summary

**Structured [CROSS-TEAM] prefix on all Monty agent writes plus Nova-to-Monty reverse write direction via orchestrator helpers**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-04T08:12:03Z
- **Completed:** 2026-04-04T08:15:22Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments
- All three Monty agents (dev, qa, security) now use structured `[CROSS-TEAM] [Source: monty-X] [Type: Y]` prefix instead of unstructured `[Monty X]` prefix
- Nova orchestrator has two exported helpers for writing platform issues and API errors to .monty/memory/incidents.md
- `parseCrossTeamEntries` utility parses cross-team entries from any memory file content, extracting timestamp, source, type, workspace, message, and direction

## Task Commits

Each task was committed atomically:

1. **Task 1: Add changeType to Monty output types and NovaCrossTeamFields** - `04115344` (feat)
2. **Task 2: Update Monty agent onComplete hooks with structured [CROSS-TEAM] prefix** - `99cded0a` (feat)
3. **Task 3: Add Nova-to-Monty write in orchestrator + parseCrossTeamEntries utility** - `fc8e1fc1` (feat)

## Files Created/Modified
- `src/lib/agents/types.ts` - Added changeType to MontyDevOutput/QAOutput/SecurityOutput interfaces and Zod schemas; added NovaCrossTeamFields interface
- `src/lib/agents/memory.ts` - Added CrossTeamEntry interface and parseCrossTeamEntries parser function
- `src/lib/agents/monty-dev.ts` - Updated onComplete hook and system prompt with [CROSS-TEAM] prefix format
- `src/lib/agents/monty-qa.ts` - Updated onComplete hook and system prompt with [CROSS-TEAM] prefix format
- `src/lib/agents/monty-security.ts` - Updated onComplete hook and system prompt with [CROSS-TEAM] prefix format
- `src/lib/agents/orchestrator.ts` - Added notifyMontyOfPlatformIssue and notifyMontyOfApiError helper functions

## Decisions Made
- Cross-team prefix uses structured bracket format for machine parseability: `[CROSS-TEAM] [Source: X] [Type: Y]`
- Nova-to-Monty writes target incidents.md since platform issues and API errors are incident-class events
- parseCrossTeamEntries regex accommodates both em-dash separator (from appendToMontyMemory) and space separator (from appendToGlobalMemory)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 02 can use parseCrossTeamEntries to build the radar health endpoint integration
- All cross-team write helpers are exported and ready for consumption
- NovaCrossTeamFields interface available for orchestrator onComplete hook extension

## Self-Check: PASSED

All 6 modified files exist. All 3 task commits verified.

---
*Phase: 67-cross-team-integration*
*Completed: 2026-04-04*
