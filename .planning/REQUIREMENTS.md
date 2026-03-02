# Requirements: Outsignal Lead Engine

**Defined:** 2026-02-27
**Core Value:** Own the lead data pipeline end-to-end so we never pay for the same lead twice and can cancel the $300+/month Clay subscription.

## v1.1 Requirements

Requirements for v1.1 Outbound Pipeline milestone. Each maps to roadmap phases.

### Leads Agent

- [x] **LEAD-01**: Admin can search people and companies from Cmd+J dashboard chat
- [x] **LEAD-02**: Admin can create, view, and manage target lists from dashboard chat
- [x] **LEAD-03**: Admin can score leads (ICP qualification) from dashboard chat
- [x] **LEAD-04**: Admin can export verified leads to EmailBison from dashboard chat
- [x] **LEAD-05**: Leads Agent shares operations layer with MCP tools (no logic divergence). Scope: search, list CRUD, list scoring. Excluded: workspace-level batch scoring and campaign management in MCP export (deferred to Phase 8 campaign entity).
- [x] **LEAD-06**: All Leads Agent operations logged to AgentRun audit trail

### Campaign Entity

- [x] **CAMP-01**: Campaign model exists as first-class entity with status lifecycle (draft → internal_review → pending_approval → approved → deployed → active → paused → completed)
- [x] **CAMP-02**: Campaign owns a TargetList (leads) and stores email + LinkedIn sequences (content)
- [x] **CAMP-03**: Admin can create campaigns from Cmd+J chat, linking a TargetList and setting channels (email, LinkedIn, or both)
- [x] **CAMP-04**: Campaign has separate approval fields for leads and content (approved/feedback/timestamp for each)
- [x] **CAMP-05**: Campaign CRUD API routes enforce workspace ownership

### Writer Agent

- [x] **WRITER-01**: Writer agent generates multi-step email sequences with multiple angles for A/B testing, stored on Campaign.emailSequence
- [x] **WRITER-02**: Writer agent generates LinkedIn connection request + follow-up messages, stored on Campaign.linkedinSequence
- [x] **WRITER-03**: Writer interaction is conversational — admin reviews drafts via Cmd+J, gives feedback, writer iterates
- [x] **WRITER-04**: Writer follows style rules: no em dashes, no AI/robotic tone, natural simple language (high school reading level), clear offering, avoid spam trigger words
- [x] **WRITER-05**: Writer ingests knowledge base best practices (46 docs) for email + LinkedIn copywriting
- [x] **WRITER-06**: On reply webhook (LEAD_REPLIED, LEAD_INTERESTED), writer generates a suggested response using conversation history, workspace context, and knowledge base — included in Slack notification
- [x] **WRITER-07**: Admin can refine reply suggestions via Cmd+J ("draft a response to John's reply", "make it more casual") — conversational iteration
- [x] **WRITER-08**: Knowledge base uses vector embeddings (pgvector on Neon) for semantic search — replaces keyword matching; all 46+ docs re-embedded on migration
- [x] **WRITER-09**: searchKnowledgeBase is a shared tool available to all agents (writer, leads, research, campaign) — not writer-only

### Portal Review

- [x] **PORTAL-01**: Client sees campaigns tab in portal with pending notification badges
- [x] **PORTAL-02**: Campaign detail shows lead sample (top N by ICP score) with key fields (name, title, company, location, LinkedIn)
- [x] **PORTAL-03**: Client can approve leads or request changes with feedback text
- [x] **PORTAL-04**: Campaign detail shows content preview — email sequence steps (subject + body) and LinkedIn messages
- [x] **PORTAL-05**: Client can approve content or request changes with feedback text
- [x] **PORTAL-06**: Lead approval and content approval are independent — one does not affect the other
- [x] **PORTAL-07**: Portal endpoints enforce workspace ownership via session (workspace A cannot access workspace B)

### Campaign Deploy

- [x] **DEPLOY-01**: EmailBison campaign API capabilities discovered via spike (create, assign, sequence steps)
- [ ] **DEPLOY-02**: On dual approval (leads + content both approved), auto-deploy triggers without admin intervention
- [ ] **DEPLOY-03**: System creates EmailBison campaign with sequence steps from approved email content
- [ ] **DEPLOY-04**: System pushes verified leads to EmailBison workspace (manual campaign assignment in EB UI until API endpoint available)
- [ ] **DEPLOY-05**: System queues LinkedIn messages via LinkedIn sequencer worker on Railway
- [ ] **DEPLOY-06**: Deploy is fire-and-forget with CampaignDeploy record tracking status (pending → running → complete / failed)
- [ ] **DEPLOY-07**: Deploy handles email-only, LinkedIn-only, or both channels depending on Campaign.channels

### Email ↔ LinkedIn Sequencing

- [ ] **SEQ-01**: EMAIL_SENT webhook triggers LinkedIn actions via CampaignSequenceRule — configurable delay between email send and LinkedIn action (e.g., "24h after Email 1, send connection request")
- [ ] **SEQ-02**: CampaignSequenceRule maps email steps to LinkedIn actions with triggerEvent, triggerStepRef, actionType, messageTemplate, and delayMinutes
- [ ] **SEQ-03**: Connection accept detection polls periodically — when accepted, next LinkedIn sequence step auto-queues (e.g., follow-up message)
- [ ] **SEQ-04**: LinkedIn message templates can reference email step context — adapting content based on which email the lead received
- [ ] **SEQ-05**: Sender session refresh runs on daily cron — proactively re-authenticates sessions older than 6 days to prevent expiry failures

### LinkedIn Voyager API

- [x] **VOYAGER-01**: All LinkedIn actions (connect, message, profile_view, check_connection) execute via HTTP Voyager API calls instead of browser automation
- [x] **VOYAGER-02**: VoyagerClient authenticates using li_at + JSESSIONID cookies with correct CSRF token derivation
- [x] **VOYAGER-03**: All Voyager API requests route through sender's ISP residential proxy via SOCKS5
- [x] **VOYAGER-04**: VoyagerClient handles error responses (429 rate limit, 403 auth expired, 999 IP blocked, checkpoint redirect) with appropriate sender health status updates
- [x] **VOYAGER-05**: Cookie extraction from agent-browser session persists li_at + JSESSIONID to Sender.sessionData via existing API

### Notifications

- [x] **NOTIF-01**: Admin receives Slack notification when client approves or rejects (leads or content)
- [x] **NOTIF-02**: Admin receives email notification when client approves or rejects (leads or content)
- [ ] **NOTIF-03**: Admin receives notification when deploy completes or fails

### Dashboard & Admin UX

- [ ] **DASH-01**: Dashboard home shows KPI cards with email stats (sent, replies, bounces), LinkedIn stats (connections, messages, pending), pipeline status (contacted, interested, meetings), and health indicators (sender status, campaign active/paused, inboxes connected vs disconnected)
- [ ] **DASH-02**: Dashboard has a client/campaign dropdown filter that controls ALL views (KPIs, charts, alerts) — "All Campaigns" plus per-client options
- [ ] **DASH-03**: Dashboard shows line charts for reply volume, sent/bounce trends from WebhookEvent data over time, with configurable time range (default 7 days)
- [ ] **DASH-04**: Critical alerts section below KPIs shows flagged senders, failed agent runs, and disconnected inboxes — no activity feed noise
- [ ] **DASH-05**: Person detail page at /people/[id] with tabbed layout — header with name/email/company/title, overview timeline, email history, LinkedIn activity, enrichment data, and workspaces tabs
- [ ] **DASH-06**: Person overview tab shows unified chronological timeline with color-coded icons per event type (emails, LinkedIn actions, enrichment) — view-only, no inline actions
- [x] **DASH-07**: Agent run monitoring page with compact Datadog-style table — summary rows expand into inline accordion showing full run details (input, output, steps, errors), filterable by agent type/status/workspace
- [ ] **DASH-08**: LinkedIn action queue viewer with queue status focus — pending/scheduled/completed/failed counts, next actions, sender assignment, execution timing, filterable by status/action type/workspace/sender
- [ ] **DASH-09**: LinkedIn sender management page with card grid layout — each sender card shows name, email, proxy URL, daily limits, status badge (active/paused/flagged), with pause/delete actions accessible from the card
- [ ] **DASH-10**: Sender add/edit via modal dialog form — all sender fields (name, email, proxy URL, daily limits, LinkedIn profile URL, tier), consistent with proposal management pattern
- [ ] **DASH-11**: Webhook event log viewer with search box for free text (email, subject) plus quick-filter preset chips ("Errors only", "Replies only", "Last 24h") that combine
- [x] **DASH-12**: Sidebar navigation includes all new Phase 12 pages organized into logical groups with visual separators
- [x] **DASH-13**: Proposal and onboarding pages support edit and delete via modal dialogs, consistent with sender management modal pattern
- [x] **DASH-14**: Document upload triggers auto-parse — upload content (paste from PDF/Google Doc) and system extracts fields to pre-fill proposal/onboarding form for user review before saving

### Smart Sender Health

- [x] **HEALTH-01**: Daily cron detects unhealthy senders — bounce rate >5% (24h window, min 10 sends), CAPTCHA, LinkedIn restriction, session expired
- [x] **HEALTH-02**: SenderHealthEvent audit trail records every health state change with status, reason, detail, and timestamp
- [x] **HEALTH-03**: Flagged sender auto-removed from campaign rotation; campaign continues running with remaining healthy senders
- [x] **HEALTH-04**: Pending LinkedIn actions auto-reassign to healthy sender in same workspace (least-loaded with budget check)
- [x] **HEALTH-05**: If workspace has only one sender and it's flagged, all active campaigns pause and urgent critical alert fires
- [x] **HEALTH-06**: Soft flags (bounce rate) auto-recover after 48h cooldown when rate normalizes; hard flags (CAPTCHA, restriction, session expired) require manual admin reactivation
- [x] **HEALTH-07**: Critical alerts (CAPTCHA, restriction, session expired, last sender down) fire Slack + email notification immediately
- [x] **HEALTH-08**: Warning alerts (bounce rate) batched into daily health digest — Slack only
- [x] **HEALTH-09**: Sender cards enhanced with expandable health history panel, sparkline trends, health event log, and summary metrics
- [x] **HEALTH-10**: Admin reactivate button for hard-flagged senders (blocked, session_expired) with POST /api/senders/[id]/reactivate endpoint
- [x] **HEALTH-11**: Dashboard sender health KPI card with healthy/total count and link to /senders page

## Future Requirements

Deferred to later milestones. Tracked but not in current roadmap.

### v1.2: Learning Loop + Agent Pipeline

- **LEARN-01**: Track response data per campaign (open rates, reply rates, interested rates per content variant)
- **LEARN-02**: A/B testing framework for multiple content angles per campaign
- **LEARN-03**: Feed results back to writer agent (what CTAs, subject lines, lead magnets work for which ICP)
- **PIPELINE-01**: Auto-trigger onboarding → research → writer → lead pipeline on new client
- **PIPELINE-02**: Research agent ingests onboarding doc + scans website/case studies automatically

### v1.3: Unified Inbox

- **INBOX-01**: Single inbox for email + LinkedIn replies per workspace
- **INBOX-02**: Thread view combining channels
- **INBOX-03**: Reply directly from Outsignal dashboard (proxy through EmailBison API + LinkedIn sequencer)

### v1.4: Intent Signals + Social Listening

- **SIGNAL-01**: RB2B, Warmly, Vector, Trigify integrations
- **SIGNAL-02**: Real-time buying signals
- **SIGNAL-03**: Auto-prioritize leads with active intent

### Future: Payment Integration

- **PAY-01**: Stripe recurring billing
- **PAY-02**: Bank transfer monitoring (Monzo API)
- **PAY-03**: Payment → auto-trigger onboarding

## Out of Scope (v1.1)

| Feature | Reason |
|---------|--------|
| Per-lead approve/reject in portal | Binary list-level approval only — per-lead is a scope trap |
| Enrichment from dashboard chat | Costs money per API call — keep as CLI-only to prevent accidental spend |
| Real-time intent signals | High complexity, future milestone (v1.4) |
| LinkedIn sequencer | Separate workstream, in progress on main branch |
| Unified inbox | Future milestone (v1.3) — clients use EmailBison + LinkedIn directly |
| Payment integration | Manual for now — future milestone |
| Per-client onboarding automation | Manual CLI trigger for now — v1.2 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| LEAD-01 | Phase 7 | Complete |
| LEAD-02 | Phase 7 | Complete |
| LEAD-03 | Phase 7 | Complete |
| LEAD-04 | Phase 7.1 | Complete |
| LEAD-05 | Phase 7.1 | Complete |
| LEAD-06 | Phase 7 | Complete |
| DEPLOY-01 | Phase 7 | Complete |
| CAMP-01 | Phase 8 | Complete |
| CAMP-02 | Phase 8 | Complete |
| CAMP-03 | Phase 8 | Complete |
| CAMP-04 | Phase 8 | Complete |
| CAMP-05 | Phase 8 | Complete |
| WRITER-01 | Phase 8 | Complete |
| WRITER-02 | Phase 8 | Complete |
| WRITER-03 | Phase 8 | Complete |
| WRITER-04 | Phase 8 | Complete |
| WRITER-05 | Phase 8 | Complete |
| WRITER-06 | Phase 8 | Complete |
| WRITER-07 | Phase 8 | Complete |
| WRITER-08 | Phase 8 | Complete |
| WRITER-09 | Phase 8 | Complete |
| PORTAL-01 | Phase 9 | Complete |
| PORTAL-02 | Phase 9 | Complete |
| PORTAL-03 | Phase 9 | Complete |
| PORTAL-04 | Phase 9 | Complete |
| PORTAL-05 | Phase 9 | Complete |
| PORTAL-06 | Phase 9 | Complete |
| PORTAL-07 | Phase 9 | Complete |
| NOTIF-01 | Phase 9 | Complete |
| NOTIF-02 | Phase 9 | Complete |
| DEPLOY-02 | Phase 10 | Pending |
| DEPLOY-03 | Phase 10 | Pending |
| DEPLOY-04 | Phase 10 | Pending |
| DEPLOY-05 | Phase 10 | Pending |
| DEPLOY-06 | Phase 10 | Pending |
| DEPLOY-07 | Phase 10 | Pending |
| NOTIF-03 | Phase 10 | Pending |
| SEQ-01 | Phase 10 | Pending |
| SEQ-02 | Phase 10 | Pending |
| SEQ-03 | Phase 10 | Pending |
| SEQ-04 | Phase 10 | Pending |
| SEQ-05 | Phase 10 | Pending |

| VOYAGER-01 | Phase 11 | Complete |
| VOYAGER-02 | Phase 11 | Complete |
| VOYAGER-03 | Phase 11 | Complete |
| VOYAGER-04 | Phase 11 | Complete |
| VOYAGER-05 | Phase 11 | Complete |
| DASH-01 | Phase 12 | Pending |
| DASH-02 | Phase 12 | Pending |
| DASH-03 | Phase 12 | Pending |
| DASH-04 | Phase 12 | Pending |
| DASH-05 | Phase 12 | Pending |
| DASH-06 | Phase 12 | Pending |
| DASH-07 | Phase 12 | Complete |
| DASH-08 | Phase 12 | Pending |
| DASH-09 | Phase 12 | Pending |
| DASH-10 | Phase 12 | Pending |
| DASH-11 | Phase 12 | Pending |
| DASH-12 | Phase 12 | Complete |
| DASH-13 | Phase 12 | Complete |
| DASH-14 | Phase 12 | Complete |
| HEALTH-01 | Phase 13 | Complete |
| HEALTH-02 | Phase 13 | Complete |
| HEALTH-03 | Phase 13 | Complete |
| HEALTH-04 | Phase 13 | Complete |
| HEALTH-05 | Phase 13 | Complete |
| HEALTH-06 | Phase 13 | Complete |
| HEALTH-07 | Phase 13 | Complete |
| HEALTH-08 | Phase 13 | Complete |
| HEALTH-09 | Phase 13 | Complete |
| HEALTH-10 | Phase 13 | Complete |
| HEALTH-11 | Phase 13 | Complete |

**Coverage:**
- v1.1 requirements: 73 total (37 complete, 36 pending)
- Mapped to phases: 73
- Unmapped: 0

---
*Requirements defined: 2026-02-27*
*Last updated: 2026-03-02 — Added HEALTH-01 to HEALTH-11 (Smart Sender Health) to Phase 13*
