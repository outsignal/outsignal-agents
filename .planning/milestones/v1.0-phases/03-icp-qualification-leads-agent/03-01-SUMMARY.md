---
phase: 03-icp-qualification-leads-agent
plan: 01
subsystem: database, infra
tags: [prisma, mcp, typescript, leadmagic, firecrawl, icp-scoring]

# Dependency graph
requires:
  - phase: 02-provider-adapters-waterfall
    provides: Provider type + PROVIDER_COSTS + enrichment pipeline infrastructure
provides:
  - Prisma schema with ICP scoring fields on PersonWorkspace (icpScore, icpReasoning, icpConfidence, icpScoredAt)
  - Prisma schema with Firecrawl cache fields on Company (crawlMarkdown, crawledAt)
  - Prisma schema with AI prompt override fields on Workspace (icpCriteriaPrompt, normalizationPrompt, outreachTonePrompt)
  - leadmagic-verify provider in Provider union + $0.05/call cost entry
  - MCP server skeleton (outsignal-leads) runnable via stdio
  - .mcp.json registration for Claude Code integration
affects: [03-02-email-verification, 03-03-mcp-tools, 03-icp-scoring]

# Tech tracking
tech-stack:
  added: ["@modelcontextprotocol/sdk ^1.27.1", "tsx ^4.21.0"]
  patterns: ["MCP server over stdio (async main() pattern — avoids top-level await CJS issue)", "db push (not migrate dev) for schema changes — no migration history"]

key-files:
  created:
    - src/mcp/leads-agent/index.ts
    - .mcp.json
  modified:
    - prisma/schema.prisma
    - src/lib/enrichment/types.ts
    - src/lib/enrichment/costs.ts
    - package.json

key-decisions:
  - "Used async main() wrapper instead of top-level await — tsx/esbuild CJS mode doesn't support top-level await; wrapping in async function fixes it cleanly"
  - "db push (not migrate dev) for Phase 3 schema changes — consistent with prior pattern; migrate dev would reset production data (14,563+ records)"
  - "leadmagic-verify cost set at $0.05/call — charged for valid/invalid/valid_catch_all; catch_all and unknown are free (handled in adapter Plan 03-02)"
  - ".mcp.json uses DATABASE_URL env var forwarding only — secrets not embedded; tsx process inherits full shell environment for FIRECRAWL_API_KEY etc."

patterns-established:
  - "MCP server pattern: McpServer + StdioServerTransport + async main() — no top-level await"
  - "console.error only in MCP server — stdout reserved for JSON-RPC protocol"

requirements-completed: [AI-04, AI-05, ENRICH-05]

# Metrics
duration: 6min
completed: 2026-02-26
---

# Phase 3 Plan 01: Schema + MCP Foundation Summary

**Prisma schema extended with ICP scoring (PersonWorkspace), Firecrawl cache (Company), and AI prompt overrides (Workspace); MCP server skeleton running via stdio with leadmagic-verify added to Provider type**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-02-26T19:40:00Z
- **Completed:** 2026-02-26T19:46:00Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- All three Phase 3 schema additions pushed to production DB (9 new nullable columns, no data loss)
- `leadmagic-verify` added to Provider union type and PROVIDER_COSTS at $0.05/call
- `@modelcontextprotocol/sdk` and `tsx` installed
- MCP server skeleton (`outsignal-leads`) verified to connect via stdio without errors
- `.mcp.json` registered at project root for Claude Code integration

## Task Commits

Each task was committed atomically:

1. **Task 1: Schema migration + dependency install + type updates** - `888d71d` (feat)
2. **Task 2: MCP server entry point + .mcp.json registration** - `d4bd76e` (feat)

**Plan metadata:** (docs commit — see final commit)

## Files Created/Modified
- `prisma/schema.prisma` - Added crawlMarkdown/crawledAt to Company, icpScore/icpReasoning/icpConfidence/icpScoredAt to PersonWorkspace, icpCriteriaPrompt/normalizationPrompt/outreachTonePrompt to Workspace
- `src/lib/enrichment/types.ts` - Added "leadmagic-verify" to Provider union
- `src/lib/enrichment/costs.ts` - Added "leadmagic-verify": 0.05 to PROVIDER_COSTS
- `package.json` - Added @modelcontextprotocol/sdk (dep) + tsx (devDep)
- `src/mcp/leads-agent/index.ts` - MCP server skeleton with ping tool + StdioServerTransport
- `.mcp.json` - Registers outsignal-leads server for Claude Code

## Decisions Made
- **async main() pattern for MCP server**: tsx/esbuild runs in CJS mode by default, which doesn't support top-level await. Wrapping connect() in an async main() function fixes the transform error without needing package.json `"type": "module"` changes.
- **db push not migrate dev**: Consistent with [01-01] decision — no migration history, db push is safe for additive nullable columns.
- **leadmagic-verify cost at $0.05**: Only valid/invalid/valid_catch_all statuses are charged; catch_all and unknown are free. The adapter (Plan 03-02) handles conditional cost logic; this entry is the base cost per charged call.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed top-level await CJS incompatibility in MCP server**
- **Found during:** Task 2 (MCP server verification)
- **Issue:** Plan specified top-level `await server.connect(transport)` but tsx/esbuild defaults to CJS output format which rejects top-level await with a transform error
- **Fix:** Wrapped connect() in `async function main()` with `.catch()` handler — functionally identical, avoids the transform restriction
- **Files modified:** src/mcp/leads-agent/index.ts
- **Verification:** Server starts and logs `[outsignal-leads] MCP server connected via stdio` to stderr
- **Committed in:** d4bd76e (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - runtime bug)
**Impact on plan:** Fix was necessary for the server to start. No scope creep; behavior is identical to plan intent.

## Issues Encountered
- DATABASE_URL not in shell environment for `npx prisma db push` — resolved by passing env var explicitly. (.env.local requires manual sourcing in shell sessions)

## User Setup Required
None - no external service configuration required. DATABASE_URL is already configured in .env.local and Vercel.

## Next Phase Readiness
- Schema is live in production DB with all Phase 3 columns
- MCP server skeleton runnable and registered — Plans 03-02 and 03-03 can add tool implementations
- leadmagic-verify provider ready for adapter implementation (Plan 03-02)
- No blockers for Phase 3 continuation

---
*Phase: 03-icp-qualification-leads-agent*
*Completed: 2026-02-26*
