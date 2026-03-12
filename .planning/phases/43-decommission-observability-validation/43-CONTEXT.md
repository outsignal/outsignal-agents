# Phase 43: Decommission + Observability Validation - Context

**Gathered:** 2026-03-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Retire cron-job.org completely, remove all fire-and-forget patterns from the codebase, delete unused Vercel cron route files, migrate Postmaster Stats Sync to Trigger.dev, and add a Background Tasks dashboard page to the admin UI so failures are visible. Slack alerting on task failures to #outsignal-ops.

</domain>

<decisions>
## Implementation Decisions

### 1. Background Tasks dashboard — summary overview in admin sidebar

The admin dashboard gets a new "Background Tasks" page accessible from the sidebar navigation. Layout:

- **Summary overview cards** at the top: total tasks, tasks succeeded (last 24h), tasks failed (last 24h), active schedules count
- **Workspace filter dropdown** — filter task runs by workspace (default: all workspaces)
- **Task list below cards** — each task shows: name, last run time, last status (success/failed), next scheduled run
- **Error messages visible** — when a task fails, the error message is displayed inline (not hidden behind a click)
- Placement: admin sidebar, below existing nav items
- No dedicated "retry" button — retries are automatic via Trigger.dev config

### 2. cron-job.org retirement — keep disabled jobs, migrate Postmaster Stats Sync

- The 7 already-disabled cron-job.org jobs stay disabled (do NOT delete them — safety net for rollback)
- **Postmaster Stats Sync** (job ID 7368027, the only remaining active job) gets migrated to Trigger.dev as a new scheduled task
- This requires freeing one schedule slot since we're at 10/10 — consolidate two existing tasks that share compatible schedules
- After migration and verification, disable Postmaster Stats Sync on cron-job.org (same-day disable pattern)
- Result: zero active jobs on cron-job.org

### 3. Fire-and-forget cleanup — full codebase scan, remove old routes

- **Full codebase scan** for `.then()` fire-and-forget patterns and any remaining `after()` usage — not just webhook routes
- Convert any found patterns to proper `await` or `tasks.trigger()` as appropriate
- **Remove old Vercel cron route files** that are now fully handled by Trigger.dev:
  - `src/app/api/cron/poll-replies/route.ts` — now Trigger.dev `poll-replies` task
  - `src/app/api/inbox-health/check/route.ts` — now Trigger.dev `inbox-check` task
  - Any other cron route files that have been fully replaced
- Keep routes that serve as manual trigger fallbacks ONLY if they're still useful (Claude decides which)
- `vercel.json` crons section: keep only enrichment-job-processor (the one task still on Vercel)

### 4. Failure alerting — Slack to #outsignal-ops on failure only

- When any Trigger.dev task fails (after all retries exhausted), send a Slack notification to **#outsignal-ops** (channel ID: C0AJCRTDA8H)
- **No slow task warnings** — only alert on actual failures
- Alert format: task name, error message, timestamp, link to Trigger.dev dashboard run
- Implementation: Trigger.dev `onFailure` hook or equivalent mechanism

### Claude's Discretion
- Which two schedules to consolidate to free a slot for Postmaster Stats Sync
- Exact Trigger.dev API used for the dashboard (REST API vs SDK)
- Which old Vercel route files to keep vs delete (based on manual trigger usefulness)
- How to implement the onFailure alerting (global hook vs per-task)
- Dashboard data fetching approach (Trigger.dev API polling vs webhook-based)

</decisions>

<specifics>
## Specific Ideas

- Dashboard should use Trigger.dev's REST API (`GET /api/v1/runs`, `GET /api/v1/schedules`) — same API we used to manage schedules in Phase 42
- Slack alerting can use the existing `postSlackMessage()` helper from `src/lib/notifications.ts`
- Postmaster Stats Sync: check what the existing cron-job.org job calls, lift the logic into a `trigger/postmaster-stats-sync.ts` file
- For schedule consolidation: look at which tasks have compatible schedules (same time or one can run at the other's time without issue)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 43-decommission-observability-validation*
*Context gathered: 2026-03-12*
