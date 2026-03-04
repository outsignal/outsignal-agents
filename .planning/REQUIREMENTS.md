# Requirements: Outsignal Lead Engine v2.0

**Defined:** 2026-03-04
**Core Value:** Own the lead data pipeline end-to-end so we never pay for the same lead twice and can cancel the $300+/month Clay subscription.

## v2.0 Requirements

Requirements for Lead Discovery & Intelligence milestone. Each maps to roadmap phases.

### Discovery

- [x] **DISC-01**: Leads Agent can search Apollo.io People API (275M contacts, free) by title, seniority, industry, location, company size and return paginated results
- [x] **DISC-02**: Leads Agent can search Prospeo Search Person API with 20+ filters (title, seniority, department, location, company industry, headcount, funding stage)
- [x] **DISC-03**: Leads Agent can search AI Ark People Search API by role, seniority, department, location, keywords
- [x] **DISC-04**: Leads Agent can search Serper.dev for Google web results, Maps results, and social mentions (Reddit/Twitter) via natural language queries
- [x] **DISC-05**: Leads Agent can scrape custom directories via Firecrawl /extract endpoint with structured JSON schema (association member lists, government databases, etc.)
- [x] **DISC-06**: Discovery results are written to a DiscoveredPerson staging table (not directly to Person) for dedup before promotion
- [x] **DISC-07**: Agent deduplicates discovered leads against local Person DB (by LinkedIn URL, email, or name+company match) before enrichment
- [x] **DISC-08**: Agent automatically selects best discovery sources based on ICP type (enterprise B2B → Apollo/Prospeo, niche → Serper/Firecrawl directories, local/SMB → Serper Maps)
- [x] **DISC-09**: Per-workspace API keys for Apollo.io (ToS requirement — no shared keys across workspaces)
- [x] **DISC-10**: Discovery adapter pattern (DiscoveryAdapter interface) so new sources can be added without restructuring
- [x] **DISC-11**: Agent generates a discovery plan (sources selected, reasoning, estimated cost, estimated lead volume per source) and presents for admin approval before executing searches
- [x] **DISC-12**: Admin can adjust the discovery plan (add/remove sources, change filters) before approving execution
- [x] **DISC-13**: Discovery plan shows how campaign lead volume tracks against workspace monthly lead quota (e.g., "500 of 2,000 monthly leads used")

### Signal Monitoring

- [x] **SIG-01**: PredictLeads integration detects job changes at ICP-matching companies
- [x] **SIG-02**: PredictLeads integration detects funding rounds (seed, Series A-D, acquisition) at ICP-matching companies
- [x] **SIG-03**: PredictLeads integration detects hiring spikes (unusual job posting volume)
- [x] **SIG-04**: PredictLeads integration detects technology adoption changes
- [x] **SIG-05**: PredictLeads integration detects company news events (product launches, partnerships, C-level changes)
- [x] **SIG-06**: Serper.dev social listening detects competitor mentions and frustration signals on Reddit/Twitter
- [x] **SIG-07**: Signal monitoring runs as Railway background worker (cron every 4-6 hours) — not Vercel
- [x] **SIG-08**: SignalEvent model stores every detected signal with type, company, workspace, timestamp, metadata for long-term intelligence
- [x] **SIG-09**: Signal-level budget governor prevents cost explosion from burst events (configurable daily cap per workspace)
- [x] **SIG-10**: Multi-signal stacking detection (2+ signals on same company = high intent flag)

### Pipeline

- [x] **PIPE-01**: Admin can create a signal campaign via chat specifying ICP criteria, signal types to monitor, and channel (email/LinkedIn/both)
- [x] **PIPE-02**: Signal campaign setup requires content template approval (admin review + client dual approval in portal) before going live
- [x] **PIPE-03**: When a signal fires on a live campaign, leads at the matching company are auto-enriched via existing waterfall
- [x] **PIPE-04**: Auto-enriched leads are ICP scored and added to the signal campaign's target list
- [x] **PIPE-05**: New leads auto-deploy to EmailBison/LinkedIn using the campaign's approved content template
- [x] **PIPE-06**: Admin receives Slack notification when leads are added to a signal campaign ("3 leads added to Rise Fintech Signals")
- [x] **PIPE-07**: Signal campaigns have a daily lead cap (configurable per campaign) to prevent burst floods
- [x] **PIPE-08**: Signal campaigns can be paused/resumed instantly by admin
- [x] **PIPE-09**: Static campaigns (one-off list build → copy → deploy) continue to work as before alongside signal campaigns

### Workspace Configuration

- [x] **CFG-01**: Workspace model has a campaign package config defining allowed campaign types (static email, static LinkedIn, signal email, signal LinkedIn)
- [x] **CFG-02**: Agent enforces workspace package — cannot create signal campaigns if workspace is not approved for signals
- [x] **CFG-03**: Monthly campaign allowance tracked per workspace (e.g., 2 static campaigns/month)
- [x] **CFG-04**: Admin can upgrade/downgrade workspace package via chat or API
- [x] **CFG-05**: Monthly lead quota per workspace (e.g., 2,000 leads/month) — agent enforces quota across all campaigns (static + signal)
- [x] **CFG-06**: Lead quota usage visible in agent responses and discovery plans

### Copy Strategy

- [x] **COPY-01**: Writer Agent supports multiple copy strategies (Creative Ideas, PVP, one-liner, custom) and admin/agent selects which to use per campaign
- [x] **COPY-02**: Creative Ideas strategy generates 3 constrained, personalized ideas per prospect based on company research and client offerings
- [x] **COPY-03**: Each Creative Idea is constrained to a specific client offering/capability (AI cannot make up services the client doesn't provide)
- [x] **COPY-04**: Ideas are personalized using prospect's company description, website analysis, and ICP data — not generic
- [x] **COPY-05**: Writer produces both 3-idea format (full) and one-liner variant ("If I were looking at your business, I'd help by...")
- [x] **COPY-06**: Per-client copy examples are stored in Knowledge Base with tags (e.g., `creative-ideas-{workspaceSlug}`, `pvp-{workspaceSlug}`) — agent retrieves relevant examples based on selected strategy
- [x] **COPY-07**: AI generates draft copy examples from Research Agent website analysis of client, admin reviews and refines before ingestion
- [x] **COPY-08**: Writer validates `groundedIn` field for Creative Ideas — every idea must trace to a real client offering (hallucination prevention)
- [x] **COPY-09**: Signal-triggered emails use signals for timing only — signals are invisible to the recipient, copy leads with value
- [x] **COPY-10**: Writer consults full Knowledge Base (46+ docs) for best practices regardless of selected strategy — frameworks, subject lines, follow-up patterns, personalization techniques
- [x] **COPY-11**: Writer generates multiple strategy variants for the same campaign (e.g., Creative Ideas vs PVP vs one-liner) for A/B split testing
- [x] **COPY-12**: Campaign tracks which strategy variant each lead receives so performance can be compared per strategy

### Signal Dashboard

- [x] **DASH-01**: Admin can view live signal feed showing recent signals across all clients
- [x] **DASH-02**: Dashboard shows per-client signal breakdown (signals fired, leads generated, cost)
- [x] **DASH-03**: Dashboard shows signal type distribution (funding, job changes, hiring, tech, news, social)
- [x] **DASH-04**: Dashboard shows daily/weekly cost tracking for signal monitoring per workspace
- [x] **DASH-05**: SignalEvent data persists for long-term pattern analysis (signal → conversion correlation over time)

### CLI Orchestrator

- [x] **CLI-01**: Admin can start interactive chat session with orchestrator agent from Claude Code terminal
- [x] **CLI-02**: CLI chat supports all existing orchestrator capabilities (delegate to Research, Leads, Writer, Campaign agents)
- [x] **CLI-03**: CLI chat maintains conversation context across multiple turns within a session

### Quick Fixes

- [x] **FIX-01**: Research Agent has access to searchKnowledgeBase tool (currently missing — only Writer, Leads, Orchestrator have it)
- [x] **FIX-02**: Enrichment waterfall reordered to actual cheapest-first: FindyMail ($0.001) → Prospeo ($0.002) → AI Ark ($0.003) → LeadMagic ($0.005)

## v2.1 Requirements

Deferred to next milestone. Tracked but not in current roadmap.

### Advanced Discovery

- **DISC-ADV-01**: Exa.ai Websets integration for semantic company search and lookalike discovery
- **DISC-ADV-02**: Apify LinkedIn no-cookie actor integration for LinkedIn profile scraping
- **DISC-ADV-03**: Ocean.io or Disco lookalike list building (if Exa doesn't cover the use case)
- **DISC-ADV-04**: AI Ark company similarity search (lookalike via AI)

### Advanced Signals

- **SIG-ADV-01**: Website visitor identification (RB2B, Warmly) as first-party intent signal
- **SIG-ADV-02**: G2/Capterra review monitoring for competitor dissatisfaction signals
- **SIG-ADV-03**: Signal → conversion analytics (which signal types produce the best reply rates)

## Out of Scope

| Feature | Reason |
|---------|--------|
| FullEnrich | Redundant — we have our own enrichment waterfall |
| StoreLeads | $75-950/mo — Serper.dev covers ecommerce discovery via Google queries |
| Campaign builder UI | All campaign operations through chat (Cmd+J / CLI) |
| First-party website visitor ID | Requires pixel/JS install on client sites — high complexity, v2.1+ |
| Per-lead approve/reject in portal | Binary list-level approval only — consistent with v1.1 |
| Replacing EmailBison | EmailBison remains sending infrastructure |
| Domain infrastructure management | Handled externally (PlusVibe) |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FIX-01 | Phase 15 | Complete |
| FIX-02 | Phase 15 | Complete |
| DISC-06 | Phase 15 | Complete |
| DISC-09 | Phase 15 | Complete |
| DISC-10 | Phase 15 | Complete |
| CFG-01 | Phase 15 | Complete |
| CFG-02 | Phase 15 | Complete |
| CFG-03 | Phase 15 | Complete |
| CFG-04 | Phase 15 | Complete |
| CFG-05 | Phase 15 | Complete |
| CFG-06 | Phase 15 | Complete |
| DISC-01 | Phase 16 | Complete |
| DISC-02 | Phase 16 | Complete |
| DISC-03 | Phase 16 | Complete |
| DISC-04 | Phase 16 | Complete |
| DISC-05 | Phase 16 | Complete |
| DISC-07 | Phase 17 | Complete |
| DISC-08 | Phase 17 | Complete |
| DISC-11 | Phase 17 | Complete |
| DISC-12 | Phase 17 | Complete |
| DISC-13 | Phase 17 | Complete |
| SIG-01 | Phase 18 | Complete |
| SIG-02 | Phase 18 | Complete |
| SIG-03 | Phase 18 | Complete |
| SIG-04 | Phase 18 | Complete |
| SIG-05 | Phase 18 | Complete |
| SIG-06 | Phase 18 | Complete |
| SIG-07 | Phase 18 | Complete |
| SIG-08 | Phase 18 | Complete |
| SIG-09 | Phase 18 | Complete |
| SIG-10 | Phase 18 | Complete |
| PIPE-01 | Phase 19 | Complete |
| PIPE-02 | Phase 19 | Complete |
| PIPE-03 | Phase 19 | Complete |
| PIPE-04 | Phase 19 | Complete |
| PIPE-05 | Phase 19 | Complete |
| PIPE-06 | Phase 19 | Complete |
| PIPE-07 | Phase 19 | Complete |
| PIPE-08 | Phase 19 | Complete |
| PIPE-09 | Phase 19 | Complete |
| COPY-01 | Phase 20 | Complete |
| COPY-02 | Phase 20 | Complete |
| COPY-03 | Phase 20 | Complete |
| COPY-04 | Phase 20 | Complete |
| COPY-05 | Phase 20 | Complete |
| COPY-06 | Phase 20 | Complete |
| COPY-07 | Phase 20 | Complete |
| COPY-08 | Phase 20 | Complete |
| DASH-01 | Phase 21 | Complete |
| DASH-02 | Phase 21 | Complete |
| DASH-03 | Phase 21 | Complete |
| DASH-04 | Phase 21 | Complete |
| DASH-05 | Phase 21 | Complete |
| CLI-01 | Phase 21 | Complete |
| CLI-02 | Phase 21 | Complete |
| CLI-03 | Phase 21 | Complete |

**Coverage:**
- v2.0 requirements: 56 total
- Mapped to phases: 56
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-04*
*Last updated: 2026-03-04 after roadmap creation*
