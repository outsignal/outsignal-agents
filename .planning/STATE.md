---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: Email Deliverability & Domain Infrastructure Monitoring
status: unknown
last_updated: "2026-03-11T15:03:04.150Z"
progress:
  total_phases: 32
  completed_phases: 29
  total_plans: 100
  completed_plans: 99
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-11)

**Core value:** Own the lead data pipeline end-to-end so we never pay for the same lead twice and can cancel the $300+/month Clay subscription.
**Current focus:** v5.0 Client Portal Inbox (phases 33-37) | v4.0 Email Deliverability (phases 31-32, parallel)

## Current Position

Phase: Phase 35 — Email Inbox
Plan: 35-02 complete
Status: Phase 35 Plan 02 done — 3 portal API routes created: GET /api/portal/inbox/email/threads (thread list grouped by parent_id chain), GET /api/portal/inbox/email/threads/[threadId] (chronological messages with outbound context), POST /api/portal/inbox/email/reply (send via EmailBison + persist outbound Reply).
Last activity: 2026-03-11 - Completed 35-02: Email inbox API routes

Progress: v5.0 [░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 112 (v1.0: 22, v1.1: 40, v2.0: 26, v3.0: 16, v4.0: 8)
- Average duration: ~15 min
- Total execution time: ~22 hours

**Recent Trend:**
- v3.0 phases shipped in 1 day (2026-03-10)
- Trend: Stable

*Updated after each plan completion*

## Accumulated Context

### Decisions

- [32-01]: Batch BounceSnapshot lookup using senderEmail IN [...] then JS groupBy — avoids N queries for N senders
- [32-01]: cursor pagination uses take N+1 trick — cleaner than separate count query
- [32-01]: JSON parse fields (dkimSelectors, blacklistHits) wrapped in try/catch — malformed data returns empty array not 500

- [31-01]: EmailHealthEvent.senderId is optional (SetNull on delete) — audit trail persists even after sender deletion
- [31-01]: patchSenderEmail is a plain API wrapper; caller decides when to invoke based on EMAILBISON_SENDER_MGMT_ENABLED
- [31-01]: Campaign removal for critical senders deferred to 'campaign_removal_pending' — EmailBison API unknown per research
- [31-01]: runBounceMonitor returns transition list without sending notifications — Plan 02 owns notification dispatch

- [v5.0 Pre-Milestone]: No new dependencies — entire milestone is application-layer code on existing stack
- [v5.0 Pre-Milestone]: DB-intermediary pattern for LinkedIn — portal reads from DB only; Railway worker syncs from Voyager
- [v5.0 Pre-Milestone]: LinkedIn sync is fire-and-forget (202 Accepted, async) — avoids Vercel 60s timeout
- [v5.0 Pre-Milestone]: Plain textarea for reply composer — HTML emails harm deliverability, text-only
- [v5.0 Pre-Milestone]: Polling (15s active, 60s background) not WebSockets/SSE — Vercel serverless incompatible with persistent connections
- [v5.0 Pre-Milestone]: LinkedInAction queue (priority 1) reused for LinkedIn reply delivery — battle-tested
- [v5.0 Pre-Milestone]: Email threads built from parent_id chain — orphaned parents treated as thread roots
- [v5.0 Pre-Milestone]: 5-min sync cache on LinkedIn sync API — prevents Voyager rate limit issues
- [v5.0 Roadmap]: Phase 33 is spike-first — EmailBison sendReply must be validated before any UI is built
- [v5.0 Roadmap]: Phase 34 gates all LinkedIn UI — DB models must exist before LinkedIn thread list can render
- [v5.0 Roadmap]: Email (Phase 35) before LinkedIn (Phase 36) — lower risk, higher volume, fewer unknowns
- [v5.0 Roadmap]: UI-01 through UI-07, ADMIN-01 through ADMIN-04, NAV-01, NAV-02 all deferred to Phase 37 (polish after function proven)
- [Phase 31-02]: Notification gating is in cron route — notifySenderHealthTransition always fires when called
- [Phase 31-02]: workspaceSlug added to runBounceMonitor transitions so replaceSender has workspace scope
- [Phase 31-02]: Manual override resets consecutiveHealthyChecks to 0 with no lock — next cron resumes auto-evaluation

- [33-01]: sendReply requires to_emails[] OR reply_all:true — not documented, only revealed by live spike
- [33-01]: sendReply response is {data: {success, message, reply: Reply}} — not {data: Reply} as assumed
- [33-01]: ReplyRecipient uses .address not .email — corrected from spike, existing component fixed
- [33-02]: VoyagerError 401/403 propagates without retry — SessionServer returns {error: session_expired, message: Reconnect LinkedIn in settings}
- [33-02]: VoyagerError 429 fails fast, no retry — account safety is priority
- [33-02]: Messages fetched on-demand (separate endpoint) not inline with conversations — minimizes Voyager API calls
- [33-02]: randomDelay(2-3s) applied before fetchMessages API call to mimic human browsing speed
- [33-02]: Proxy support deferred — TODO comments left pending getSenderById() on ApiClient

- [34-01]: personId not updated on re-sync — initial Person URL match is authoritative (prevents race conditions)
- [34-01]: Sender filter uses status='active' only, not sessionStatus — expired sessions still show previously-synced conversations
- [34-01]: normalizeLinkedinUrl lowercases /in/username before Person.linkedinUrl contains query — prevents format mismatch
- [34-01]: LinkedInSyncStatus is a separate model (not on Sender) — cleaner separation, avoids migrating a frequently-modified table
- [Phase 32-03]: DeliverabilityBentoCard fetches from existing /api/deliverability/summary endpoint — no new API needed
- [Phase 32-03]: Insight dedup uses findFirst on observation contains senderEmail — prevents duplicate active insights per sender

- [Phase 32-04]: Idempotency for digest enforced via NotificationAuditLog lookup (last 6 days) — prevents duplicate weekly sends
- [Phase 32-04]: BounceSnapshot trend uses 2-day window vs 5-7-day-ago window for comparison — more reliable than exact day match
- [Phase 32-04]: DB emailBounceStatus shown as separate column from EmailBison-derived health chip — they measure different things
- [Phase 32-02]: Inline relative time helper instead of date-fns — not installed, consistent with sender-health-panel.tsx
- [Phase 32-02]: Promise.allSettled for parallel fetches — each section degrades independently on error
- [Phase 32-02]: Workspace options derived from senders response — avoids extra /api/workspaces call
- [Phase 32-02]: ActivityFeed accepts initialEvents/hasMore/cursor props — supports server-driven pagination from parent page
- [Phase 35-01]: prisma db push used instead of migrate dev — database schema was ahead of migration history (pre-existing drift), reset would destroy production data
- [Phase 35-01]: aiSuggestedReply not added to poll-replies cron — AI suggestion requires full context (lead name, interested flag) only available in webhook handler
- [Phase 35-01]: direction field defaults to inbound, explicit outbound detection via folder=Sent or type=Outgoing Email from EB reply data
- [Phase 35-02]: Workspace EmailBison token stored as apiToken (not emailBisonToken) — plan used wrong field name, corrected via TypeScript compilation error
- [Phase 35-02]: Thread grouping skips replies with no emailBisonReplyId — can't reliably group orphaned records
- [Phase 35-02]: reply_all:true used in sendReply — per Phase 33 spike validation, required alongside sender_email_id

### Blockers/Concerns

- EmailBison POST /replies/{id}/reply RESOLVED — spike confirmed working on white-label, requires reply_all:true or to_emails[], response: {data: {success, message, reply: Reply}}
- Voyager conversation API response schema needs live validation in Phase 33 before sync parser is built
- Vercel 60s timeout — LinkedIn sync must be fully fire-and-forget (202 before any Voyager calls)

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 1 | Automated EmailBison sender sync - pull sender emails into Sender table and run on daily cron | 2026-03-11 | 074cf22 | [1-automated-emailbison-sender-sync-pull-se](./quick/1-automated-emailbison-sender-sync-pull-se/) |
| 2 | Automate critical sender remediation - pause/remove/resume campaigns, set daily_limit=1, disable warmup, store state for recovery | 2026-03-11 | e0229e0 | [2-automate-critical-sender-remediation-cam](./quick/2-automate-critical-sender-remediation-cam/) |
- LinkedIn Voyager rate limits unknown — 2-3s delays between calls, limit 20 conversations, 5-min cache, graceful 401/429 degradation

### Pending Todos

None.

## Session Continuity

Last session: 2026-03-11
Stopped at: Completed 35-02-PLAN.md — 3 email inbox API routes (thread list, thread detail, reply send)
Resume file: None
