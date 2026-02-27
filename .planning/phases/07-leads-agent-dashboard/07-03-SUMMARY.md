---
phase: 07-leads-agent-dashboard
plan: "03"
subsystem: api
tags: [ai-sdk, orchestrator, leads-agent, vercel, streaming]

# Dependency graph
requires:
  - phase: 07-leads-agent-dashboard
    plan: "02"
    provides: "runLeadsAgent() function with 7 tools and LeadsInput/LeadsOutput types"
provides:
  - "Live delegateToLeads tool in orchestrator that calls runLeadsAgent()"
  - "Orchestrator system prompt updated to describe Leads Agent as active"
  - "Chat route with maxDuration = 300 for Vercel timeout prevention"
affects: [08-target-lists-ui, 09-client-portal, 10-campaign-deploy]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Vercel route segment config (export const maxDuration) on long-running chat routes"
    - "Orchestrator delegation pattern: tool() wrapper calls runAgent() via import"

key-files:
  created: []
  modified:
    - src/lib/agents/orchestrator.ts
    - src/app/api/chat/route.ts

key-decisions:
  - "Removed limit param from delegateToLeads inputSchema — Leads Agent handles pagination internally via its own tools"
  - "maxDuration set to 300s (5 minutes) to accommodate worst-case scoring/export for large lists"
  - "delegateToLeads made workspaceSlug optional (was required) — Leads Agent can operate workspace-agnostic for searches"

patterns-established:
  - "Delegation tools: thin tool() wrappers that import and call runAgent()-backed functions"
  - "Orchestrator system prompt routing examples kept current as agents go live"

requirements-completed: [LEAD-01, LEAD-02, LEAD-03, LEAD-04, LEAD-06]

# Metrics
duration: 1min
completed: 2026-02-27
---

# Phase 7 Plan 03: Orchestrator Wiring Summary

**delegateToLeads tool wired to call runLeadsAgent(), completing the full chat → orchestrator → Leads Agent → operations chain; maxDuration = 300 added to prevent Vercel timeout on scoring/export**

## Performance

- **Duration:** 1 min
- **Started:** 2026-02-27T18:32:41Z
- **Completed:** 2026-02-27T18:34:03Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Replaced `not_available` stub in `delegateToLeads` with live implementation calling `runLeadsAgent()`
- Added `import { runLeadsAgent } from "./leads"` to orchestrator
- Removed stale `limit` param from `delegateToLeads` inputSchema (Leads Agent handles pagination internally)
- Updated orchestrator system prompt: Leads Agent described as live with concrete routing examples (search, create list, score, export)
- Added `export const maxDuration = 300` to chat route — prevents Vercel Hobby plan 10s timeout during scoring/export

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire delegateToLeads to call runLeadsAgent** - `59f5a15` (feat)
2. **Task 2: Add maxDuration to chat route** - `df9080e` (chore)

**Plan metadata:** (docs commit below)

## Files Created/Modified
- `src/lib/agents/orchestrator.ts` - Added runLeadsAgent import; replaced not_available stub with live delegateToLeads; updated system prompt routing examples
- `src/app/api/chat/route.ts` - Added `export const maxDuration = 300` route segment config

## Decisions Made
- Removed `limit` from `delegateToLeads` inputSchema — the Leads Agent's `searchPeople` tool handles pagination with its own `limit` and `page` params; no need to duplicate at the orchestrator level
- `workspaceSlug` made optional in `delegateToLeads` (it was required in the stub) — matches `LeadsInput` type from Plan 02 where workspaceSlug is optional for workspace-agnostic searches
- maxDuration 300 (not 60) — research identified worst-case scoring for large lists can approach 300s

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None — TypeScript compiled cleanly on first attempt.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Full chain complete: chat → orchestrator → Leads Agent → operations layer → Prisma
- Leads Agent is now reachable from Cmd+J chat interface
- All LEAD-01 through LEAD-04 and LEAD-06 requirements satisfied end-to-end
- Ready for Phase 8: Target Lists UI (display lists created by the agent in the dashboard)

---
*Phase: 07-leads-agent-dashboard*
*Completed: 2026-02-27*
