# Roadmap: Outsignal Lead Engine

## Milestones

- ✅ **v1.0 Lead Engine** — Phases 1-6 (shipped 2026-02-27) — [archive](milestones/v1.0-ROADMAP.md)
- ✅ **v1.1 Outbound Pipeline** — Phases 7-14 (shipped 2026-03-03) — [archive](milestones/v1.1-ROADMAP.md)
- ✅ **v2.0 Lead Discovery & Intelligence** — Phases 15-22 (shipped 2026-03-04) — [archive](milestones/v2.0-ROADMAP.md)
- ✅ **v3.0 Campaign Intelligence Hub** — Phases 23-28 (shipped 2026-03-10) — [archive](milestones/v3.0-ROADMAP.md)
- 🚧 **v4.0 Email Deliverability & Domain Infrastructure Monitoring** — Phases 29-32 (in progress)
- 🚧 **v5.0 Client Portal Inbox** — Phases 33-37 (in progress)

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

### v4.0 Email Deliverability & Domain Infrastructure Monitoring (In Progress)

**Milestone Goal:** Full-stack deliverability visibility — DNS health, bounce trends, placement testing, auto-rotation, and client-facing reporting — so every sender's health is observable and actionable before problems become crises.

- [x] **Phase 29: Domain Health Foundation** — Schema, DNS validation library, bounce snapshots, and daily cron; everything downstream depends on this data layer (completed 2026-03-10)
- [x] **Phase 30: Inbox Placement Testing** — On-demand mail-tester.com integration with "recommended for testing" badges on at-risk senders (completed 2026-03-11)
- [ ] **Phase 31: Auto-Rotation Engine** — Graduated status escalation, 4-hour bounce monitor cron, audit trail, notifications, and EmailBison API investigation
- [ ] **Phase 32: Deliverability Dashboard & Reporting** — Admin deliverability page, Intelligence Hub bento section, weekly digest, and client portal health summary

### v5.0 Client Portal Inbox (In Progress)

**Milestone Goal:** Full inbox experience at /portal/inbox with threaded email conversations (via EmailBison) and LinkedIn messaging (via Voyager API), replacing the read-only replies feed with reply capability.

- [ ] **Phase 33: API Spike & Client Extensions** — Validate EmailBison sendReply live behavior and extend both the EmailBisonClient and VoyagerClient with inbox methods; all downstream phases depend on these contracts
- [ ] **Phase 34: LinkedIn Data Layer** — DB models for LinkedIn conversations + messages, fire-and-forget sync API, and participant-to-Person matching; gates all LinkedIn UI work
- [ ] **Phase 35: Email Inbox** — Thread grouping API, conversation view, email reply composer, and AI suggested reply display; delivers immediate client value on the highest-volume channel
- [ ] **Phase 36: LinkedIn Inbox** — Conversation list and detail views from DB, LinkedIn reply queue via LinkedInAction, and manual refresh trigger
- [ ] **Phase 37: Inbox UI Polish, Admin Inbox & Navigation** — Channel tabs, mobile single-panel layout, unread indicators, cross-channel indicator, admin master inbox, and portal sidebar nav update

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
- [ ] 29-01-PLAN.md — DomainHealth model + DNS validation library (SPF/DKIM/DMARC)
- [ ] 29-02-PLAN.md — BounceSnapshot model + snapshot capture + warmup API + daily cron
- [ ] 29-03-PLAN.md — DNSBL blacklist checker + notifications + domain health cron

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
- [ ] 30-01-PLAN.md — PlacementTest model + mail-tester.com client + recommended badge query
- [ ] 30-02-PLAN.md — API endpoints (POST trigger + GET history) + auto-send + alerting

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
**Plans**: TBD

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
**Plans**: TBD

### Phase 33: API Spike & Client Extensions
**Goal**: EmailBison sendReply behavior is validated live and both API clients are extended with inbox methods — unblocking every downstream phase
**Depends on**: Phase 28 (existing EmailBisonClient and VoyagerClient in codebase)
**Requirements**: API-01, API-02, API-03, API-04
**Success Criteria** (what must be TRUE):
  1. A real EmailBison reply ID has been used to call POST /replies/{id}/reply and the response shape, auth requirements, and error codes are documented
  2. EmailBisonClient exposes sendReply(), getReply(), and getRepliesPage() methods with correct TypeScript types
  3. VoyagerClient exposes fetchConversations() and fetchMessages() methods that return typed conversation and message objects from the Voyager messaging API
  4. The Railway worker exposes GET /sessions/{senderId}/conversations and returns conversations JSON the portal can consume
**Plans:** 2 plans
Plans:
- [ ] 33-01-PLAN.md — EmailBison sendReply spike + client extensions (sendReply, getReply, getRepliesPage)
- [ ] 33-02-PLAN.md — VoyagerClient conversation methods + worker conversations endpoint

### Phase 34: LinkedIn Data Layer
**Goal**: LinkedIn conversations and messages are stored in the database and kept fresh via a fire-and-forget sync API — the data foundation all LinkedIn UI reads from
**Depends on**: Phase 33 (VoyagerClient extensions and worker route must exist)
**Requirements**: LI-01, LI-02, LI-03, LI-04
**Success Criteria** (what must be TRUE):
  1. LinkedInConversation records exist in the DB with conversation ID, participant info, last message preview, and last activity timestamp
  2. LinkedInMessage records exist for each message with sender flag (inbound/outbound), body text, and sent timestamp
  3. Portal calls POST /api/portal/inbox/linkedin/sync and receives 202 immediately; the worker fetches and syncs conversations asynchronously in the background
  4. Participants in synced conversations are matched to existing Person records by LinkedIn profile URL where available
**Plans**: TBD

### Phase 35: Email Inbox
**Goal**: Clients can read threaded email conversations and send replies from the portal inbox — delivering immediate value on the highest-volume channel
**Depends on**: Phase 33 (EmailBisonClient sendReply validated and extended)
**Requirements**: EMAIL-01, EMAIL-02, EMAIL-03, EMAIL-04
**Success Criteria** (what must be TRUE):
  1. The email inbox shows replies grouped into threads by parent_id chain — each thread shows the most recent message as a preview, and orphaned parents are treated as thread roots
  2. Opening a thread shows all messages in chronological order with inbound messages left-aligned, outbound messages right-aligned, and the original outbound email shown as context at the top
  3. Client can type a reply in the composer, select a sender email, hit Send, and the reply is delivered via EmailBison within the same portal session
  4. When an AI suggested reply exists on a reply record, a "Use this" button populates the composer with the suggestion text
**Plans**: TBD

### Phase 36: LinkedIn Inbox
**Goal**: Clients can read full LinkedIn conversation histories and queue replies from the portal, with a manual refresh to pull the latest messages
**Depends on**: Phase 34 (LinkedIn data layer must be populated before UI can render it)
**Requirements**: LIIN-01, LIIN-02, LIIN-03, LIIN-04
**Success Criteria** (what must be TRUE):
  1. The LinkedIn tab shows a list of recent conversations with participant name, last message preview, and time since last activity
  2. Opening a conversation shows the full message history from the DB with inbound/outbound bubbles and timestamps
  3. Client can type a reply, click Queue Message, and see it appear as "Queued" in the conversation — the LinkedInAction is created with priority 1 and the worker delivers it within 2 minutes
  4. Client can click Refresh on any conversation to trigger a fresh Voyager sync and see new messages appear after the sync completes
**Plans**: TBD

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
| 31. Auto-Rotation Engine | v4.0 | 0/TBD | Not started | - |
| 32. Deliverability Dashboard & Reporting | v4.0 | 0/TBD | Not started | - |
| 33. API Spike & Client Extensions | v5.0 | 0/2 | Not started | - |
| 34. LinkedIn Data Layer | v5.0 | 0/TBD | Not started | - |
| 35. Email Inbox | v5.0 | 0/TBD | Not started | - |
| 36. LinkedIn Inbox | v5.0 | 0/TBD | Not started | - |
| 37. Inbox UI Polish, Admin Inbox & Navigation | v5.0 | 0/TBD | Not started | - |
