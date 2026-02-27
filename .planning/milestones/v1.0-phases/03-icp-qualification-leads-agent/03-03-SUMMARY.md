---
phase: 03-icp-qualification-leads-agent
plan: 03
subsystem: mcp, api
tags: [mcp, typescript, prisma, icp-scoring, email-verification, enrichment, lists]

# Dependency graph
requires:
  - phase: 03-01
    provides: MCP server skeleton (McpServer + StdioServerTransport), schema fields, register*Tools pattern
  - phase: 03-02
    provides: scorePersonIcp, verifyEmail, getVerificationStatus, enrichEmail, enrichCompany functions
provides:
  - search_people MCP tool: case-insensitive full-text search across people with filters and pagination
  - enrich_person MCP tool: confirmation-gated enrichment waterfall with pre-flight cost estimate
  - score_person MCP tool: ICP scoring via scorePersonIcp returning formatted score/confidence/reasoning
  - batch_score_list MCP tool: bulk ICP scoring for unscored people in workspace with confirmation gate
  - create_list, add_to_list, view_list MCP tools: named list management via PersonWorkspace.tags JSON
  - export_to_emailbison MCP tool: email verification gate before export (blocks any non-valid email)
  - update_lead_status MCP tool: update Person.status + optional PersonWorkspace.status
  - set_workspace_prompt, get_workspace_prompts MCP tools: manage icpCriteriaPrompt/normalizationPrompt/outreachTonePrompt
affects: [phase-04, phase-05-emailbison-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "register*Tools(server: McpServer) export pattern — each tool module registers on shared server instance"
    - "Confirmation gate pattern: confirm=false returns cost estimate, confirm=true executes (used for enrich, batch_score, export)"
    - "Email export hard gate: ALL emails must be valid; any non-valid blocks entire export"
    - "List tags as JSON string array in PersonWorkspace.tags — contains search + client-side filter for exact match"
    - "Import paths use .js extension for ESM/tsx compatibility (tsx resolves .js to .ts at runtime)"

key-files:
  created:
    - src/mcp/leads-agent/tools/search.ts
    - src/mcp/leads-agent/tools/enrich.ts
    - src/mcp/leads-agent/tools/score.ts
    - src/mcp/leads-agent/tools/lists.ts
    - src/mcp/leads-agent/tools/export.ts
    - src/mcp/leads-agent/tools/status.ts
    - src/mcp/leads-agent/tools/workspace.ts
  modified:
    - src/mcp/leads-agent/index.ts

key-decisions:
  - "Spread operator for Prisma WHERE clauses instead of typed variable — avoids complex Prisma generic type inference issues"
  - "Double-check tag membership after Prisma contains query — contains on JSON string could match substrings (e.g. 'list1' matching inside 'list11'); client-side array includes() provides exact match"
  - "Export gate checks each person sequentially (not concurrently) — avoids overwhelming LeadMagic API and respects rate limits"
  - "batch_score_list failure isolation: try/catch per person — one Claude Haiku timeout doesn't stop the entire batch"

requirements-completed: [AI-04, AI-05, ENRICH-05]

# Metrics
duration: 3min
completed: 2026-02-26
---

# Phase 3 Plan 03: MCP Tools — All 6 Leads Agent Capabilities Summary

**9 MCP tools wired into outsignal-leads server: search, enrich (with confirm gate), score (single + batch), list management (create/add/view), export with LeadMagic hard gate, status update, and workspace prompt configuration**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-02-26T22:06:40Z
- **Completed:** 2026-02-26T22:10:32Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- `search_people`: case-insensitive full-text search across email, firstName, lastName, company, jobTitle with workspace/vertical/status filters and pagination — returns markdown table
- `enrich_person`: pre-flight shows existing enrichments + waterfall plan + cost estimate; confirm=true runs enrichEmail + enrichCompany waterfall
- `score_person` and `batch_score_list`: single and batch ICP scoring via scorePersonIcp; batch has confirm gate and per-person error isolation
- `create_list`, `add_to_list`, `view_list`: named lists via PersonWorkspace.tags JSON array with exact membership checking
- `export_to_emailbison`: pre-export shows ready/needs-verification/blocked counts; confirm=true verifies all unverified emails then blocks if ANY are non-valid, outputs CSV export data
- `update_lead_status`: updates Person.status + optional PersonWorkspace.status in one call
- `set_workspace_prompt`, `get_workspace_prompts`: manages all three AI prompt override fields on Workspace
- Server starts cleanly, logs "all tools registered", zero console.log calls, all TypeScript compiles with no MCP-file errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Search + enrich + score MCP tools** - `f65a136` (feat)
2. **Task 2: List + export + status + workspace tools + wire into index.ts** - `8dba19f` (feat)

## Files Created/Modified

- `src/mcp/leads-agent/tools/search.ts` - search_people tool with case-insensitive multi-field search
- `src/mcp/leads-agent/tools/enrich.ts` - enrich_person tool with confirmation gate + enrichEmail/enrichCompany waterfall
- `src/mcp/leads-agent/tools/score.ts` - score_person (single) + batch_score_list (bulk with confirm gate)
- `src/mcp/leads-agent/tools/lists.ts` - create_list, add_to_list, view_list via PersonWorkspace.tags JSON
- `src/mcp/leads-agent/tools/export.ts` - export_to_emailbison with LeadMagic verification gate (blocks non-valid)
- `src/mcp/leads-agent/tools/status.ts` - update_lead_status for Person + optional PersonWorkspace
- `src/mcp/leads-agent/tools/workspace.ts` - set_workspace_prompt + get_workspace_prompts for 3 AI override fields
- `src/mcp/leads-agent/index.ts` - replaced ping placeholder with all 7 register*Tools() calls

## Decisions Made

- **Spread operator for Prisma WHERE**: Typing `where` as `Parameters<typeof prisma.person.findMany>[0]["where"]` causes a TS2339 error on the `where` property under Prisma's generic types. Using `const where = { ... }` with spread for optional filters resolves this cleanly without type assertions.
- **Double-check tag membership**: `prisma.personWorkspace.findMany({ where: { tags: { contains: '"list_name"' } } })` can match substrings if list names overlap. Added client-side `parseTags(pw.tags).includes(list_name)` filter for exact membership.
- **Export blocks on any non-valid**: Strict policy from Plan 03-02 — `valid_catch_all` is explicitly blocked despite "valid" in the name. Export returns blocked list with each email's status so user can take action.
- **Batch score error isolation**: Each person in `batch_score_list` is wrapped in try/catch — scorePersonIcp can throw (e.g. on Firecrawl timeout). One failure logs to stderr and increments failureCount without stopping the batch.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Prisma WHERE type inference error in search_people**
- **Found during:** Task 1 (search.ts TypeScript compile check)
- **Issue:** `Parameters<typeof prisma.person.findMany>[0]["where"]` caused TS2339 "Property 'where' does not exist" — Prisma's generic overloaded type makes the index type ambiguous
- **Fix:** Replaced typed variable with `const where = { OR: [...], ...spreadConditionals }` pattern
- **Files modified:** src/mcp/leads-agent/tools/search.ts
- **Verification:** `npx tsc --noEmit` shows 0 errors in src/mcp files
- **Committed in:** f65a136 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - TypeScript type error)
**Impact on plan:** Required for TypeScript compilation. Functionally identical to plan intent — same Prisma query, different type annotation approach.

## Issues Encountered

None beyond the auto-fixed TypeScript type issue.

## User Setup Required

None - all tools are wired and MCP server runs with existing credentials (DATABASE_URL etc. inherited from shell environment via .mcp.json).

## Next Phase Readiness

- Phase 3 complete — all 3 plans executed, MCP server fully functional
- The `outsignal-leads` server is now available in Claude Code via `.mcp.json`
- To use: configure workspace ICP criteria first with `set_workspace_prompt`
- Phase 5 (EmailBison integration) will replace the CSV export stub in `export_to_emailbison` with actual API push

---
*Phase: 03-icp-qualification-leads-agent*
*Completed: 2026-02-26*

## Self-Check: PASSED

- FOUND: src/mcp/leads-agent/tools/search.ts
- FOUND: src/mcp/leads-agent/tools/enrich.ts
- FOUND: src/mcp/leads-agent/tools/score.ts
- FOUND: src/mcp/leads-agent/tools/lists.ts
- FOUND: src/mcp/leads-agent/tools/export.ts
- FOUND: src/mcp/leads-agent/tools/status.ts
- FOUND: src/mcp/leads-agent/tools/workspace.ts
- FOUND: src/mcp/leads-agent/index.ts
- FOUND: .planning/phases/03-icp-qualification-leads-agent/03-03-SUMMARY.md
- FOUND: commit f65a136 (Task 1: search + enrich + score tools)
- FOUND: commit 8dba19f (Task 2: list + export + status + workspace tools + index.ts wiring)
