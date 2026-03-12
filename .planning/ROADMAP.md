# Roadmap: Outsignal Lead Engine

## Milestones

- ✅ **v1.0 Lead Engine** — Phases 1-6 (shipped 2026-02-27) — [archive](milestones/v1.0-ROADMAP.md)
- ✅ **v1.1 Outbound Pipeline** — Phases 7-14 (shipped 2026-03-03) — [archive](milestones/v1.1-ROADMAP.md)
- ✅ **v2.0 Lead Discovery & Intelligence** — Phases 15-22 (shipped 2026-03-04) — [archive](milestones/v2.0-ROADMAP.md)
- ✅ **v3.0 Campaign Intelligence Hub** — Phases 23-28 (shipped 2026-03-10) — [archive](milestones/v3.0-ROADMAP.md)
- ✅ **v4.0 Email Deliverability & Domain Infrastructure Monitoring** — Phases 29-32 (shipped 2026-03-11)
- ✅ **v5.0 Client Portal Inbox** — Phases 33-37 (shipped 2026-03-11)
- 🚧 **v6.0 Trigger.dev Migration — Background Jobs Infrastructure** — Phases 38-43 (in progress)

## Phases

<details>
<summary>✅ v1.0 Lead Engine (Phases 1-6) — SHIPPED 2026-02-27</summary>

- [x] Phase 1: Enrichment Foundation (3/3 plans) — completed 2026-02-26
- [x] Phase 2: Provider Adapters + Waterfall (6/6 plans) — completed 2026-02-26
- [x] Phase 3: ICP Qualification + Leads Agent (3/3 plans) — completed 2026-02-26
- [x] Phase 3.1: API Security + Hardening (2/2 plans) — completed 2026-02-26
- [x] Phase 4: Search, Filter + List Building (5/5 plans) — completed 2026-02-27
- [x] Phase 5: Export + EmailBison Integration (3/3 plans) — completed 2026-02-27
- [x] Phase 6: MCP List Migration + CSV Download Button — completed 2026-02-27

Full details: [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)

</details>

<details>
<summary>✅ v1.1 Outbound Pipeline (Phases 7-14) — SHIPPED 2026-03-03</summary>

- [x] Phase 7: Leads Agent Dashboard (4/4 plans) — completed 2026-02-27
- [x] Phase 7.1: Leads Agent Integration Fixes (3/3 plans) — completed 2026-02-27
- [x] Phase 8: Campaign Entity + Writer Integration (6/6 plans) — completed 2026-03-01
- [x] Phase 9: Client Portal Campaign Approval (5/5 plans) — completed 2026-03-01
- [x] Phase 10: Auto-Deploy on Approval (5/5 plans) — completed 2026-03-03
- [x] Phase 11: LinkedIn Voyager API Client (3/3 plans) — completed 2026-03-02
- [x] Phase 12: Dashboard & Admin UX (8/8 plans) — completed 2026-03-02
- [x] Phase 13: Smart Sender Health (3/3 plans) — completed 2026-03-02
- [x] Phase 14: LinkedIn Cookie Chrome Extension (3/3 plans) — completed 2026-03-03

Full details: [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)

</details>

<details>
<summary>✅ v2.0 Lead Discovery & Intelligence (Phases 15-22) — SHIPPED 2026-03-04</summary>

- [x] Phase 15: Foundation (4/4 plans) — completed 2026-03-04
- [x] Phase 16: Discovery Sources (3/3 plans) — completed 2026-03-04
- [x] Phase 17: Leads Agent Discovery Upgrade (2/2 plans) — completed 2026-03-04
- [x] Phase 18: Signal Monitoring Infrastructure (4/4 plans) — completed 2026-03-04
- [x] Phase 19: Evergreen Signal Campaign Auto-Pipeline (4/4 plans) — completed 2026-03-04
- [x] Phase 20: Creative Ideas Copy Framework (2/2 plans) — completed 2026-03-04
- [x] Phase 21: Signal Dashboard + CLI Chat (2/2 plans) — completed 2026-03-04
- [x] Phase 22: Client Financials & Invoicing (5/5 plans) — completed 2026-03-04

Full details: [milestones/v2.0-ROADMAP.md](milestones/v2.0-ROADMAP.md)

</details>

<details>
<summary>✅ v3.0 Campaign Intelligence Hub (Phases 23-28) — SHIPPED 2026-03-10</summary>

- [x] Phase 23: Reply Storage & Classification (4/4 plans) — completed 2026-03-09
- [x] Phase 24: Campaign Analytics Engine (3/3 plans) — completed 2026-03-09
- [x] Phase 25: Copy Performance Analysis (3/3 plans) — completed 2026-03-10
- [x] Phase 26: Cross-Workspace Benchmarking & ICP Calibration (2/2 plans) — completed 2026-03-10
- [x] Phase 27: AI Insights & Action Queue (3/3 plans) — completed 2026-03-10
- [x] Phase 28: Intelligence Hub Dashboard (2/2 plans) — completed 2026-03-10

Full details: [milestones/v3.0-ROADMAP.md](milestones/v3.0-ROADMAP.md)

</details>

<details>
<summary>✅ v4.0 Email Deliverability & Domain Infrastructure Monitoring (Phases 29-32) — SHIPPED 2026-03-11</summary>

- [x] Phase 29: Domain Health Foundation (3/3 plans) — completed 2026-03-10
- [x] Phase 30: Inbox Placement Testing (2/2 plans) — completed 2026-03-11
- [x] Phase 31: Auto-Rotation Engine (2/2 plans) — completed 2026-03-11
- [x] Phase 32: Deliverability Dashboard & Reporting (4/4 plans) — completed 2026-03-11

</details>

<details>
<summary>✅ v5.0 Client Portal Inbox (Phases 33-37) — SHIPPED 2026-03-11</summary>

- [x] Phase 33: API Spike & Client Extensions (2/2 plans) — completed 2026-03-11
- [x] Phase 34: LinkedIn Data Layer (1/1 plans) — completed 2026-03-11
- [x] Phase 35: Email Inbox (3/3 plans) — completed 2026-03-11
- [x] Phase 36: LinkedIn Inbox (2/2 plans) — completed 2026-03-11
- [x] Phase 37: Inbox UI Polish, Admin Inbox & Navigation (3/3 plans) — completed 2026-03-11

</details>

### v6.0 Trigger.dev Migration — Background Jobs Infrastructure (In Progress)

**Milestone Goal:** Migrate all background operations from cron-job.org + Vercel fire-and-forget to Trigger.dev managed infrastructure, eliminating silent failures caused by 30s/60s serverless timeout constraints and providing full task observability.

- [x] **Phase 38: Trigger.dev Foundation + Smoke Test** — SDK install, config, Prisma binary target, env var sync, concurrency queues, and smoke test verification; nothing else is unblockable without this (completed 2026-03-12)
- [x] **Phase 39: Webhook Reply Migration** — EmailBison webhook handler reduced to verify + trigger + 200; reply classification and LinkedIn fast-track moved to Trigger.dev tasks with inline fallback (2 plans) (completed 2026-03-12)
- [x] **Phase 40: Writer Agent Restoration** — AI reply suggestion upgraded from Haiku shortcut to full Opus writer agent running as a Trigger.dev task with no timeout constraint (completed 2026-03-12)
- [x] **Phase 41: AI Cron Migration** — retry-classification, generate-insights, and snapshot-metrics migrated as scheduled tasks; these are the most timeout-vulnerable crons and most likely already failing silently (completed 2026-03-12)
- [ ] **Phase 42: Remaining Cron Lift-and-Shift** — poll-replies, domain-health, bounce-monitor, sync-senders, bounce-snapshots, deliverability-digest, and inbox-health (split) migrated; campaign deploy after() pattern replaced
- [ ] **Phase 43: Decommission + Observability Validation** — cron-job.org fully retired, fire-and-forget patterns removed, background task observability live in admin dashboard
- [ ] **Phase 44: OOO Re-engagement Pipeline** — AI-extracted return dates from OOO replies, Trigger.dev delayed tasks, auto-enrolment into personalised Welcome Back campaigns, OOO queue dashboard

## Phase Details

### Phase 29: Domain Health Foundation
**Goal**: All domain DNS health and per-sender bounce data is captured, stored, and queryable — the data layer every other phase reads from
**Depends on**: Phase 28 (existing sender model)
**Requirements**: DOMAIN-01, DOMAIN-02, DOMAIN-03, DOMAIN-04, DOMAIN-05, DOMAIN-06, DOMAIN-07, BOUNCE-01, BOUNCE-02, BOUNCE-03, BOUNCE-04
**Success Criteria** (what must be TRUE):
  1. Admin can query DomainHealth records and see SPF/DKIM/DMARC pass/fail status for every sending domain
  2. Daily bounce snapshots exist for every sender email showing cumulative sent, bounced, and replied counts
  3. Per-domain aggregate bounce metrics roll up correctly from sender-level snapshots
  4. Admin receives a Slack notification when a domain appears on any DNSBL blacklist
  5. Admin receives a warning notification when SPF, DKIM, or DMARC validation fails for any sending domain
**Plans:** 3/3 plans complete
Plans:
- [x] 29-01-PLAN.md — DomainHealth model + DNS validation library (SPF/DKIM/DMARC)
- [x] 29-02-PLAN.md — BounceSnapshot model + snapshot capture + warmup API + daily cron
- [x] 29-03-PLAN.md — DNSBL blacklist checker + notifications + domain health cron

### Phase 30: Inbox Placement Testing
**Goal**: Admin can trigger on-demand inbox placement tests for at-risk senders and see historical results per sender
**Depends on**: Phase 29 (bounce snapshot data needed for "recommended" badge logic)
**Requirements**: PLACE-01, PLACE-02, PLACE-03, PLACE-04
**Success Criteria** (what must be TRUE):
  1. Senders with a bounce rate above 3% show a "Recommended for testing" badge in the dashboard
  2. Admin can click a button to initiate a placement test, which returns a mail-tester.com test address
  3. After sending to the test address, the system fetches and stores the placement score via the mail-tester.com JSON API
  4. Admin can view a timeline of past placement test scores for any sender
**Plans:** 2/2 plans complete
Plans:
- [x] 30-01-PLAN.md — PlacementTest model + mail-tester.com client + recommended badge query
- [x] 30-02-PLAN.md — API endpoints (POST trigger + GET history) + auto-send + alerting

### Phase 31: Auto-Rotation Engine
**Goal**: Sender health status escalates and recovers automatically based on bounce rate thresholds, with full audit trail and admin notifications
**Depends on**: Phase 29 (bounce snapshot data and DomainHealth model)
**Requirements**: ROTATE-01, ROTATE-02, ROTATE-03, ROTATE-04, ROTATE-05, ROTATE-06
**Success Criteria** (what must be TRUE):
  1. Bounce monitor cron runs every 4 hours and evaluates health status for all sender emails across all workspaces
  2. A sender's health status transitions correctly through healthy / elevated / warning / critical thresholds based on bounce percentage
  3. A sender in critical status auto-recovers to healthy after 7 consecutive days below 3% bounce rate
  4. Every status transition is recorded in the EmailHealthEvent audit trail with reason and bounce percentage at the time
  5. Admin receives a notification when any sender reaches warning or critical status with the current bounce rate and recommended action
**Plans**: 2/2 plans complete

### Phase 32: Deliverability Dashboard & Reporting
**Goal**: Deliverability data is fully surfaced in the admin dashboard, Intelligence Hub, weekly digest, and client portal
**Depends on**: Phases 29, 30, 31 (all data must exist before it can be displayed)
**Requirements**: DASH-01, DASH-02, DASH-03, DASH-04, DASH-05, INTEL-01, INTEL-02, INTEL-03, PORTAL-01
**Success Criteria** (what must be TRUE):
  1. Admin can navigate to a Deliverability page from the sidebar and see domain health cards with SPF/DKIM/DMARC badges and blacklist status
  2. Each sender on the deliverability page shows a 30-day bounce rate sparkline and warmup progress bar
  3. The Intelligence Hub shows a deliverability bento card summarizing how many domains are healthy vs at-risk and which is worst
  4. A weekly digest fires every Monday containing bounce trends and domain health summary for all workspaces
  5. Clients can view per-sender bounce rates and domain health badges on their portal email-health page
**Plans:** 4/4 plans complete
Plans:
- [x] 32-01-PLAN.md — Deliverability API layer (summary, domains, senders, events endpoints)
- [x] 32-02-PLAN.md — Admin deliverability page with domain cards, sender table, activity feed + sidebar link
- [x] 32-03-PLAN.md — Intelligence Hub bento card + auto-insight generation on warning/critical
- [x] 32-04-PLAN.md — Weekly digest notification + portal email-health enhancement

### Phase 33: API Spike & Client Extensions
**Goal**: EmailBison sendReply behavior is validated live and both API clients are extended with inbox methods — unblocking every downstream phase
**Depends on**: Phase 28 (existing EmailBisonClient and VoyagerClient in codebase)
**Requirements**: API-01, API-02, API-03, API-04
**Success Criteria** (what must be TRUE):
  1. A real EmailBison reply ID has been used to call POST /replies/{id}/reply and the response shape, auth requirements, and error codes are documented
  2. EmailBisonClient exposes sendReply(), getReply(), and getRepliesPage() methods with correct TypeScript types
  3. VoyagerClient exposes fetchConversations() and fetchMessages() methods that return typed conversation and message objects from the Voyager messaging API
  4. The Railway worker exposes GET /sessions/{senderId}/conversations and returns conversations JSON the portal can consume
**Plans:** 2/2 plans complete
Plans:
- [x] 33-01-PLAN.md — EmailBison sendReply spike + client extensions (sendReply, getReply, getRepliesPage)
- [x] 33-02-PLAN.md — VoyagerClient conversation methods + worker conversations endpoint

### Phase 34: LinkedIn Data Layer
**Goal**: LinkedIn conversations and messages are stored in the database and kept fresh via a fire-and-forget sync API — the data foundation all LinkedIn UI reads from
**Depends on**: Phase 33 (VoyagerClient extensions and worker route must exist)
**Requirements**: LI-01, LI-02, LI-03, LI-04
**Success Criteria** (what must be TRUE):
  1. LinkedInConversation records exist in the DB with conversation ID, participant info, last message preview, and last activity timestamp
  2. LinkedInMessage records exist for each message with sender flag (inbound/outbound), body text, and sent timestamp
  3. Portal calls POST /api/portal/inbox/linkedin/sync and receives 202 immediately; the worker fetches and syncs conversations asynchronously in the background
  4. Participants in synced conversations are matched to existing Person records by LinkedIn profile URL where available
**Plans:** 1/1 plans complete
Plans:
- [x] 34-01-PLAN.md — Prisma models (LinkedInConversation, LinkedInMessage, LinkedInSyncStatus) + sync logic + portal sync API route

### Phase 35: Email Inbox
**Goal**: Clients can read threaded email conversations and send replies from the portal inbox — delivering immediate value on the highest-volume channel
**Depends on**: Phase 33 (EmailBisonClient sendReply validated and extended)
**Requirements**: EMAIL-01, EMAIL-02, EMAIL-03, EMAIL-04
**Success Criteria** (what must be TRUE):
  1. The email inbox shows replies grouped into threads by parent_id chain — each thread shows the most recent message as a preview, and orphaned parents are treated as thread roots
  2. Opening a thread shows all messages in chronological order with inbound messages left-aligned, outbound messages right-aligned, and the original outbound email shown as context at the top
  3. Client can type a reply in the composer, select a sender email, hit Send, and the reply is delivered via EmailBison within the same portal session
  4. When an AI suggested reply exists on a reply record, a "Use this" button populates the composer with the suggestion text
**Plans:** 3/3 plans complete
Plans:
- [x] 35-01-PLAN.md — Reply model inbox fields migration + webhook/poll-replies updates
- [x] 35-02-PLAN.md — Thread list, thread detail, and reply send API routes
- [x] 35-03-PLAN.md — Portal inbox UI (thread list, conversation view, composer, AI suggestion)

### Phase 36: LinkedIn Inbox
**Goal**: Clients can read full LinkedIn conversation histories and queue replies from the portal, with a manual refresh to pull the latest messages
**Depends on**: Phase 34 (LinkedIn data layer must be populated before UI can render it)
**Requirements**: LIIN-01, LIIN-02, LIIN-03, LIIN-04
**Success Criteria** (what must be TRUE):
  1. The LinkedIn tab shows a list of recent conversations with participant name, last message preview, and time since last activity
  2. Opening a conversation shows the full message history from the DB with inbound/outbound bubbles and timestamps
  3. Client can type a reply, click Queue Message, and see it appear as "Queued" in the conversation — the LinkedInAction is created with priority 1 and the worker delivers it within 2 minutes
  4. Client can click Refresh on any conversation to trigger a fresh Voyager sync and see new messages appear after the sync completes
**Plans:** 2/2 plans complete
Plans:
- [x] 36-01-PLAN.md — LinkedIn inbox API routes (conversation list, on-demand messages, reply queue, action status)
- [x] 36-02-PLAN.md — LinkedIn UI components (conversation list, chat bubble view, composer) + inbox page channel toggle

### Phase 37: Inbox UI Polish, Admin Inbox & Navigation
**Goal**: The inbox is fully polished with channel tabs, mobile layout, unread tracking, cross-channel indicators, an admin master inbox, and updated navigation in both portals
**Depends on**: Phases 35, 36 (email and LinkedIn inboxes must exist before polish and admin reuse)
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05, UI-06, UI-07, ADMIN-01, ADMIN-02, ADMIN-03, ADMIN-04, NAV-01, NAV-02
**Success Criteria** (what must be TRUE):
  1. The inbox renders as a two-panel layout on desktop (thread list left, conversation right) and collapses to single-panel on mobile with a back button to return to the thread list
  2. Channel tabs (All / Email / LinkedIn) appear based on the workspace package — an email-only workspace never sees the LinkedIn tab
  3. Unread threads show a dot indicator and the Inbox nav item shows the total unread count; reading a thread clears its unread state
  4. When the same person has both an email reply and a LinkedIn conversation, a cross-channel indicator appears in both thread views linking to the other channel
  5. Admin can navigate to /admin/inbox, filter by workspace, and reply on behalf of any client using the same two-panel components built for the portal
**Plans:** 3/3 plans complete
Plans:
- [x] 37-01-PLAN.md — Schema migration (isRead on Reply) + unread tracking APIs + navigation updates (both portals)
- [x] 37-02-PLAN.md — Portal inbox UI polish (mobile layout, channel tabs, cross-channel indicator, intent badges, composer upgrade)
- [x] 37-03-PLAN.md — Admin master inbox (API endpoints + page with workspace filter + reply on behalf)

### Phase 38: Trigger.dev Foundation + Smoke Test
**Goal**: Trigger.dev is installed, configured, and verified working — Prisma connects, env vars are present, and the shared Anthropic concurrency queue exists; every downstream phase is blocked until this passes
**Depends on**: Phase 37 (existing codebase baseline)
**Requirements**: FOUND-01, FOUND-02, FOUND-03, FOUND-04, FOUND-05, FOUND-06
**Success Criteria** (what must be TRUE):
  1. `trigger.dev dev` starts without errors and discovers the smoke-test task in the local dashboard
  2. The smoke-test task runs successfully: it reads one Person record from Neon and makes one Anthropic API call, and both return valid responses — proving DB connectivity and env var presence end-to-end
  3. `trigger.config.ts` contains `prismaExtension` with `mode: "legacy"` and `binaryTargets` in `schema.prisma` includes `debian-openssl-3.0.x`
  4. The Vercel integration is installed and Trigger.dev dashboard shows all production env vars synced from Vercel
  5. `/trigger/queues.ts` exists with a named `anthropicQueue` (concurrencyLimit: 3) and `emailBisonQueue` that all AI tasks can reference
**Plans:** 3/3 plans complete
Plans:
- [ ] 38-01-PLAN.md — SDK install, trigger.config.ts with Prisma extension, binary targets, shared queues
- [ ] 38-02-PLAN.md — Trigger.dev project creation, Vercel integration, env var sync, Neon connection config
- [ ] 38-03-PLAN.md — Smoke test task (Prisma + Anthropic + Slack + EmailBison + Resend) and verification

### Phase 39: Webhook Reply Migration
**Goal**: The EmailBison webhook handler returns 200 immediately and all reply processing (classification, LinkedIn fast-track) runs as Trigger.dev tasks — ending the fire-and-forget silent failure pattern
**Depends on**: Phase 38 (Trigger.dev must be installed and verified before any task is deployed)
**Requirements**: WHOOK-01, WHOOK-03, WHOOK-04, WHOOK-05
**Success Criteria** (what must be TRUE):
  1. The webhook handler returns 200 within 500ms of receiving a payload — verified by checking webhook event logs in EmailBison showing consistent fast acknowledgment
  2. A reply arrives, the webhook returns 200, and within 30 seconds the Reply record in the DB has a populated `intent` field — proving classification ran asynchronously via Trigger.dev
  3. When Trigger.dev is unavailable (simulated by disabling the task), the webhook handler falls back to inline classification and still writes intent to the DB — the fallback is observable via error log entries
  4. LinkedIn fast-track actions triggered from the webhook appear in the Trigger.dev dashboard run history with the correct workspace slug tag
**Plans**: 0/2
Plans:
- [ ] 39-01-PLAN.md — process-reply and linkedin-fast-track Trigger.dev task files
- [ ] 39-02-PLAN.md — Webhook handler refactor to trigger tasks with inline fallback

### Phase 40: Writer Agent Restoration
**Goal**: AI reply suggestions are generated by the full Opus writer agent with KB search and quality rules — restoring the capability that was degraded to Haiku as a Vercel timeout workaround
**Depends on**: Phase 39 (reply must be classified and persisted in DB before suggestion generation begins)
**Requirements**: WHOOK-02
**Success Criteria** (what must be TRUE):
  1. A new inbound reply triggers a `generate-suggestion` Trigger.dev task that completes successfully — the task run is visible in the Trigger.dev dashboard with a duration above 60 seconds (proving it runs beyond Vercel's constraint)
  2. The generated suggestion uses the Opus model (visible in AgentRun logs) and references knowledge base results — not the single-model Haiku shortcut
  3. The AI suggested reply appears on the Reply record within 5 minutes of the webhook arriving, and the portal "Use this" button surfaces it in the inbox composer
**Plans**: TBD

### Phase 41: AI Cron Migration
**Goal**: retry-classification, generate-insights, and snapshot-metrics run as Trigger.dev scheduled tasks — eliminating the silent failures caused by multi-workspace Anthropic chains exceeding Vercel's 60s ceiling
**Depends on**: Phase 38 (Trigger.dev foundation must exist; anthropicQueue must be pre-defined before AI tasks run)
**Requirements**: CRON-01, CRON-02, CRON-03
**Success Criteria** (what must be TRUE):
  1. The Trigger.dev dashboard shows retry-classification, generate-insights, and snapshot-metrics running on their configured schedules — with run history showing successful completions, not timeouts
  2. generate-insights processes all 6 workspaces in a single run (fan-out pattern) — Trigger.dev run log shows workspace-level subtask entries, not a sequential loop hitting a wall at workspace 3
  3. snapshot-metrics completes AI body element classification within a single task run — no partial snapshots with null classification fields
  4. The cron-job.org jobs for all three crons are deactivated the same day each Trigger.dev cron is verified stable — no double-processing window
**Plans:** 2/2 plans complete
Plans:
- [x] 41-01-PLAN.md — Three Trigger.dev scheduled tasks (retry-classification, snapshot-metrics, generate-insights)
- [x] 41-02-PLAN.md — Deploy to Trigger.dev Cloud + disable cron-job.org jobs

### Phase 42: Remaining Cron Lift-and-Shift
**Goal**: All remaining scheduled work (poll-replies, domain-health, bounce-monitor, sync-senders, bounce-snapshots, deliverability-digest, inbox-health split into parts, and campaign deploy) runs on Trigger.dev
**Depends on**: Phase 41 (idempotency and scheduling patterns established in Phase 41 carry forward here)
**Requirements**: CRON-04, CRON-05, CRON-06, CRON-07, CRON-08, CRON-09, CRON-10, DECOMM-03
**Success Criteria** (what must be TRUE):
  1. poll-replies fetches across all workspaces concurrently in a single Trigger.dev run — no sequential workspace loop visible in task logs
  2. domain-health runs with no 4-domain cap — all domains in the DB are checked per run, confirmed by comparing Trigger.dev run output against total domain count in DB
  3. inbox-health is split into at least 3 separate tasks (inbox checks, sender health, invoice processing) — each visible as a distinct scheduled task in the Trigger.dev dashboard with independent retry history
  4. A campaign deployment completes successfully via Trigger.dev task — the `after()` pattern in the deploy route is gone and the task run appears in dashboard history
  5. cron-job.org jobs for all 7 migrated crons are deactivated the same day each Trigger.dev cron is verified stable
**Plans:** 3/5 plans executed
Plans:
- [ ] 42-01-PLAN.md — Simple cron tasks (sync-senders, bounce-snapshots, deliverability-digest, bounce-monitor)
- [ ] 42-02-PLAN.md — Complex cron tasks (poll-replies with emailBisonQueue, domain-health with cap removed)
- [ ] 42-03-PLAN.md — inbox-health split (4 tasks) + enrichment-job-processor
- [ ] 42-04-PLAN.md — campaign-deploy task + route refactor (after() → tasks.trigger())
- [ ] 42-05-PLAN.md — Deploy to Trigger.dev Cloud + remove Vercel crons + disable cron-job.org jobs

### Phase 43: Decommission + Observability Validation
**Goal**: cron-job.org is fully retired, all fire-and-forget patterns are removed from the codebase, and the admin dashboard surfaces background task status so failures are no longer silent
**Depends on**: Phase 42 (all tasks must be running on Trigger.dev before external crons can be retired)
**Requirements**: DECOMM-01, DECOMM-02, DECOMM-04
**Success Criteria** (what must be TRUE):
  1. The cron-job.org account has zero active jobs — all previously-external crons are now Trigger.dev schedules
  2. A search of the codebase for `.then(` in webhook handler files returns no background work — all async operations are `tasks.trigger()` calls
  3. Admin can navigate to a Background Tasks page (or panel) in the dashboard and see a list of recent task runs with status (success/failed/running), duration, and workspace tag — making failures visible without logging into Trigger.dev
  4. A deliberately-failed task appears in the admin dashboard within 5 minutes of the failure, with enough context to identify which workspace and operation was affected
**Plans**: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Enrichment Foundation | v1.0 | 3/3 | Complete | 2026-02-26 |
| 2. Provider Adapters + Waterfall | v1.0 | 6/6 | Complete | 2026-02-26 |
| 3. ICP Qualification + Leads Agent | v1.0 | 3/3 | Complete | 2026-02-26 |
| 3.1. API Security + Hardening | v1.0 | 2/2 | Complete | 2026-02-26 |
| 4. Search, Filter + List Building | v1.0 | 5/5 | Complete | 2026-02-27 |
| 5. Export + EmailBison Integration | v1.0 | 3/3 | Complete | 2026-02-27 |
| 6. MCP List Migration + CSV Download | v1.0 | 1/1 | Complete | 2026-02-27 |
| 7. Leads Agent Dashboard | v1.1 | 4/4 | Complete | 2026-02-27 |
| 7.1. Leads Agent Integration Fixes | v1.1 | 3/3 | Complete | 2026-02-27 |
| 8. Campaign Entity + Writer Integration | v1.1 | 6/6 | Complete | 2026-03-01 |
| 9. Client Portal Campaign Approval | v1.1 | 5/5 | Complete | 2026-03-01 |
| 10. Auto-Deploy on Approval | v1.1 | 5/5 | Complete | 2026-03-03 |
| 11. LinkedIn Voyager API Client | v1.1 | 3/3 | Complete | 2026-03-02 |
| 12. Dashboard & Admin UX | v1.1 | 8/8 | Complete | 2026-03-02 |
| 13. Smart Sender Health | v1.1 | 3/3 | Complete | 2026-03-02 |
| 14. LinkedIn Cookie Chrome Extension | v1.1 | 3/3 | Complete | 2026-03-03 |
| 15. Foundation | v2.0 | 4/4 | Complete | 2026-03-04 |
| 16. Discovery Sources | v2.0 | 3/3 | Complete | 2026-03-04 |
| 17. Leads Agent Discovery Upgrade | v2.0 | 2/2 | Complete | 2026-03-04 |
| 18. Signal Monitoring Infrastructure | v2.0 | 4/4 | Complete | 2026-03-04 |
| 19. Evergreen Signal Campaign Auto-Pipeline | v2.0 | 4/4 | Complete | 2026-03-04 |
| 20. Creative Ideas Copy Framework | v2.0 | 2/2 | Complete | 2026-03-04 |
| 21. Signal Dashboard + CLI Chat | v2.0 | 2/2 | Complete | 2026-03-04 |
| 22. Client Financials & Invoicing | v2.0 | 5/5 | Complete | 2026-03-04 |
| 23. Reply Storage & Classification | v3.0 | 4/4 | Complete | 2026-03-09 |
| 24. Campaign Analytics Engine | v3.0 | 3/3 | Complete | 2026-03-09 |
| 25. Copy Performance Analysis | v3.0 | 3/3 | Complete | 2026-03-10 |
| 26. Cross-Workspace Benchmarking & ICP Calibration | v3.0 | 2/2 | Complete | 2026-03-10 |
| 27. AI Insights & Action Queue | v3.0 | 3/3 | Complete | 2026-03-10 |
| 28. Intelligence Hub Dashboard | v3.0 | 2/2 | Complete | 2026-03-10 |
| 29. Domain Health Foundation | v4.0 | 3/3 | Complete | 2026-03-10 |
| 30. Inbox Placement Testing | v4.0 | 2/2 | Complete | 2026-03-11 |
| 31. Auto-Rotation Engine | v4.0 | 2/2 | Complete | 2026-03-11 |
| 32. Deliverability Dashboard & Reporting | v4.0 | 4/4 | Complete | 2026-03-11 |
| 33. API Spike & Client Extensions | v5.0 | 2/2 | Complete | 2026-03-11 |
| 34. LinkedIn Data Layer | v5.0 | 1/1 | Complete | 2026-03-11 |
| 35. Email Inbox | v5.0 | 3/3 | Complete | 2026-03-11 |
| 36. LinkedIn Inbox | v5.0 | 2/2 | Complete | 2026-03-11 |
| 37. Inbox UI Polish, Admin Inbox & Navigation | v5.0 | 3/3 | Complete | 2026-03-11 |
| 38. Trigger.dev Foundation + Smoke Test | 3/3 | Complete    | 2026-03-12 | - |
| 39. Webhook Reply Migration | 2/2 | Complete    | 2026-03-12 | - |
| 40. Writer Agent Restoration | 1/2 | Complete    | 2026-03-12 | - |
| 41. AI Cron Migration | v6.0 | 2/2 | Complete | 2026-03-12 |
| 42. Remaining Cron Lift-and-Shift | 3/5 | In Progress|  | - |
| 43. Decommission + Observability Validation | v6.0 | 0/TBD | Not started | - |
| 44. OOO Re-engagement Pipeline | v6.0 | 0/TBD | Not started | - |

### Phase 44: OOO Re-engagement Pipeline

**Goal:** Out-of-office replies are automatically detected, parsed for return date and reason, and the lead is auto-enrolled into a personalised "Welcome Back" campaign on their return date — recovering leads that would otherwise be lost when EmailBison marks their sequence as complete
**Depends on:** Phase 43 (Trigger.dev fully operational for delayed task scheduling)
**Requirements**: OOO-01, OOO-02, OOO-03, OOO-04, OOO-05, OOO-06, OOO-07
**Success Criteria** (what must be TRUE):
  1. When an OOO reply arrives, AI extracts the return date and reason (holiday, illness, conference, generic) and stores them on the Person record (`oooUntil`, `oooReason`, `oooDetectedAt`)
  2. A Trigger.dev delayed task is automatically scheduled for the extracted return date — visible in the Trigger.dev dashboard with the lead's email and workspace tag
  3. When the delayed task fires, the lead is auto-enrolled into the workspace's "Welcome Back" campaign via EmailBison API (or queued as a LinkedIn message for LinkedIn-only workspaces like BlankTag)
  4. The welcome-back messaging is personalised based on OOO reason: holiday gets "Hope you had a great break!", illness gets "Hope you're feeling better!", conference gets "Hope [event] was good!"
  5. Admin dashboard shows an OOO queue page listing all leads currently out-of-office with return dates, reasons, and re-engagement status (pending/sent/failed)
  6. Client receives a notification when their OOO leads are re-engaged: "[Workspace] 3 leads back from OOO — Welcome Back campaign sent"
  7. If no return date can be extracted, a sensible default is used (14 days from OOO detection) and flagged for manual review
**Plans:** 2/2 plans complete

Plans:
- [ ] TBD (run /gsd:plan-phase 44 to break down)
