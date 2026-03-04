# Requirements: Outsignal Lead Engine v2.0

**Defined:** 2026-03-04
**Core Value:** Own the lead data pipeline end-to-end so we never pay for the same lead twice and can cancel the $300+/month Clay subscription.

## v2.0 Requirements

Requirements for Lead Discovery & Intelligence milestone. Each maps to roadmap phases.

### Discovery

- [ ] **DISC-01**: Leads Agent can search Apollo.io People API (275M contacts, free) by title, seniority, industry, location, company size and return paginated results
- [ ] **DISC-02**: Leads Agent can search Prospeo Search Person API with 20+ filters (title, seniority, department, location, company industry, headcount, funding stage)
- [ ] **DISC-03**: Leads Agent can search AI Ark People Search API by role, seniority, department, location, keywords
- [ ] **DISC-04**: Leads Agent can search Serper.dev for Google web results, Maps results, and social mentions (Reddit/Twitter) via natural language queries
- [ ] **DISC-05**: Leads Agent can scrape custom directories via Firecrawl /extract endpoint with structured JSON schema (association member lists, government databases, etc.)
- [ ] **DISC-06**: Discovery results are written to a DiscoveredPerson staging table (not directly to Person) for dedup before promotion
- [ ] **DISC-07**: Agent deduplicates discovered leads against local Person DB (by LinkedIn URL, email, or name+company match) before enrichment
- [ ] **DISC-08**: Agent automatically selects best discovery sources based on ICP type (enterprise B2B → Apollo/Prospeo, niche → Serper/Firecrawl directories, local/SMB → Serper Maps)
- [ ] **DISC-09**: Per-workspace API keys for Apollo.io (ToS requirement — no shared keys across workspaces)
- [ ] **DISC-10**: Discovery adapter pattern (DiscoveryAdapter interface) so new sources can be added without restructuring
- [ ] **DISC-11**: Agent generates a discovery plan (sources selected, reasoning, estimated cost, estimated lead volume per source) and presents for admin approval before executing searches
- [ ] **DISC-12**: Admin can adjust the discovery plan (add/remove sources, change filters) before approving execution
- [ ] **DISC-13**: Discovery plan shows how campaign lead volume tracks against workspace monthly lead quota (e.g., "500 of 2,000 monthly leads used")

### Signal Monitoring

- [ ] **SIG-01**: PredictLeads integration detects job changes at ICP-matching companies
- [ ] **SIG-02**: PredictLeads integration detects funding rounds (seed, Series A-D, acquisition) at ICP-matching companies
- [ ] **SIG-03**: PredictLeads integration detects hiring spikes (unusual job posting volume)
- [ ] **SIG-04**: PredictLeads integration detects technology adoption changes
- [ ] **SIG-05**: PredictLeads integration detects company news events (product launches, partnerships, C-level changes)
- [ ] **SIG-06**: Serper.dev social listening detects competitor mentions and frustration signals on Reddit/Twitter
- [ ] **SIG-07**: Signal monitoring runs as Railway background worker (cron every 4-6 hours) — not Vercel
- [ ] **SIG-08**: SignalEvent model stores every detected signal with type, company, workspace, timestamp, metadata for long-term intelligence
- [ ] **SIG-09**: Signal-level budget governor prevents cost explosion from burst events (configurable daily cap per workspace)
- [ ] **SIG-10**: Multi-signal stacking detection (2+ signals on same company = high intent flag)

### Pipeline

- [ ] **PIPE-01**: Admin can create a signal campaign via chat specifying ICP criteria, signal types to monitor, and channel (email/LinkedIn/both)
- [ ] **PIPE-02**: Signal campaign setup requires content template approval (admin review + client dual approval in portal) before going live
- [ ] **PIPE-03**: When a signal fires on a live campaign, leads at the matching company are auto-enriched via existing waterfall
- [ ] **PIPE-04**: Auto-enriched leads are ICP scored and added to the signal campaign's target list
- [ ] **PIPE-05**: New leads auto-deploy to EmailBison/LinkedIn using the campaign's approved content template
- [ ] **PIPE-06**: Admin receives Slack notification when leads are added to a signal campaign ("3 leads added to Rise Fintech Signals")
- [ ] **PIPE-07**: Signal campaigns have a daily lead cap (configurable per campaign) to prevent burst floods
- [ ] **PIPE-08**: Signal campaigns can be paused/resumed instantly by admin
- [ ] **PIPE-09**: Static campaigns (one-off list build → copy → deploy) continue to work as before alongside signal campaigns

### Workspace Configuration

- [ ] **CFG-01**: Workspace model has a campaign package config defining allowed campaign types (static email, static LinkedIn, signal email, signal LinkedIn)
- [ ] **CFG-02**: Agent enforces workspace package — cannot create signal campaigns if workspace is not approved for signals
- [ ] **CFG-03**: Monthly campaign allowance tracked per workspace (e.g., 2 static campaigns/month)
- [ ] **CFG-04**: Admin can upgrade/downgrade workspace package via chat or API
- [ ] **CFG-05**: Monthly lead quota per workspace (e.g., 2,000 leads/month) — agent enforces quota across all campaigns (static + signal)
- [ ] **CFG-06**: Lead quota usage visible in agent responses and discovery plans

### Creative Ideas

- [ ] **COPY-01**: Writer Agent generates 3 constrained, personalized ideas per prospect based on company research and client offerings
- [ ] **COPY-02**: Each idea is constrained to a specific client offering/capability (AI cannot make up services the client doesn't provide)
- [ ] **COPY-03**: Ideas are personalized using prospect's company description, website analysis, and ICP data — not generic
- [ ] **COPY-04**: Writer produces both 3-idea format (full) and one-liner variant ("If I were looking at your business, I'd help by...")
- [ ] **COPY-05**: Per-client Creative Ideas examples are stored in Knowledge Base with tag `creative-ideas-{workspaceSlug}`
- [ ] **COPY-06**: AI generates draft Creative Ideas examples from Research Agent website analysis of client, admin reviews and refines before ingestion
- [ ] **COPY-07**: Writer validates `groundedIn` field — every idea must trace to a real client offering (hallucination prevention)
- [ ] **COPY-08**: Signal-triggered emails use signals for timing only — signals are invisible to the recipient, copy leads with value

### Signal Dashboard

- [ ] **DASH-01**: Admin can view live signal feed showing recent signals across all clients
- [ ] **DASH-02**: Dashboard shows per-client signal breakdown (signals fired, leads generated, cost)
- [ ] **DASH-03**: Dashboard shows signal type distribution (funding, job changes, hiring, tech, news, social)
- [ ] **DASH-04**: Dashboard shows daily/weekly cost tracking for signal monitoring per workspace
- [ ] **DASH-05**: SignalEvent data persists for long-term pattern analysis (signal → conversion correlation over time)

### CLI Orchestrator

- [ ] **CLI-01**: Admin can start interactive chat session with orchestrator agent from Claude Code terminal
- [ ] **CLI-02**: CLI chat supports all existing orchestrator capabilities (delegate to Research, Leads, Writer, Campaign agents)
- [ ] **CLI-03**: CLI chat maintains conversation context across multiple turns within a session

### Quick Fixes

- [ ] **FIX-01**: Research Agent has access to searchKnowledgeBase tool (currently missing — only Writer, Leads, Orchestrator have it)
- [ ] **FIX-02**: Enrichment waterfall reordered to actual cheapest-first: FindyMail ($0.001) → Prospeo ($0.002) → AI Ark ($0.003) → LeadMagic ($0.005)

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
| (To be filled by roadmapper) | | |

**Coverage:**
- v2.0 requirements: 47 total
- Mapped to phases: 0
- Unmapped: 47 ⚠️

---
*Requirements defined: 2026-03-04*
*Last updated: 2026-03-04 after initial definition*
