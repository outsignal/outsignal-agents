---
phase: 04-search-filter-list-building
plan: 03
subsystem: ui
tags: [react, nuqs, prisma, search, pagination, enrichment, companies]

# Dependency graph
requires:
  - phase: 04-search-filter-list-building/04-01
    provides: nuqs installed + NuqsAdapter in admin layout; enrichment status utility (getCompanyEnrichmentStatus, ENRICHMENT_COLORS, ENRICHMENT_LABELS)
provides:
  - GET /api/companies/search — multi-field text search, vertical filter, enrichment filter, pagination (50/page)
  - CompaniesSearchPage client component with debounced search, sidebar filters, enrichment badges, pagination
  - /companies admin page at src/app/(admin)/companies/page.tsx
affects:
  - 04-04 (list management — can link from company rows to lists)
  - 04-05 (list builder — company search used for adding companies to target lists)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - nuqs useQueryStates for URL-driven filter state (q, vertical[], enrichment, page)
    - Promise.all(findMany + count + groupBy) for paginated search with distinct filter options
    - Enrichment status derived at component render time via getCompanyEnrichmentStatus — no stored column
    - Sidebar filter pattern: left sidebar with enrichment + vertical filters, main panel with results table

key-files:
  created:
    - src/app/api/companies/search/route.ts
    - src/components/search/companies-search-page.tsx
    - src/app/(admin)/companies/page.tsx
  modified: []

key-decisions:
  - "enrichmentStatus annotated server-side in API route response — avoids client re-deriving from raw fields"
  - "allIndustries state initialized once from first API response and preserved — avoids industry list disappearing when vertical filter applied"
  - "CompanyEnrichmentBadge defined inline in companies-search-page.tsx — no separate file needed for small component"

patterns-established:
  - "Companies search API pattern: andConditions[] array + Promise.all(findMany+count+groupBy)"
  - "Sidebar filter with checkbox-style vertical toggle and status filter buttons"

requirements-completed: [SEARCH-03, SEARCH-04, SEARCH-05]

# Metrics
duration: 2min
completed: 2026-02-27
---

# Phase 4 Plan 03: Companies Search Summary

**GET /api/companies/search with multi-field text search and enrichment filters, plus client-driven /companies page with sidebar, debounced search, and enrichment indicators across 17k+ companies**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-02-27T11:25:40Z
- **Completed:** 2026-02-27T11:27:36Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- GET /api/companies/search endpoint with text search (name/domain/industry), vertical multi-filter, enrichment status filter (full/partial/missing), and 50-per-page pagination with Promise.all query parallelization
- CompaniesSearchPage client component with nuqs URL state, 300ms debounce, dark-theme sidebar filters, dense enrichment-annotated table, and Previous/Next pagination
- CompanyEnrichmentBadge inline component using getCompanyEnrichmentStatus for colored dot + label pattern
- Thin server wrapper page at /companies with force-dynamic export

## Task Commits

Each task was committed atomically:

1. **Task 1: Companies search API route** - `a5cc2a6` (feat)
2. **Task 2: Companies search page with filters and enrichment indicators** - `c202581` (feat)

## Files Created/Modified
- `src/app/api/companies/search/route.ts` - GET endpoint: text search, vertical/enrichment filters, pagination, filterOptions.industries
- `src/components/search/companies-search-page.tsx` - Client search page: debounced input, sidebar filters, enrichment badges, table, pagination
- `src/app/(admin)/companies/page.tsx` - Thin server wrapper, force-dynamic

## Decisions Made
- enrichmentStatus annotated in API response (server-side) — client receives pre-computed status, avoids re-deriving from field presence on every render
- allIndustries state initialized from first load and preserved across subsequent filter changes — prevents the industry sidebar from emptying when vertical filter is active
- CompanyEnrichmentBadge kept inline in the search page component — too small to warrant a separate file

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- `npx tsc --noEmit src/app/api/companies/search/route.ts` produced framework errors (Next.js internal types + path alias resolution) in isolation — verified with full `npx tsc --noEmit` instead, which reported clean output. Pre-existing known issue with project tsc configuration.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Companies search fully functional at /companies with URL-bookmarkable state
- Plan 04-04 (list management UI) can link from company/people search rows to target lists
- Plan 04-05 (list builder) can reuse the search API for adding companies to lists

---
*Phase: 04-search-filter-list-building*
*Completed: 2026-02-27*
