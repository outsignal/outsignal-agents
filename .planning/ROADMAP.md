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
- [ ] **Phase 8: Campaign Entity + Writer Integration** - Campaign model owns leads + content; writer agent generates sequences; admin promotes to client review via Cmd+J
- [ ] **Phase 9: Client Portal Campaign Approval** - Client approves leads and content separately; notifications fire on action; dual approval triggers deploy
- [ ] **Phase 10: Auto-Deploy on Approval** - On dual approval, auto-deploy to EmailBison + LinkedIn; fire-and-forget with status tracking

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
  1. All MCP tools in `src/mcp/leads-agent/tools/` call `operations.ts` functions instead of inline Prisma queries — zero divergent implementations
  2. Export via agent returns an actionable error when workspace exists but apiToken is missing (not "Workspace not found")
  3. Orchestrator's `delegateToLeads` schema includes `conversationContext` and passes it to `runLeadsAgent` — multi-turn "narrow to London" follow-ups refine previous results
  4. `scoreList` in operations.ts has a code-level confirm gate (returns count without scoring when `confirm: false`) matching the MCP equivalent
**Plans**: 2 plans
Plans:
- [ ] 07.1-01-PLAN.md — Surgical fixes: apiToken error, conversationContext wiring, scoreList confirm gate
- [ ] 07.1-02-PLAN.md — MCP tools migration to operations layer

### Phase 8: Campaign Entity + Writer Integration
**Goal**: Campaign becomes a first-class entity in Outsignal that owns leads (TargetList) AND content (email + LinkedIn sequences). Admin creates campaigns, generates content via writer agent, reviews and iterates via Cmd+J, and promotes to client review — all through natural language chat. Writer agent also generates suggested responses to incoming replies, surfaced in Slack notifications and available for refinement via Cmd+J.
**Depends on**: Phase 7 (Leads Agent tools exist), Writer agent (exists, needs wiring to campaign context)
**Requirements**: CAMP-01, CAMP-02, CAMP-03, CAMP-04, CAMP-05, WRITER-01, WRITER-02, WRITER-03, WRITER-04, WRITER-05, WRITER-06, WRITER-07
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
**Plans**: TBD

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

### Phase 10: Auto-Deploy on Approval
**Goal**: When client approves both leads and content, the system auto-deploys to EmailBison (campaign + sequence steps + leads) and LinkedIn sequencer (connection requests + follow-ups) as a fire-and-forget background job, with deploy status visible to admin.
**Depends on**: Phase 9 (approval flow exists)
**Requirements**: DEPLOY-02, DEPLOY-03, DEPLOY-04, DEPLOY-05, DEPLOY-06, DEPLOY-07
**Success Criteria** (what must be TRUE):
  1. On dual approval, deploy triggers automatically (no admin intervention) and returns immediately while running in background
  2. EmailBison shows a new campaign with sequence steps matching the approved email content after deploy completes
  3. Verified leads from the approved TargetList are pushed to the EmailBison workspace (manual campaign assignment in EB UI until API endpoint is available)
  4. LinkedIn messages from Campaign.linkedinSequence are queued via the LinkedIn sequencer worker on Railway
  5. Deploy handles email-only, LinkedIn-only, or both channels depending on Campaign.channels
  6. CampaignDeploy record tracks status (pending → running → complete / failed), lead count, step count, error message — visible in admin campaign detail
  7. Admin receives notification when deploy completes or fails
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
| 7.1 Leads Agent Integration Fixes | 2/2 | Complete   | 2026-02-27 | - |
| 8. Campaign Entity + Writer Integration | v1.1 | 0/TBD | Not started | - |
| 9. Client Portal Campaign Approval | v1.1 | 0/TBD | Not started | - |
| 10. Auto-Deploy on Approval | v1.1 | 0/TBD | Not started | - |
