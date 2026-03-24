# Phase 48: CLI Wrapper Scripts - Context

**Gathered:** 2026-03-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Standalone CLI scripts that expose every agent tool function as a callable command with sanitized JSON output. Agents invoke these via Bash tool calls during skill sessions. No skill files are written in this phase — only the callable tool scripts they depend on.

</domain>

<decisions>
## Implementation Decisions

### Script scope & grouping
- **One script per tool function** — each tool function gets its own standalone script (e.g., `workspace-get.js`, `campaign-list.js`, `kb-search.js`)
- **Map from existing tool functions** — audit all tool functions across the 7 agent configs and create one script per function. Not limited to the 14 named in the roadmap
- **Same pattern for read and write scripts** — no confirmation gates on write scripts. Agents already make the decision to call a write tool; the skill instructions gate when writes happen
- **Import existing tool function implementations** — scripts are thin wrappers that import and call the existing functions from `src/lib/agents/tools/`. Guaranteed parity with API agents, minimal new code

### Input/output conventions
- **Positional arguments** — `node dist/cli/workspace-get.js rise`. First arg is always the primary identifier (slug, campaignId, query). Additional args as needed
- **Wrapped JSON envelope** — Success: `{ "ok": true, "data": {...} }`. Failure: `{ "ok": false, "error": "message" }`. Agents always know if it worked
- **Pretty-printed output** — `JSON.stringify(data, null, 2)` for readability when checking script output manually
- **Default result limits** — Scripts that return large datasets (people-search can return 1000s) should have sensible default limits with an override arg. Prevents context overflow in agent sessions

### Compilation & bundling
- **tsup single-file bundles** — each script compiled to a self-contained `.js` file. tsup handles `@/` path aliases automatically. Zero resolution issues at runtime
- **Prisma Client external** — mark `@prisma/client` as external in tsup config. Scripts are smaller, Prisma engine stays in `node_modules`. Scripts only run on machines with `npm install` done
- **Single build command** — `npm run build:cli` compiles all scripts to `dist/cli/` in one pass
- **dist/cli/ gitignored** — build artifacts don't belong in git. Same pattern as `.next/`. Run `npm run build:cli` after clone

### Error handling & edge cases
- **JSON error + usage hint on missing args** — `{ "ok": false, "error": "Missing required argument: slug", "usage": "workspace-get <slug>" }` with exit code 1
- **Fail immediately on errors** — no retries. Return `{ "ok": false, "error": "..." }` right away. Agents can retry by calling the script again if they want
- **Shared cli-harness.ts wrapper** — a small utility that wraps every script's main function: catches errors, sanitizes output via `sanitize-output.ts`, writes JSON envelope, sets exit code. DRY and consistent across all scripts
- **No script-level timeout** — let the caller handle timeouts. Claude Code's Bash tool has its own timeout (120s default, 600s max). Scripts just run until done

### Claude's Discretion
- Exact list of tool functions to wrap (derived from codebase audit)
- tsup configuration details
- How to structure the shared cli-harness.ts utility internally
- Default limit values per script (e.g., 50 results for people-search, 20 for campaign-list)

</decisions>

<specifics>
## Specific Ideas

- The shared cli-harness.ts should handle: try/catch wrapping, sanitize-output.ts application, JSON envelope formatting, exit code setting, and argument validation
- Scripts should be independently testable: `node dist/cli/<script>.js <args>` returns valid JSON or a well-formed error object
- The blocker from STATE.md is still relevant: verify TypeScript path alias resolution (`@/lib/...`) works in compiled `dist/cli/` output early — test one wrapper before scripting all wrappers

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 48-cli-wrapper-scripts*
*Context gathered: 2026-03-24*
