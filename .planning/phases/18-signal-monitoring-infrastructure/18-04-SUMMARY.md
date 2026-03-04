---
phase: 18-signal-monitoring-infrastructure
plan: 04
subsystem: worker
tags: [budget-governor, serper, social-listening, dedup, cycle-orchestration, railway, cron, prisma-singleton]

requires:
  - 18-01 (SignalDailyCost, SeenSignalUrl Prisma models; Workspace signal config fields)
  - 18-02 (worker-signals scaffold, PredictLeads client, Zod schemas)
  - 18-03 (signal adapters: fetchJobOpenings, fetchFinancingEvents, fetchNewsEvents, fetchTechnologyDetections; writeSignalEvents, expireOldSignals)
provides:
  - Shared Prisma singleton (db.ts) — avoids multiple connection pool instances in one process
  - Budget governor (governor.ts) — checkWorkspaceCap, incrementWorkspaceSpend, alertBudgetCapHit
  - Serper social listening (serper/social.ts) — searchCompetitorMentions with frustration keyword strategy
  - URL dedup (dedup.ts) — isSeenUrl, markUrlSeen, cleanupOldSeenUrls (30-day TTL)
  - Workspace config loader (workspaces.ts) — loadWorkspaceConfigs, buildDomainWorkspaceMap
  - Cycle orchestrator (cycle.ts) — runCycle() end-to-end: cleanup -> PredictLeads -> Serper -> budget enforcement
  - Wired entry point (index.ts) — calls runCycle(), prisma.$disconnect() in finally, correct Railway exit code
affects:
  - Railway cron worker is now functionally complete and ready for deployment

tech-stack:
  added: []
  patterns:
    - "Prisma singleton pattern: single db.ts export prevents multiple PrismaClient instances"
    - "Fan-out pattern: poll each domain once (deduped), write signals to all watching workspaces"
    - "Fisher-Yates shuffle for domain processing order — fair budget coverage when cap hit mid-cycle"
    - "Budget cap gate: checkWorkspaceCap before each workspace's processing in each domain loop"
    - "Serper frustration keyword query: site:{platform} {competitor} (switching from OR alternative to OR frustrated with OR looking for replacement)"
    - "SeenSignalUrl global dedup: markUrlSeen + isSeenUrl + 30-day cleanup"
    - "process.exitCode pattern for correct Railway cron exit code on fatal error"
    - "Per-domain try/catch in cycle: one failed domain does not abort the entire cycle"

key-files:
  created:
    - worker-signals/src/db.ts
    - worker-signals/src/governor.ts
    - worker-signals/src/serper/social.ts
    - worker-signals/src/dedup.ts
    - worker-signals/src/workspaces.ts
    - worker-signals/src/cycle.ts
  modified:
    - worker-signals/src/signals.ts (import prisma from ./db.js instead of own instance)
    - worker-signals/src/index.ts (replaced stub with runCycle + prisma disconnect + exit)

key-decisions:
  - "Shared db.ts singleton: signals.ts updated to use shared prisma from db.ts — avoids N connection pools for N modules"
  - "Domain shuffle: Fisher-Yates randomization ensures fair domain coverage when a workspace hits budget cap mid-cycle"
  - "Budget cap check per-workspace per-domain: even if a workspace hits cap mid-domain-loop, other workspaces continue processing that domain"
  - "Hiring spike as synthetic signal: externalId=null means it always creates (not deduped) — triggers on totalJobCount > 10 from fetchJobOpenings"
  - "Serper social mention companyDomain='': social mentions are competitor-level, not tied to a specific watched domain"
  - "ADMIN_SLACK_CHANNEL_ID for budget alerts: uses admin channel, not workspace channel (workspace channel is for reply notifications)"

requirements-completed: [SIG-06, SIG-07, SIG-09]

duration: 4min
completed: 2026-03-04
---

# Phase 18 Plan 04: Budget Governor, Serper Social Listening, Cycle Orchestration Summary

**Per-workspace budget governor with Slack alerts, Serper competitor mention detection on Reddit/Twitter, URL dedup, domain-deduped fan-out cycle orchestrator, and wired Railway cron entry point — signal worker is now functionally complete**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-03-04T20:25:45Z
- **Completed:** 2026-03-04T20:29:54Z
- **Tasks:** 2
- **Files modified:** 6 created, 2 modified

## Accomplishments

- Created `db.ts` Prisma singleton and updated `signals.ts` to import from it — prevents multiple connection pool instances when all modules share the same process
- `governor.ts`: `checkWorkspaceCap` reads `SignalDailyCost` for today's date; `incrementWorkspaceSpend` upserts with JSON breakdown per signal type; `alertBudgetCapHit` sends Slack block kit message with workspace name, cap, spent amount, and "paused until midnight UTC" status — silently skips if SLACK_BOT_TOKEN or ADMIN_SLACK_CHANNEL_ID not set
- `serper/social.ts`: reimplements Serper `searchSocial` (POST to google.serper.dev with X-API-KEY) with site:reddit.com / site:twitter.com prefix; `searchCompetitorMentions` uses frustration keyword strategy: `"{competitor}" ("switching from" OR "alternative to" OR "frustrated with" OR "looking for replacement")`; deduplicates via `isSeenUrl`/`markUrlSeen` before adding to output
- `dedup.ts`: `isSeenUrl` uses `findUnique`; `markUrlSeen` uses upsert (idempotent); `cleanupOldSeenUrls` deletes entries with `seenAt < 30 days ago`
- `workspaces.ts`: `loadWorkspaceConfigs()` queries `status=active AND signalEnabledTypes != "[]"`, parses all JSON array fields with try/catch fallback; `buildDomainWorkspaceMap()` deduplicates domains across workspaces, maps domain -> { workspaceSlugs, enabledTypes per workspace }
- `cycle.ts`: full orchestration — cleanup (expireOldSignals + cleanupOldSeenUrls) → load configs → build domain map → Fisher-Yates shuffle domains → PredictLeads adapter fan-out loop with budget cap gate per workspace → hiring spike synthetic signal if totalJobCount > 10 → Serper social per workspace with budget cap gate → cycle summary log
- `index.ts`: replaced stub with `runCycle()` call, `prisma.$disconnect()` in finally block, `process.exitCode` pattern for correct Railway cron exit code

## Task Commits

Each task was committed atomically:

1. **Task 1: Budget governor + Serper social listening + URL dedup** - `367e5a8` (feat)
2. **Task 2: Workspace config loader + cycle orchestrator + wire entry point** - `8bff393` (feat)

## Files Created/Modified

- `worker-signals/src/db.ts` — Shared PrismaClient singleton
- `worker-signals/src/governor.ts` — checkWorkspaceCap, incrementWorkspaceSpend, alertBudgetCapHit
- `worker-signals/src/serper/social.ts` — searchCompetitorMentions (reimplemented Serper POST)
- `worker-signals/src/dedup.ts` — isSeenUrl, markUrlSeen, cleanupOldSeenUrls
- `worker-signals/src/workspaces.ts` — loadWorkspaceConfigs, buildDomainWorkspaceMap
- `worker-signals/src/cycle.ts` — runCycle() full orchestration
- `worker-signals/src/signals.ts` — Updated to import prisma from ./db.js
- `worker-signals/src/index.ts` — Replaced stub with runCycle + proper exit pattern

## Decisions Made

- Shared `db.ts` singleton: avoids N PrismaClient connection pools when N modules each import prisma — all share the single instance
- Domain processing order is randomized (Fisher-Yates) each cycle: ensures that when a workspace hits its cap mid-cycle, coverage is spread fairly across all domains rather than always processing the same domains first
- Budget cap is checked per-workspace, not per-domain: a workspace can be skipped for all remaining domains once its cap is hit, while other workspaces continue processing the same domains
- `alertBudgetCapHit` uses `ADMIN_SLACK_CHANNEL_ID` (not the workspace's Slack channel) — budget alerts are operational/admin alerts, not client-facing notifications
- Hiring spike signal uses `externalId: null` (always creates a new record each cycle if spike persists) — no stable external ID exists for synthetic aggregate signals
- Serper social mentions have `companyDomain: ""` — social mentions are scoped to a competitor, not a specific ABM watchlist domain

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript implicit any on Prisma findMany map callback**
- **Found during:** Task 2 verification (tsc --noEmit)
- **Issue:** `workspaces.map((ws) => ...)` — Prisma `findMany` with `select` returns typed result but tsc strict mode flagged `ws` as implicit any
- **Fix:** Added `type WorkspaceRow = (typeof workspaces)[number]` and explicit `(ws: WorkspaceRow)` annotation on the map callback
- **Files modified:** `worker-signals/src/workspaces.ts`
- **Commit:** Included in 8bff393 (same task commit)

**2. [Rule 1 - Bug] prisma import at bottom of cycle.ts (hoisted but unclear)**
- **Found during:** Task 2 review
- **Issue:** `import { prisma } from "./db.js"` was written at the bottom of cycle.ts (habit from inline fix); while ESM hoists imports, this is non-idiomatic
- **Fix:** Moved import to the top with all other imports
- **Files modified:** `worker-signals/src/cycle.ts`
- **Commit:** Included in 8bff393 (same task commit)

## Issues Encountered

None beyond the two auto-fixed TypeScript strict mode issues above.

## User Setup Required

**Railway environment variables** (additional to those documented in Plan 02):
- `SERPER_API_KEY` — Serper API key for social listening searches (https://serper.dev)
- `SLACK_BOT_TOKEN` — Slack bot token for budget cap alerts (same token used by main app)
- `ADMIN_SLACK_CHANNEL_ID` — Slack channel ID for operational alerts (e.g., budget cap notifications)

## Next Phase Readiness

- Signal worker is functionally complete — all 4 Plans of Phase 18 are done
- Railway deployment: create a cron service pointing to worker-signals/ with cronSchedule `0 */6 * * *`
- Set Railway env vars: DATABASE_URL, PREDICTLEADS_API_KEY, PREDICTLEADS_API_TOKEN, SERPER_API_KEY, SLACK_BOT_TOKEN, ADMIN_SLACK_CHANNEL_ID
- Configure signal settings per workspace via GET/PATCH `/api/workspaces/{slug}/signals` (Phase 18 Plan 01 endpoint)

---
*Phase: 18-signal-monitoring-infrastructure*
*Completed: 2026-03-04*

## Self-Check: PASSED

All created files verified on disk. Both task commits (367e5a8, 8bff393) confirmed in git log.
