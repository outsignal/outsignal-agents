---
phase: 06-mcp-list-migration-csv-button
plan: 01
subsystem: mcp-tools, ui-components
tags: [mcp, lists, csv-export, email-resolution, enrichment]
dependency_graph:
  requires: []
  provides: [email-based-add-to-list, enrichment-aware-view-list, csv-fetch-download]
  affects: [src/mcp/leads-agent/tools/lists.ts, src/components/search/list-detail-page.tsx]
tech_stack:
  added: []
  patterns: [email-to-personId resolution, createMany skipDuplicates, blob URL download]
key_files:
  created: []
  modified:
    - src/mcp/leads-agent/tools/lists.ts
    - src/components/search/list-detail-page.tsx
decisions:
  - "Email-based add_to_list: resolve emails to personIds in parallel then bulk insert with createMany+skipDuplicates (not per-item try/catch)"
  - "view_list uses getListExportReadiness helper to get enrichment coverage + verification status in one call"
  - "CSV download uses fetch+blob URL pattern with Content-Disposition filename extraction (no toast library)"
metrics:
  duration: "~2 minutes"
  completed: "2026-02-27T14:05:18Z"
  tasks_completed: 2
  files_modified: 2
---

# Phase 06 Plan 01: MCP List Migration + CSV Button Summary

MCP list tools rewritten from person_ids to email-based interface with enrichment-aware view_list, and CSV export button fixed to use fetch + programmatic blob download with inline error handling.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Rewrite MCP list tools (create_list, add_to_list, view_list) | d5080d8 | src/mcp/leads-agent/tools/lists.ts |
| 2 | Fix CSV download button with fetch + error handling | 49af242 | src/components/search/list-detail-page.tsx |

## What Was Built

### Task 1: MCP List Tools Rewrite

**create_list:**
- Replaced `findUniqueOrThrow` with `findUnique` + null check returning a friendly error message
- Response now includes `ID`, `Name`, `Workspace`, `Created` (ISO timestamp), and usage hint

**add_to_list:**
- Parameter changed from `person_ids: z.array(z.string())` to `emails: z.array(z.string().email())`
- Parallel email-to-personId resolution via `prisma.person.findUnique({ where: { email } })`
- Bulk insert using `prisma.targetListPerson.createMany({ skipDuplicates: true })` — no more per-item try/catch
- Reports not-found emails in response without aborting the operation
- Reports skipped (already-in-list) count

**view_list:**
- Added `offset` parameter for pagination
- Uses `getListExportReadiness(list_id)` to get enrichment coverage + verification categorization in one call
- Derives `exportReady` boolean and `unverifiedCount` from readiness result
- Builds `statusMap` from `readyPeople`/`needsVerificationPeople`/`blockedPeople` arrays
- Summary header shows: total count, export readiness, enrichment % breakdown, verification counts
- Member table columns: Name, Email, Company, Enrichment (full/partial/missing), Verification status
- Pagination footer shown only when not displaying all members
- Empty list case handled separately

### Task 2: CSV Export Button Fix

- Replaced `window.open(...)` with `handleExportCsv()` async function
- On success: fetches blob, creates object URL, programmatically clicks `<a download>`, revokes URL
- Filename extracted from `Content-Disposition` response header with fallback to `"export.csv"`
- On error: parses JSON error body, sets `exportError` state for inline display
- Loading state: button shows "Exporting..." and is disabled during request
- Error display: `<p className="text-xs text-red-400">` below button group in flex-col wrapper
- No new dependencies added

## Deviations from Plan

None — plan executed exactly as written.

## Verification Results

1. TypeScript compilation: zero errors in source files (node_modules zod locale errors are pre-existing, unrelated)
2. MCP server starts: `[outsignal-leads] MCP server connected via stdio — all tools registered` — no import errors
3. `window.open` removed: confirmed no matches
4. `person_ids` removed: confirmed no matches
5. `getListExportReadiness` imported and called in view_list: confirmed
6. `emails.*z.array` pattern present: confirmed
7. `handleExportCsv` wired to button onClick: confirmed

## Self-Check: PASSED

Files exist:
- FOUND: src/mcp/leads-agent/tools/lists.ts
- FOUND: src/components/search/list-detail-page.tsx

Commits exist:
- FOUND: d5080d8 (feat(06-01): rewrite MCP list tools)
- FOUND: 49af242 (feat(06-01): fix CSV export button)
