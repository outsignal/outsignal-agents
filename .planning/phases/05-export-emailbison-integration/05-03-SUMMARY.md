---
phase: 05-export-emailbison-integration
plan: 03
subsystem: api
tags: [mcp, emailbison, export, csv, verification, targetlist, campaign, prisma]

# Dependency graph
requires:
  - phase: 05-export-emailbison-integration
    plan: 01
    provides: getListExportReadiness, verifyAndFilter, generateListCsv — verification gate + CSV generation
  - phase: 05-export-emailbison-integration
    plan: 02
    provides: EmailBisonClient with createCampaign, duplicateCampaign, createLead, ensureCustomVariables
  - phase: 04-search-filter-list-building
    provides: TargetList and TargetListPerson models for list member queries

provides:
  - MCP export_to_emailbison tool: pre-export summary → optional verification → confirm push to EmailBison campaign
  - MCP export_csv tool: generate downloadable CSV for a TargetList (optionally write to disk)
  - Workspace auto-creation when missing (locked CONTEXT.md decision)
  - Pre-export summary with lead count, verified email %, vertical breakdown, enrichment coverage, verification cost estimate

affects:
  - Agent-driven export workflow is now complete — users can push verified lists to EmailBison via agent

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Three-step MCP tool flow: pre-export summary (default) → verify_unverified=true → confirm=true
    - Workspace auto-create on missing slug (CONTEXT.md locked decision, not an error)
    - Campaign naming convention: {workspace_name}_{list_name}_{YYYY-MM-DD} (spaces→underscores)
    - Lead push loop with individual try/catch — partial success allowed, errors logged to console.error

key-files:
  created: []
  modified:
    - src/mcp/leads-agent/tools/export.ts

key-decisions:
  - "export_to_emailbison uses list_id (TargetList ID) not list_name — TargetList model replaced tag-based list query"
  - "Workspace auto-created when slug not found — locked CONTEXT.md decision, produces informational message not error"
  - "Three-step flow: summary (confirm=false) → verification (verify_unverified=true) → push (confirm=true)"
  - "confirm=true with needsVerificationCount > 0 blocks and directs user to verify first"
  - "export_csv delegates entirely to generateListCsv (verification gate enforced there)"
  - "Leads pushed individually with per-lead try/catch — failCount tracked, export is partial success tolerant"
  - "ensureCustomVariables(['linkedin_url']) called before any lead push — idempotent pre-flight"
  - "parseTags helper and all tag-based PersonWorkspace queries removed — no references remain"

patterns-established:
  - "MCP tool three-phase flow: default=summary, verify_unverified=trigger, confirm=execute"
  - "Workspace existence check + auto-create inside tool (not a precondition)"

requirements-completed: [EXPORT-01, EXPORT-02, EXPORT-03]

# Metrics
duration: 2min
completed: 2026-02-27
---

# Phase 5 Plan 03: MCP Export Tools (TargetList-based) Summary

**Rewrote export.ts MCP tool from tag-based to TargetList model with two-tool design: export_to_emailbison (summary/verify/push flow) and export_csv, wiring in Plan 01 verification gate + Plan 02 EmailBison client**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-02-27T13:04:55Z
- **Completed:** 2026-02-27T13:06:23Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Rewrote `export_to_emailbison` tool: replaced tag-based PersonWorkspace query with TargetList model (list_id param), added workspace auto-creation, wired in getListExportReadiness for rich pre-export summary (lead count, verified email %, vertical breakdown, enrichment coverage, verification cost estimate), verify_unverified flow calls verifyAndFilter, confirm flow creates/duplicates campaign then pushes leads with standard + custom (linkedin_url) fields
- Added new `export_csv` tool that delegates to generateListCsv, optionally writes to disk at ./exports/{filename}, returns API download path
- Removed parseTags helper and all tag/PersonWorkspace-based list queries — codebase now consistently uses TargetList model for lists
- TypeScript compiles with zero errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite export.ts with TargetList-based export_to_emailbison + export_csv tools** - `6baeac1` (feat)

**Plan metadata:** (upcoming docs commit)

## Files Created/Modified
- `src/mcp/leads-agent/tools/export.ts` - Rewritten: 2 MCP tools (export_to_emailbison, export_csv), TargetList model, workspace auto-create, pre-export summary, verify/push flows

## Decisions Made
- `export_to_emailbison` uses `list_id` (TargetList ID), not the old `list_name` string — aligns with TargetList model introduced in Phase 4
- Workspace auto-creation (not error) when slug not found — this is a locked CONTEXT.md decision; the agent creates workspace first, then informs user to configure apiToken
- The three-step flow (summary → verify → push) maps cleanly to three param combinations, each with distinct branching logic
- Individual per-lead try/catch in push loop — allows partial success (failed leads logged to console.error, count reported in output)
- `ensureCustomVariables(['linkedin_url'])` called as idempotent pre-flight before any lead push

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. Workspace apiToken must be configured in database before pushing leads; the tool provides this guidance automatically when apiToken is missing.

## Next Phase Readiness
- Phase 5 export workflow is complete: verification gate (Plan 01) + EmailBison client (Plan 02) + MCP export tools (Plan 03) all shipped
- Agent can now: summarize list readiness → trigger verification → push to EmailBison campaign → generate CSV
- Known limitation: EmailBison has no REST endpoint to add leads directly to a campaign — leads land in workspace pool; user must assign them to the campaign in the UI (documented in tool output via Next Steps section)
- Phase 5 is fully complete

---
*Phase: 05-export-emailbison-integration*
*Completed: 2026-02-27*
