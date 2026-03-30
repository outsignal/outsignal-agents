---
phase: 52-copy-quality-module-model-upgrade
plan: 02
subsystem: agents
tags: [claude-opus-4-6, model-upgrade, nova-agents, ai-sdk]

# Dependency graph
requires: []
provides:
  - NOVA_MODEL constant for centralised model management
  - All 5 Nova agents upgraded to Opus 4.6
  - GSD quality model profile
affects: [53-leads-agent-quality, 54-writer-validation-loop, 55-validator-agent, 56-campaign-pipeline-hardening]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Centralised model constant (NOVA_MODEL) imported by all agent configs"

key-files:
  created: []
  modified:
    - src/lib/agents/types.ts
    - src/lib/agents/writer.ts
    - src/lib/agents/orchestrator.ts
    - src/lib/agents/leads.ts
    - src/lib/agents/campaign.ts
    - src/lib/agents/research.ts
    - .planning/config.json

key-decisions:
  - "Single NOVA_MODEL constant in types.ts for one-line model upgrades across all agents"
  - "Kept old model IDs in AgentConfig union for backwards compatibility"

patterns-established:
  - "NOVA_MODEL pattern: all agent configs import and use the constant, never hardcode model strings"

requirements-completed: [CROSS-01]

# Metrics
duration: 2min
completed: 2026-03-30
---

# Phase 52 Plan 02: Model Upgrade Summary

**All 5 Nova CLI agents upgraded to Opus 4.6 via centralised NOVA_MODEL constant, plus GSD quality profile**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-30T13:20:52Z
- **Completed:** 2026-03-30T13:23:07Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Exported `NOVA_MODEL = "claude-opus-4-6"` constant from types.ts with updated AgentConfig union
- Replaced all hardcoded model strings (Sonnet, Haiku, old Opus) across writer, orchestrator, leads, campaign, and research agents
- Campaign ICP extraction `anthropic()` call also uses NOVA_MODEL
- GSD config.json model_profile set to "quality"

## Task Commits

Each task was committed atomically:

1. **Task 1: Add NOVA_MODEL constant to types.ts and update AgentConfig union** - `3741766c` (feat)
2. **Task 2: Update all agent files to use NOVA_MODEL and set GSD to quality profile** - `8283e517` (feat)

## Files Created/Modified
- `src/lib/agents/types.ts` - Added NOVA_MODEL constant, updated AgentConfig.model union
- `src/lib/agents/writer.ts` - Import NOVA_MODEL, use in writerConfig
- `src/lib/agents/orchestrator.ts` - Import NOVA_MODEL, use in orchestratorConfig
- `src/lib/agents/leads.ts` - Import NOVA_MODEL, use in leadsConfig
- `src/lib/agents/campaign.ts` - Import NOVA_MODEL, use in campaignConfig + anthropic() ICP extraction call
- `src/lib/agents/research.ts` - Import NOVA_MODEL, use in researchConfig
- `.planning/config.json` - Changed model_profile from "balanced" to "quality"

## Decisions Made
- Single NOVA_MODEL constant in types.ts means future model upgrades are one-line edits
- Kept old model IDs (claude-opus-4-20250514, claude-sonnet-4-20250514, claude-haiku-4-5-20251001) in the AgentConfig union for backwards compatibility

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All agents now use Opus 4.6, improving output quality across leads, writer, campaign, orchestrator, and research
- CROSS-01 requirement satisfied - best-available model everywhere
- Ready for Phase 53 (Leads Agent Quality) which benefits from the model upgrade

---
*Phase: 52-copy-quality-module-model-upgrade*
*Completed: 2026-03-30*
