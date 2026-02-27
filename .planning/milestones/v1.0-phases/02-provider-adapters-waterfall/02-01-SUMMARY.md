---
phase: 02-provider-adapters-waterfall
plan: 01
subsystem: database
tags: [prisma, postgresql, typescript, enrichment, cost-tracking]

# Dependency graph
requires:
  - phase: 01-enrichment-foundation
    provides: "EnrichmentLog, EnrichmentJob, Provider type, EnrichmentResult interface"
provides:
  - "DailyCostTotal Prisma model with date-unique key for daily cap tracking"
  - "EnrichmentJob.resumeAt DateTime? for pausing jobs on daily cap breach"
  - "EnrichmentLog.workspaceSlug with composite index for per-workspace cost reporting"
  - "EmailAdapter, CompanyAdapter function types with input/output interfaces"
  - "PROVIDER_COSTS config map with per-provider USD cost"
  - "checkDailyCap() and incrementDailySpend() cost tracking functions"
  - "mergePersonData() and mergeCompanyData() with existing-data-wins strategy"
affects: [02-02, 02-03, 02-04, 02-05, waterfall-orchestrator]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Existing-data-wins merge: check null before write, return fieldsWritten list"
    - "Daily cap as upsert on date string key — avoids transaction overhead, accepts tiny overspend risk"
    - "Provider adapters as function types — EmailAdapter/CompanyAdapter take input, return typed result"

key-files:
  created:
    - src/lib/enrichment/costs.ts
    - src/lib/enrichment/merge.ts
  modified:
    - prisma/schema.prisma
    - src/lib/enrichment/types.ts

key-decisions:
  - "db push used (not migrate dev) — project has no migration history; migrate dev would reset production data"
  - "check+increment NOT atomic in incrementDailySpend — accepts small overspend risk (one chunk) rather than transaction overhead"
  - "DailyCostTotal uses String date key (YYYY-MM-DD UTC) not DateTime — simpler upsert pattern, avoids TZ edge cases"
  - "Merge functions read current record first then write only null fields — prevents any data loss from provider enrichment"

patterns-established:
  - "EmailAdapter: (input: EmailAdapterInput) => Promise<EmailProviderResult> — all email adapters use this signature"
  - "CompanyAdapter: (domain: string) => Promise<CompanyProviderResult> — all company adapters use this signature"
  - "mergePersonData/mergeCompanyData: read-then-write with null guard — never overwrite existing values"

requirements-completed: [ENRICH-02, ENRICH-03, ENRICH-04]

# Metrics
duration: 2min
completed: 2026-02-26
---

# Phase 2 Plan 01: Schema Migration, Adapter Types, Cost Tracking, and Merge Logic Summary

**Prisma schema extended with DailyCostTotal, EnrichmentJob.resumeAt, and EnrichmentLog.workspaceSlug; provider adapter types and existing-data-wins merge strategy established as the foundation layer for all Phase 2 adapters**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-02-26T18:12:09Z
- **Completed:** 2026-02-26T18:13:54Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Schema migration pushed to Neon DB: DailyCostTotal model, EnrichmentJob.resumeAt, EnrichmentLog.workspaceSlug + index
- EmailAdapter and CompanyAdapter function type contracts established with typed input/output interfaces
- PROVIDER_COSTS config map (5 providers) with checkDailyCap/incrementDailySpend functions backed by DailyCostTotal
- mergePersonData/mergeCompanyData implementing existing-data-wins merge — only writes null fields, returns fieldsWritten list

## Task Commits

Each task was committed atomically:

1. **Task 1: Schema migration** - `5c6ff39` (feat)
2. **Task 2: Adapter types, cost tracking, merge logic** - `dca7dc0` (feat)

## Files Created/Modified
- `prisma/schema.prisma` - Added DailyCostTotal model, EnrichmentJob.resumeAt, EnrichmentLog.workspaceSlug + index
- `src/lib/enrichment/types.ts` - Added EmailAdapter, CompanyAdapter, EmailProviderResult, CompanyProviderResult, EmailAdapterInput
- `src/lib/enrichment/costs.ts` - Created: PROVIDER_COSTS, todayUtc, checkDailyCap, incrementDailySpend
- `src/lib/enrichment/merge.ts` - Created: mergePersonData, mergeCompanyData with null-guard merge strategy

## Decisions Made
- Used `db push` (not `migrate dev`) — consistent with Phase 1 pattern, avoids resetting production data with 14,563+ records
- `incrementDailySpend` is not atomic (check + increment separate operations) — accepts tiny overspend risk (one chunk worth) rather than adding Prisma transaction overhead to every provider call
- DailyCostTotal uses String date key (`YYYY-MM-DD` UTC) — simpler upsert pattern via `todayUtc()`, avoids timezone boundary edge cases
- Merge functions use read-then-write pattern — must load current record to check null fields, but guarantees no existing data is overwritten

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered
- `npx prisma validate` fails without `DATABASE_URL` set — used the Neon DB URL from project memory to run validate and db push. Pre-existing limitation of local dev environment (no `.env` file with DATABASE_URL).

## User Setup Required
The plan frontmatter specifies an optional env var:
- `ENRICHMENT_DAILY_CAP_USD` — Set in Vercel env vars. Defaults to `10.00` USD/day if not set. Costs module reads this at runtime via `process.env`.

No external service configuration is blocked on this env var — the default is safe.

## Next Phase Readiness
- All contracts established: EmailAdapter, CompanyAdapter, merge functions, cost tracking
- Phase 2 plans 02-05 can now implement provider adapters using these types without schema drift
- DailyCostTotal table ready in production DB for cost recording

---
*Phase: 02-provider-adapters-waterfall*
*Completed: 2026-02-26*
