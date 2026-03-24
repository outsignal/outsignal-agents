---
phase: 49-specialist-cli-skill-files
plan: 03
subsystem: agents
tags: [claude-code, skill-files, cli, orchestrator, agent-delegation]

requires:
  - phase: 49-specialist-cli-skill-files
    provides: Rules files for deliverability, onboarding, intelligence agents (Plan 01); canonical skill file pattern from writer/research/leads/campaign (Plan 02)
provides:
  - 3 new specialist skill files (deliverability, onboarding, intelligence)
  - Rewritten nova.md orchestrator with Agent tool delegation to all 7 specialists
  - Complete 8-file Nova agent team (orchestrator + 7 specialists)
affects: [50-orchestrator-cli-spawn-integration, 51-memory-accumulation-validation]

tech-stack:
  added: []
  patterns: [Agent tool delegation for subagent spawning, request pattern routing, multi-step pipeline chaining]

key-files:
  created:
    - .claude/commands/nova-deliverability.md
    - .claude/commands/nova-onboarding.md
    - .claude/commands/nova-intelligence.md
  modified:
    - .claude/commands/nova.md

key-decisions:
  - "nova-intelligence.md loads global-insights.md as 5th memory file — only agent with cross-client context"
  - "nova-onboarding.md includes cross-agent domain-health.js tool for DNS verification post-setup"
  - "nova.md orchestrator loads only profile+campaigns (not feedback/learnings) — specialist-level context stays with specialists"
  - "nova.md references campaign-rules.md which contains orchestrator delegation rules"

patterns-established:
  - "All 8 skill files follow identical pattern: frontmatter, role, ! cat memory injection, tools table, @rules reference, memory write-back, $ARGUMENTS"
  - "Orchestrator routes by request pattern to 7 specialists via Agent tool — zero API code"

requirements-completed: [SKL-05, SKL-06, SKL-07, SKL-08, SKL-09]

duration: 3min
completed: 2026-03-24
---

# Phase 49 Plan 03: Specialist Skill Files and Orchestrator Rewrite Summary

**3 new specialist skill files (deliverability, onboarding, intelligence) plus full nova.md rewrite from API orchestrator to Agent tool delegation across all 7 specialists**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-24T09:47:05Z
- **Completed:** 2026-03-24T09:50:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Created nova-deliverability.md (38 lines, 4 CLI tools, references deliverability-rules.md)
- Created nova-onboarding.md (41 lines, 5 CLI tools incl cross-agent domain-health.js, references onboarding-rules.md)
- Created nova-intelligence.md (40 lines, 4 CLI tools, loads global-insights.md as 5th memory file, references intelligence-rules.md)
- Fully rewrote nova.md from 74-line npx tsx API orchestrator to 98-line Agent tool delegation model
- All 8 Nova skill files now complete: orchestrator + writer + research + leads + campaign + deliverability + onboarding + intelligence

## Task Commits

Each task was committed atomically:

1. **Task 1: Create nova-deliverability.md, nova-onboarding.md, and nova-intelligence.md** - `c8e2508b` (feat)
2. **Task 2: Rewrite nova.md orchestrator for CLI delegation** - `5fec7ad0` (feat)

## Files Created/Modified
- `.claude/commands/nova-deliverability.md` - Deliverability specialist: sender-health, domain-health, bounce-stats, inbox-status
- `.claude/commands/nova-onboarding.md` - Onboarding guide: workspace-create, member-invite, workspace-get, package-update, domain-health
- `.claude/commands/nova-intelligence.md` - Analytics specialist: cached-metrics, insight-list, workspace-intelligence, campaigns-get + global-insights.md
- `.claude/commands/nova.md` - Orchestrator: routes to 7 specialists via Agent tool, multi-step chaining, workspace resolution

## Decisions Made
- nova-intelligence.md loads global-insights.md as a 5th file in the ! cat injection line — it is the only agent with cross-client context access, per locked research decision
- nova-onboarding.md includes domain-health.js from the deliverability tool set for DNS verification post-setup — cross-agent tool sharing is appropriate here
- nova.md orchestrator loads only profile + campaigns (2 files), not the full 4-file set — feedback and learnings are specialist-level context
- nova.md references campaign-rules.md (which already contains orchestrator delegation rules) rather than having a separate rules file

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 8 Nova skill files are complete and follow the canonical pattern
- All 7 rules files are in place (from Plan 01)
- Phase 49 is fully complete: 3 plans shipped
- Ready for Phase 50 (Orchestrator CLI Spawn Integration) which bridges dashboard UI to CLI agent delegation

---
*Phase: 49-specialist-cli-skill-files*
*Completed: 2026-03-24*
