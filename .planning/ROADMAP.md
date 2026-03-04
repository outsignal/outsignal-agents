# Roadmap: Outsignal Lead Engine

## Milestones

- ✅ **v1.0 Lead Engine** — Phases 1-6 (shipped 2026-02-27) — [archive](milestones/v1.0-ROADMAP.md)
- ✅ **v1.1 Outbound Pipeline** — Phases 7-14 (shipped 2026-03-03) — [archive](milestones/v1.1-ROADMAP.md)
- 🚧 **v2.0 Lead Discovery & Intelligence** — Phases 15-21 (in progress)

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

### 🚧 v2.0 Lead Discovery & Intelligence (In Progress)

**Milestone Goal:** Transform the Leads Agent from a local DB searcher into a full discovery engine that finds leads across millions of contacts, monitors signals for timing, and generates Creative Ideas copy that outperforms generic outreach.

- [ ] **Phase 15: Foundation** - Schema additions, discovery adapter interface, workspace config packages, per-workspace Apollo key architecture, quick fixes
- [ ] **Phase 16: Discovery Sources** - Apollo, Prospeo Search, AI Ark Search, Serper.dev, and Firecrawl directory adapters wired into discovery module
- [ ] **Phase 17: Leads Agent Discovery Upgrade** - discoverLeads/searchDirectory tools, dedup against staging table, ICP-to-source routing, plan approval flow, quota enforcement
- [ ] **Phase 18: Signal Monitoring Infrastructure** - Railway signal worker, PredictLeads integration (5 signal types), Serper social listening, SignalEvent ingestion, budget governor
- [ ] **Phase 19: Evergreen Signal Campaign Auto-Pipeline** - Signal campaign CRUD, full signal-to-deploy pipeline, human approval gate, daily caps, pause/resume, Slack notifications
- [ ] **Phase 20: Copy Strategy Framework** - Writer Agent multi-strategy support (Creative Ideas, PVP, one-liner, custom), per-client KB examples by strategy, groundedIn validation, full KB consultation
- [ ] **Phase 21: Signal Dashboard + CLI Chat** - /admin/signals live feed and breakdown, CLI orchestrator chat via scripts/cli-chat.ts

## Phase Details

### Phase 15: Foundation
**Goal**: The codebase has the schema, adapter interfaces, and workspace configuration model that every subsequent v2.0 phase depends on — no downstream phase is blocked
**Depends on**: Nothing (first v2.0 phase)
**Requirements**: FIX-01, FIX-02, DISC-06, DISC-09, DISC-10, CFG-01, CFG-02, CFG-03, CFG-04, CFG-05, CFG-06
**Success Criteria** (what must be TRUE):
  1. Research Agent can call searchKnowledgeBase and return results (FIX-01 verified in agent chat)
  2. Enrichment waterfall processes emails cheapest-first: FindyMail then Prospeo then AI Ark then LeadMagic (FIX-02 verified by order of provider calls in logs)
  3. DiscoveredPerson table exists in the database and accepts staged discovery records without touching the Person table
  4. Workspace admin screen shows campaign package and monthly lead quota, and the agent refuses signal campaign creation for non-signal-approved workspaces
  5. DiscoveryAdapter interface is defined and a new discovery source can be added by implementing one interface with no other changes
**Plans**: 4 plans
- [ ] 15-01-PLAN.md -- Quick fixes: Research Agent KB access (FIX-01) + enrichment waterfall reorder (FIX-02)
- [ ] 15-02-PLAN.md -- Schema foundation: DiscoveredPerson model, Workspace package columns, DiscoveryAdapter interface, quota helpers
- [ ] 15-03-PLAN.md -- Agent enforcement: Campaign Agent package checks, Orchestrator quota tools, package API endpoint
- [ ] 15-04-PLAN.md -- Admin UI: Global packages overview page, workspace settings Package & Quotas section

### Phase 16: Discovery Sources
**Goal**: The Leads Agent has access to five external discovery sources — Apollo, Prospeo Search, AI Ark Search, Serper.dev, and Firecrawl directory extraction — each returning structured DiscoveredPerson records
**Depends on**: Phase 15
**Requirements**: DISC-01, DISC-02, DISC-03, DISC-04, DISC-05
**Success Criteria** (what must be TRUE):
  1. Leads Agent can search Apollo People API by title, seniority, industry, location, and company size and receive paginated contact records
  2. Leads Agent can search Prospeo Search Person API with filters including funding stage and headcount and receive paginated contact records
  3. Leads Agent can search Serper.dev for Google web results, Maps results, and Reddit/Twitter mentions via natural language query
  4. Leads Agent can extract a structured contact list from a custom URL (association member page, directory) using Firecrawl /extract with a JSON schema
  5. All adapter calls write to DiscoveredPerson staging table, not directly to Person
**Plans**: TBD

### Phase 17: Leads Agent Discovery Upgrade
**Goal**: The Leads Agent operates as a full discovery engine — it classifies ICP type, selects appropriate sources, generates an approval plan, deduplicates against the local DB, respects workspace quotas, and promotes qualified leads through the existing enrichment waterfall
**Depends on**: Phase 16
**Requirements**: DISC-07, DISC-08, DISC-11, DISC-12, DISC-13
**Success Criteria** (what must be TRUE):
  1. When asked to find leads, the agent presents a discovery plan (sources, reasoning, estimated cost, estimated volume) and waits for admin approval before executing any external API calls
  2. Admin can modify the plan (add/remove sources, adjust filters) in chat before approving
  3. Discovered leads are checked against local Person DB by LinkedIn URL, email, and name+company before enrichment — duplicates are skipped
  4. Discovery plan response shows quota usage (e.g., "500 of 2,000 monthly leads used") before admin commits to the search
  5. Agent automatically routes enterprise B2B ICP to Apollo/Prospeo, niche/association ICP to Firecrawl directories, and local/SMB ICP to Serper Maps without requiring manual source selection
**Plans**: TBD

### Phase 18: Signal Monitoring Infrastructure
**Goal**: A Railway background worker polls PredictLeads every 4-6 hours for all active workspace domains, detects job changes, funding, hiring spikes, tech adoption, and news events, writes SignalEvents to the database, and enforces per-workspace budget caps before triggering any enrichment
**Depends on**: Phase 15
**Requirements**: SIG-01, SIG-02, SIG-03, SIG-04, SIG-05, SIG-06, SIG-07, SIG-08, SIG-09, SIG-10
**Success Criteria** (what must be TRUE):
  1. Railway signal worker runs on schedule and PredictLeads signals appear in the SignalEvent table for ICP-matching companies (verified by DB query after one cron cycle)
  2. Serper.dev social listening detects Reddit/Twitter competitor mentions and writes them as SignalEvents alongside PredictLeads signals
  3. When a workspace exceeds its daily signal processing budget cap, the worker stops spawning enrichment jobs for that workspace for the remainder of the day
  4. When two or more signals fire on the same company, that company is flagged as high-intent in the SignalEvent records
  5. Every SignalEvent record contains type, company, workspace, timestamp, and metadata sufficient to reconstruct what triggered it
**Plans**: TBD

### Phase 19: Evergreen Signal Campaign Auto-Pipeline
**Goal**: Admins can configure signal campaigns that automatically enrich and ICP-score leads when signals fire, add them to the campaign's target list, stage content for portal approval, and deploy on human approval — with full audit trail, daily caps, and instant pause/resume
**Depends on**: Phase 18
**Requirements**: PIPE-01, PIPE-02, PIPE-03, PIPE-04, PIPE-05, PIPE-06, PIPE-07, PIPE-08, PIPE-09
**Success Criteria** (what must be TRUE):
  1. Admin can create a signal campaign via chat specifying ICP criteria, signal types to monitor, and channel — and it becomes active without any manual code changes
  2. When a signal fires on a live campaign, matching leads are enriched, ICP scored, and appear in the campaign's target list without admin intervention
  3. No leads are deployed to EmailBison or LinkedIn from a signal campaign until a human has explicitly approved them through the portal approval flow
  4. Admin receives a Slack notification when leads are added to a signal campaign, and can pause or resume the campaign from the admin dashboard instantly
  5. Static campaigns (one-off list build) continue to operate exactly as before and are unaffected by signal campaign infrastructure
**Plans**: TBD

### Phase 20: Copy Strategy Framework
**Goal**: The Writer Agent supports multiple copy strategies (Creative Ideas, PVP, one-liner, custom) with admin/agent selection per campaign, per-client KB examples tagged by strategy, groundedIn validation for Creative Ideas, and full Knowledge Base consultation regardless of strategy
**Depends on**: Phase 15
**Requirements**: COPY-01, COPY-02, COPY-03, COPY-04, COPY-05, COPY-06, COPY-07, COPY-08, COPY-09, COPY-10, COPY-11, COPY-12
**Success Criteria** (what must be TRUE):
  1. Admin or agent can select a copy strategy per campaign (Creative Ideas, PVP, one-liner, custom) and the Writer generates copy following that strategy's framework
  2. Creative Ideas strategy produces exactly 3 ideas per prospect, each citing a specific client offering in the groundedIn field, and refuses ideas it cannot trace to a real service
  3. Per-client copy examples are stored in KB with strategy-specific tags (creative-ideas-{slug}, pvp-{slug}) and the agent retrieves the right examples for the selected strategy
  4. Writer consults the full Knowledge Base (46+ docs) for best practices regardless of which strategy is selected — subject lines, follow-up patterns, personalization techniques
  5. Signal-triggered copy never mentions the triggering signal to the recipient — the copy leads with value, not "I saw you raised a round"
**Plans**: TBD

### Phase 21: Signal Dashboard + CLI Chat
**Goal**: Admins have a signal intelligence dashboard showing live signal feed, per-client breakdown, cost tracking, and signal type distribution — and can run the full orchestrator as an interactive CLI chat from the terminal for rapid campaign work without opening the browser
**Depends on**: Phase 18 (signal dashboard), Phase 15 (CLI — depends only on existing orchestrator)
**Requirements**: DASH-01, DASH-02, DASH-03, DASH-04, DASH-05, CLI-01, CLI-02, CLI-03
**Success Criteria** (what must be TRUE):
  1. Admin can view /admin/signals and see a live feed of recent signals across all clients, refreshing without manual reload
  2. Dashboard shows per-client breakdown (signals fired, leads generated, cost) and signal type distribution (funding, job changes, hiring, tech, news, social)
  3. Dashboard shows daily and weekly cost for signal monitoring per workspace so admin can track spend
  4. Admin can run `npm run chat` from the terminal and have a multi-turn conversation with the orchestrator that supports all existing agent capabilities (Research, Leads, Writer, Campaign)
  5. CLI session conversation history persists across multiple turns within a session and each session is recorded as an AgentRun in the database
**Plans**: TBD

## Progress

**Execution Order:**
v2.0 phases: 15 → 16 → 17 → 18 → 19 → 20 (parallel with 18-19) → 21

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-6 | v1.0 | 22/22 | Complete | 2026-02-27 |
| 7-14 | v1.1 | 40/40 | Complete | 2026-03-03 |
| 15. Foundation | 1/4 | In Progress|  | - |
| 16. Discovery Sources | v2.0 | 0/TBD | Not started | - |
| 17. Leads Agent Discovery Upgrade | v2.0 | 0/TBD | Not started | - |
| 18. Signal Monitoring Infrastructure | v2.0 | 0/TBD | Not started | - |
| 19. Evergreen Signal Campaign Auto-Pipeline | v2.0 | 0/TBD | Not started | - |
| 20. Creative Ideas Copy Framework | v2.0 | 0/TBD | Not started | - |
| 21. Signal Dashboard + CLI Chat | v2.0 | 0/TBD | Not started | - |
