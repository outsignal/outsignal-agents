# Phase 4: Search, Filter + List Building - Context

**Gathered:** 2026-02-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can find any person or company in the database, filter by enrichment state and ICP criteria, and assemble qualified lists ready for export. This is an internal tool — only the operator uses it alongside CLI agents. No multi-user considerations needed.

</domain>

<decisions>
## Implementation Decisions

### Search experience
- Separate `/people` and `/companies` pages, each with their own search bar and filters
- Instant search with ~300ms debounce — results update as you type
- Dense table rows (spreadsheet-like) for displaying results
- People table default columns: Name, Email, Company, Title, Vertical, Enrichment Status
- Companies table: searchable by name, domain, or vertical with enrichment status visible

### Filter design
- Left sidebar filter panel (persistent, always visible)
- AND logic across different filters, OR logic within the same filter (e.g. vertical=Recruitment OR Merchandise AND status=Enriched)
- Active filters displayed as removable chips/tags above the results table
- Filtered result count updates live as filters are toggled — no "Apply" button
- People filters: vertical, enrichment status, workspace, company
- Company filters: vertical, enrichment status

### Selection + list building
- Checkbox per row with "Select all" in header for current page
- "Select all X matching" link appears to select across all pages
- Sticky action bar appears at bottom when selections are active, showing count (e.g. "12 selected") with "Add to List" button
- "Add to List" opens dropdown to pick existing list or create new
- New list creation: simple modal with list name (required) + workspace picker (required, since lists are workspace-scoped)
- Users can add people from search results and remove people from within the list detail view

### List management
- "Lists" item in sidebar navigation
- List index page shows: list name, people count, workspace, and mini enrichment completeness bar per list
- List index page has its own search bar to find lists (could have 100s of lists)
- Delete list with confirmation — deletes the list container only, people remain in database
- List detail view shows enrichment summary bars at top (% with email, % with LinkedIn, % with company data)
- Each row in list detail shows green/yellow/red enrichment status indicator

### Claude's Discretion
- Exact pagination implementation (offset vs cursor, page size)
- Loading states and skeleton designs
- Empty state messages and illustrations
- Error handling patterns
- Company search result columns
- Exact color/styling of enrichment indicators (as long as green/yellow/red intent is clear)

</decisions>

<specifics>
## Specific Ideas

- Layout should feel like Apollo or HubSpot contact lists — dense, scannable, data-forward
- Filter bar similar to Amazon's left sidebar approach
- Bottom action bar similar to Gmail's bulk action bar
- Enrichment completeness bars should give at-a-glance visibility into list quality before export

</specifics>

<deferred>
## Deferred Ideas

- Export functionality (CSV, integrations) — future phase
- Advanced saved search / saved filters — future phase

</deferred>

---

*Phase: 04-search-filter-list-building*
*Context gathered: 2026-02-27*
