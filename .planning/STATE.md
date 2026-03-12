---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: Email Deliverability & Domain Infrastructure Monitoring
status: unknown
last_updated: "2026-03-11T19:50:08.568Z"
progress:
  total_phases: 34
  completed_phases: 32
  total_plans: 105
  completed_plans: 106
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-11)

**Core value:** Own the lead data pipeline end-to-end so we never pay for the same lead twice and can cancel the $300+/month Clay subscription.
**Current focus:** v5.0 Client Portal Inbox (phases 33-37) | v4.0 Email Deliverability (phases 31-32, parallel)

## Current Position

Phase: Phase 37 — Inbox UI Polish & Admin Inbox Navigation
Plan: 37-03 complete
Status: Phase 37 Plan 03 done — admin master inbox with cross-workspace filtering, workspace badges, Replying-as banner, 6 admin inbox API routes (email threads/reply, LinkedIn conversations/messages/reply).
Last activity: 2026-03-11 - Completed 37-03: admin inbox page, workspace filter, workspace badges, Replying-as banner, admin API endpoints

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

- [36-01]: Two-query pattern for Person join — personId has no @relation on LinkedInConversation, separate findMany + Map avoids N+1
- [36-01]: On-demand message fetch only calls worker when no DB messages exist (or refresh=true) — minimizes Voyager API calls
- [36-01]: 422 vs 404 for missing personId on reply — 422 Unprocessable Entity correct when can't proceed without Person record
- [36-01]: Graceful degradation on worker failure in message fetch — returns existing DB messages, never 500s
- [Phase 36-02]: Chat bubbles not stacked cards for LinkedIn — mirrors native LinkedIn messaging feel
- [Phase 36-02]: Queue Message button text (not Send) — communicates async delivery via LinkedIn worker
- [Phase 36-02]: Both channels poll simultaneously — data always fresh regardless of active tab
- [Phase 37-01]: isRead field with @@index([workspaceSlug, isRead]) for efficient unread count queries
- [Phase 37-01]: OR clause on emailBisonParentId/emailBisonReplyId in mark-read covers both thread roots and reply children
- [Phase 37-01]: LinkedIn unreadCount from LinkedInConversation._sum aggregate — reuses existing field
- [Phase 37-02]: Mobile panel visibility uses CSS hidden md:flex not JS resize listeners — no hydration issues
- [Phase 37-02]: Cross-channel data added to thread detail API response — single round-trip for full thread + cross-channel metadata
- [Phase 37-02]: workspace package fetched from /api/portal/workspace on mount — dedicated endpoint, clean separation from inbox data
- [Phase 37-03]: Admin routes use requireAdminAuth() not getPortalSession() — admin is not a portal client
- [Phase 37-03]: Component override pattern for admin (replyEndpoint, extraBody props) — no component forking, backward compatible
- [Phase 37-03]: Replying-as banner data from thread workspaceName field — no extra API fetch needed

### Blockers/Concerns

- EmailBison POST /replies/{id}/reply RESOLVED — spike confirmed working on white-label, requires reply_all:true or to_emails[], response: {data: {success, message, reply: Reply}}
- Voyager conversation API response schema needs live validation in Phase 33 before sync parser is built
- Vercel 60s timeout — LinkedIn sync must be fully fire-and-forget (202 before any Voyager calls)

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 1 | Automated EmailBison sender sync - pull sender emails into Sender table and run on daily cron | 2026-03-11 | 074cf22 | [1-automated-emailbison-sender-sync-pull-se](./quick/1-automated-emailbison-sender-sync-pull-se/) |
| 2 | Automate critical sender remediation - pause/remove/resume campaigns, set daily_limit=1, disable warmup, store state for recovery | 2026-03-11 | e0229e0 | [2-automate-critical-sender-remediation-cam](./quick/2-automate-critical-sender-remediation-cam/) |
| 3 | Fix AI reply suggestions (replace Opus writer agent with Haiku direct call) + polish email thread view spacing and thread list visual hierarchy | 2026-03-12 | 59b76e1 | [3-fix-ai-reply-suggestions-email-thread-vi](./quick/3-fix-ai-reply-suggestions-email-thread-vi/) |
- LinkedIn Voyager rate limits unknown — 2-3s delays between calls, limit 20 conversations, 5-min cache, graceful 401/429 degradation
| Phase 37-inbox-ui-polish-admin-inbox-navigation P01 | 4 | 2 tasks | 7 files |
| Phase 37-inbox-ui-polish-admin-inbox-navigation P02 | 22 | 2 tasks | 8 files |
| Phase 37-inbox-ui-polish-admin-inbox-navigation P03 | 10 | 2 tasks | 12 files |

### Pending Todos

None.

## Session Continuity

Last session: 2026-03-12
Stopped at: Completed quick-3 — AI reply suggestions (Haiku direct call) + email thread view/list UI polish
Resume file: None
