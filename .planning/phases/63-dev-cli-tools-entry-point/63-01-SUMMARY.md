---
phase: 63-dev-cli-tools-entry-point
plan: 01
subsystem: cli
tags: [tsup, dev-cli, monty, shell-tools, json-envelope]

requires:
  - phase: 62-architecture-foundation
    provides: dev-cli harness (_cli-harness.ts), sanitizeOutput utility
provides:
  - 9 dev-cli wrapper scripts for codebase observation (git, files, search, types, deploy)
  - tsup build config for dev-cli namespace
  - npm run build:dev-cli build step
  - npm run monty CLI entry point
affects: [64-monty-agent-tools, 65-monty-orchestrator-agent]

tech-stack:
  added: []
  patterns: [dev-cli wrapper pattern (runWithHarness + execSync + structured JSON)]

key-files:
  created:
    - scripts/dev-cli/git-status.ts
    - scripts/dev-cli/git-diff.ts
    - scripts/dev-cli/git-log.ts
    - scripts/dev-cli/read-file.ts
    - scripts/dev-cli/list-files.ts
    - scripts/dev-cli/search-code.ts
    - scripts/dev-cli/run-tests.ts
    - scripts/dev-cli/check-types.ts
    - scripts/dev-cli/deploy-status.ts
    - tsup.dev-cli.config.ts
  modified:
    - package.json

key-decisions:
  - "No dotenv in git/code/test scripts -- only deploy-status.ts loads .env"
  - "maxBuffer 10MB on all execSync calls for large repo output"
  - "PROJECT_ROOT env var for cwd resolution in compiled scripts"

patterns-established:
  - "Dev-cli script pattern: import runWithHarness, parse argv, execSync with maxBuffer+cwd, return structured object"
  - "Error envelope: {ok: false, error, usage} -- no stack traces exposed"

requirements-completed: [DEV-07]

duration: 3min
completed: 2026-04-03
---

# Phase 63 Plan 01: Dev CLI Tools Summary

**9 dev-cli wrapper scripts compiled via tsup, providing Monty agents structured JSON access to git, filesystem, search, type-checking, and deployment status**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-03T20:09:51Z
- **Completed:** 2026-04-03T20:12:40Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments
- Created 9 dev-cli scripts covering git ops (status/diff/log), codebase navigation (read-file/list-files/search-code), quality checks (run-tests/check-types), and deploy status
- All scripts return structured JSON via runWithHarness envelope with secret sanitization
- Errors return {ok: false, error, usage} not stack traces
- tsup build compiles all 9 to dist/dev-cli/ in ~12ms

## Task Commits

Each task was committed atomically:

1. **Task 1: Create 9 dev-cli wrapper scripts** - `e6b732ad` (feat)
2. **Task 2: Create tsup config and npm script** - `34dcecd9` (chore)

## Files Created/Modified
- `scripts/dev-cli/git-status.ts` - Git working tree status (branch, clean, files)
- `scripts/dev-cli/git-diff.ts` - Git diff summary with numstat
- `scripts/dev-cli/git-log.ts` - Recent commit history with --count flag
- `scripts/dev-cli/read-file.ts` - File content with line range support
- `scripts/dev-cli/list-files.ts` - Directory listing with glob and exclusions
- `scripts/dev-cli/search-code.ts` - Code search with grep, max-count, and result limiting
- `scripts/dev-cli/run-tests.ts` - Vitest execution with JSON parse and fallback
- `scripts/dev-cli/check-types.ts` - tsc --noEmit with TS error parsing
- `scripts/dev-cli/deploy-status.ts` - Vercel deployment status with graceful degradation
- `tsup.dev-cli.config.ts` - Build config mirroring Nova's tsup.cli.config.ts
- `package.json` - Added build:dev-cli, monty scripts; integrated into main build

## Decisions Made
- Only deploy-status.ts loads dotenv -- git/code/test scripts have no env dependency
- Used simple process.argv parsing (--flag value) instead of yargs to keep bundles small
- Limit results in search-code (50) and list-files (500) to prevent oversized output
- check-types limits error output to 50 errors for readability

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 9 scripts are compiled and verified in dist/dev-cli/
- Phase 64 can wrap these as AI SDK tools with inputSchema
- monty npm script is ready for Phase 64's CLI entry point

---
*Phase: 63-dev-cli-tools-entry-point*
*Completed: 2026-04-03*
