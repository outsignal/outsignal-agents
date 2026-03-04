---
phase: 17-leads-agent-discovery-upgrade
plan: 02
subsystem: agents
tags: [ai-sdk, zod, discovery, quota, dedup, system-prompt]

# Dependency graph
requires:
  - phase: 17-leads-agent-discovery-upgrade (plan 01)
    provides: deduplicateAndPromote() in promotion.ts, PROVIDER_COSTS, getWorkspaceQuotaUsage
provides:
  - buildDiscoveryPlan tool in leadsTools (quota projections, cost estimation)
  - deduplicateAndPromote tool in leadsTools (delegates to promotion.ts)
  - Upgraded LEADS_SYSTEM_PROMPT with 4-step plan-approve-execute-dedup flow
  - maxSteps increased to 15 for multi-source discovery flows
affects: [18-signal-pipeline, 20-creative-ideas, 21-cli-chat]

# Tech tracking
tech-stack:
  added: []
  patterns: [plan-approve-execute agent conversation pattern, soft quota warnings]

key-files:
  created: []
  modified:
    - src/lib/agents/leads.ts

key-decisions:
  - "z.record(z.string(), z.unknown()) for source filters -- Zod v3 requires explicit key type"
  - "AI Ark positioned as equal peer to Apollo/Prospeo in system prompt -- not a fallback source"
  - "Quota warning is soft limit -- agent warns but does not block execution per user decision"
  - "maxSteps 15 provides headroom for plan + 5 search calls + dedup + adjustments"

patterns-established:
  - "Plan-approve-execute: agent always builds plan first, waits for explicit approval, then executes"
  - "Tool-as-projection: buildDiscoveryPlan makes zero API calls, only computes projections from DB data"

requirements-completed: [DISC-07, DISC-08, DISC-11, DISC-12, DISC-13]

# Metrics
duration: 8min
completed: 2026-03-04
---

# Phase 17 Plan 02: Leads Agent Discovery Upgrade Summary

**buildDiscoveryPlan + deduplicateAndPromote tools wired into Leads Agent with 4-step plan-approve-execute-dedup system prompt and maxSteps 15**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-04T13:51:07Z
- **Completed:** 2026-03-04T13:59:00Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Two new tools added to leadsTools: buildDiscoveryPlan (quota/cost projections) and deduplicateAndPromote (staged lead promotion)
- System prompt completely rewritten with Discovery Workflow (Steps 1-4), Source Selection Guide, and approval gate rules
- AI Ark elevated from "secondary source" to equal peer alongside Apollo and Prospeo
- maxSteps bumped from 8 to 15 for multi-source discovery flows

## Task Commits

Each task was committed atomically:

1. **Task 1: Add buildDiscoveryPlan and deduplicateAndPromote tools** - `9a904d6` (feat)
2. **Task 2: Upgrade system prompt and increase maxSteps** - `e06f5e8` (feat)

## Files Created/Modified
- `src/lib/agents/leads.ts` - Two new tools (buildDiscoveryPlan, deduplicateAndPromote), rewritten system prompt, maxSteps 15

## Decisions Made
- Used `z.record(z.string(), z.unknown())` for source filters schema -- Zod v3 requires explicit key type for record schemas
- AI Ark positioned as equal peer to Apollo/Prospeo throughout source selection guide -- not a fallback
- Quota exceeded = soft warning only, agent does not block execution (user decision)
- maxSteps set to 15: plan (1) + up to 5 searches + dedup (1) + potential re-plan (1) = 8 minimum, 15 gives headroom

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Leads Agent now supports the full plan-approve-execute-dedup flow through natural language
- Phase 17 complete -- both plans done (plan 01: business logic, plan 02: agent layer)
- Ready for Phase 18 (signal pipeline) which builds on the discovery infrastructure

---
*Phase: 17-leads-agent-discovery-upgrade*
*Completed: 2026-03-04*
