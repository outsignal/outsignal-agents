---
phase: quick
plan: 1
subsystem: emailbison/cron
tags: [sync, senders, cron, emailbison]
dependency_graph:
  requires: []
  provides:
    - syncSendersForAllWorkspaces() in src/lib/emailbison/sync-senders.ts
    - GET /api/cron/sync-senders (daily cron endpoint)
  affects:
    - Sender.emailAddress
    - Sender.emailBisonSenderId
    - Sender.emailSenderName
tech_stack:
  added: []
  patterns:
    - Per-workspace try/catch so one failure does not block others
    - Load all workspace senders once (no N+1), match by email then name then create
    - Cron route follows exact bounce-snapshots pattern (maxDuration=60, Bearer auth, JSON summary)
key_files:
  created:
    - src/lib/emailbison/sync-senders.ts
    - src/app/api/cron/sync-senders/route.ts
  modified: []
decisions:
  - Match priority: email > name > create — email is authoritative, name fallback handles dashboard-created senders
  - Load all workspace senders in one query then match in JS — avoids N queries for N EmailBison senders
  - Only update fields that changed — prevents unnecessary DB writes on daily cron
  - status="active" on auto-created senders — consistent with EmailBison-sourced records
metrics:
  duration: 66s
  completed: 2026-03-11T13:40:04Z
  tasks_completed: 2
  files_created: 2
  files_modified: 0
---

# Quick Task 1: Automated EmailBison Sender Sync — Summary

**One-liner:** Daily cron that pulls EmailBison sender emails into the Sender table via email/name matching with auto-create fallback.

## What Was Built

### src/lib/emailbison/sync-senders.ts
Core sync function `syncSendersForAllWorkspaces()` that:
- Fetches all workspaces with non-null `apiToken`
- For each workspace, calls `EmailBisonClient.getSenderEmails()`
- Loads all existing Sender records for the workspace in a single query
- Matches EmailBison senders against DB records: by `emailAddress` first, then by `name`
- Updates `emailBisonSenderId` (and `emailSenderName`) if values changed
- Creates new Sender records for EmailBison senders with no match (`status: "active"`)
- Returns `{ workspaces, synced, created, skipped, errors }` summary
- Per-workspace try/catch — one failing workspace does not block others

### src/app/api/cron/sync-senders/route.ts
GET endpoint at `/api/cron/sync-senders` that:
- Validates `Authorization: Bearer <CRON_SECRET>` header via `validateCronSecret()`
- Calls `syncSendersForAllWorkspaces()` and returns full JSON summary
- `maxDuration = 60` to match other cron routes
- Identical error handling and logging pattern as `bounce-snapshots/route.ts`

## Next Step (Manual)
Register on cron-job.org:
- URL: `https://admin.outsignal.ai/api/cron/sync-senders`
- Schedule: daily at 5am UTC (runs before bounce-snapshots at 6am)
- Header: `Authorization: Bearer <CRON_SECRET>`

## Deviations from Plan

None — plan executed exactly as written.

## Commits

| Hash    | Message                                                      |
| ------- | ------------------------------------------------------------ |
| 074cf22 | feat(quick-1): create syncSendersForAllWorkspaces() library function |
| f7ee5c2 | feat(quick-1): add GET /api/cron/sync-senders cron endpoint  |

## Self-Check: PASSED

- FOUND: src/lib/emailbison/sync-senders.ts
- FOUND: src/app/api/cron/sync-senders/route.ts
- FOUND: commit 074cf22
- FOUND: commit f7ee5c2
