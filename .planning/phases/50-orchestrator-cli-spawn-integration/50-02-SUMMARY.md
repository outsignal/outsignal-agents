---
phase: 50-orchestrator-cli-spawn-integration
plan: 02
subsystem: api
tags: [cli-agents, orchestrator, delegation, feature-flag, subprocess]

# Dependency graph
requires:
  - phase: 50-01
    provides: cliSpawn utility and isCliMode() helper in cli-spawn.ts and utils.ts

provides:
  - Feature-flagged CLI routing in all 4 delegation tools (delegateToResearch, delegateToLeads, delegateToWriter, delegateToCampaign)
  - Dual-mode orchestrator.ts: USE_CLI_AGENTS=true routes to dist/cli/*.js, false/unset routes to inline API agents

affects:
  - Phase 51 (Memory Accumulation and Full Validation) — orchestrator bridge is now complete, validation can test end-to-end CLI flows

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "isCliMode() early-return guard at top of each delegation tool execute function"
    - "/tmp/{randomUUID()}.json file pattern for complex CLI arg objects (writer, leads)"
    - "CLI path returns simplified status object; inline path returns full structured result"

key-files:
  created: []
  modified:
    - src/lib/agents/orchestrator.ts

key-decisions:
  - "Writer CLI path uses save-sequence.js when campaignId present, save-draft.js when absent — preserves campaign-aware flow"
  - "Campaign CLI path uses campaign-list.js as single entry point — simplified per plan spec (orchestrator is not the campaign execution context)"
  - "CLI paths return simplified status objects (message + data) rather than full agent return shapes — dashboard chat is not used in CLI mode per CONTEXT.md"
  - "writeFileSync + randomUUID used for /tmp arg files — no async needed for file creation"

patterns-established:
  - "Delegation tool CLI guard: if (isCliMode()) { try { ... return simplified; } catch { return failed; } } — inline path unchanged below"

requirements-completed: [BRG-01, BRG-02, BRG-03, BRG-05]

# Metrics
duration: 2min
completed: 2026-03-24
---

# Phase 50 Plan 02: Orchestrator CLI Spawn Integration Summary

**USE_CLI_AGENTS feature flag wired into all 4 orchestrator delegation tools, routing to dist/cli/*.js subprocess calls when enabled while preserving all inline API agent paths unchanged**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-24T10:28:50Z
- **Completed:** 2026-03-24T10:30:50Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Added `isCliMode()` early-return guards to `delegateToResearch`, `delegateToLeads`, `delegateToWriter`, and `delegateToCampaign`
- Added imports: `cliSpawn` from `./cli-spawn`, `isCliMode` from `./utils`, `writeFileSync` from `fs`, `randomUUID` from `crypto`
- CLI paths serialize complex args to `/tmp/{uuid}.json` where needed (writer, leads) and call appropriate `dist/cli/*.js` scripts
- All 4 inline `runResearchAgent`/`runLeadsAgent`/`runWriterAgent`/`runCampaignAgent` paths preserved unchanged (BRG-02)
- No changes to `runner.ts`, `types.ts`, or AgentRun schema (BRG-05 audit transparency)
- TypeScript compiles cleanly with zero new errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Add CLI imports and wire all 4 delegation tools** - `6a858044` (feat)

**Plan metadata:** (see docs commit below)

## Files Created/Modified

- `src/lib/agents/orchestrator.ts` - Added CLI routing guards to all 4 delegation tool execute functions

## Decisions Made

- Writer CLI path branches on `campaignId` presence: `save-sequence.js` (campaign-aware) vs `save-draft.js` (standard) — preserves the same logic the inline writer agent uses
- Campaign CLI path uses `campaign-list.js --slug` as a single entry point rather than routing per operation type — the CLI path for campaign is a simplified orchestration stub since the Nova CLI skill handles the full workflow
- CLI return objects are simplified (message + data) vs the full structured returns of inline paths — this is intentional as dashboard chat is not used when `USE_CLI_AGENTS=true`

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. TypeScript compilation was clean on first pass. Pre-existing uncommitted changes to `copy-quality.ts` were noted as out-of-scope and left untouched.

## User Setup Required

None - no external service configuration required. The `USE_CLI_AGENTS=true` environment variable must be set to activate CLI mode (pre-existing env var from Phase 50 planning).

## Next Phase Readiness

- Orchestrator bridge is complete — all 4 delegation tools can route to CLI scripts
- Phase 51 (Memory Accumulation and Full Validation) can now run end-to-end CLI agent flows through the orchestrator
- `USE_CLI_AGENTS=true` must be set in the test environment to exercise CLI paths

---
*Phase: 50-orchestrator-cli-spawn-integration*
*Completed: 2026-03-24*
