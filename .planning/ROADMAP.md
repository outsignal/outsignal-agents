# Roadmap: Outsignal Lead Engine

## Milestones

- ✅ **v1.0 Lead Engine** — Phases 1-6 (shipped 2026-02-27) — [archive](milestones/v1.0-ROADMAP.md)
- ✅ **v1.1 Outbound Pipeline** — Phases 7-14 (shipped 2026-03-03) — [archive](milestones/v1.1-ROADMAP.md)
- ✅ **v2.0 Lead Discovery & Intelligence** — Phases 15-22 (shipped 2026-03-04) — [archive](milestones/v2.0-ROADMAP.md)
- 🚧 **v3.0 Campaign Intelligence Hub** — Phases 23-28 (in progress)

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

### v3.0 Campaign Intelligence Hub (In Progress)

**Milestone Goal:** Close the feedback loop — automatically classify replies, rank campaign performance, benchmark across workspaces, generate AI-powered insights, and present actionable suggestions to the admin via an Intelligence Hub dashboard. The system does the analysis; the admin makes the decisions.

- [x] **Phase 23: Reply Storage & Classification** - Store every reply with full body text and automatically classify by intent, sentiment, and objection type
- [x] **Phase 24: Campaign Analytics Engine** - Pre-compute campaign performance metrics via cron and enable ranking, comparison, and per-step sequence analysis (completed 2026-03-09)
- [x] **Phase 25: Copy Performance Analysis** - Analyze subject lines and email body structural elements to surface what copy patterns drive the highest reply rates (completed 2026-03-10)
- [x] **Phase 26: Cross-Workspace Benchmarking & ICP Calibration** - Benchmark workspace performance against vertical averages and calibrate ICP scores against actual conversion outcomes (completed 2026-03-10)
- [ ] **Phase 27: AI Insights & Action Queue** - Generate weekly AI-powered insights per workspace and let admin approve, dismiss, or defer suggested optimizations
- [ ] **Phase 28: Intelligence Hub Dashboard** - Unified dashboard page displaying all intelligence data with campaign rankings, classification charts, benchmarks, insights, and ICP calibration

## Phase Details

### Phase 23: Reply Storage & Classification
**Goal**: Every reply that enters the system is persisted with full body text and automatically classified by intent, sentiment, and objection subtype — giving the admin visibility into what replies actually say and mean
**Depends on**: Nothing (first v3.0 phase)
**Requirements**: REPLY-01, REPLY-02, REPLY-03, REPLY-04, REPLY-05, REPLY-06
**Success Criteria** (what must be TRUE):
  1. Admin can navigate to a reply view and see every stored reply with full body text, sender email, subject line, timestamp, and linked campaign name
  2. Each reply automatically shows an intent label (interested, meeting_booked, objection, referral, not_now, unsubscribe, out_of_office, auto_reply, not_relevant) without any admin action
  3. Each reply automatically shows a sentiment score (positive, neutral, negative) alongside its intent classification
  4. Replies classified as "objection" additionally show an objection subtype (budget, timing, competitor, authority, need, trust)
  5. Admin can view classification breakdown charts showing intent distribution and sentiment distribution filtered per campaign and per workspace
**Plans:** 4/4 plans complete
Plans:
- [x] 23-01-PLAN.md — Reply model, classification types, classifyReply function, stripHtml utility
- [x] 23-02-PLAN.md — Wire reply persistence and classification into webhook handler and poll-replies cron, create retry cron
- [x] 23-03-PLAN.md — API routes for replies list, override, and stats aggregation
- [x] 23-04-PLAN.md — Admin replies page with filterable table, side panel, classification badges, and charts

### Phase 24: Campaign Analytics Engine
**Goal**: Campaign performance metrics are captured locally via daily snapshots and pre-computed into CachedMetrics, enabling the admin to rank campaigns, compare performance, and analyze which sequence steps generate the most replies
**Depends on**: Phase 23
**Requirements**: ANAL-01, ANAL-02, ANAL-03, ANAL-04
**Success Criteria** (what must be TRUE):
  1. Campaign metrics (sent, opened, replied, bounced, interested counts) are stored locally and update daily via cron without admin action
  2. Admin can view a ranked list of campaigns within a workspace sorted by reply rate, open rate, bounce rate, or interested rate
  3. Admin can see per-step sequence analytics for a campaign showing which email step (1st, 2nd, 3rd, etc.) generates the most replies
  4. Admin can compare aggregate metrics across campaigns grouped by copy strategy (creative-ideas, PVP, one-liner) to see which approach performs best
**Plans:** 3/3 plans complete
Plans:
- [x] 24-01-PLAN.md — CachedMetrics schema evolution, snapshot logic, strategy detection, cron endpoint
- [x] 24-02-PLAN.md — API routes for campaign rankings, per-step analytics, and strategy comparison
- [x] 24-03-PLAN.md — Admin analytics page with rankings table, expandable step charts, and strategy cards

### Phase 25: Copy Performance Analysis
**Goal**: The admin can see which subject lines and email body elements correlate with higher reply rates, filtered by workspace and vertical, so copy decisions are data-driven rather than gut-driven
**Depends on**: Phase 24
**Requirements**: COPY-01, COPY-02, COPY-03, COPY-04, COPY-05
**Success Criteria** (what must be TRUE):
  1. Admin can see a ranked list of subject lines across campaigns with their open rate and reply rate
  2. Each outbound email body is tagged with structural elements it contains (CTA type, problem statement, value proposition, case study, social proof, personalization)
  3. Admin can see correlation data showing which body elements drive higher reply rates globally (e.g., "emails with case studies get 2.1x more replies")
  4. Admin can filter copy analysis by workspace and vertical to see element effectiveness per industry
  5. Admin can view top-performing email templates with a breakdown of which structural elements they contain
**Plans:** 3/3 plans complete
Plans:
- [ ] 25-01-PLAN.md — Body element AI classification module and snapshot cron integration
- [ ] 25-02-PLAN.md — Copy analysis API routes (subject lines, correlations, top templates)
- [ ] 25-03-PLAN.md — Copy tab UI with subject line rankings, multiplier cards, and top templates

### Phase 26: Cross-Workspace Benchmarking & ICP Calibration
**Goal**: The admin can benchmark any workspace's performance against anonymized vertical averages and see whether ICP scores actually predict conversion, with recommended threshold adjustments and signal-type effectiveness data
**Depends on**: Phase 24
**Requirements**: BENCH-01, BENCH-02, BENCH-03, BENCH-04, BENCH-05
**Success Criteria** (what must be TRUE):
  1. Admin can view a workspace's reply rate, open rate, and interested rate against anonymized industry reference bands computed from all workspaces
  2. Admin can compare performance grouped by vertical, copy strategy, and time period in a single benchmarking view
  3. Admin can see a scatter/bucket chart correlating ICP scores assigned at send time with actual reply and conversion outcomes
  4. Admin can see recommended ICP threshold adjustments (e.g., "raise minimum from 60 to 72") with confidence indicators based on data volume
  5. Admin can see which signal types (funding, hiring, tech adoption, job changes, news) produce the best reply outcomes across signal campaigns
**Plans**: 2 plans
Plans:
- [ ] 26-01-PLAN.md — Industry benchmarks constants and API endpoints (reference bands, ICP calibration, signal effectiveness)
- [ ] 26-02-PLAN.md — Benchmarks tab UI (gauge components, ICP bucket chart, signal cards, analytics page integration)

### Phase 27: AI Insights & Action Queue
**Goal**: The system generates weekly AI-powered insights per workspace analyzing reply patterns, campaign performance, and cross-workspace comparisons — and the admin can approve, dismiss, or defer each suggested action through a structured queue
**Depends on**: Phase 24, Phase 26
**Requirements**: INSIGHT-01, INSIGHT-02, INSIGHT-03, INSIGHT-04, INSIGHT-05, INSIGHT-06
**Success Criteria** (what must be TRUE):
  1. Weekly insight generation runs automatically per workspace and produces 3-5 actionable insight cards analyzing reply patterns, campaign performance, and cross-workspace comparisons
  2. Each insight card displays an observation, supporting evidence with specific numbers, a suggested action, and a confidence level
  3. Admin can approve, dismiss, or defer (snooze N days) each suggested action and the action queue reflects current state
  4. Approved actions execute the suggestion (pause campaign, update ICP threshold, flag for copy review) with audit trail
  5. Admin can see objection pattern clusters across campaigns (e.g., "42% mention budget, 28% mention timing") in the insights view
**Plans**: 2 plans
Plans:
- [ ] 26-01-PLAN.md — Industry benchmarks constants and API endpoints (reference bands, ICP calibration, signal effectiveness)
- [ ] 26-02-PLAN.md — Benchmarks tab UI (gauge components, ICP bucket chart, signal cards, analytics page integration)

### Phase 28: Intelligence Hub Dashboard
**Goal**: A dedicated Intelligence Hub page brings together all intelligence data — campaign rankings, reply classification breakdowns, cross-workspace benchmarks, ICP calibration, active insights, and the action queue — into one unified admin view with weekly digest notifications
**Depends on**: Phase 23, Phase 24, Phase 25, Phase 26, Phase 27
**Requirements**: HUB-01, HUB-02, HUB-03, HUB-04, HUB-05, HUB-06
**Success Criteria** (what must be TRUE):
  1. Admin can access /admin/intelligence and see a unified dashboard with all intelligence data loading from pre-computed sources
  2. Intelligence Hub displays a sortable campaign rankings table with reply rate, open rate, bounce rate, and interested rate columns
  3. Intelligence Hub displays reply classification breakdown charts showing intent distribution, sentiment distribution, and objection type distribution
  4. Intelligence Hub displays cross-workspace benchmarking comparison with visual reference bands showing where each workspace falls
  5. Intelligence Hub displays active insight cards with approve/dismiss/defer controls and an ICP calibration visualization showing score-vs-conversion correlation
**Plans**: 2 plans
Plans:
- [ ] 26-01-PLAN.md — Industry benchmarks constants and API endpoints (reference bands, ICP calibration, signal effectiveness)
- [ ] 26-02-PLAN.md — Benchmarks tab UI (gauge components, ICP bucket chart, signal cards, analytics page integration)

## Progress

**Execution Order:**
v3.0 phases: 23 → 24 → 25 (parallel with 26) → 27 → 28

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-6 | v1.0 | 22/22 | Complete | 2026-02-27 |
| 7-14 | v1.1 | 40/40 | Complete | 2026-03-03 |
| 15-22 | v2.0 | 26/26 | Complete | 2026-03-04 |
| 23. Reply Storage & Classification | v3.0 | Complete    | 2026-03-09 | 2026-03-09 |
| 24. Campaign Analytics Engine | 3/3 | Complete    | 2026-03-09 | - |
| 25. Copy Performance Analysis | 3/3 | Complete    | 2026-03-10 | - |
| 26. Cross-Workspace Benchmarking & ICP Calibration | 2/2 | Complete    | 2026-03-10 | - |
| 27. AI Insights & Action Queue | v3.0 | 0/TBD | Not started | - |
| 28. Intelligence Hub Dashboard | v3.0 | 0/TBD | Not started | - |
