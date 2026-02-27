---
phase: 05-export-emailbison-integration
plan: 01
subsystem: api
tags: [csv, export, verification, prisma, leadmagic, targetlist]

# Dependency graph
requires:
  - phase: 04-search-filter-list-building
    provides: TargetList and TargetListPerson models for list member queries
  - phase: 03-icp-qualification-leads-agent
    provides: getVerificationStatus() and verifyEmail() from leadmagic.ts

provides:
  - Verification gate (getListExportReadiness, verifyAndFilter) for TargetList-based exports
  - CSV generation with Person + Company join and enrichmentData flattening
  - GET /api/lists/[id]/export endpoint returning downloadable CSV file
  - ExportReadiness type with totalCount, readyCount, verifiedEmailPct, verticalBreakdown, enrichmentCoverage

affects:
  - 05-02 (EmailBison push will use getListExportReadiness for pre-export summary)
  - 05-03 (MCP export tool migration uses verification-gate.ts)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Verification gate pattern: getListExportReadiness checks all TargetListPerson members before any export
    - CSV generation: flattenEnrichmentData handles array [{name,value}] and object {k:v} formats
    - Dynamic enrichment columns: collect all enrichment_* keys across list then sort alphabetically
    - Person enrichment wins over Company enrichment on key collision
    - Verification hard block: needsVerificationCount > 0 throws, blockedCount > 0 auto-excludes silently

key-files:
  created:
    - src/lib/export/verification-gate.ts
    - src/lib/export/csv.ts
    - src/app/api/lists/[id]/export/route.ts
  modified: []

key-decisions:
  - "Verification gate throws on needsVerificationCount > 0 (hard block); auto-excludes blocked people silently per CONTEXT.md"
  - "enrichmentData flattening uses Array.isArray() branch first (Clay data), then object branch (company/provider data)"
  - "Person enrichment wins over Company enrichment when both have the same enrichment_* key (person data more specific)"
  - "Company data fetched in single query via prisma.company.findMany with domain array — O(1) lookup via Map"
  - "Enrichment headers sorted alphabetically for deterministic CSV column order"
  - "Filename sanitization: lowercase, non-alphanumeric → underscore, trim leading/trailing underscores"
  - "Route returns X-Export-Count header alongside CSV for debugging/logging"

patterns-established:
  - "Verification gate pattern: always call getListExportReadiness() before any export, check needsVerificationCount"
  - "Company join pattern: domains = unique Set from people, single findMany, Map for lookup"
  - "CSV route pattern: export endpoint returns new Response(csv) with Content-Disposition, not NextResponse"

requirements-completed:
  - EXPORT-02
  - EXPORT-03

# Metrics
duration: 3min
completed: 2026-02-27
---

# Phase 5 Plan 01: Verification Gate + CSV Export Summary

**Email verification gate with TargetList member categorization and CSV generation flattening Person/Company enrichmentData into dynamic columns**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-02-27T12:56:23Z
- **Completed:** 2026-02-27T12:59:02Z
- **Tasks:** 2
- **Files modified:** 3 (all new)

## Accomplishments
- Verification gate (verification-gate.ts) checks all TargetListPerson members and categorizes into ready/needsVerification/blocked with full ExportReadiness summary
- CSV utility (csv.ts) enforces gate, auto-excludes blocked, joins Company data via companyDomain, flattens both array and object enrichmentData formats into dynamic columns
- GET /api/lists/[id]/export endpoint returns downloadable CSV with proper Content-Type and Content-Disposition headers, 400 on gate block, 500 on unexpected error

## Task Commits

Each task was committed atomically:

1. **Task 1: Verification gate (getListExportReadiness + verifyAndFilter)** - `113e942` (feat)
2. **Task 2: CSV utility + API endpoint** - `37e47f1` (feat)

**Plan metadata:** (upcoming docs commit)

## Files Created/Modified
- `src/lib/export/verification-gate.ts` - ExportReadiness check using TargetListPerson model, parallel verification status checks, verifyAndFilter for post-approval email verification
- `src/lib/export/csv.ts` - flattenEnrichmentData (array + object), escapeCsv, generateListCsv with verification gate, Company join, dynamic enrichment columns
- `src/app/api/lists/[id]/export/route.ts` - GET handler returning CSV file, distinguishes gate errors (400) from unexpected errors (500)

## Decisions Made
- Verification gate throws on any unverified email (hard block per CONTEXT.md). Blocked/invalid emails auto-excluded silently after verification.
- enrichmentData flattening: Array.isArray() check first for Clay [{name,value}] format, then object {k:v} fallback for company/provider data.
- Person enrichment wins on key collision (more specific than company-level data).
- Company records fetched in single batch query then Map-indexed for O(1) lookup.
- Enrichment headers sorted alphabetically for deterministic CSV column order across exports.
- Route uses `new Response()` (not `NextResponse`) since CSV response doesn't need JSON helpers.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- `npx tsc --noEmit src/lib/export/verification-gate.ts` fails due to `@/` alias not resolvable in single-file mode — ran full project `npx tsc --noEmit` instead, which passes cleanly.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Verification gate and CSV export are complete and ready for use by Phase 5 Plan 02 (EmailBison push) and Plan 03 (MCP tool migration)
- getListExportReadiness() provides the pre-export summary data (verifiedEmailPct, verticalBreakdown, enrichmentCoverage) that the agent flow requires before user approval
- No blockers for next plans

---
*Phase: 05-export-emailbison-integration*
*Completed: 2026-02-27*
