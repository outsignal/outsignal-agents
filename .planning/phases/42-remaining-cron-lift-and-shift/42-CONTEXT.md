# Phase 42: Remaining Cron Lift-and-Shift - Context

**Gathered:** 2026-03-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Migrate all remaining scheduled work (poll-replies, domain-health, bounce-monitor, sync-senders, bounce-snapshots, deliverability-digest, inbox-health split into parts, and campaign deploy) from cron-job.org + Vercel to Trigger.dev. Same logic, new execution wrapper. cron-job.org jobs disabled per-job same day as Trigger.dev replacement verified.

</domain>

<decisions>
## Implementation Decisions

### 1. inbox-health split into 3 tasks + separate enrichment task

The current monolithic `inbox-health/check` endpoint splits into 3 Trigger.dev scheduled tasks:
1. **Inbox connectivity checks** — EmailBison inbox status/disconnect detection
2. **Sender health + bounce evaluation** — sender-level health assessment
3. **LinkedIn maintenance** — warmup advancement, acceptance rate calc, stale session recovery

Enrichment job processing becomes its own separate scheduled task — it's unrelated to health checks.

Each task gets its own independent schedule (Claude determines optimal frequency per task based on code analysis). Not all need to run at 6am UTC like the current monolith.

### 2. Schedule timing — keep existing frequencies

All migrated crons keep their current schedules:
- **poll-replies**: Every 10 min (`*/10 * * * *`)
- **domain-health**: Twice daily 8am + 8pm UTC (`0 8,20 * * *`)
- **bounce-monitor**: Every 4 hours (`0 */4 * * *`)
- **bounce-snapshots**: Daily 8am UTC (`0 8 * * *`)
- **sync-senders**: Daily 5am UTC (`0 5 * * *`)
- **deliverability-digest**: Weekly Monday 8am UTC (`0 8 * * 1`)

No frequency changes — the benefit is removing timeout constraints and adding observability, not changing cadence.

### 3. cron-job.org disabling — same-day per-job via API

Same approach as Phase 41:
- Disable each cron-job.org job the same day its Trigger.dev replacement is deployed and verified
- Use cron-job.org REST API (`PATCH /jobs/{id}` with `{"job":{"enabled":false}}`)
- No double-processing window
- No batch disable — each job disabled individually after verification

### 4. Campaign deploy after() → Trigger.dev task

Replace Next.js `after()` pattern in campaign deploy route with `tasks.trigger('campaign-deploy', ...)`:
- Move the **full deploy flow** into the Trigger.dev task (EmailBison API call + status updates + notifications)
- Route validates input and triggers the task, returns immediately
- Task gets retry, observability, no timeout constraint

### 5. Vercel routes kept as manual fallbacks

Same as Phase 41 — existing Vercel API route endpoints stay as manual trigger fallbacks. Removed in Phase 43 decommission.

### Claude's Discretion
- Exact schedule frequencies for split inbox-health tasks
- Whether poll-replies needs `emailBisonQueue` concurrency limiting
- Concurrency and retry settings per task
- Whether domain-health needs the `anthropicQueue` or just DNS lookups
- Task file naming conventions

</decisions>

<specifics>
## Specific Ideas

- Follow the same patterns established in Phase 41 (schedules.task(), anthropicQueue where needed, Promise.all fan-out for multi-workspace work)
- poll-replies should fetch all workspaces concurrently (not sequential loop)
- domain-health should check ALL domains per run (remove the 4-domain cap that exists due to timeout constraints)
- cron-job.org API key and job IDs are documented in `memory/infrastructure.md`

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 42-remaining-cron-lift-and-shift*
*Context gathered: 2026-03-12*
