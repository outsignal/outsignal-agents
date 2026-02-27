---
phase: 04-search-filter-list-building
plan: "04"
subsystem: list-management
tags: [lists, crud, enrichment-summary, pagination, ui]
dependency_graph:
  requires: [04-01]
  provides: [list-crud-api, list-index-ui, list-detail-ui]
  affects: [04-05]
tech_stack:
  added: []
  patterns: [nextjs-async-params, prisma-cascade-delete, client-side-search-filter, enrichment-progress-bars]
key_files:
  created:
    - src/app/api/lists/route.ts
    - src/app/api/lists/[id]/route.ts
    - src/app/api/lists/[id]/people/route.ts
    - src/app/(admin)/lists/page.tsx
    - src/app/(admin)/lists/[id]/page.tsx
    - src/components/search/list-index-page.tsx
    - src/components/search/list-detail-page.tsx
  modified: []
decisions:
  - "Enrichment summary fetches all members in-memory for accuracy at Phase 4 scope (<500 people/list) — acceptable until list sizes grow"
  - "No import of EnrichmentBadge from Plan 02 — inline InlineEnrichmentBadge defined in list-detail-page.tsx using status.ts directly (Plan 02 runs in parallel Wave 2)"
  - "Client-side list name filtering — lists are few enough to filter in-memory after single fetch"
  - "Remove action uses person.id (not TargetListPerson.id) to match personId in DELETE body — consistent with API contract"
metrics:
  duration: "3 min"
  completed_date: "2026-02-27"
  tasks_completed: 2
  files_created: 7
  files_modified: 0
---

# Phase 04 Plan 04: List Management Summary

**One-liner:** Named workspace-scoped target lists with full CRUD API, enrichment completeness bars, and paginated detail views — output container for the search/filter workflow.

## What Was Built

Three API routes plus two UI pages that give users the ability to create, view, and manage named target lists of prospects.

### API Routes

**`GET /api/lists`** — Lists all target lists with enrichment summary stats. Supports `q` (name search) and `workspace` (slug filter). Each list includes `peopleCount`, `enrichment.withEmail`, `enrichment.withLinkedin`, `enrichment.withCompany` computed in-memory from Prisma includes.

**`POST /api/lists`** — Creates a new named list. Validates `name` and `workspaceSlug` are non-empty, returns 400 otherwise. Returns 201 with the created list.

**`GET /api/lists/[id]`** — List detail with paginated people (50/page) and full enrichment summary. Uses `Promise.all` for 4 parallel queries: list metadata, paginated members, total count, all-members enrichment aggregate. Returns 404 if list not found.

**`DELETE /api/lists/[id]`** — Deletes the list container. TargetListPerson entries cascade-delete. Person records remain untouched.

**`POST /api/lists/[id]/people`** — Adds people to a list. Supports two modes:
- `personIds: string[]` — individual selection
- `selectAllFilters: { q?, vertical?, workspace?, enrichment?, company? }` — server-side filter matching GET /api/people/search logic, bulk-adds all matching people

Uses `createMany` with `skipDuplicates: true`.

**`DELETE /api/lists/[id]/people`** — Removes a person from a list by `personId`. Returns 404 if not found.

### UI Components

**`list-index-page.tsx`** (300 lines) — Client component for `/lists` route.
- Table layout: Name, Workspace badge, People count, Enrichment bars, Created date, Delete action
- Client-side name search on fetched data
- Three-bar enrichment completeness indicator per list (brand yellow #F0FF7A fill, zinc-800 track)
- Delete confirmation dialog (shadcn Dialog): "People will remain in the database"
- Click row to navigate to `/lists/{id}`

**`list-detail-page.tsx`** (465 lines) — Client component for `/lists/[id]` route.
- Receives `listId` prop from async server wrapper
- Enrichment summary section with full-width progress bars (Email, LinkedIn, Company)
- People table: Name, Email, Company, Title, Vertical, Enrichment status, Remove
- Inline `InlineEnrichmentBadge` component using `getEnrichmentStatus`/`ENRICHMENT_COLORS`/`ENRICHMENT_LABELS` from `@/lib/enrichment/status` (no Plan 02 dependency)
- Remove person action with optimistic UI (shows "Removing..." during request)
- 50-per-page pagination with Previous/Next
- Delete list button with confirmation dialog; redirects to `/lists` on success
- 404 handling: shows "List not found" message

**Page wrappers:**
- `src/app/(admin)/lists/page.tsx` — wraps `ListIndexPage`
- `src/app/(admin)/lists/[id]/page.tsx` — async server component, awaits `params` (Next.js 15 pattern), passes `id` to `ListDetailPage`

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

All required artifacts verified:
- `src/app/api/lists/route.ts` — FOUND
- `src/app/api/lists/[id]/route.ts` — FOUND
- `src/app/api/lists/[id]/people/route.ts` — FOUND
- `src/app/(admin)/lists/page.tsx` — FOUND
- `src/app/(admin)/lists/[id]/page.tsx` — FOUND
- `src/components/search/list-index-page.tsx` — FOUND (300 lines, min 80)
- `src/components/search/list-detail-page.tsx` — FOUND (465 lines, min 100)

Commits verified:
- `6b43fe1` — feat(04-04): list management API routes
- `c182cfd` — feat(04-04): list index and detail UI pages

TypeScript: `npx tsc --noEmit` passes with 0 errors in project source files.
