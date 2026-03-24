---
phase: 48-cli-wrapper-scripts
plan: "01"
subsystem: cli-tooling
tags: [cli, tsup, compilation, wrapper-scripts, sanitization, prisma]
dependency_graph:
  requires:
    - Phase 46: sanitize-output.ts (pure sanitization function)
    - Phase 47: memory namespace (context on PROJECT_ROOT pattern in load-rules.ts)
  provides:
    - scripts/cli/_cli-harness.ts (shared harness for all CLI wrapper scripts)
    - tsup.cli.config.ts (build pipeline for all future wrapper scripts)
    - scripts/cli/workspace-get.ts (smoke-test wrapper + first production script)
    - dist/cli/workspace-get.js (compiled CJS bundle, proves pipeline works)
  affects:
    - Phase 48 Plans 02-07 (all wrapper scripts depend on this foundation)
    - Phase 49 CLI skills (consume wrapper scripts via Bash tool)
tech_stack:
  added:
    - tsup ^8.5.1 (devDependency — CLI TypeScript bundler)
  patterns:
    - runWithHarness() pattern: shared error handling + JSON envelope + sanitization + exit codes
    - tsup esbuildOptions.alias for @/ path resolution (not tsconfig paths — tsup ignores those for bundling)
    - Prisma external: @prisma/client excluded from bundle, uses node_modules native engine
    - PROJECT_ROOT env var set before imports in _cli-harness.ts (load-rules.ts hazard mitigation)
    - dotenv config() calls at top of each wrapper script (scripts run outside Next.js)
key_files:
  created:
    - scripts/cli/_cli-harness.ts
    - tsup.cli.config.ts
    - scripts/cli/workspace-get.ts
  modified:
    - package.json (added build:cli script, tsup devDependency)
    - .gitignore (added /dist/cli/)
decisions:
  - "PROJECT_ROOT set unconditionally in cli-harness.ts before any imports — prevents load-rules.ts __dirname hazard in dist/cli/ context"
  - "workspace-get uses direct Prisma query (not writer tool) for smoke test — validates Prisma + @/ + dotenv without writer agent complexity; Plan 02/03 adds tool-function wrappers"
  - "tsup esbuildOptions.alias maps '@' to path.resolve(__dirname, 'src') — tsup does not auto-read tsconfig.json paths for bundling, only for type checking"
metrics:
  duration_seconds: 157
  tasks_completed: 2
  tasks_total: 2
  files_created: 3
  files_modified: 2
  completed_date: "2026-03-24"
---

# Phase 48 Plan 01: CLI Wrapper Foundation Summary

CLI wrapper build pipeline established: shared harness utility, tsup bundler config with @/ alias resolution and Prisma externalization, and one smoke-test wrapper script (workspace-get) validating the full pipeline end-to-end.

## What Was Built

### `scripts/cli/_cli-harness.ts`
Shared utility imported by every CLI wrapper script. Handles:
- `PROJECT_ROOT` env var set before any imports (prevents `load-rules.ts` `__dirname` hazard from `dist/cli/` context)
- `runWithHarness(usage, fn)` — wraps any async function with try/catch
- Success: `{ "ok": true, "data": {...} }` + exit 0
- Failure: `{ "ok": false, "error": "...", "usage": "..." }` + exit 1
- All output sanitized via `sanitizeOutput()` before writing to stdout

### `tsup.cli.config.ts`
tsup bundler configuration that compiles all `scripts/cli/*.ts` (excluding `_*.ts` helpers) to `dist/cli/*.js`:
- CJS format, single file per script, no shared chunks
- `external: ["@prisma/client"]` — Prisma native engine stays in `node_modules`
- `esbuildOptions.alias: { "@": path.resolve(__dirname, "src") }` — resolves @/ imports at bundle time
- `clean: true` — removes stale bundles before each build

### `scripts/cli/workspace-get.ts`
First wrapper script — smoke test for the entire pipeline:
- Loads `.env` + `.env.local` via dotenv
- Imports `runWithHarness` from the harness
- Direct Prisma query: `prisma.workspace.findUnique({ where: { slug } })`
- Positional arg: `node dist/cli/workspace-get.js <slug>`

### `package.json` + `.gitignore`
- Added `"build:cli": "tsup --config tsup.cli.config.ts"` to scripts
- Added `/dist/cli/` to .gitignore (build artifacts, not source)
- tsup ^8.5.1 added as devDependency

## Verification Results

| Check | Result |
|-------|--------|
| `npm run build:cli` exits 0 | PASS — 16.58 KB CJS bundle |
| `dist/cli/workspace-get.js` exists | PASS |
| `node dist/cli/workspace-get.js rise` returns `ok: true` with DB data | PASS |
| `node dist/cli/workspace-get.js` returns `ok: false` with usage, exit 1 | PASS |
| `node dist/cli/workspace-get.js nonexistent` returns `ok: false`, exit 1 | PASS |
| No DATABASE_URL or API keys in stdout | PASS — sanitization working |

## Pipeline Blockers Resolved

The STATE.md blocker "Phase 48 should verify TypeScript path alias resolution (@/lib/...) in compiled dist/cli/ output early" is resolved:

- `@/lib/db` imports resolve correctly in compiled bundle
- `@/lib/sanitize-output` resolves correctly in compiled bundle
- Prisma queries work from compiled dist/cli/ context
- dotenv correctly loads .env when run from project root
- All three critical pipeline components confirmed working

## Deviations from Plan

None — plan executed exactly as written.

## Commits

| Hash | Message |
|------|---------|
| 2772bf74 | chore(48-01): install tsup, add cli-harness, tsup config, and build:cli script |
| f1adc373 | feat(48-01): create workspace-get wrapper script and validate CLI pipeline end-to-end |
