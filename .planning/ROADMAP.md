# Roadmap: Outsignal Lead Engine

## Milestones

- ✅ **v1.0 Lead Engine** — Phases 1-6 (shipped 2026-02-27) — [archive](milestones/v1.0-ROADMAP.md)
- 🚧 **v1.1 Outbound Pipeline** — Phases 7-10 (in progress)

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

### 🚧 v1.1 Outbound Pipeline (In Progress)

**Milestone Goal:** Complete the outbound pipeline loop — admin creates campaigns via Cmd+J chat (leads + content), client reviews and approves leads and content separately in a portal, system auto-deploys to EmailBison + LinkedIn on dual approval.

- [x] **Phase 7: Leads Agent Dashboard** - Natural language access to search, list build, score, and export via Cmd+J chat (completed 2026-02-27)
- [x] **Phase 7.1: Leads Agent Integration Fixes** - MCP operations migration, export error handling, conversationContext wiring, score credit-gate (completed 2026-02-27)
- [x] **Phase 8: Campaign Entity + Writer Integration** - Campaign model owns leads + content; writer agent generates sequences; admin promotes to client review via Cmd+J (completed 2026-03-01)
- [x] **Phase 9: Client Portal Campaign Approval** - Client approves leads and content separately; notifications fire on action; dual approval triggers deploy (completed 2026-03-01)
- [x] **Phase 10: Auto-Deploy on Approval** - On dual approval, auto-deploy to EmailBison + LinkedIn; fire-and-forget with status tracking (completed 2026-03-03)

## Phase Details

### Phase 7: Leads Agent Dashboard
**Goal**: Admin can operate the full lead pipeline — search, list build, score, and export — through natural language chat in the Cmd+J dashboard without touching any UI pages
**Depends on**: Phase 6 (v1.0 complete — TargetList, enrichment pipeline, export gate all exist)
**Requirements**: LEAD-01, LEAD-02, LEAD-03, LEAD-04, LEAD-05, LEAD-06, DEPLOY-01
**Success Criteria** (what must be TRUE):
  1. Admin types "find CTOs in fintech with verified email" in Cmd+J and gets a paginated people result with scores
  2. Admin types "create a list called Rise Q1" and the list appears in the lists UI immediately after the chat response
  3. Admin types "score the Rise Q1 list" and receives ICP qualification scores for each person without hitting an enrichment API for already-scored leads
  4. Admin types "export Rise Q1 to EmailBison" and the export runs through the verification gate and confirms success or reports why leads were excluded
  5. EmailBison API surface is documented in a spike note: sequence step schema and campaign-lead assignment endpoint are verified as present or absent against the live white-label instance
  6. Every Leads Agent action (search, list create, score, export) appears as an AgentRun record in the audit trail
**Plans**: 4/4 complete

### Phase 7.1: Leads Agent Integration Fixes
**Goal**: Close integration gaps from Phase 7 audit — MCP tools share the operations layer, export errors are actionable, conversational refinement works end-to-end, and scoring has a code-level credit gate
**Depends on**: Phase 7
**Requirements**: LEAD-04, LEAD-05
**Gap Closure**: Closes gaps from v1.1 milestone audit
**Success Criteria** (what must be TRUE):
  1. MCP tools with direct operations equivalents (search_people, create_list, add_to_list, view_list) call `operations.ts` functions instead of inline Prisma queries. Accepted exclusions: batch_score_list (workspace-level scope, no operations equivalent — deferred to Phase 8) and export_to_emailbison confirm path (campaign management, no operations equivalent — deferred to Phase 8). Both use shared scoring/verification functions.
  2. Export via agent returns an actionable error when workspace exists but apiToken is missing (not "Workspace not found")
  3. Orchestrator's `delegateToLeads` schema includes `conversationContext` and passes it to `runLeadsAgent` — multi-turn "narrow to London" follow-ups refine previous results
  4. `scoreList` in operations.ts has a code-level confirm gate (returns count without scoring when `confirm: false`) matching the MCP equivalent
**Plans**: 3/3 complete
Plans:
- [x] 07.1-01-PLAN.md — Surgical fixes: apiToken error, conversationContext wiring, scoreList confirm gate
- [x] 07.1-02-PLAN.md — MCP tools migration to operations layer
- [x] 07.1-03-PLAN.md — SC-1 gap closure: dead imports removed, scope documented in ROADMAP + REQUIREMENTS

### Phase 8: Campaign Entity + Writer Integration
**Goal**: Campaign becomes a first-class entity in Outsignal that owns leads (TargetList) AND content (email + LinkedIn sequences). Admin creates campaigns, generates content via writer agent, reviews and iterates via Cmd+J, and promotes to client review — all through natural language chat. Writer agent also generates suggested responses to incoming replies, surfaced in Slack notifications and available for refinement via Cmd+J.
**Depends on**: Phase 7 (Leads Agent tools exist), Writer agent (exists, needs wiring to campaign context)
**Requirements**: CAMP-01, CAMP-02, CAMP-03, CAMP-04, CAMP-05, WRITER-01, WRITER-02, WRITER-03, WRITER-04, WRITER-05, WRITER-06, WRITER-07, WRITER-08, WRITER-09
**Success Criteria** (what must be TRUE):
  1. Campaign model exists in Prisma with status lifecycle (draft → internal_review → pending_approval → approved → deployed → active → paused → completed), channel selection, separate lead/content approval fields, and deployment tracking
  2. Admin types "create a campaign for Rise using the fintech CTO list, email + LinkedIn" in Cmd+J and a Campaign record is created with the TargetList linked and channels set
  3. Admin types "write email sequence for this campaign — 3 steps, pain-point angle" and the writer agent generates a multi-step email sequence stored on the Campaign
  4. Admin types "write LinkedIn messages for this campaign" and the writer generates LinkedIn connection request + follow-up messages stored on the Campaign
  5. Admin can review content in chat, give feedback ("too formal, simplify the CTA"), and the writer iterates — conversational back-and-forth
  6. Admin types "push this campaign for client approval" and Campaign.status transitions to pending_approval, triggering a client notification (email + Slack)
  7. Campaign CRUD API routes exist at `/api/campaigns/*` with workspace ownership enforcement
  8. When a reply webhook fires (LEAD_REPLIED, LEAD_INTERESTED), the writer agent generates a suggested response using conversation history, workspace context, and knowledge base — included in the Slack notification as a "Suggested Response" block
  9. Admin can refine a reply suggestion via Cmd+J: "draft a response to John's reply" or "make that response more casual" — conversational iteration on reply drafts
  10. Knowledge base search uses pgvector embeddings (cosine similarity) instead of keyword matching — all existing documents re-embedded during migration
  11. searchKnowledgeBase tool is available to all agents (writer, leads, research, campaign) as a shared utility, not writer-exclusive
**Plans**: 6 plans
Plans:
- [ ] 08-01-PLAN.md — Campaign Prisma model with status lifecycle, TargetList ownership, approval fields
- [ ] 08-02-PLAN.md — Knowledge base pgvector upgrade + shared searchKnowledgeBase tool
- [ ] 08-03-PLAN.md — Campaign operations layer (CRUD + state machine)
- [ ] 08-04-PLAN.md — Writer agent upgrade with production quality rules and campaign-aware generation
- [ ] 08-05-PLAN.md — Campaign agent + orchestrator wiring + CRUD API routes
- [ ] 08-06-PLAN.md — Reply suggestions in webhooks + Slack/email notifications

### Phase 9: Client Portal Campaign Approval
**Goal**: Clients log into the portal, see their pending campaigns, preview lead sample and content, and approve or reject leads and content separately — triggering admin notifications. Campaign deploys ONLY when both leads AND content are approved.
**Depends on**: Phase 8 (Campaign model exists)
**Requirements**: PORTAL-01, PORTAL-02, PORTAL-03, PORTAL-04, PORTAL-05, PORTAL-06, PORTAL-07, NOTIF-01, NOTIF-02
**Success Criteria** (what must be TRUE):
  1. Client opens /portal/campaigns and sees all campaigns for their workspace, with pending campaigns showing a notification badge
  2. Campaign detail page shows two separate sections: Leads and Content
  3. Leads section displays top N leads (configurable, default 50) by ICP score with name, title, company, location, LinkedIn — client clicks "Approve Leads" or "Request Changes" (with feedback text field)
  4. Content section displays email sequence steps (subject + body) and LinkedIn messages (if channel includes LinkedIn) with multiple angles/variants — client clicks "Approve Content" or "Request Changes" (with feedback text field)
  5. Lead approval and content approval are independent — approving one does not affect the other
  6. When BOTH leads AND content are approved, Campaign.status transitions to approved and auto-deploy is triggered
  7. Admin receives Slack message in workspace channel and email within 30 seconds of any client approval or rejection
  8. Client from workspace A cannot view or act on campaigns belonging to workspace B
**Plans**: TBD

### Phase 10: Auto-Deploy + Email ↔ LinkedIn Sequencing
**Goal**: When client approves both leads and content, the system auto-deploys to EmailBison (campaign + sequence steps + leads) and LinkedIn sequencer (connection requests + follow-ups) as a fire-and-forget background job, with deploy status visible to admin. Email and LinkedIn channels are interconnected — LinkedIn actions trigger based on email events (EMAIL_SENT steps 1/2/3), and LinkedIn content adapts based on which email step fired.
**Depends on**: Phase 9 (approval flow exists), LinkedIn agent-browser rewrite (profile-first targeting)
**Requirements**: DEPLOY-02, DEPLOY-03, DEPLOY-04, DEPLOY-05, DEPLOY-06, DEPLOY-07, SEQ-01, SEQ-02, SEQ-03, SEQ-04, SEQ-05
**Success Criteria** (what must be TRUE):
  1. On dual approval, deploy triggers automatically (no admin intervention) and returns immediately while running in background
  2. EmailBison shows a new campaign with sequence steps matching the approved email content after deploy completes
  3. Verified leads from the approved TargetList are pushed to the EmailBison workspace (manual campaign assignment in EB UI until API endpoint is available)
  4. LinkedIn messages from Campaign.linkedinSequence are queued via the LinkedIn sequencer worker on Railway
  5. Deploy handles email-only, LinkedIn-only, or both channels depending on Campaign.channels
  6. CampaignDeploy record tracks status (pending → running → complete / failed), lead count, step count, error message — visible in admin campaign detail
  7. Admin receives notification when deploy completes or fails
  8. EMAIL_SENT webhook triggers LinkedIn actions via CampaignSequenceRule — e.g., "24h after Email 1, send connection request" is queued automatically
  9. CampaignSequenceRule maps email steps to LinkedIn actions with configurable delays, message templates, and action types
  10. Connection accept detection polls periodically — when a connection is accepted, the next LinkedIn sequence step (e.g., follow-up message) is auto-queued
  11. LinkedIn content adapts based on email step context — message templates can reference which email the lead received
  12. Sender session refresh runs on a daily cron — proactively re-authenticates sessions older than 6 days to prevent expiry failures
**Plans**: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Enrichment Foundation | v1.0 | 3/3 | Complete | 2026-02-26 |
| 2. Provider Adapters + Waterfall | v1.0 | 6/6 | Complete | 2026-02-26 |
| 3. ICP Qualification + Leads Agent | v1.0 | 3/3 | Complete | 2026-02-26 |
| 3.1 API Security + Hardening | v1.0 | 2/2 | Complete | 2026-02-26 |
| 4. Search, Filter + List Building | v1.0 | 5/5 | Complete | 2026-02-27 |
| 5. Export + EmailBison Integration | v1.0 | 3/3 | Complete | 2026-02-27 |
| 6. MCP List Migration + CSV Download | v1.0 | — | Complete | 2026-02-27 |
| 7. Leads Agent Dashboard | v1.1 | 4/4 | Complete | 2026-02-27 |
| 7.1 Leads Agent Integration Fixes | v1.1 | 3/3 | Complete | 2026-02-27 |
| 8. Campaign Entity + Writer Integration | 6/6 | Complete   | 2026-03-01 | - |
| 9. Client Portal Campaign Approval | 5/5 | Complete   | 2026-03-01 | - |
| 10. Auto-Deploy on Approval | 5/5 | Complete   | 2026-03-03 | - |
| 11. LinkedIn Voyager API Client | — | 3/3 | Code complete | 2026-03-02 |
| 12. Dashboard & Admin UX | 8/8 | Complete    | 2026-03-02 | - |
| 13. Smart Sender Health | 3/3 | Complete    | 2026-03-02 | - |
| 14. LinkedIn Cookie Chrome Extension | 3/3 | Complete   | 2026-03-03 | - |

### Phase 11: LinkedIn Voyager API Client
**Goal**: Replace browser automation (LinkedInBrowser) with direct HTTP calls to LinkedIn's Voyager API (VoyagerClient) for all LinkedIn actions (connect, message, profile_view, check_connection), reducing detection risk and improving reliability. Keep agent-browser for initial cookie capture only.
**Depends on**: Phase 10 (deploy pipeline exists; LinkedIn actions are queued)
**Requirements**: VOYAGER-01, VOYAGER-02, VOYAGER-03, VOYAGER-04, VOYAGER-05
**Success Criteria** (what must be TRUE):
  1. All LinkedIn actions (connect, message, profile_view, check_connection) execute via HTTP Voyager API calls, not browser automation
  2. VoyagerClient authenticates using li_at + JSESSIONID cookies with correct CSRF token derivation (jsessionId.replace(/"/g, ''))
  3. All Voyager API requests route through the sender's ISP residential proxy via SOCKS5 when proxyUrl is configured
  4. Error responses (429 rate limit, 403 auth expired, 999 IP blocked, checkpoint redirect) are handled with appropriate sender health status updates
  5. Cookie extraction from agent-browser session persists li_at + JSESSIONID to Sender.sessionData via existing API
  6. Worker creates VoyagerClient per sender using stored cookies, falling back to browser login when cookies are missing
  7. Full worker project compiles without errors with the new VoyagerClient integration
**Plans**: 3 plans

Plans:
- [ ] 11-01-PLAN.md — VoyagerClient class with Voyager API methods + socks-proxy-agent dependency
- [ ] 11-02-PLAN.md — Cookie extraction from LinkedInBrowser + ApiClient cookie persistence
- [ ] 11-03-PLAN.md — Worker integration: swap LinkedInBrowser for VoyagerClient in worker.ts

### Phase 12: Dashboard & Admin UX

**Goal:** Upgrade the admin dashboard from a read-only overview to a full operational command center. Add activity graphs (reply volume, sent/bounce trends from WebhookEvent table) filterable by client or all. Agent run monitoring UI (AgentRun model). LinkedIn action queue viewer (LinkedInAction model). Proposal and onboarding CRUD (edit, delete). Manual document upload/ingest for proposals and onboarding docs (PDF/Google Doc parsing to auto-create records). Person detail page. LinkedIn sender management (add/edit/pause/delete, proxy URL, daily limits). Webhook event log viewer.
**Requirements**: DASH-01, DASH-02, DASH-03, DASH-04, DASH-05, DASH-06, DASH-07, DASH-08, DASH-09, DASH-10, DASH-11, DASH-12, DASH-13, DASH-14
**Depends on:** Phase 11
**Success Criteria** (what must be TRUE):
  1. Dashboard home shows KPI cards (email, LinkedIn, pipeline, health) with a client filter dropdown that controls all views
  2. Line charts show reply volume, sent/bounce trends over configurable time ranges from WebhookEvent data
  3. Critical alerts section shows flagged senders, failed agent runs, disconnected inboxes — no noise
  4. Person detail page at /people/[id] shows header, overview timeline, and channel-specific tabs
  5. Agent run monitoring page has compact expandable table with inline run details
  6. LinkedIn action queue viewer shows queue status counts and next-up actions
  7. Webhook event log has search + combinable filter chips (Errors, Replies, Last 24h)
  8. Sender management page uses card grid with modal add/edit, pause/delete from card
  9. Sidebar navigation includes all new pages in logical groups
  10. Proposals support edit/delete via modal, document upload auto-parses content
**Plans:** 5/5 plans complete

Plans:
- [ ] 12-01-PLAN.md — Dashboard home KPIs, activity charts, alerts, client filter
- [ ] 12-02-PLAN.md — Person detail page with tabs and timeline
- [ ] 12-03-PLAN.md — Sender management card grid and CRUD modal
- [ ] 12-04-PLAN.md — Agent run monitoring with expandable accordion table
- [ ] 12-05-PLAN.md — LinkedIn action queue viewer
- [ ] 12-06-PLAN.md — Webhook event log with search and filter chips
- [ ] 12-07-PLAN.md — Sidebar navigation + proposal CRUD + document upload

### Phase 13: Smart Sender Health

**Goal:** Automated sender health management. Auto-detect flagged senders (bounce rate >5%, CAPTCHA, restriction, session expired). Auto-remove flagged sender from campaign rotation (not pause whole campaign). Reassign pending LinkedIn actions to healthy senders. Slack + email notifications on health events. Reactivate workflow for hard-flagged senders. Health history tracking and trend visualization with sparkline charts.
**Requirements**: HEALTH-01, HEALTH-02, HEALTH-03, HEALTH-04, HEALTH-05, HEALTH-06, HEALTH-07, HEALTH-08, HEALTH-09, HEALTH-10, HEALTH-11
**Depends on:** Phase 12
**Plans:** 3/3 plans complete

Plans:
- [ ] 13-01-PLAN.md — Schema (SenderHealthEvent model) + health check detection engine + cron integration
- [ ] 13-02-PLAN.md — Health notifications (critical Slack+email, warning daily digest) + cron wiring
- [ ] 13-03-PLAN.md — Sender card UI enhancement (health panel, sparkline, reactivate) + dashboard KPI card

### Phase 14: LinkedIn Cookie Chrome Extension

**Goal:** Ship a lightweight Chrome extension that lets clients (and admins) connect their LinkedIn account to Outsignal with one click — no DevTools required. Extension reads `li_at` + `JSESSIONID` cookies from linkedin.com, POSTs them to the sender session API, and confirms success. Includes auto-detection of cookie expiry (periodic check) with a badge notification prompting re-auth. Pairs with Phase 12's LinkedIn sender management page.
**Requirements**: TBD
**Depends on:** Phase 12 (sender management UI exists for pairing)
**Plans:** 3/3 plans complete

Plans:
- [x] TBD (run /gsd:plan-phase 14 to break down) (completed 2026-03-03)
