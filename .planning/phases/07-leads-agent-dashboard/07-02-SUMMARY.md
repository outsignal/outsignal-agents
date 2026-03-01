---
phase: 07-leads-agent-dashboard
plan: 02
subsystem: api
tags: [ai-sdk, anthropic, agents, leads, operations]

# Dependency graph
requires:
  - phase: 07-01
    provides: operations.ts shared layer (searchPeople, createList, addPeopleToList, getList, getLists, scoreList, exportListToEmailBison)
  - phase: runner.ts
    provides: runAgent() core execution engine with AgentRun audit trail
provides:
  - Leads Agent configuration, tools, and runLeadsAgent() entry point (src/lib/agents/leads.ts)
  - Updated LeadsInput/LeadsOutput types for conversational agent pattern
affects: [07-03-dashboard-chat, 07-05-mcp-tools, orchestrator]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Thin tool wrapper pattern: agent tools delegate entirely to operations.ts, zero business logic in closures"
    - "Credit-gate pattern: system prompt instructs agent to preview costly operations before executing"
    - "Conversational refinement: agent uses prior context to refine searches rather than starting fresh"

key-files:
  created:
    - src/lib/agents/leads.ts
  modified:
    - src/lib/agents/types.ts

key-decisions:
  - "LeadsOutput loosened to action/summary/data — conversational agent returns text, not rigid struct"
  - "LeadsInput.workspaceSlug made optional — agent can operate without workspace context for global searches"
  - "conversationContext field added to LeadsInput — enables chat UI to pass prior search results for refinement"
  - "Tool descriptions include credit-gate warnings inline — agent knows which ops cost credits without needing to check"

patterns-established:
  - "Agent file pattern: tools -> system prompt -> config -> runXxxAgent() -> buildXxxMessage() -> exports"
  - "Zero Prisma in agent files: all DB access goes through operations.ts"

requirements-completed: [LEAD-01, LEAD-02, LEAD-03, LEAD-04, LEAD-06]

# Metrics
duration: 3min
completed: 2026-02-27
---

# Phase 7 Plan 02: Leads Agent Summary

**Leads Agent with 7 operation-backed tools, credit-gate system prompt, and runLeadsAgent() entry point backed by runAgent() for automatic AgentRun audit trail**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-27T18:27:35Z
- **Completed:** 2026-02-27T18:30:01Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Created `src/lib/agents/leads.ts` with 7 tools wrapping the operations layer (searchPeople, createList, addPeopleToList, getList, getLists, scoreList, exportListToEmailBison)
- Updated `LeadsInput`/`LeadsOutput` types in types.ts to match conversational agent pattern
- System prompt enforces credit-gate, conversational refinement, and friendly-brief voice
- `runLeadsAgent()` calls `runAgent()` which auto-creates AgentRun audit record (satisfies LEAD-06)

## Task Commits

Each task was committed atomically:

1. **Task 1: Update LeadsInput and LeadsOutput types** - `109aebb` (feat)
2. **Task 2: Create Leads Agent with tools and system prompt** - `dc4b66d` (feat)

**Plan metadata:** (to be committed with this SUMMARY.md)

## Files Created/Modified

- `src/lib/agents/leads.ts` — Leads Agent: 7 tool definitions, LEADS_SYSTEM_PROMPT, leadsConfig, runLeadsAgent(), buildLeadsMessage(), exports
- `src/lib/agents/types.ts` — LeadsInput and LeadsOutput interfaces updated for conversational pattern

## Decisions Made

- LeadsOutput kept intentionally loose (action/summary/data) because the Leads Agent is conversational — it returns natural language text, not a rigid structured response
- workspaceSlug made optional in LeadsInput so the agent can handle global queries ("show me all lists") without requiring a workspace filter
- conversationContext field added to pass prior chat context for search refinement
- Tool descriptions embed credit-gate warnings inline so the agent has context at the tool level

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. TypeScript type-check passed with zero project-level errors. All plan verification checks passed:
- 0 direct Prisma calls in leads.ts
- 7 operations. calls (one per tool)
- runAgent() called in runLeadsAgent()
- 227 lines (well above 120 minimum)

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Leads Agent is ready to be integrated into the dashboard chat API (07-03)
- runLeadsAgent() can be called directly from orchestrator or chat route
- All 7 operations from Plan 01 are now accessible via natural language
- LEAD-01 through LEAD-04 and LEAD-06 satisfied

## Self-Check: PASSED

- FOUND: src/lib/agents/leads.ts
- FOUND: src/lib/agents/types.ts
- FOUND: .planning/phases/07-leads-agent-dashboard/07-02-SUMMARY.md
- FOUND commit: 109aebb (Task 1)
- FOUND commit: dc4b66d (Task 2)

---
*Phase: 07-leads-agent-dashboard*
*Completed: 2026-02-27*
