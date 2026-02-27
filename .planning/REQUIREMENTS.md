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
- [x] **LEAD-05**: Leads Agent shares operations layer with MCP tools (no logic divergence)
- [x] **LEAD-06**: All Leads Agent operations logged to AgentRun audit trail

### Campaign Entity

- [ ] **CAMP-01**: Campaign model exists as first-class entity with status lifecycle (draft → internal_review → pending_approval → approved → deployed → active → paused → completed)
- [ ] **CAMP-02**: Campaign owns a TargetList (leads) and stores email + LinkedIn sequences (content)
- [ ] **CAMP-03**: Admin can create campaigns from Cmd+J chat, linking a TargetList and setting channels (email, LinkedIn, or both)
- [ ] **CAMP-04**: Campaign has separate approval fields for leads and content (approved/feedback/timestamp for each)
- [ ] **CAMP-05**: Campaign CRUD API routes enforce workspace ownership

### Writer Agent

- [ ] **WRITER-01**: Writer agent generates multi-step email sequences with multiple angles for A/B testing, stored on Campaign.emailSequence
- [ ] **WRITER-02**: Writer agent generates LinkedIn connection request + follow-up messages, stored on Campaign.linkedinSequence
- [ ] **WRITER-03**: Writer interaction is conversational — admin reviews drafts via Cmd+J, gives feedback, writer iterates
- [ ] **WRITER-04**: Writer follows style rules: no em dashes, no AI/robotic tone, natural simple language (high school reading level), clear offering, avoid spam trigger words
- [ ] **WRITER-05**: Writer ingests knowledge base best practices (46 docs) for email + LinkedIn copywriting
- [ ] **WRITER-06**: On reply webhook (LEAD_REPLIED, LEAD_INTERESTED), writer generates a suggested response using conversation history, workspace context, and knowledge base — included in Slack notification
- [ ] **WRITER-07**: Admin can refine reply suggestions via Cmd+J ("draft a response to John's reply", "make it more casual") — conversational iteration

### Portal Review

- [ ] **PORTAL-01**: Client sees campaigns tab in portal with pending notification badges
- [ ] **PORTAL-02**: Campaign detail shows lead sample (top N by ICP score) with key fields (name, title, company, location, LinkedIn)
- [ ] **PORTAL-03**: Client can approve leads or request changes with feedback text
- [ ] **PORTAL-04**: Campaign detail shows content preview — email sequence steps (subject + body) and LinkedIn messages
- [ ] **PORTAL-05**: Client can approve content or request changes with feedback text
- [ ] **PORTAL-06**: Lead approval and content approval are independent — one does not affect the other
- [ ] **PORTAL-07**: Portal endpoints enforce workspace ownership via session (workspace A cannot access workspace B)

### Campaign Deploy

- [x] **DEPLOY-01**: EmailBison campaign API capabilities discovered via spike (create, assign, sequence steps)
- [ ] **DEPLOY-02**: On dual approval (leads + content both approved), auto-deploy triggers without admin intervention
- [ ] **DEPLOY-03**: System creates EmailBison campaign with sequence steps from approved email content
- [ ] **DEPLOY-04**: System pushes verified leads to EmailBison workspace (manual campaign assignment in EB UI until API endpoint available)
- [ ] **DEPLOY-05**: System queues LinkedIn messages via LinkedIn sequencer worker on Railway
- [ ] **DEPLOY-06**: Deploy is fire-and-forget with CampaignDeploy record tracking status (pending → running → complete / failed)
- [ ] **DEPLOY-07**: Deploy handles email-only, LinkedIn-only, or both channels depending on Campaign.channels

### Notifications

- [ ] **NOTIF-01**: Admin receives Slack notification when client approves or rejects (leads or content)
- [ ] **NOTIF-02**: Admin receives email notification when client approves or rejects (leads or content)
- [ ] **NOTIF-03**: Admin receives notification when deploy completes or fails

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
| CAMP-01 | Phase 8 | Pending |
| CAMP-02 | Phase 8 | Pending |
| CAMP-03 | Phase 8 | Pending |
| CAMP-04 | Phase 8 | Pending |
| CAMP-05 | Phase 8 | Pending |
| WRITER-01 | Phase 8 | Pending |
| WRITER-02 | Phase 8 | Pending |
| WRITER-03 | Phase 8 | Pending |
| WRITER-04 | Phase 8 | Pending |
| WRITER-05 | Phase 8 | Pending |
| WRITER-06 | Phase 8 | Pending |
| WRITER-07 | Phase 8 | Pending |
| PORTAL-01 | Phase 9 | Pending |
| PORTAL-02 | Phase 9 | Pending |
| PORTAL-03 | Phase 9 | Pending |
| PORTAL-04 | Phase 9 | Pending |
| PORTAL-05 | Phase 9 | Pending |
| PORTAL-06 | Phase 9 | Pending |
| PORTAL-07 | Phase 9 | Pending |
| NOTIF-01 | Phase 9 | Pending |
| NOTIF-02 | Phase 9 | Pending |
| DEPLOY-02 | Phase 10 | Pending |
| DEPLOY-03 | Phase 10 | Pending |
| DEPLOY-04 | Phase 10 | Pending |
| DEPLOY-05 | Phase 10 | Pending |
| DEPLOY-06 | Phase 10 | Pending |
| DEPLOY-07 | Phase 10 | Pending |
| NOTIF-03 | Phase 10 | Pending |

**Coverage:**
- v1.1 requirements: 36 total (7 complete, 29 pending)
- Mapped to phases: 36
- Unmapped: 0

---
*Requirements defined: 2026-02-27*
*Last updated: 2026-02-27 — Revised Phases 8-10 per outbound vision alignment*
