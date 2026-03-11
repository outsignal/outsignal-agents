---
phase: 32-deliverability-dashboard-reporting
plan: "04"
subsystem: notifications, portal
tags: [deliverability, digest, cron, portal, dns, bounce-status, notifications]
dependency_graph:
  requires: ["32-03"]
  provides: ["deliverability_digest notification", "enhanced portal email-health page"]
  affects: ["src/lib/notifications.ts", "src/app/api/notification-health/route.ts", "src/app/(portal)/portal/email-health/page.tsx"]
tech_stack:
  added: []
  patterns: ["audited() notification wrapper", "prisma data enrichment in server components", "idempotency via audit log lookup"]
key_files:
  created:
    - src/app/api/cron/deliverability-digest/route.ts
  modified:
    - src/lib/notifications.ts
    - src/app/api/notification-health/route.ts
    - src/app/(portal)/portal/email-health/page.tsx
decisions:
  - "Idempotency enforced via NotificationAuditLog lookup (last 6 days) before sending digest — prevents duplicate weekly sends from retries or re-runs"
  - "BounceSnapshot trend uses 2-day window vs 5-7-day-ago window for comparison — avoids empty results when daily snapshots may be missing"
  - "Domain DNS badges shown only when DomainHealth records exist — zero-state hides the section rather than showing empty table"
  - "DB emailBounceStatus shown as separate column (Bounce Status) from EmailBison-derived health chip (Health) — they measure different things"
metrics:
  duration: "~12 min"
  completed: "2026-03-11"
  tasks_completed: 2
  files_changed: 4
---

# Phase 32 Plan 04: Weekly Deliverability Digest + Portal Enhancement Summary

Weekly deliverability digest notification function with cross-workspace domain health, bounce trends, and problem senders sent to ops Slack and admin email; portal email-health page enhanced with DNS badges, DB bounce status chips, and recent event notes.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Weekly deliverability digest notification + cron | d27a287 | src/lib/notifications.ts, src/app/api/cron/deliverability-digest/route.ts, src/app/api/notification-health/route.ts |
| 2 | Enhance portal email-health page | f40af72 | src/app/(portal)/portal/email-health/page.tsx |

## What Was Built

### Task 1: notifyDeliverabilityDigest() + Cron Endpoint

`notifyDeliverabilityDigest()` in `src/lib/notifications.ts`:
- Queries DomainHealth for healthy vs at-risk counts and worst domain
- Queries EmailHealthEvent.count for transitions in last 7 days
- Queries Sender for all warning/critical emailBounceStatus senders
- Queries BounceSnapshot per workspace for recent vs older avg bounce rates, computes up/down/flat arrows
- Sends to OPS_SLACK_CHANNEL_ID (Slack) and ADMIN_EMAIL (email) with full HTML
- Wrapped with audited() for audit trail on both channels
- Idempotency: checks NotificationAuditLog for any "sent" deliverability_digest in last 6 days — skips if found

`src/app/api/cron/deliverability-digest/route.ts`:
- GET endpoint (cron-job.org sends GET)
- Validates cron secret via validateCronSecret()
- Calls notifyDeliverabilityDigest()
- Returns 401 on auth failure, 500 on error, 200 with { ok: true } on success
- Exports `const dynamic = "force-dynamic"`

`src/app/api/notification-health/route.ts`:
- Added `{ key: "deliverability_digest", label: "Deliverability Digest", channels: "Slack + Email", audience: "Admin" }` to ALL_NOTIFICATION_TYPES

### Task 2: Enhanced Portal Email-Health Page

`src/app/(portal)/portal/email-health/page.tsx`:
- Domain Health card: for each unique sending domain found in EmailBison senders, shows SPF/DKIM/DMARC badges (green check / yellow partial / red X) from DomainHealth records; only shown when records exist
- Bounce Status column: per-row badge from Sender.emailBounceStatus (healthy/elevated/warning/critical) — reflects DB-tracked bounce state machine
- Recent column: shows human-readable note if an EmailHealthEvent for this sender exists within 7 days ("Recovering", "Status elevated", "Daily limit reduced", "Blacklist detected")
- All Prisma queries scoped to `workspaceSlug` from portal session
- Existing EmailBison data display fully preserved (additive)

## User Setup Required

Register cron on cron-job.org:
- URL: https://admin.outsignal.ai/api/cron/deliverability-digest
- Schedule: `0 8 * * 1` (Monday 8am UTC)
- Header: `Authorization: Bearer <CRON_SECRET>`

## Deviations from Plan

None — plan executed exactly as written.

## Verification

- [x] notifyDeliverabilityDigest() compiles and exports correctly
- [x] Cron endpoint exports GET with force-dynamic
- [x] audited() wraps both Slack and email sends
- [x] "deliverability_digest" appears in ALL_NOTIFICATION_TYPES
- [x] Portal email-health page shows Domain Health section with DNS badges
- [x] Portal email-health page shows Bounce Status and Recent columns per sender
- [x] Portal data scoped to workspaceSlug — no cross-workspace leaks
- [x] Full TypeScript compile: zero errors

## Self-Check: PASSED

Files created/modified:
- src/lib/notifications.ts (notifyDeliverabilityDigest added at line 1632) — FOUND
- src/app/api/cron/deliverability-digest/route.ts — FOUND
- src/app/api/notification-health/route.ts (deliverability_digest at line 22) — FOUND
- src/app/(portal)/portal/email-health/page.tsx (emailBounceStatus at line 33) — FOUND

Commits:
- d27a287 — FOUND
- f40af72 — FOUND
