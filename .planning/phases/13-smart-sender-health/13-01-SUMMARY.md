---
phase: 13-smart-sender-health
plan: 01
subsystem: database, api, infra
tags: [prisma, postgresql, linkedin, health-check, cron, sender]

# Dependency graph
requires:
  - phase: 12-dashboard-admin-ux
    provides: Sender model with healthStatus field and /senders page foundation
  - phase: 11-linkedin-voyager
    provides: LinkedInDailyUsage model with captchaDetected/restrictionNotice fields

provides:
  - SenderHealthEvent Prisma model with full audit trail (senderId, status, reason, detail, bouncePct)
  - Sender.healthFlaggedAt field for 48h cooldown tracking
  - runSenderHealthCheck() detection engine in src/lib/linkedin/health-check.ts
  - Daily cron integration calling health check after inbox monitor

affects:
  - 13-02 (notification wiring for health check results)
  - 13-03 (UI health badges and sparkline charts on /senders page)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Health check as daily cron step piggybacking on existing inbox-health/check route
    - SenderHealthEvent as append-only audit log (never updated, only created)
    - Soft vs hard flag distinction: soft (bounce_rate) sets healthFlaggedAt for cooldown; hard (captcha/restriction/session_expired) requires manual reactivation
    - Least-loaded sender selection for action reassignment (pending count + remaining daily budget)
    - prisma.$transaction for atomic workspace campaign pause when last sender goes down

key-files:
  created:
    - src/lib/linkedin/health-check.ts
  modified:
    - prisma/schema.prisma
    - src/app/api/inbox-health/check/route.ts

key-decisions:
  - "Minimum volume gate: bounce rate only flags if sender has >= 10 EMAIL_SENT events in 24h window — avoids false positives from low-volume senders"
  - "Soft flag auto-recovery: 48h cooldown before recheck; if bounce rate normalizes (<= 5%), auto-recover and record auto_recovered event"
  - "Avoid duplicate events: skip flagging if sender already has the same healthStatus (e.g. already 'blocked' won't create another blocked event)"
  - "Warning severity (bounce_rate) does NOT reassign actions or pause campaigns — sender stays in rotation, just monitored"
  - "Critical severity (captcha/restriction/session_expired) triggers action reassignment to least-loaded healthy sender"
  - "Last-healthy-sender-down: count healthy senders excluding the flagged one, pause all active/deployed campaigns if zero remain"
  - "healthFlaggedAt only set for soft flags (bounce_rate); hard flags don't set it since they require manual reactivation anyway"
  - "Notification calls explicitly deferred to Plan 02 — plan boundary respected"

patterns-established:
  - "Health event audit trail: prisma.senderHealthEvent.create() for every status change (flag + auto-recovery + admin actions in future plans)"
  - "Bounce rate computation: WebhookEvent groupBy-equivalent using findMany + in-memory map keyed by senderEmail.toLowerCase()"
  - "Case-insensitive email matching: .toLowerCase() on both senderEmail and Sender.emailAddress before comparison"

requirements-completed: [HEALTH-01, HEALTH-02, HEALTH-03, HEALTH-05, HEALTH-06]

# Metrics
duration: 3min
completed: 2026-03-02
---

# Phase 13 Plan 01: Smart Sender Health — Schema and Detection Engine Summary

**SenderHealthEvent Prisma model + runSenderHealthCheck() engine that detects bounce rate >5%, CAPTCHA, restriction, session expiry and auto-recovers soft flags after 48h cooldown**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-03-02T22:19:37Z
- **Completed:** 2026-03-02T22:22:51Z
- **Tasks:** 2 of 2
- **Files modified:** 3

## Accomplishments

- Added SenderHealthEvent model to Prisma schema with proper indexes and Cascade delete; added healthFlaggedAt field to Sender; applied via db push
- Implemented full detection engine: bounce rate with 10-send minimum gate, CAPTCHA/restriction via LinkedInDailyUsage, session expiry via sessionStatus
- 48h cooldown auto-recovery for soft flags with bounce rate recheck before restoring "healthy" status
- Least-loaded action reassignment on critical flags with combined pending-count + daily-budget scoring
- Atomic workspace campaign pause via prisma.$transaction when last healthy sender goes down
- Integrated into existing inbox-health cron (no new vercel.json cron entry needed)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add SenderHealthEvent model and Sender.healthFlaggedAt field** - `cde173f` (feat)
2. **Task 2: Implement runSenderHealthCheck() and cron integration** - `7ac7946` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `prisma/schema.prisma` - Added SenderHealthEvent model + healthFlaggedAt field on Sender + healthEvents relation
- `src/lib/linkedin/health-check.ts` - Core detection engine with full pipeline: bounce rate, CAPTCHA, restriction, session expiry, auto-recovery, reassignment
- `src/app/api/inbox-health/check/route.ts` - Added import and call to runSenderHealthCheck() after existing inbox check; senderHealthChanges in response

## Decisions Made

- **Minimum volume gate (10 sends):** Avoids false-positive flagging when a sender has only sent 1-2 emails and had 1 bounce. Research confirmed this threshold.
- **Soft vs hard flag distinction:** Bounce rate is recoverable (auto-recovery after cooldown); CAPTCHA/restriction/session expiry require manual admin intervention — modeled by presence/absence of healthFlaggedAt.
- **Warning severity keeps sender in rotation:** A 5-7% bounce rate is a signal to monitor, not immediately remove. Only critical flags remove from rotation.
- **healthFlaggedAt only for soft flags:** Hard flags don't use cooldown math — they need admin reactivation regardless of time elapsed.
- **Notifications deferred to Plan 02:** Clean plan boundary — detection engine returns HealthCheckResult[] for the caller, does not fire Slack/email itself.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None — TypeScript compiled cleanly on first run, db push succeeded immediately.

## User Setup Required

None — no external service configuration required. DB schema applied automatically via db push.

## Next Phase Readiness

- Plan 02 can now import `runSenderHealthCheck` and `HealthCheckResult` from `@/lib/linkedin/health-check` and wire up Slack/email notifications
- SenderHealthEvent records are being written — Plan 03 UI can query them for sparkline trend charts
- healthFlaggedAt on Sender is available for /senders page health badge display

---
*Phase: 13-smart-sender-health*
*Completed: 2026-03-02*
