---
phase: 04-search-filter-list-building
plan: 05
subsystem: ui
tags: [react, next.js, shadcn, checkbox, dropdown, dialog, nuqs]

# Dependency graph
requires:
  - phase: 04-02
    provides: PeopleSearchPage component with URL state
  - phase: 04-04
    provides: /api/lists and /api/lists/[id]/people API routes

provides:
  - Bulk checkbox selection on people search (row + header)
  - "Select all X matching" cross-page selection via filter params
  - Sticky BulkActionBar at bottom when selections are active
  - AddToListDropdown with existing list picker and create-new-list modal
  - Companies and Lists navigation items in sidebar

affects: [phase-05-export, future-list-building-workflows]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Ephemeral selection state in useState (not URL state) — selection is not bookmarkable
    - selectAllFilters object passed to API for cross-page bulk operations
    - filterKey string derived from URL params to detect filter changes and auto-clear selection
    - Fetch-on-open pattern for AddToListDropdown lists (avoids unnecessary API calls)

key-files:
  created:
    - src/components/search/bulk-action-bar.tsx
    - src/components/search/add-to-list-dropdown.tsx
  modified:
    - src/components/search/people-search-page.tsx
    - src/components/layout/sidebar.tsx

key-decisions:
  - "Selection state in useState not nuqs — ephemeral UI state should not be bookmarkable or URL-polluting"
  - "filterKey string derived from URL params triggers useEffect to clear selection when filters change"
  - "Fetch-on-open pattern for list loading — avoids unnecessary GET /api/lists call when user never clicks Add to List"
  - "selectAllMatching sends currentFilterParams object to API instead of individual IDs — enables server-side filtering for large datasets"
  - "Row click also toggles checkbox — improves UX without requiring precise click on small checkbox target"
  - "isActive uses startsWith for /lists/* and /companies/* — child routes highlight parent nav item correctly"

patterns-established:
  - "BulkActionBar: fixed bottom bar pattern with selection count and children slot for action buttons"
  - "DropdownMenu + Dialog composition for Add to List — dropdown for fast selection, dialog for create flow"

requirements-completed:
  - LIST-02
  - LIST-03

# Metrics
duration: 3min
completed: 2026-02-27
---

# Phase 04 Plan 05: Bulk Selection and List Building Summary

**Checkbox bulk selection on people search with sticky action bar, Add to List dropdown with create-new-list modal, and Companies/Lists sidebar navigation**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-27T11:32:36Z
- **Completed:** 2026-02-27T11:35:38Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Row and header checkboxes on people search table with brand-yellow checked state
- "Select all X matching" banner promotes page selection to full-dataset selection via filter params
- Sticky BulkActionBar fixed to bottom (left-64 to account for sidebar) with count display and action slot
- AddToListDropdown fetches existing lists on open, filters client-side by search, and POSTs to /api/lists/[id]/people
- Create New List modal with name, workspace select (from filterOptions), and optional description
- Selection auto-clears when URL filter params change
- Row click toggles selection in addition to checkbox click
- Sidebar updated with Companies (Building2) and Lists (ListChecks) nav items
- isActive check updated to use startsWith for /lists/* and /companies/* route highlighting

## Task Commits

Each task was committed atomically:

1. **Task 1: Bulk selection components + Add to List dropdown** - `a7d1094` (feat)
2. **Task 2: Wire selection into people search page + Update sidebar navigation** - `056329a` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `src/components/search/bulk-action-bar.tsx` - Sticky bottom bar with selected count, clear, and action button slot
- `src/components/search/add-to-list-dropdown.tsx` - Dropdown with list picker, search filter, and create-new-list dialog
- `src/components/search/people-search-page.tsx` - Updated with checkbox columns, selection state, "select all matching" banner, and BulkActionBar
- `src/components/layout/sidebar.tsx` - Added Companies and Lists nav items with isActive startsWith fix

## Decisions Made

- **Selection state in useState not nuqs:** Ephemeral UI state (selections) should not pollute the URL or be bookmarkable — useState is appropriate.
- **filterKey change detection:** Computed a string from all filter params; useEffect on that key auto-clears selection when filters change without needing to wire each param individually.
- **Fetch-on-open for lists:** AddToListDropdown fetches GET /api/lists only when the dropdown opens, not on component mount — avoids unnecessary API calls for users who never click Add to List.
- **selectAllMatching sends filters not IDs:** For "select all X matching," we pass the current filter params to the API instead of potentially thousands of IDs — cleaner and more scalable.
- **Row click toggles checkbox:** Whole row is clickable for toggle (stopPropagation on the checkbox cell prevents double-toggle). Better UX than requiring precise click on small checkbox.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 05 completes Phase 04. All list-building features are now wired end-to-end: search → filter → select → add to list.
- Phase 05 (export/email push to campaign) can proceed — lists now exist and are populated from bulk selection.
- /companies and /lists routes are already in the sidebar but the underlying pages (companies search, list index/detail) were built in Plans 03 and 04.

---
*Phase: 04-search-filter-list-building*
*Completed: 2026-02-27*

## Self-Check: PASSED

- src/components/search/bulk-action-bar.tsx — FOUND
- src/components/search/add-to-list-dropdown.tsx — FOUND
- .planning/phases/04-search-filter-list-building/04-05-SUMMARY.md — FOUND
- Commit a7d1094 — FOUND
- Commit 056329a — FOUND
