# Roadmap: Outsignal Lead Engine

## Overview

Build a self-hosted lead enrichment pipeline that replaces Clay end-to-end: schema foundation and dedup logic first, then provider adapters wired into the waterfall, then an AI-powered qualification layer and leads agent, then search and list building UI, and finally export to EmailBison with a hard email-verification gate. Every phase delivers a coherent, independently-verifiable capability on top of the existing 14k+ person / 17k+ company database.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Enrichment Foundation** - Schema extension, dedup logic, AI normalization, and async job infrastructure (completed 2026-02-26)
- [ ] **Phase 2: Provider Adapters + Waterfall** - All four provider adapters wired into the waterfall pipeline
- [ ] **Phase 3: ICP Qualification + Leads Agent** - Firecrawl/Haiku qualification, custom AI prompts, and the chat-driven leads agent
- [ ] **Phase 4: Search, Filter + List Building** - Full lead search UI and workspace-scoped list management
- [ ] **Phase 5: Export + EmailBison Integration** - Verified-only list export to EmailBison campaigns and CSV

## Phase Details

### Phase 1: Enrichment Foundation
**Goal**: The pipeline's data contract and cost-control mechanisms are in place so no paid API is ever called unnecessarily and no enrichment corrupts existing data
**Depends on**: Nothing (first phase)
**Requirements**: ENRICH-01, ENRICH-06, ENRICH-07, AI-01, AI-02, AI-03
**Success Criteria** (what must be TRUE):
  1. A dedup check function (`shouldEnrich`) is callable and returns false for any person/company already enriched by a given provider, preventing duplicate API calls
  2. Enrichment provenance is recorded on every run — which provider, which fields, timestamp, and cost — queryable from the database
  3. Batch enrichment jobs are queued asynchronously and execute in chunks that never exceed Vercel's timeout, with DB-tracked progress
  4. Industry classification, company name, and job title submitted to the normalizer come back with canonical values validated against a controlled vocabulary
**Plans**: 3 plans
- [ ] 01-01-PLAN.md — Schema migration (EnrichmentLog + EnrichmentJob), types, dedup gate, provenance logger
- [ ] 01-02-PLAN.md — AI normalization (industry, company name, job title classifiers with controlled vocabulary)
- [ ] 01-03-PLAN.md — Async job queue (enqueueJob, processNextChunk, process API route)

### Phase 2: Provider Adapters + Waterfall
**Goal**: All four enrichment providers are wired into a tested waterfall that finds emails and enriches people/companies at the lowest possible cost per record
**Depends on**: Phase 1
**Requirements**: PROV-01, PROV-02, PROV-03, PROV-04, PROV-05, ENRICH-02, ENRICH-03, ENRICH-04
**Success Criteria** (what must be TRUE):
  1. Given a LinkedIn URL, the pipeline finds an email address by trying Prospeo, then LeadMagic, then FindyMail in order and stopping at the first success
  2. Given a domain, the pipeline returns company data (headcount, industry, description) by trying AI Ark then Firecrawl, with local cache preventing repeat crawls
  3. Given a batch of people records, enrichment completes without burning credits on records that already have sufficient data (dedup gate fires correctly)
  4. Provider errors (404 permanent, 429 rate-limit, 422 bad input) are handled distinctly — rate-limit errors back off and retry, permanent errors do not
**Plans**: 5 plans
- [ ] 02-01-PLAN.md — Schema migration (DailyCostTotal, paused status, workspaceSlug), adapter types, cost config, merge logic
- [ ] 02-02-PLAN.md — Email provider adapters (Prospeo, LeadMagic, FindyMail)
- [ ] 02-03-PLAN.md — Company provider adapters (AI Ark, Firecrawl extract)
- [ ] 02-04-PLAN.md — Waterfall orchestration (enrichEmail, enrichCompany) + queue wiring + run trigger
- [ ] 02-05-PLAN.md — Cost dashboard (API endpoint + Recharts UI page)

### Phase 3: ICP Qualification + Leads Agent
**Goal**: Prospects are classified against ICP criteria using web research, custom workspace rules are supported, and all pipeline capabilities are accessible through the chat dashboard
**Depends on**: Phase 2
**Requirements**: AI-04, AI-05, ENRICH-05
**Success Criteria** (what must be TRUE):
  1. A prospect's website can be crawled and scored for ICP fit (pass/fail + reasoning), with the result persisted to the person record and the crawl result cached to prevent re-crawling
  2. Email addresses are gated through LeadMagic verification before any export path can proceed — the export surface refuses to proceed on unverified emails
  3. The Leads Agent is accessible from the dashboard chat interface and can enrich a person, search people, build a list, and trigger export via natural language commands
  4. Workspace-specific AI prompt overrides are configurable, so different clients can customize normalization and qualification rules without code changes
**Plans**: TBD

### Phase 4: Search, Filter + List Building
**Goal**: Users can find any person or company in the database, filter by enrichment state and ICP criteria, and assemble qualified lists ready for export
**Depends on**: Phase 3
**Requirements**: SEARCH-01, SEARCH-02, SEARCH-03, SEARCH-04, SEARCH-05, LIST-01, LIST-02, LIST-03, LIST-04
**Success Criteria** (what must be TRUE):
  1. User can type a name, email, company name, or job title and see matching people records paginated across the full 14k+ dataset in under 2 seconds
  2. User can filter people by vertical, enrichment status, workspace, and company and see the filtered count update without a full page reload
  3. User can search companies by name, domain, or vertical with enrichment status visible on each result
  4. User can select people from search results individually or in bulk and add them to a named, workspace-scoped list
  5. List view shows enrichment completeness summary (how many records have email, LinkedIn, company data) so the user can see what's missing before export
**Plans**: TBD

### Phase 5: Export + EmailBison Integration
**Goal**: Qualified, verified lists can be pushed directly to EmailBison campaigns or exported as CSV, with a hard verification gate preventing unverified emails from ever being exported
**Depends on**: Phase 4
**Requirements**: EXPORT-01, EXPORT-02, EXPORT-03
**Success Criteria** (what must be TRUE):
  1. User can push a list to an EmailBison campaign via direct API with a pre-export summary showing lead count, verified email percentage, and vertical breakdown
  2. Any export attempt — API push or CSV — is blocked with an error if any person in the list has an unverified email address
  3. User can export a list as a CSV file containing all enriched fields for use in tools outside EmailBison
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Enrichment Foundation | 3/3 | Complete   | 2026-02-26 |
| 2. Provider Adapters + Waterfall | 4/5 | In Progress|  |
| 3. ICP Qualification + Leads Agent | 0/TBD | Not started | - |
| 4. Search, Filter + List Building | 0/TBD | Not started | - |
| 5. Export + EmailBison Integration | 0/TBD | Not started | - |
