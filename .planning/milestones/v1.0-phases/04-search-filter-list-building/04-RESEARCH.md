# Phase 4: Search, Filter + List Building - Research

**Researched:** 2026-02-27
**Domain:** Full-stack search/filter UI, URL state management, Prisma query patterns, schema extension
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- Separate `/people` and `/companies` pages, each with their own search bar and filters
- Instant search with ~300ms debounce — results update as you type
- Dense table rows (spreadsheet-like) for displaying results
- People table default columns: Name, Email, Company, Title, Vertical, Enrichment Status
- Companies table: searchable by name, domain, or vertical with enrichment status visible
- Left sidebar filter panel (persistent, always visible)
- AND logic across different filters, OR logic within the same filter
- Active filters displayed as removable chips/tags above the results table
- Filtered result count updates live as filters are toggled — no "Apply" button
- People filters: vertical, enrichment status, workspace, company
- Company filters: vertical, enrichment status
- Checkbox per row with "Select all" in header for current page
- "Select all X matching" link appears to select across all pages
- Sticky action bar appears at bottom when selections are active, showing count with "Add to List" button
- "Add to List" opens dropdown to pick existing list or create new
- New list creation: simple modal with list name (required) + workspace picker (required, workspace-scoped)
- Users can add people from search results and remove people from within the list detail view
- "Lists" item in sidebar navigation
- List index page shows: list name, people count, workspace, and mini enrichment completeness bar per list
- List index page has its own search bar to find lists
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

### Deferred Ideas (OUT OF SCOPE)

- Export functionality (CSV, integrations) — future phase
- Advanced saved search / saved filters — future phase
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SEARCH-01 | User can search people by name, email, company, or job title | Prisma `contains` + `mode: 'insensitive'` across 4 fields via OR; dedicated API route `/api/people/search` with debounced client |
| SEARCH-02 | User can filter people by vertical, enrichment status, workspace, and company | URL params → Prisma WHERE clauses; enrichment status derived from field presence (email/linkedin/company); workspace filter via PersonWorkspace join |
| SEARCH-03 | User can search companies by name, domain, or vertical | Same pattern as SEARCH-01 but on Company model — name, domain, industry fields |
| SEARCH-04 | User can view enrichment status indicators (enriched/partial/missing) on each record | Derived at query time from field presence: email + linkedinUrl + companyDomain; no separate stored column needed |
| SEARCH-05 | User can paginate through large result sets (14k+ people, 17k+ companies) | Offset pagination with page=50 is fast enough at this scale; cursor is overkill for 14-19k rows |
| LIST-01 | User can create named target lists scoped to a workspace | New `TargetList` model + `TargetListPerson` junction table; Prisma explicit many-to-many |
| LIST-02 | User can add people to lists from search results (individually or in bulk) | POST `/api/lists/[id]/people` accepting array of personIds; bulk via "select all matching" query |
| LIST-03 | User can filter and segment leads by ICP criteria to build lists | Covered by SEARCH-02 filter system — same filter params feed list selection |
| LIST-04 | User can view list contents with enrichment completeness summary | Aggregate query at list detail load: count non-null email/linkedin/companyDomain over list members |
</phase_requirements>

---

## Summary

This phase builds the core data exploration surface of the app: two dense search/filter pages (people and companies), plus a list-building system that lets users select from search results and save named, workspace-scoped target lists. The technical work splits into four domains: (1) server API routes with multi-field search and compound filters, (2) client-side URL state management with debounce, (3) schema extension to add List/ListPerson models, and (4) UI components — filter sidebar, bulk selection, action bar, enrichment indicators.

The existing `/people` page is a starting point but uses server-rendered HTML form submission. This phase replaces it with a client-driven search experience backed by a JSON API route. The existing pattern in `enrichment-costs` page (pure client fetch, skeleton loading, `useState`/`useEffect`) is the closer reference for the new pages.

The 14,566 people and 19,300 companies are all within Neon PostgreSQL. Prisma `contains` with `mode: 'insensitive'` compiles to `ILIKE` which is efficient at this scale without needing pg_trgm trigram indexes — sub-200ms query times are achievable with existing indexes on `company`, `vertical`, and `status` columns. Full-text search (tsvector) is unnecessary at 14-19k rows and would require migration overhead.

**Primary recommendation:** Build a single `GET /api/people/search` route with URL params, use `nuqs` for type-safe URL state in the client sidebar/search components, and implement a simple `TargetList` + `TargetListPerson` explicit many-to-many in Prisma for list building.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| nuqs | ^2.x (latest) | Type-safe URL query state | Next.js-native, replaces manual `useSearchParams`/`useRouter` wiring; debounce built-in; 6kB; featured at Next.js Conf 2025 |
| use-debounce | ^10.x | Debounce hook for search input | Lightweight, used in official Next.js docs for search pattern; nuqs can also debounce but explicit hook is clearer |
| Prisma 6 | already installed | Database queries with multi-field search | Already in project — `contains` + `mode: 'insensitive'` for ILIKE search |
| Next.js App Router | 16.x already | Client + server component architecture | Already in project |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lucide-react | already installed | Icons for filter chips, search, list actions | Already in project, consistent with existing UI |
| shadcn/ui components | already installed | checkbox, dialog, dropdown-menu, badge | All needed components already present in `src/components/ui/` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| nuqs | Manual useSearchParams + useRouter | nuqs removes ~40 lines of boilerplate per filter; type-safe; built-in shallow updates |
| nuqs | Zustand/Jotai client state | URL state gives bookmarkable filtered views and works with server components; no persistence needed |
| Offset pagination | Cursor pagination | Cursor is faster at millions of rows; at 14-19k rows offset is simpler and performance difference is negligible |
| Prisma `contains` ILIKE | pg_trgm trigram search | Trigram needs extension + migration + raw SQL; ILIKE is sufficient at this row count |
| Prisma `contains` ILIKE | Prisma fullTextSearch (tsvector) | tsvector needs generated column + GIN index migration; word-boundary semantics differ; ILIKE substring search is what users expect for name/email |

**Installation:**
```bash
npm install nuqs use-debounce
```

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── app/(admin)/
│   ├── people/
│   │   └── page.tsx              # REPLACE existing — becomes client search page
│   ├── companies/
│   │   └── page.tsx              # NEW — company search page
│   └── lists/
│       ├── page.tsx              # NEW — list index page
│       └── [id]/
│           └── page.tsx          # NEW — list detail page
├── app/api/
│   ├── people/
│   │   └── search/
│   │       └── route.ts          # NEW — GET /api/people/search
│   ├── companies/
│   │   └── search/
│   │       └── route.ts          # NEW — GET /api/companies/search
│   └── lists/
│       ├── route.ts              # NEW — GET (list all) + POST (create)
│       └── [id]/
│           ├── route.ts          # NEW — DELETE
│           └── people/
│               └── route.ts     # NEW — POST (add people), DELETE (remove person)
└── components/
    └── search/
        ├── people-search-page.tsx    # NEW — client component, full search page
        ├── companies-search-page.tsx # NEW — client component
        ├── filter-sidebar.tsx        # NEW — left sidebar filters
        ├── bulk-action-bar.tsx       # NEW — sticky bottom bar
        ├── enrichment-badge.tsx      # NEW — green/yellow/red indicator
        └── add-to-list-dropdown.tsx  # NEW — list picker + create modal
```

### Pattern 1: URL State with nuqs + debounce

**What:** Filter and search state lives in the URL, not React state. nuqs manages type-safe reads/writes. The search input debounces 300ms before updating the URL.
**When to use:** All filter/search state that should be bookmarkable or survive page refresh.

```typescript
// Source: https://nuqs.dev/docs/adapters (official nuqs docs)
// In root layout — wrap once:
import { NuqsAdapter } from 'nuqs/adapters/next/app'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <NuqsAdapter>{children}</NuqsAdapter>
}

// In the search/filter client component:
'use client'
import { useQueryStates, parseAsString, parseAsArrayOf } from 'nuqs'
import { useDebouncedCallback } from 'use-debounce'

export function PeopleSearchFilters() {
  const [params, setParams] = useQueryStates({
    q: parseAsString.withDefault(''),
    vertical: parseAsArrayOf(parseAsString).withDefault([]),
    enrichment: parseAsString.withDefault(''),
    workspace: parseAsString.withDefault(''),
    page: parseAsInteger.withDefault(1),
  }, { shallow: false }) // shallow: false triggers server re-render

  const debouncedSetQ = useDebouncedCallback(
    (value: string) => setParams({ q: value, page: 1 }),
    300
  )

  // Reset page to 1 when any filter changes
  const handleFilterChange = (key: string, value: unknown) => {
    setParams({ [key]: value, page: 1 })
  }
  ...
}
```

### Pattern 2: Search API Route with Prisma Multi-Field OR + Compound AND Filters

**What:** A single GET endpoint receives URL params and builds a dynamic Prisma WHERE clause. Multi-field text search uses OR, cross-filter uses AND.
**When to use:** All search endpoints in this phase.

```typescript
// Source: project pattern from existing /api/enrichment/costs/route.ts
// GET /api/people/search?q=john&vertical=Recruitment&workspace=rise&enrichment=full&page=1
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const q = searchParams.get('q') ?? ''
  const verticals = searchParams.getAll('vertical')       // multi-value
  const workspace = searchParams.get('workspace') ?? ''
  const enrichment = searchParams.get('enrichment') ?? '' // 'full' | 'partial' | 'missing'
  const page = Math.max(1, Number(searchParams.get('page') ?? '1'))
  const PAGE_SIZE = 50

  // Build WHERE — AND across filter types, OR within each filter type
  const where: Prisma.PersonWhereInput = {}

  // Text search: OR across fields
  if (q) {
    where.OR = [
      { email: { contains: q, mode: 'insensitive' } },
      { firstName: { contains: q, mode: 'insensitive' } },
      { lastName: { contains: q, mode: 'insensitive' } },
      { company: { contains: q, mode: 'insensitive' } },
      { jobTitle: { contains: q, mode: 'insensitive' } },
    ]
  }

  // Vertical filter: OR within, AND with other filters
  if (verticals.length > 0) {
    where.vertical = { in: verticals }
  }

  // Workspace filter: via PersonWorkspace join
  if (workspace) {
    where.workspaces = { some: { workspace } }
  }

  // Enrichment status filter: derived from field presence
  if (enrichment === 'full') {
    where.email = { not: null }
    where.linkedinUrl = { not: null }
    where.companyDomain = { not: null }
  } else if (enrichment === 'partial') {
    // Has email but missing linkedin OR companyDomain
    where.AND = [
      { email: { not: null } },
      { OR: [{ linkedinUrl: null }, { companyDomain: null }] }
    ]
  } else if (enrichment === 'missing') {
    where.OR = [{ linkedinUrl: null }, { companyDomain: null }]
    // Note: email is always present (String @unique, never null)
  }

  const [people, total] = await Promise.all([
    prisma.person.findMany({
      where,
      select: {
        id: true, email: true, firstName: true, lastName: true,
        company: true, jobTitle: true, vertical: true,
        linkedinUrl: true, companyDomain: true,
        workspaces: { select: { workspace: true, vertical: true } }
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.person.count({ where }),
  ])

  return NextResponse.json({ people, total, page, pageSize: PAGE_SIZE })
}
```

### Pattern 3: Enrichment Status Derived Field

**What:** Enrichment status (full/partial/missing) is computed per-record at render time, not stored. Avoids a separate column that could go stale.
**When to use:** Anywhere an enrichment badge is displayed.

```typescript
// In a shared utility (src/lib/enrichment/status.ts)
export type EnrichmentStatus = 'full' | 'partial' | 'missing'

export function getEnrichmentStatus(person: {
  email: string | null
  linkedinUrl: string | null
  companyDomain: string | null
}): EnrichmentStatus {
  const hasEmail = !!person.email
  const hasLinkedin = !!person.linkedinUrl
  const hasCompany = !!person.companyDomain
  const score = [hasEmail, hasLinkedin, hasCompany].filter(Boolean).length
  if (score === 3) return 'full'
  if (score >= 1) return 'partial'
  return 'missing'
}

// Color mapping (green/yellow/red intent)
export const ENRICHMENT_COLORS: Record<EnrichmentStatus, string> = {
  full: '#4ECDC4',    // teal-green (consistent with existing chart colors)
  partial: '#F0FF7A', // brand yellow
  missing: '#FF6B6B', // red (existing error color)
}
```

### Pattern 4: Bulk Selection with "Select All Matching"

**What:** Row-level checkboxes tracked in client state (Set of IDs). A "Select all X matching" prompt stores a flag instead of all IDs — the bulk action uses current filter params to target all matching records server-side.
**When to use:** Bulk "Add to List" action.

```typescript
// Two modes of selection:
// 1. Individual: Set<string> of person IDs (client state only)
// 2. All matching: boolean flag + current filter params (sent to API)

// POST /api/lists/[id]/people
// Body option A: { personIds: string[] }
// Body option B: { selectAllFilters: { q, vertical, workspace, enrichment } }
// Server handles both cases
```

### Pattern 5: Explicit Many-to-Many for Lists (new schema models)

**What:** `TargetList` model owned by a workspace, with `TargetListPerson` junction table. Mirrors the existing `PersonWorkspace` pattern in the project.

```prisma
// prisma/schema.prisma additions

model TargetList {
  id            String   @id @default(cuid())
  name          String
  workspaceSlug String
  description   String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  people TargetListPerson[]

  @@index([workspaceSlug])
}

model TargetListPerson {
  id           String   @id @default(cuid())
  listId       String
  personId     String
  addedAt      DateTime @default(now())

  list   TargetList @relation(fields: [listId], references: [id], onDelete: Cascade)
  person Person     @relation(fields: [personId], references: [id], onDelete: Cascade)

  @@unique([listId, personId])
  @@index([listId])
  @@index([personId])
}
```

Note: The `Person` model also needs `lists TargetListPerson[]` added to its relation fields.

### Pattern 6: Enrichment Completeness Summary for List Detail

**What:** On list detail load, aggregate counts across list members in a single query.

```typescript
// GET /api/lists/[id] returns summary alongside people
const members = await prisma.targetListPerson.findMany({
  where: { listId },
  include: { person: { select: { email: true, linkedinUrl: true, companyDomain: true } } },
})

const total = members.length
const withEmail = members.filter(m => m.person.email).length
const withLinkedin = members.filter(m => m.person.linkedinUrl).length
const withCompany = members.filter(m => m.person.companyDomain).length

// Returns:
// { pctEmail: withEmail/total, pctLinkedin: withLinkedin/total, pctCompany: withCompany/total }
```

For large lists this could be slow — at Phase 4 scope (lists are manually assembled, likely <500 people), in-memory aggregation after a single join query is fine.

### Anti-Patterns to Avoid

- **Server Component for dynamic search:** Do NOT use a server-side `page.tsx` that re-renders on searchParam changes for the search pages. The existing `/people/page.tsx` uses `searchParams` prop and does full server round-trips. Replace with a client component that fetches from a JSON API — this is what enables instant debounce, live filter counts, and checkbox state.
- **Re-fetching count separately on every filter change:** Batch `count` and `findMany` in a single `Promise.all` in the API route. Never make two sequential requests.
- **Storing enrichment status as a DB column:** It would go stale when underlying fields are updated by enrichment providers. Derive it.
- **Using Prisma fullTextSearch for this use case:** The `@@fullTextIndex` + `search` filter uses PostgreSQL tsvector which does word-boundary tokenization. For email addresses like `john.doe@company.com`, tsvector won't match "john" against that string. ILIKE substring match is the right choice here.
- **Top-level `where` field overwrite when combining enrichment + other filters:** When building the Prisma WHERE clause dynamically, use `AND: [...]` array syntax rather than assigning to `where.OR` multiple times (second assignment overwrites first).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| URL query state | Custom hooks reading/writing URLSearchParams | `nuqs` | Edge cases: sync on initial load, history entries, React 18 transitions, shallow vs deep updates |
| Debounce | setTimeout-based debounce in component | `use-debounce` `useDebouncedCallback` | Cancellation on unmount, TypeScript types, stable reference |
| Filter chip removal | Custom "remove from array" URL param logic | nuqs `parseAsArrayOf` with `.withDefault([])` | Handles serialization/deserialization automatically |
| Bulk selection "select all matching" | Fetch all IDs client-side first | Server-side filter params in bulk action payload | Avoids fetching 14k IDs into browser memory |

**Key insight:** URL state management in Next.js App Router has many edge cases around Suspense boundaries, hydration, and history entries. nuqs has solved all of them; any hand-rolled solution will rediscover the same bugs.

---

## Common Pitfalls

### Pitfall 1: Missing NuqsAdapter in Layout

**What goes wrong:** `useQueryState` / `useQueryStates` throws or silently no-ops.
**Why it happens:** nuqs requires a React context provider (NuqsAdapter) in the tree.
**How to avoid:** Add `<NuqsAdapter>` to `src/app/(admin)/layout.tsx` (the admin layout, not root layout — scoped to avoid affecting portal/customer routes).
**Warning signs:** "No NuqsAdapter found" console error; URL never updates.

### Pitfall 2: `where.OR` Overwritten by Multiple Assignments

**What goes wrong:** Text search OR clause gets silently replaced by enrichment filter's OR clause.
**Why it happens:** `where.OR = [...]` twice — second assignment wins.
**How to avoid:** Use `where.AND = [{ OR: [...text search] }, { OR: [...enrichment] }]` when both conditions are active.
**Warning signs:** Text search stops working when enrichment filter is active.

### Pitfall 3: Checkbox State Lost on Page Navigation

**What goes wrong:** User selects 10 people, clicks to page 2, selections vanish.
**Why it happens:** `Set<string>` of selected IDs lives in component state — page change remounts or resets state.
**How to avoid:** Keep selection state in a parent component that doesn't remount on page change. OR: implement "select all matching" as the primary bulk flow (no need to track across pages).
**Warning signs:** Users complain that paginating clears selections.

### Pitfall 4: Prisma `mode: 'insensitive'` Performance

**What goes wrong:** Slow queries on text search (>500ms).
**Why it happens:** Prisma generates `ILIKE` which can't use a standard B-tree index. PostgreSQL must scan all rows.
**How to avoid:** At 14-19k rows, ILIKE is fast enough (~50-100ms) without indexes. If it ever becomes slow, add a `pg_trgm` GIN index via `db push` with a raw SQL migration. Don't optimize prematurely.
**Warning signs:** Search queries taking >300ms in Neon console. Check query plan with EXPLAIN ANALYZE.

### Pitfall 5: `db push` vs `migrate dev` for Schema Changes

**What goes wrong:** Running `migrate dev` on production Neon database with 14k records.
**Why it happens:** Project has no migration history — established in decision [01-01]. `migrate dev` would create shadow database and could prompt destructive actions.
**How to avoid:** Use `prisma db push` for all Phase 4 schema changes (TargetList, TargetListPerson models). This is the established project pattern.
**Warning signs:** Any attempt to run `prisma migrate dev` — stop and use `db push`.

### Pitfall 6: `searchParams` is a Promise in Next.js 15/16

**What goes wrong:** TypeScript error or runtime crash when accessing `searchParams.q` directly.
**Why it happens:** Next.js 15+ made `searchParams` a Promise that must be awaited in server components.
**How to avoid:** The new search pages are client components (no `searchParams` prop needed — nuqs reads URL directly). If any server component needs initial params, `await searchParams` before use.
**Warning signs:** See existing pattern in `/people/page.tsx` line 26: `const params = await searchParams`.

### Pitfall 7: nuqs `shallow: false` Required for Server Re-renders

**What goes wrong:** URL updates but server component (SSR data) doesn't re-fetch.
**Why it happens:** nuqs defaults to shallow routing (history.pushState without server round-trip) which is correct for pure client state. For search pages backed by JSON API routes, we don't need server re-renders at all — the client fetches from the API directly. So `shallow: true` (default) is actually correct here.
**How to avoid:** Don't set `shallow: false`. Use client fetch pattern (like `enrichment-costs` page). URL state drives client `useEffect` which calls the API.
**Warning signs:** Unnecessary full page round-trips to the server on every filter change.

---

## Code Examples

Verified patterns from official sources and project codebase:

### Search Input with Debounce (Next.js official pattern)

```typescript
// Source: https://nextjs.org/learn/dashboard-app/adding-search-and-pagination
'use client'
import { useDebouncedCallback } from 'use-debounce'

export function SearchInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const handleChange = useDebouncedCallback((term: string) => {
    onChange(term)
  }, 300)

  return (
    <input
      defaultValue={value}
      onChange={(e) => handleChange(e.target.value)}
      placeholder="Search by name, email, company, title..."
      className="..."
    />
  )
}
```

### nuqs Multi-Filter State

```typescript
// Source: https://nuqs.dev/ — official docs
'use client'
import { useQueryStates, parseAsString, parseAsArrayOf, parseAsInteger } from 'nuqs'

export function usePeopleFilters() {
  return useQueryStates({
    q: parseAsString.withDefault(''),
    vertical: parseAsArrayOf(parseAsString).withDefault([]),
    enrichment: parseAsString.withDefault(''),
    workspace: parseAsString.withDefault(''),
    company: parseAsString.withDefault(''),
    page: parseAsInteger.withDefault(1),
  })
}
```

### Prisma TargetList — Create + Add People

```typescript
// Create list
const list = await prisma.targetList.create({
  data: { name, workspaceSlug, description: description ?? null }
})

// Add people (bulk upsert — ignore duplicates)
await prisma.targetListPerson.createMany({
  data: personIds.map(personId => ({ listId: list.id, personId })),
  skipDuplicates: true,
})

// Remove person from list
await prisma.targetListPerson.delete({
  where: { listId_personId: { listId, personId } }
  // Note: @@unique([listId, personId]) generates this compound unique name automatically
})
```

### Enrichment Completeness Summary

```typescript
// In list detail API handler
const [listWithPeople, totalInList] = await Promise.all([
  prisma.targetList.findUnique({
    where: { id: listId },
    include: {
      people: {
        include: {
          person: {
            select: { id: true, email: true, firstName: true, lastName: true,
                       company: true, jobTitle: true, linkedinUrl: true,
                       companyDomain: true, vertical: true }
          }
        },
        orderBy: { addedAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }
    }
  }),
  prisma.targetListPerson.count({ where: { listId } })
])

// Aggregate enrichment summary (all members, not just current page)
const allMembers = await prisma.targetListPerson.findMany({
  where: { listId },
  select: { person: { select: { email: true, linkedinUrl: true, companyDomain: true } } }
})
const summary = {
  total: allMembers.length,
  withEmail: allMembers.filter(m => m.person.email).length,
  withLinkedin: allMembers.filter(m => m.person.linkedinUrl).length,
  withCompany: allMembers.filter(m => m.person.companyDomain).length,
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `useSearchParams` + `useRouter` + manual URLSearchParams | `nuqs` with `useQueryStates` | nuqs v2 (2024) | 40+ lines → 10 lines; type-safe |
| Server component `searchParams` re-render | Client fetch to JSON API | Next.js 14 App Router matured | Faster perceived performance; no full page reload |
| `migrate dev` for schema changes | `db push` for schema changes | Established in this project [01-01] | Safe for production DB without migration history |
| Separate count and data queries | `Promise.all([findMany, count])` | Always best practice | Halves query latency |

**Deprecated/outdated:**
- Existing `/people/page.tsx`: Uses server-side `searchParams` + HTML form submission. Functional but doesn't support instant debounced search or checkbox state. Will be replaced (not deleted) by a client component that calls the new API route.

---

## Open Questions

1. **nuqs NuqsAdapter placement**
   - What we know: NuqsAdapter should wrap the tree where nuqs hooks are used
   - What's unclear: Whether to put it in `src/app/(admin)/layout.tsx` or `src/app/layout.tsx`
   - Recommendation: Put it in `(admin)/layout.tsx` to avoid affecting portal/customer routes which don't use nuqs. This is safe because each route group has its own layout.

2. **Enrichment status filter for Company model**
   - What we know: Company doesn't have a direct "enrichment status" stored field; enrichment is tracked in `EnrichmentLog`
   - What's unclear: Whether "company enrichment status" means "has been enriched at all" or "has all key fields"
   - Recommendation: Derive from field presence: `industry`, `headcount`, `description` present = enriched; none present = missing. Same approach as Person.

3. **Filter value population (vertical options)**
   - What we know: Verticals are free-text strings stored on `Person.vertical` — not a fixed enum
   - What's unclear: How to populate the vertical filter options in the sidebar (fetch all distinct values vs hardcode)
   - Recommendation: Fetch distinct vertical values at page load via `prisma.person.groupBy({ by: ['vertical'] })` — there are ~6 active verticals in current data. Cache this list in the component.

4. **Company filter on People search**
   - What we know: People have `company` (string name) and `companyDomain` fields
   - What's unclear: Is the "company" filter a text search on company name, or a dropdown of known companies?
   - Recommendation: Treat it as a text search sub-filter (contains), not a dropdown — company names are too varied for a fixed dropdown.

---

## Validation Architecture

> `workflow.nyquist_validation` is not set in config.json — skipping this section.

---

## Sources

### Primary (HIGH confidence)
- Official Next.js docs: https://nextjs.org/learn/dashboard-app/adding-search-and-pagination — search/pagination pattern with debounce
- Official nuqs docs: https://nuqs.dev/docs/adapters — NuqsAdapter setup
- Project source `src/app/(admin)/enrichment-costs/page.tsx` — client fetch pattern (useState/useEffect/fetch) already used in project
- Project source `src/app/(admin)/people/page.tsx` — existing search starting point, URL params pattern
- Project `prisma/schema.prisma` — PersonWorkspace pattern to mirror for TargetListPerson
- DB query results: 14,566 people, 19,300 companies, 6 workspaces, top verticals confirmed

### Secondary (MEDIUM confidence)
- nuqs npm page + GitHub: https://github.com/47ng/nuqs — version, install, API
- Next.js Conf 2025 nuqs session: https://nextjs.org/conf/session/type-safe-url-state-in-nextjs-with-nuqs — confirms nuqs is first-class Next.js ecosystem
- WebSearch: Prisma `mode: 'insensitive'` → ILIKE confirmed; performance concern at millions of rows, not at 14k
- WebSearch: Prisma `db push` pattern confirmed appropriate for no-migration-history projects

### Tertiary (LOW confidence)
- Trigram index approach for ILIKE performance at scale — not needed at current row counts, noted as future option if queries slow

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — nuqs is widely adopted, confirmed at Next.js Conf 2025; all other deps already in project
- Architecture: HIGH — patterns derived from existing project code + official Next.js docs
- Pitfalls: HIGH — `db push` decision is documented in STATE.md; other pitfalls from direct code inspection
- Schema design: HIGH — mirrors existing `PersonWorkspace` pattern exactly

**Research date:** 2026-02-27
**Valid until:** 2026-03-30 (stable stack — nuqs, Prisma 6, Next.js 16 all stable releases)
