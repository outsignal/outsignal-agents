---
phase: 50-orchestrator-cli-spawn-integration
plan: 01
subsystem: infra
tags: [child_process, spawn, subprocess, feature-flag, cli-bridge]

# Dependency graph
requires:
  - phase: 48-cli-wrapper-scripts
    provides: dist/cli/*.js scripts compiled by tsup with _cli-harness.ts JSON envelope contract
provides:
  - cli-spawn.ts subprocess utility with 300s timeout, JSON envelope parsing, error translation
  - isCliMode() feature flag helper exported from utils.ts
  - Updated package.json build script that compiles dist/cli/ on every Vercel deployment
affects:
  - 50-02 (bridge wiring — uses cliSpawn and isCliMode in delegation tools)
  - Vercel deployment pipeline

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "AbortController + signal option to child_process.spawn for timeout management"
    - "Buffer[] chunk collection at close event before JSON.parse (multi-byte safe)"
    - "PROJECT_ROOT env var for scriptPath resolution in both local dev and Vercel serverless"
    - "stdio: ['ignore', 'pipe', 'pipe'] to prevent stdin hang in spawned Node subprocesses"

key-files:
  created:
    - src/lib/agents/cli-spawn.ts
  modified:
    - src/lib/agents/utils.ts
    - package.json

key-decisions:
  - "cli-spawn.ts uses spawn (not execFile) for streaming stdout collection during 300s window"
  - "AbortController preferred over setTimeout+kill for cleaner AbortError detection"
  - "build:cli inserted between prisma generate and next build to guarantee dist/cli/ exists on Vercel"
  - "CliResult<T> type alias exported for type safety at call sites in Plan 02"

patterns-established:
  - "Pattern: cliSpawn<T>(scriptName, args) returns envelope.data typed as T on success, throws Error on failure"
  - "Pattern: isCliMode() checked at tool level before routing to subprocess vs inline"

requirements-completed: [BRG-04, BRG-02]

# Metrics
duration: 8min
completed: 2026-03-24
---

# Phase 50 Plan 01: CLI Spawn Utility and Build Integration Summary

**Node.js subprocess spawn utility (cliSpawn) with AbortController timeout, JSON envelope parsing, isCliMode() feature flag helper, and Vercel build command updated to compile dist/cli/ on every deployment**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-24T10:24:00Z
- **Completed:** 2026-03-24T10:32:00Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- Created `cli-spawn.ts` with `cliSpawn<T>()` function using `child_process.spawn`, AbortController 300s timeout, Buffer[] chunk collection, and JSON envelope parsing from `_cli-harness.ts` contract
- Added `isCliMode()` to `utils.ts` — returns `true` only when `USE_CLI_AGENTS === "true"`, used by delegation tools in Plan 02
- Updated `package.json` build script to run `npm run build:cli` before `next build`, ensuring `dist/cli/*.js` compiled on every Vercel deployment (previously gitignored and missing at runtime)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create cli-spawn.ts subprocess utility** - `34d39c99` (feat)
2. **Task 2: Add isCliMode() helper to utils.ts** - `e3c6fdac` (feat)
3. **Task 3: Update Vercel build command to compile CLI scripts** - `864594b4` (chore)

## Files Created/Modified
- `src/lib/agents/cli-spawn.ts` - Subprocess spawn utility: exports `cliSpawn<T>()`, `CLI_TIMEOUT_MS`, `CliResult<T>`
- `src/lib/agents/utils.ts` - Added `isCliMode()` helper after `USER_INPUT_GUARD`
- `package.json` - Build script: `prisma generate && npm run build:cli && next build`

## Decisions Made
- Used `spawn` (not `execFile`) — matches research recommendation for streaming safety during 300s timeout window
- `AbortController` over `setTimeout + kill` — cleaner `AbortError` detection in error handler
- `stdio: ['ignore', 'pipe', 'pipe']` — prevents stdin hang (Pitfall 3 from research)
- Buffer[] chunks collected at close event then concatenated — multi-byte character safe

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None — TypeScript compiled clean on first pass, all verification checks passed.

## User Setup Required
None - no external service configuration required. `PROJECT_ROOT` Vercel env var will be needed when USE_CLI_AGENTS=true is enabled (covered in Plan 02 notes).

## Next Phase Readiness
- `cliSpawn` and `isCliMode` are ready for Plan 02 which wires them into the 4 delegation tools in `orchestrator.ts`
- No blockers

---
*Phase: 50-orchestrator-cli-spawn-integration*
*Completed: 2026-03-24*
