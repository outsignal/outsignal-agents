---
phase: 04-search-filter-list-building
plan: 02
subsystem: search-ui
tags: [search, filter, nuqs, prisma, next.js, client-components, enrichment]

# Dependency graph
requires:
  - phase: 04-01
    provides: nuqs + use-debounce installed, NuqsAdapter wired, getEnrichmentStatus utility
  - phase: 03-icp-qualification-leads-agent
    provides: Person model with linkedinUrl + companyDomain fields
provides:
  - GET /api/people/search with multi-field text search, compound filters, pagination
  - PeopleSearchPage client component (full search experience, URL-driven state)
  - FilterSidebar component (vertical, enrichment, workspace, company filters)
  - EnrichmentBadge component (green/yellow/red enrichment indicator)
affects:
  - /people route — now fully client-driven with instant search
  - 04-03 (company search — can follow same patterns as this plan)
  - 04-04 (list management — can reuse EnrichmentBadge component)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - AND conditions array pattern for Prisma WHERE — avoids clobbering where.OR
    - filterOptions bundled in search response — avoids extra API call on filter sidebar mount
    - nuqs useQueryStates for all URL filter state — bookmarkable, survives refresh
    - Filter options cached in ref after first load — static-ish data, no re-query on filter changes
    - useDebouncedCallback 300ms for search input and company filter

key-files:
  created:
    - src/app/api/people/search/route.ts
    - src/components/search/enrichment-badge.tsx
    - src/components/search/filter-sidebar.tsx
    - src/components/search/people-search-page.tsx
  modified:
    - src/app/(admin)/people/page.tsx

key-decisions:
  - "filterOptions (distinct verticals + workspaces) bundled in search response — single round trip, no extra API call"
  - "AND conditions array for Prisma WHERE — safe composition of OR + filter conditions without overwrite risk"
  - "Enrichment status filter maps to Prisma field-presence conditions — full/partial/missing derived at query time"
  - "Filter options cached in ref after first successful load — avoids re-querying all distinct values on every filter change"
  - "People page replaced wholesale (server component → client component) — server-side form submit is anti-pattern for dynamic search"

# Metrics
duration: ~3min
completed: 2026-02-27
---

# Phase 4 Plan 02: People Search UI Summary

**GET /api/people/search with multi-field text search + compound filters + pagination, and full client-side search page with debounced input, filter sidebar, enrichment badges, removable filter chips, and nuqs URL state**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-02-27T11:25:19Z
- **Completed:** 2026-02-27T11:27:51Z
- **Tasks:** 2
- **Files modified:** 5 (4 created, 1 replaced)

## Accomplishments

- GET /api/people/search route: text search across 5 fields (OR within), compound AND filters for vertical (multi-value), workspace, company (contains), enrichment status derived from field presence, paginated 50/page, filterOptions (distinct verticals+workspaces) bundled in response, all via single Promise.all
- EnrichmentBadge component: colored dot (teal-green/yellow/red) + label using getEnrichmentStatus from Plan 01
- FilterSidebar component: vertical checkboxes (multi-select, OR logic), enrichment radio buttons (full/partial/missing/all), workspace select, company text input (debounced 300ms)
- PeopleSearchPage: full client search experience — search input debounced 300ms, all state in URL via nuqs, active filter chips with individual remove + clear-all, dense 6-column results table with skeleton loading (8 rows), empty state, error state with retry, pagination showing "X-Y of Z results"
- people/page.tsx replaced: old server component with HTML form submission replaced by thin wrapper rendering PeopleSearchPage

## Task Commits

1. **Task 1: People search API route** - `1c0adc2` (feat)
2. **Task 2: People search page with filter sidebar and enrichment badges** - `2e648d1` (feat)

## Files Created/Modified

- `src/app/api/people/search/route.ts` — GET endpoint (created, 130 lines)
- `src/components/search/enrichment-badge.tsx` — EnrichmentBadge component (created, 28 lines)
- `src/components/search/filter-sidebar.tsx` — FilterSidebar component (created, 173 lines)
- `src/components/search/people-search-page.tsx` — PeopleSearchPage client component (created, 408 lines)
- `src/app/(admin)/people/page.tsx` — Thin server wrapper (replaced, 7 lines)

## Decisions Made

- filterOptions bundled in search response — single request on page load populates filter sidebar, no separate API call needed
- AND conditions array for Prisma WHERE — safe way to add OR within a filter (e.g. text search) plus other filter conditions without overwriting each other
- Enrichment filter maps to field-presence Prisma conditions: full=(linkedinUrl not null AND companyDomain not null), partial=(exactly one null), missing=(both null)
- Filter options cached via useRef after first successful load — verticals/workspaces don't change between searches, avoids N+1 groupBy queries
- Server component replaced wholesale — the old HTML form submit page was an anti-pattern for instant search (requires page reload per search)

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

- `src/app/api/people/search/route.ts` — EXISTS
- `src/components/search/enrichment-badge.tsx` — EXISTS
- `src/components/search/filter-sidebar.tsx` — EXISTS
- `src/components/search/people-search-page.tsx` — EXISTS
- `src/app/(admin)/people/page.tsx` — EXISTS (replaced)
- Commit `1c0adc2` — VERIFIED (Task 1)
- Commit `2e648d1` — VERIFIED (Task 2)
- TypeScript: `npx tsc --noEmit` — 0 errors in project code
