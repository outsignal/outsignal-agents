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

**Milestone Goal:** Complete the outbound pipeline loop — admin builds lists via natural language chat, client reviews and approves in a portal, system auto-deploys campaigns to EmailBison on approval.

- [ ] **Phase 7: Leads Agent Dashboard** - Natural language access to search, list build, score, and export via Cmd+J chat
- [ ] **Phase 8: Schema + Admin Promotion** - TargetList status lifecycle + admin promote UI unlocks portal
- [ ] **Phase 9: Client Portal Review + Approvals** - Client approves/rejects leads and copy; notifications fire on action
- [ ] **Phase 10: Campaign Deploy Service** - EmailBison campaign creation, sequence steps, lead assignment, fire-and-forget execution

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
**Plans**: TBD

### Phase 8: Schema + Admin Promotion
**Goal**: TargetList gains a full status lifecycle and admins can promote lists and drafts to review state, unblocking all portal and deploy features
**Depends on**: Phase 7
**Requirements**: SCHEMA-01, SCHEMA-02
**Success Criteria** (what must be TRUE):
  1. TargetList records have a status field that accepts building, pending_review, approved, rejected, and deployed values
  2. Admin opens a list detail page and sees a "Send to Client Review" button that transitions the list from building to pending_review
  3. Admin opens a draft detail page and sees a "Send to Client Review" button that transitions drafts from draft to review status
  4. PortalApproval and CampaignDeploy models exist in the database and accept records without errors
**Plans**: TBD

### Phase 9: Client Portal Review + Approvals
**Goal**: Clients can log into the portal, preview their lead list and copy batch, and approve or reject each — triggering an admin Slack and email notification immediately
**Depends on**: Phase 8
**Requirements**: PORTAL-01, PORTAL-02, PORTAL-03, PORTAL-04, PORTAL-05, NOTIF-01, NOTIF-02
**Success Criteria** (what must be TRUE):
  1. Client opens /portal and sees a "Review Leads" card when their list is in pending_review state, showing the top 10 leads by ICP score with enrichment stats
  2. Client clicks "Approve List" and the list status transitions to approved; clicking "Reject List" transitions it to rejected with optional feedback
  3. Client opens /portal and sees a "Review Copy" card when drafts are in review state, showing email drafts grouped by campaign step with subject and body preview
  4. Client clicks "Approve Copy" and all review-state drafts transition to approved; rejection records feedback
  5. Admin receives a Slack message in the workspace channel and an email within 30 seconds of any client approval or rejection
  6. A client from workspace A cannot view or act on leads or copy belonging to workspace B
**Plans**: TBD

### Phase 10: Campaign Deploy Service
**Goal**: Approved leads and copy are deployed to EmailBison as a campaign with sequence steps in a fire-and-forget background job, with deploy status visible to admin and the portal showing deployment state
**Depends on**: Phase 9
**Requirements**: DEPLOY-02, DEPLOY-03, DEPLOY-04, DEPLOY-05, DEPLOY-06
**Success Criteria** (what must be TRUE):
  1. Admin triggers deploy on an approved list and receives an immediate response (under 2 seconds) while deploy runs in the background
  2. EmailBison shows a new campaign (or updated existing campaign) with sequence steps matching the approved copy drafts after deploy completes
  3. Verified leads from the approved TargetList are assigned to the campaign (or a clear admin prompt is shown if the EmailBison API has no assignment endpoint)
  4. Deploy works when only leads are approved, only copy is approved, or both are approved — three separate execution paths
  5. CampaignDeploy record in the database shows status (pending, running, complete, failed), lead count, step count, and any error message — visible in admin list detail page
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
| 7. Leads Agent Dashboard | 1/4 | In Progress|  | - |
| 8. Schema + Admin Promotion | v1.1 | 0/TBD | Not started | - |
| 9. Client Portal Review + Approvals | v1.1 | 0/TBD | Not started | - |
| 10. Campaign Deploy Service | v1.1 | 0/TBD | Not started | - |
