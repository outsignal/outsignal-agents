---
phase: 16-discovery-sources
plan: 01
subsystem: discovery
tags: [discovery, apollo, prospeo, staging, prisma]
dependency_graph:
  requires: []
  provides:
    - rawResponse column on DiscoveredPerson model (DB + Prisma client)
    - stageDiscoveredPeople function for batch DB writes
    - ApolloAdapter implements DiscoveryAdapter (Apollo People API)
    - ProspeoSearchAdapter implements DiscoveryAdapter (Prospeo /search-person)
  affects:
    - prisma/schema.prisma
    - src/lib/discovery/staging.ts
    - src/lib/discovery/adapters/apollo.ts
    - src/lib/discovery/adapters/prospeo-search.ts
tech_stack:
  added:
    - Apollo People API (POST /api/v1/mixed_people/api_search) — free search, 275M contacts
    - Prospeo /search-person API — paid (1 credit/request = $0.002), 20+ filters including funding stage
  patterns:
    - DiscoveryAdapter interface pattern (search -> DiscoveryResult)
    - Zod passthrough schema validation for external APIs
    - AbortController 15s timeout
    - createMany with skipDuplicates: false (dedup deferred to Phase 17)
key_files:
  created:
    - src/lib/discovery/staging.ts
    - src/lib/discovery/adapters/apollo.ts
    - src/lib/discovery/adapters/prospeo-search.ts
  modified:
    - prisma/schema.prisma (rawResponse column added to DiscoveredPerson)
decisions:
  - "Apollo search returns no emails — email field always undefined in DiscoveredPersonResult; enrichment is Phase 17"
  - "Prospeo Search uses person_id as sourceId for Phase 17 enrichment via /enrich-person"
  - "stageDiscoveredPeople uses skipDuplicates: false intentionally — dedup is Phase 17 responsibility"
  - "ProspeoSearchAdapter.search() has extras optional param beyond DiscoveryAdapter interface for Prospeo-specific filters (company_funding, person_department)"
  - "prisma db push used to apply schema change (project uses db push, no migration history)"
metrics:
  duration_minutes: 2
  completed_date: "2026-03-04"
  tasks_completed: 3
  tasks_total: 3
  files_created: 3
  files_modified: 1
---

# Phase 16 Plan 01: Discovery Sources (Apollo + Prospeo Search + Staging) Summary

**One-liner:** Apollo adapter (free, 275M contacts) + Prospeo Search adapter (1 credit/call, funding filters) + shared stageDiscoveredPeople batch writer with rawResponse column for audit.

## What Was Built

### Schema Change
Added `rawResponse String?` column to the `DiscoveredPerson` model in `prisma/schema.prisma`. Applied to the Neon PostgreSQL database via `prisma db push`. Column stores JSON-serialized raw API responses for debugging and audit, placed after `discoveryRunId`.

### Staging Helper (`src/lib/discovery/staging.ts`)
Shared write path for all discovery adapters. Exports:
- `StagingInput` interface: people array, discoverySource, workspaceSlug, searchQuery, discoveryRunId, rawResponses (optional parallel array)
- `stageDiscoveredPeople(input): Promise<{ staged, runId }>`: generates runId if not provided, maps DiscoveredPersonResult to Prisma create data, handles per-person rawResponse serialization, calls `prisma.discoveredPerson.createMany` with `skipDuplicates: false`

### Apollo Adapter (`src/lib/discovery/adapters/apollo.ts`)
Implements `DiscoveryAdapter` against `POST https://api.apollo.io/api/v1/mixed_people/api_search`:
- `estimatedCostPerResult = 0` (Apollo search is free)
- Auth: `x-api-key` header with `APOLLO_API_KEY` env var
- Filter mapping: jobTitles -> person_titles, seniority (with ic->senior mapping) -> person_seniorities, locations -> person_locations, companySizes -> organization_num_employees_ranges (via `sizeToApolloRange`), industries -> q_organization_keyword_tags, keywords -> q_keywords (joined), companyDomains -> organization_domains
- Pagination: page/per_page, nextPageToken as String(page+1)
- email always undefined — Apollo search API does not return emails
- 15s AbortController timeout, 429 gets `.status` property for retry

### Prospeo Search Adapter (`src/lib/discovery/adapters/prospeo-search.ts`)
Implements `DiscoveryAdapter` against `POST https://api.prospeo.io/search-person`:
- `estimatedCostPerResult = 0.04` (1 credit per call / ~25 results)
- Auth: `X-KEY` header with `PROSPEO_API_KEY` env var (same as enrichment adapter)
- Filter mapping using Prospeo's `include/exclude` array format: person_job_title, person_seniority, person_location, company_industry, company_headcount_range, company_domain, keywords
- Optional `extras` param for Prospeo-specific filters not in DiscoveryFilter: company_funding, person_department (passed through directly to request body)
- Pagination: 25 results/page (Prospeo fixed), uses pagination.total_page from response
- email always undefined — enrichment via /enrich-person is Phase 17
- `PROSPEO_SEARCH_CREDIT_COST = 0.002` per call

## Verification

1. `npx prisma validate` — passes, schema valid with rawResponse column
2. `npx tsc --noEmit` — passes, all TypeScript compiles without errors
3. Both adapters implement DiscoveryAdapter interface (TypeScript enforces at compile time)
4. staging.ts imports from `@/lib/db` and `./types` correctly
5. Apollo uses `x-api-key`, Prospeo uses `X-KEY` auth headers
6. Neither adapter returns emails (both search APIs do not provide them)

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1: Schema + Staging | `9e5979b` | rawResponse column + stageDiscoveredPeople helper |
| 2: Apollo Adapter | `344e2a7` | ApolloAdapter implementing DiscoveryAdapter |
| 3: Prospeo Search Adapter | `ed80904` | ProspeoSearchAdapter implementing DiscoveryAdapter |

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- FOUND: prisma/schema.prisma (rawResponse column at line 186)
- FOUND: src/lib/discovery/staging.ts
- FOUND: src/lib/discovery/adapters/apollo.ts
- FOUND: src/lib/discovery/adapters/prospeo-search.ts
- FOUND: commit 9e5979b (Task 1)
- FOUND: commit 344e2a7 (Task 2)
- FOUND: commit ed80904 (Task 3)
- TypeScript compiles cleanly (npx tsc --noEmit passes)
- Prisma schema validates (npx prisma validate passes)
- Schema applied to Neon database (prisma db push success)
