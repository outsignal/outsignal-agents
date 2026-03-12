---
phase: 43-decommission-observability-validation
plan: "01"
subsystem: trigger-scheduling
tags: [trigger.dev, cron-retirement, observability, slack-alerting]
dependency_graph:
  requires: [42-05-SUMMARY.md]
  provides: [zero-active-cron-job.org-jobs, postmaster-stats-sync-trigger-task, global-onfailure-slack-alerts]
  affects: [trigger.config.ts, trigger/inbox-check.ts, trigger/sync-senders.ts, trigger/postmaster-stats-sync.ts]
tech_stack:
  added: []
  patterns: [trigger-schedules-task, global-onfailure-hook, inline-slack-fetch, two-step-schedule-slot-swap]
key_files:
  created:
    - trigger/postmaster-stats-sync.ts
  modified:
    - trigger/sync-senders.ts
    - trigger/inbox-check.ts
    - trigger.config.ts
    - .gitignore
decisions:
  - "Two-step deploy required to swap schedule slots: first deploy removes sync-senders schedules.task (10->9), second deploy adds postmaster-stats-sync (9->10). One-step deploy hits 11/10 limit and aborts."
  - "onFailure hook uses inline fetch to Slack API — not src/lib/slack import (build-time import risk per research pitfall 2)"
  - "runSyncSenders() exported as plain async function from sync-senders.ts and called at end of inbox-check Step 3"
  - ".trigger/ added to .gitignore — local dev cache should not be tracked in git"
metrics:
  duration: 7 minutes
  completed_date: "2026-03-12"
  tasks_completed: 2
  files_changed: 5
---

# Phase 43 Plan 01: Cron Retirement + Global Failure Alerting Summary

**One-liner:** Merged sync-senders into inbox-check, migrated postmaster-stats-sync to Trigger.dev scheduled task, added global onFailure Slack hook, and retired cron-job.org completely (0 active jobs).

## What Was Built

### Task 1: Code Changes

**trigger/sync-senders.ts — Refactored**
Removed `schedules.task()` wrapper. The 5am daily schedule is gone. File now exports `runSyncSenders()` as a plain async function that inbox-check can call.

**trigger/inbox-check.ts — Consolidated**
Added Step 3 at the end of the run function: imports and calls `runSyncSenders()` from `./sync-senders`. inbox-check now does:
1. Inbox connectivity check (all workspaces)
2. Sender health check + session refresh
3. Sender sync (previously separate 5am schedule)

Return value extended with `senderSync` stats block.

**trigger/postmaster-stats-sync.ts — Created**
New `schedules.task()` with id `postmaster-stats-sync`, cron `0 10 * * *` (daily 10am UTC). Mirrors the logic from `src/app/api/cron/postmaster-sync/route.ts`: checks `isPostmasterConfigured()`, calls `syncPostmasterStats()`, then loops synced domains calling `checkAndAlert()` for each with data. Uses module-scoped PrismaClient for record lookups.

**trigger.config.ts — Global onFailure Hook**
Added `onFailure` hook to `defineConfig()`. Uses inline `fetch` to `https://slack.com/api/chat.postMessage` targeting `OPS_SLACK_CHANNEL_ID`. Sends a structured Slack message with task ID, workspace tag, error message, and a run link to cloud.trigger.dev. Fails silently via `.catch()` — Slack failure must not block task infrastructure.

### Task 2: Deployment + Cron Retirement

**Two-step deploy executed:**
- v20260312.15: deployed without postmaster-stats-sync → sync-senders schedule removed (10→9 slots)
- v20260312.16: deployed with postmaster-stats-sync → new schedule added (9→10 slots)

**cron-job.org job 7368027 (Postmaster Stats Sync) disabled** via REST API PATCH.

**Verified zero active cron-job.org jobs** — `Active jobs: 0` confirmed via cron-job.org API.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Two-step deploy workaround for schedule limit**
- **Found during:** Task 2 first deploy attempt
- **Issue:** Trigger.dev rejected single-step deploy with "You have created 10/10 schedules so you'll need to increase your limits or delete some schedules." Adding postmaster-stats-sync before removing sync-senders would temporarily push to 11/10.
- **Fix:** Temporarily moved postmaster-stats-sync.ts aside, deployed to free slot (v20260312.15), restored file, deployed again (v20260312.16). Exactly as Pitfall 5 warned in the research.
- **Files modified:** None (operational workaround)
- **Commits:** 5a628d1

**2. [Rule 2 - Missing] Added .trigger/ to .gitignore**
- **Found during:** Task 2 commit
- **Issue:** `.trigger/` local dev cache directory (7832 files, 53MB) was committed accidentally — not in .gitignore.
- **Fix:** Added `/.trigger/` to .gitignore, removed directory from git tracking.
- **Files modified:** .gitignore
- **Commit:** a15197a

## Verification Results

- TypeScript: `npx tsc --noEmit` — clean (0 errors)
- Trigger.dev: v20260312.16 deployed with 15 detected tasks
- Schedule inventory: 10/10 slots (sync-senders schedule removed, postmaster-stats-sync added at 0 10 * * *)
- cron-job.org: 0 active jobs (`"enabled":false` confirmed on job 7368027)
- trigger.config.ts: onFailure hook present with inline Slack fetch

## Self-Check

Files created/modified:
- trigger/postmaster-stats-sync.ts: FOUND
- trigger/inbox-check.ts: FOUND (contains runSyncSenders call)
- trigger/sync-senders.ts: FOUND (no schedules.task)
- trigger.config.ts: FOUND (contains onFailure)
- .gitignore: FOUND (contains /.trigger/)

Commits:
- 0589672: FOUND (feat 43-01 code changes)
- 5a628d1: FOUND (chore 43-01 deploy)
- a15197a: FOUND (chore 43-01 gitignore)
