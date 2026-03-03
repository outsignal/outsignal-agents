# Feature Research

**Domain:** Multi-source lead discovery, signal monitoring, Creative Ideas copy generation — Outsignal Lead Engine v2.0
**Researched:** 2026-03-03
**Confidence:** MEDIUM-HIGH (APIs confirmed via official docs; behavior details from docs + community sources; see per-item confidence)

---

> **Note:** This document supersedes the v1.1 FEATURES.md (which covered Leads Agent dashboard, client portal approval, smart deploy — all now shipped).
> This file covers only **v2.0 milestone** features: multi-source discovery, signal monitoring, Creative Ideas framework, signal dashboard, CLI orchestrator chat.

---

## Existing Features (Out of Scope for v2.0 Research)

Already shipped and not re-researched:
- Local DB search (14.5k people), ICP score filters, enrichment waterfall (Prospeo enrich → AI Ark enrich → LeadMagic → FindyMail)
- ICP scoring via Firecrawl + Haiku
- Writer Agent (11 quality rules, spintax, PVP framework), Research Agent (website crawling, ICP extraction)
- Campaign lifecycle (draft → deployed), dual approval, auto-deploy to EmailBison + LinkedIn
- Knowledge Base (46 docs, pgvector hybrid search), portal, sender health monitoring

---

## Feature Landscape

### Table Stakes (Expected for v2.0)

Features where v2.0 is considered incomplete without them.

| Feature | Why Expected | Complexity | Depends On |
|---------|--------------|------------|------------|
| Apollo people search (free) | 275M contacts, no credit cost — no reason not to have this as first discovery source; missing it means leaving the cheapest source unused | LOW | New `discovery/` module, Leads Agent tool dispatch, existing enrichment waterfall |
| Prospeo Search Person | Same API key already integrated for enrichment; search is a separate endpoint — natural no-new-cost extension | LOW | Existing PROSPEO_API_KEY, new discovery adapter in `src/lib/discovery/` |
| PredictLeads signal ingestion | Core signal source without which evergreen campaigns and signal dashboard are empty shells; the milestone's defining feature | MEDIUM | New Signal DB model, Railway cron job, new `signals/` module |
| Evergreen campaign pipeline (end-to-end) | The main v2.0 value prop: persistent campaigns that auto-add qualified leads as signals fire | HIGH | PredictLeads integration, existing enrichment waterfall, existing campaign + writer agents, new Signal model |
| Signal dashboard | Visibility into what signals fired, per-client costs, feed of events — required to show value to clients and to debug the pipeline | MEDIUM | Signal DB model, new Next.js page at `/admin/signals` |
| Creative Ideas copy framework | 3 constrained ideas per prospect, personalized from company research; the copy differentiation the milestone promises | MEDIUM | Existing Writer Agent + system prompt update, existing Research Agent output, existing KB with tag search |
| CLI orchestrator chat | Interactive terminal session for Leads/Writer/Campaign agents in Claude Code without browser — daily workflow tool, not just a feature | LOW-MEDIUM | Existing `runAgent()` in `runner.ts`, Node.js built-in readline, tsx script |

### Differentiators (Competitive Advantage)

Features that separate this from Clay, Apollo, or generic tools.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Agent-driven source selection | Agent classifies ICP type (enterprise vs niche vs local vs ultra-niche) and auto-picks best source(s) — avoids wasting credits on the wrong API | MEDIUM | ICP classification heuristic in Leads Agent system prompt; source adapter registry with cost metadata |
| Exa.ai Websets semantic search | Natural-language company queries ("SaaS companies in the UK using Salesforce, hiring SDRs") — no other provider does this via API; covers ultra-niche ICPs that databases miss | MEDIUM | New Exa adapter; Websets is async (minutes for complex queries), needs polling pattern |
| Apify LinkedIn no-cookie scrapers | Pulls LinkedIn employee lists and posts without risking sender cookies — fills the "find everyone at Company X" use case; $3/1k profiles via HarvestAPI actors | MEDIUM | Apify API key, actor slugs for HarvestAPI actors; Apify runs are async, need polling |
| Firecrawl directory scraping | Extract structured leads from niche directories, association member lists, awards pages where no API exists | MEDIUM | Existing Firecrawl integration, `/extract` endpoint with JSON schema; still in Beta per Firecrawl |
| Serper.dev for Google Maps + social | $0.001/query covers Google Search, Maps, News — one provider for local biz prospecting and Reddit social listening | LOW | New Serper adapter; covers discovery + signal monitoring use cases |
| Per-client Creative Ideas examples in KB | Admin curates hand-written examples per workspace; Writer Agent searches KB before generating — grounds output in real client voice, not generic AI copy | MEDIUM | Existing KB tag filtering; new `creative_idea` + `{workspace-slug}` tag convention; admin ingestion workflow |
| Signals invisible to recipient | Signals used only for timing/targeting, never as email hooks ("congrats on funding") — explicit rule in Writer Agent's quality framework | LOW (policy/prompt) | Writer Agent system prompt update; rule #12 in quality framework: "Never reference signals, funding, job changes, or news as the email hook" |
| Long-term signal data collection | Signals stored permanently in DB — enables trend analysis, replay, auditing; most tools only show last 30 days | MEDIUM | New Signal DB table with no TTL; query optimization for large result sets over time |

### Anti-Features (Do Not Build in v2.0)

| Anti-Feature | Why Requested | Why Problematic | Alternative |
|--------------|---------------|-----------------|-------------|
| Signal-triggered copy hooks ("congrats on funding") | Obvious personalization trigger | Everyone sends these; recipients have seen 1000 of them; destroys reply rates; Growth Engine X explicitly forbids it | Use signal for TIMING only; Creative Ideas framework leads with constrained offering, not the trigger |
| Per-lead approve/reject in portal | Clients want fine-grained control | Already ruled out in v1.0 — list-level approval is sufficient; per-lead creates infinite review loops | Binary list-level approval (already built and shipped) |
| Real-time WebSocket signal feed | Feels impressive and modern | Signals fire asynchronously from Railway cron — WebSockets add complexity with no real value at 6-client scale | 30-second client-side polling refresh on signal dashboard |
| StoreLeads.io integration | Ecommerce lead discovery | $75-950/mo; Serper.dev Google queries cover ecommerce discovery at $0.001/query | Serper.dev Google search for ecommerce niches |
| Twitter/X full social listening | Monitor Twitter for brand mentions | X API is $100+/mo for developer access; heavily rate-limited; most B2B signal value is Reddit/news | Serper.dev Google News + Reddit search (cheap, sufficient) |
| First-party intent data (RB2B, Warmly, Vector) | Catch website visitors and identify companies | Requires pixel on client websites — we don't control client sites | PredictLeads signals for company-level intent instead |
| Campaign builder UI | Visual drag-and-drop | All campaign ops through chat (Cmd+J / CLI) — already decided in v1.1 | CLI orchestrator chat (this milestone) |
| FullEnrich integration | More email finding coverage | Redundant — we already have a 4-provider waterfall; adding another adds marginal yield at marginal cost | Optimize existing waterfall order instead (v2.0 tech debt item) |

---

## Feature Deep-Dives

### 1. Multi-Source Lead Discovery

**How it works:** A new `src/lib/discovery/` module wraps multiple search APIs behind a common `DiscoveryResult` interface. Each adapter returns: `{ firstName, lastName, jobTitle, company, companyDomain, linkedinUrl, location, source }`. Results are deduplicated against the local DB by email + LinkedIn URL (existing dedup logic), then passed to the existing enrichment waterfall for email finding.

**Critical pattern:** Search ≠ Enrichment. Discovery finds people (no emails). Enrichment waterfall finds emails. Existing dedup-first pattern handles discovered people correctly.

**Source-by-source behavior:**

| Source | What It Returns | Credit Cost | Key Limitation |
|--------|----------------|-------------|----------------|
| Apollo People Search | Name, title, company, LinkedIn URL, location — NO email | FREE (confirmed in official docs: "does not consume credits") | Must call enrichment for email; 275M contacts |
| Prospeo Search Person | Name, title, company, LinkedIn URL — NO email; 20+ filters | 1 credit per page of 25 results | Separate enrich call needed; max 25k results per search |
| AI Ark People Search | Name, title, company, LinkedIn — similar to Prospeo | Credits (amount varies; 100 free trial) | Auth header still LOW confidence (X-TOKEN vs Authorization) |
| Exa.ai Websets | Company-level results primarily; can request contact enrichment | ~$7-12/1k standard requests; Websets mode is slower/pricier | Async for complex queries (minutes, not seconds); best for hard/niche queries |
| Serper.dev | Unstructured SERP results (Google Search, Maps, News) — needs parsing | $0.001/query (50k = $50) | Requires AI parsing of SERP results to extract people/companies |
| Apify LinkedIn | Structured profile data, LinkedIn URLs, limited contact data | $3/1k profiles (HarvestAPI actors) | Async runs — polling needed; returns may take 30-120s |
| Firecrawl directories | Raw scraped content from directory pages — needs schema | Existing Firecrawl credits | Schema must be defined per directory; /extract still in Beta |

**Leads Agent tool:** New `discoverLeads(source, filters)` tool added to Leads Agent. Source adapters in `src/lib/discovery/` (mirrors `enrichment/providers/` pattern). After discovery, Leads Agent offers to run enrichment waterfall on discovered records.

### 2. Agent-Driven Source Selection

**How it works:** When the Leads Agent receives a discovery request, it classifies the ICP before picking sources. This classification is in the system prompt as a decision tree, not a separate LLM call (to avoid latency + cost).

**ICP-to-source routing:**

| ICP Type | Trigger Signals | Best Sources | Rationale |
|----------|----------------|-------------|-----------|
| Enterprise / named accounts | "Fortune 500", "enterprise", named companies | Apollo + Prospeo | Large DBs; enterprise companies well-indexed |
| Mid-market / volume (>100 leads) | Volume requests, broad filters | Apollo (free) first, Prospeo for top-up | Apollo free search → enrichment waterfall is cheapest path |
| Niche/vertical-specific | Specific industry + small universe | Exa.ai Websets + Firecrawl directories | Niche companies often absent from databases; semantic + directory scraping finds them |
| Local / SMB | "local", "small business", geographic + industry combo | Serper.dev Google Maps | Maps has the most complete local business coverage |
| LinkedIn-specific ("employees at Company X") | Company name + employee discovery | Apify LinkedIn Company Employees scraper | When the ask is "everyone at this company" |
| Ultra-niche by content/signal | "companies that post about X", "attendees of Y conference" | Exa.ai Websets + Serper.dev | Natural language + web search covers any content-defined niche |

**Implementation note:** Source routing logic lives in the Leads Agent system prompt as explicit instructions. Agent calls `discoverLeads(source, filters)` tool with the chosen source. No meta-agent for source selection — the Leads Agent itself makes the call.

### 3. Signal Monitoring via PredictLeads

**Signal types available (confirmed):**
- Job openings — 2M+ companies, 9.2M active openings; indicates growth/hiring intent
- Financing events — funding rounds extracted from news; budget availability signal
- News events — 29 event categories (product launch, partnership, expansion, etc.); from 19M sites; back to 2016
- Technology detections — 65M companies; tech stack changes = buyer intent signal
- Connections — company relationship data

**Free tier:** 100 API requests/month (confirmed from predictleads.com). Sufficient for pilot with 2-3 client workspaces. Production requires paid plan (pricing by demo/contact only — not public).

**Architecture:**
1. Railway cron job (not Vercel — already at 2-cron Hobby limit) polls PredictLeads API
2. For each workspace with signal monitoring enabled: load ICP filter (industries, company sizes)
3. Query PredictLeads for companies matching filter with new signals since last `lastPolledAt` timestamp
4. Store signals: new `Signal` model with `workspaceId`, `companyDomain`, `signalType`, `signalData` (JSON), `firedAt`, `processed: false`, `fingerprint` (for dedup)
5. Background processor: picks up `processed: false` signals → runs dedup against existing Person records → enrichment waterfall → ICP score → if score >= threshold, adds to evergreen campaign's TargetList

**Signal deduplication:** PredictLeads may return same signal across polls. Fingerprint = `sha256(companyDomain + signalType + firedAt.toDateString())`. Store fingerprint, reject duplicates.

**Serper.dev social listening:**
- Reddit monitoring: `GET /search?q=site:reddit.com "[competitor]" OR "[pain point]"` — ~$0.001/query
- News monitoring: `GET /news?q="[company]" OR "[vertical keyword]"` — same rate
- Results stored as `Signal` records with `signalType: 'social_mention'`
- Confidence: MEDIUM — Serper covers Google-indexed Reddit threads (most are indexed); doesn't cover private/new threads before indexing

### 4. Evergreen Signal Campaigns

**Expected behavior (full pipeline):**

```
Signal fires in PredictLeads / Serper
  → Stored in Signal table (processed: false)
  → Background processor evaluates: does this company match workspace ICP?
  → If yes: check if company/contact already in workspace TargetList (dedup)
  → If new: run enrichment waterfall (get email)
  → ICP score via Firecrawl + Haiku
  → If score >= workspace threshold (e.g. 6/10): add to evergreen campaign's TargetList
  → Writer Agent runs Creative Ideas framework for new additions (batch of N leads)
  → Notify admin via Slack: "5 new leads added to [Campaign Name], copy ready for review"
  → Portal: client sees pending batch, approves leads + copy (existing dual approval)
  → Auto-deploy to EmailBison on both approved (existing deploy logic)
```

**Key design decisions:**
- Signals are timing/targeting signals ONLY — copy never references the signal. Writer Agent rule enforces this.
- Batch accumulation: accumulate N leads (or N days) before generating copy + notifying, to avoid daily interruptions. Configurable per workspace.
- Same dual-approval flow as regular campaigns (leads approved separately from content).
- Evergreen flag on Campaign model: `isEvergreen: Boolean`. SignalCampaignRule junction: `{ campaignId, signalTypes[], workspaceId, minIcpScore, batchSize }`.

**DB additions needed:** `Signal` model, `SignalCampaignRule` model, `isEvergreen` on `Campaign`.

### 5. Creative Ideas Copy Framework

**Framework origin:** Growth Engine X (Eric Nowoslawski) methodology. Validated approach for cold email agency copy. The key constraint: each email leads with ONE specific offering, not a generic value prop.

**Framework rules (for Writer Agent implementation):**
1. **One idea = one offering.** Not "we help with outbound" — "we build 500-contact Apollo lists weekly for [vertical]". Forces specificity.
2. **Generate exactly 3 ideas per prospect.** Three different angles, three different offerings from the client's service catalog.
3. **Deep company research first.** Research Agent must have run (or run inline) before copy generation. Ideas come from what's true about the company, not generic pain points.
4. **KB search for client examples.** Writer searches for `creative_idea` + `{workspace-slug}` tags before generating. AI uses these as style/voice reference.
5. **Structure per idea:** Hook → Specific Offering → Why Relevant (from research, NOT from signals) → CTA
6. **Never use signals as hooks.** Rule added to quality framework: "Never reference funding rounds, job changes, hiring spikes, news events, or competitor mentions as the email opening hook."

**Output schema:** `CreativeIdea[]` with 3 items: `{ offeringName, hook, body, cta, rationale }`. Rationale field documents why this offering was chosen for this company (internal, not sent).

**Per-client KB examples workflow:**
1. Writer Agent auto-generates 3 Creative Ideas draft examples per client (bootstrap)
2. Admin reviews, edits to match client voice, adds additional hand-written examples
3. Admin ingests into KB with tags: `creative_idea`, `{workspace-slug}` (e.g., `creative_idea`, `rise`)
4. Writer Agent always searches KB for these tags before generating production copy
5. Expect 10+ examples per client for stable output quality (per Growth Engine X guidance)

**Writer Agent changes:**
- System prompt updated with Creative Ideas rules + 3-idea structure
- New quality rule (rule 12): no signal hooks
- Output type extended: `WriterOutput` adds optional `creativeIdeas?: CreativeIdea[]`
- KB search tool already exists; tag convention is the new addition

### 6. Signal Dashboard

**Expected UI:**
- Live feed of recent signals (all workspaces, newest-first, paginated, 30s auto-refresh)
- Per-client breakdown table: signals fired, leads added to campaigns, campaigns triggered, enrichment cost this month
- Signal type filter: hiring | funding | tech adoption | news | social_mention
- Date range picker (default: last 30 days)
- Status filter: all | processed | unprocessed | failed
- Expandable signal rows: show raw signal data, which campaign it triggered, lead outcome
- Cost tracking section: API credits consumed by source this month

**Implementation:** New `/admin/signals` page. Server Components for initial load (Prisma query on Signal table). Client component for 30s polling refresh. No WebSockets. Query design: Signal table indexed on `(workspaceId, firedAt, processed)`.

**Long-term data:** Signals stored permanently. No TTL. This is the competitive moat — historical signal data enables trend analysis ("rise in hiring signals in our target niche in Q2") that real-time-only tools can't provide.

### 7. CLI Orchestrator Chat

**Expected behavior:**
1. Run `tsx scripts/chat.ts` (or `npm run chat`) from project root
2. Terminal shows prompt: `> Outsignal Agent — type your request...`
3. User types natural language: "find 50 SaaS founders in the UK for Rise"
4. Agent runs, tool calls shown inline with results
5. Agent replies with summary
6. Conversation continues: "add those to a list called Rise Q2 UK"
7. Agent maintains full conversation history (multi-turn)
8. Can invoke sub-agents: "now generate Creative Ideas copy for that list"
9. `/exit` or Ctrl+C to quit

**Implementation:**
- `scripts/chat.ts` — readline loop using Node.js `readline/promises`
- Calls existing `runAgent()` from `src/lib/agents/runner.ts`
- Passes `messages: Message[]` conversation history on each turn
- Uses Leads Agent or Orchestrator Agent depending on task type
- Tool call results printed inline (optional: verbose mode flag)
- Runs via `tsx` (available as dev dep, or via `ts-node`)
- Approx 80-120 lines of TypeScript — lowest effort feature in the milestone

---

## Feature Dependencies

```
[Apollo Search] ─────────────────────────┐
[Prospeo Search] ────────────────────────┤
[AI Ark Search] ─────────────────────────┼──> [Discovery Module] ──> [Existing Enrichment Waterfall]
[Exa.ai Websets] ────────────────────────┤      (new src/lib/discovery/)        │
[Serper.dev Search] ─────────────────────┤                                       │
[Apify LinkedIn] ────────────────────────┤                                       v
[Firecrawl Directories] ─────────────────┘                              [DB Person records]
                                                                                  │
[Agent-Driven Source Selection]──enhances──> [Discovery Module + Leads Agent]    │
                                                                                  │
[PredictLeads Signals] ─────────────────────────────────────────────┐            │
[Serper.dev Social] ─────────────────────────────────────────────── ┤──> [Signal DB Table]
                                                                     │       │         │
                                                             [Signal Dashboard]  [Evergreen Pipeline]
                                                                                        │
                                                               [Research Agent] ──> [Creative Ideas Writer]
                                                               (existing)                    │
                                                                                             │
                                               [Per-client KB Examples] ─────────────> [Writer Agent]
                                                                                             │
                                                                              [Existing Portal Approval]
                                                                                             │
                                                                             [Existing EmailBison Deploy]

[CLI Orchestrator Chat] ──> [Existing runAgent() in runner.ts]
                             [Existing Leads/Writer/Campaign Agent tools]
```

### Dependency Notes

- **Discovery adapters require enrichment waterfall:** Apollo/Prospeo search returns NO emails. Existing waterfall must run post-discovery before the export/deploy gate is satisfied. Discovery populates `Person` records; enrichment fills `verifiedEmail`.
- **Evergreen campaigns require signal monitoring:** Signal ingestion is the trigger; without it, evergreen campaigns never receive leads.
- **Creative Ideas requires Research Agent output:** Company website crawl + ICP extraction must run before idea generation. Research Agent already exists; needs to run before Writer Agent for this framework.
- **Creative Ideas requires per-client KB examples:** KB tag convention must be established (and examples ingested) before Writer Agent can use them. Admin ingestion workflow is a dependency.
- **Signal dashboard requires Signal DB model:** New Prisma model needed before dashboard can be built. `prisma db push` (no migration history, consistent with existing practice).
- **CLI chat has no new dependencies:** Uses existing `runAgent()`, readline is Node built-in, tsx available.
- **Evergreen pipeline batching:** Copy generation triggers AFTER N leads accumulate (not per-lead) — prevents Writer Agent from running on every individual signal. Batching config needed on `SignalCampaignRule`.

---

## MVP Definition

### Launch With (v2.0 core — validate the milestone concept)

- [ ] Apollo people search adapter — validates Discovery module pattern; free, high volume, no risk
- [ ] Prospeo Search Person adapter — same API key, natural extension, 1 credit/page
- [ ] PredictLeads signal ingestion (job openings + funding) — core signal source
- [ ] Signal DB model + Railway background poller
- [ ] Evergreen campaign pipeline: signal → enrich → score → add to list → Writer Agent → notify
- [ ] Creative Ideas framework in Writer Agent (3 ideas, constrained, KB-backed)
- [ ] Signal dashboard (feed + per-client breakdown, basic)
- [ ] CLI orchestrator chat (readline script, multi-turn Leads Agent + Orchestrator)

### Add After Core Works (v2.x)

- [ ] Exa.ai Websets adapter — add after validating Discovery module with simpler sync sources; async pattern adds complexity
- [ ] Apify LinkedIn scrapers — add when "find all employees at Company X" use case is requested by a client
- [ ] AI Ark People Search — low priority; marginal value over Apollo + Prospeo; auth header still unvalidated
- [ ] Firecrawl directory scraping — add when a specific niche directory is identified for a client
- [ ] Serper.dev social listening — add after PredictLeads is stable; Reddit monitoring is supplementary
- [ ] Agent-driven source selection — add once 3+ sources are integrated and cost patterns are observable
- [ ] Per-client Creative Ideas KB examples ingestion admin workflow — add after Writer Agent framework is generating; admin can manually use ingest CLI in interim
- [ ] Signal dashboard: cost tracking + long-term trend view — add after 30 days of signal data

### Future Consideration (v3+)

- [ ] Serper.dev Google Maps for local/SMB prospecting — different buyer persona from current 6 clients
- [ ] Signal scoring weights (recency, type, company fit) — requires historical data to calibrate
- [ ] Evergreen campaign batching config UI in admin — currently hardcoded per SignalCampaignRule

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Apollo people search adapter | HIGH (free, 275M, validates discovery module) | LOW | P1 |
| PredictLeads signal ingestion | HIGH (core of milestone) | MEDIUM | P1 |
| Evergreen campaign pipeline (full) | HIGH (main v2.0 value prop) | HIGH | P1 |
| Creative Ideas copy framework | HIGH (3x reply rates, differentiator) | MEDIUM | P1 |
| CLI orchestrator chat | HIGH (daily workflow improvement) | LOW | P1 |
| Signal dashboard (basic) | MEDIUM (visibility, debugging) | MEDIUM | P1 |
| Prospeo Search Person adapter | MEDIUM (more search volume) | LOW | P1 |
| Exa.ai Websets | MEDIUM (niche/hard queries) | MEDIUM | P2 |
| Agent-driven source selection | MEDIUM (cost optimization) | MEDIUM | P2 |
| Apify LinkedIn scrapers | MEDIUM (specific "find employees" use case) | MEDIUM | P2 |
| Per-client KB examples workflow | MEDIUM (improves Creative Ideas quality) | LOW | P2 |
| AI Ark People Search | LOW (marginal over Apollo) | LOW | P3 |
| Firecrawl directory scraping | LOW (very niche, manual setup per directory) | MEDIUM | P3 |
| Serper.dev social listening | LOW (supplementary signal source) | LOW | P3 |
| Serper.dev Google Maps (local SMB) | LOW (not current client profile) | LOW | P3 |

---

## Complexity Notes Per Feature

### HIGH Complexity
- **Evergreen pipeline (end-to-end):** New Signal model, Railway background processor, integration with 4 existing systems (enrichment, ICP scorer, campaign, writer), batch accumulation logic, Slack notifications, portal hookup. Highest integration surface area in the milestone. Risk: regression in existing enrichment or campaign flow.

### MEDIUM Complexity
- **PredictLeads signal ingestion:** New API client + Railway cron job + Signal DB model. Self-contained but Railway deployment friction and signal dedup logic add work.
- **Creative Ideas framework:** Writer Agent system prompt update + output schema change + KB tag convention. Risk: regressing existing copy quality for non-Creative-Ideas campaigns. Needs careful A/B testing or a `mode` flag on Writer Agent input.
- **Signal dashboard:** New DB table + Next.js page + aggregation queries. Straightforward but non-trivial query work for per-client cost rollups over time.
- **Exa.ai Websets:** Async pattern (minutes per query, not seconds). Needs polling or webhook for completion. Different from the sync Apollo/Prospeo calls — changes the Leads Agent UX ("I'll run this in the background and report back").
- **Agent-driven source selection:** More cognitive/prompt engineering complexity than code complexity. Requires ICP classification heuristic that doesn't generate wrong routing.
- **Apify LinkedIn:** Async actor execution (Apify SDK, polling run completion). HarvestAPI actors are confirmed to exist; actor slug / API call pattern needs verification.

### LOW Complexity
- **Apollo people search adapter:** REST API call pattern, same shape as existing enrichment adapters. 50-80 lines. Confirmed credit-free via official docs.
- **Prospeo Search Person adapter:** Same API key, different endpoint. Same pattern as existing `prospeo.ts`. 50-80 lines.
- **CLI orchestrator chat:** readline loop + existing `runAgent()`. ~100 lines. No new dependencies.
- **Per-client KB examples admin workflow:** Using existing `scripts/ingest-document.ts` with new tag convention. Zero new code needed for MVP; just documentation of the convention.

---

## Open Questions / Items Needing Validation

1. **PredictLeads pricing beyond 100 free requests.** Pricing is demo/contact only — not public. Must validate before designing polling frequency and per-client cost model. Risk: could be expensive at scale.

2. **AI Ark search endpoint and auth header.** Is there a dedicated `/search` endpoint for people search, or does it use the same `/people` endpoint with different params? Auth header literal (`X-TOKEN` vs `Authorization` Bearer) still LOW confidence from v1.0 — needs live test.

3. **Exa.ai Websets timing.** Documentation says "minutes" for hard queries; confirmed sub-200ms for standard search. Need to validate actual Websets latency before designing the agent UX. If >5 minutes, needs async pattern with status polling.

4. **Apify actor slugs for HarvestAPI no-cookie scrapers.** Actors exist on Apify marketplace (confirmed). Need exact actor IDs: `harvestapi/linkedin-profile-search-by-name` and `harvestapi/linkedin-company-employees`. Pricing of $3/1k profiles and $1/1k jobs confirmed in actor listings.

5. **Railway cron + TypeScript execution.** Existing Railway deployment runs the LinkedIn worker. Confirm that Railway can execute TypeScript directly (via tsx/ts-node) or if a compiled JS build step is needed for the signal poller.

6. **Creative Ideas example count for stable output.** Growth Engine X guidance implies 10+ hand-written examples per client before AI output is reliable. For 6 clients, that's 60+ examples to generate. Need a practical bootstrap plan (AI draft → admin review → ingest) rather than expecting 60 perfect hand-written examples upfront.

7. **Signal deduplication fingerprint design.** PredictLeads may return overlapping signals across polling windows. Fingerprint must be deterministic: `sha256(companyDomain + signalType + firedAt.toDateString())`. Need to verify PredictLeads returns consistent `firedAt` timestamps for the same event across polls.

8. **Enrichment waterfall reorder (v2.0 tech debt).** PROJECT.md notes "Enrichment waterfall reordered to actual cheapest-first" as a v2.0 active item. Need to verify current order vs actual cost-per-successful-email for Prospeo, AI Ark, LeadMagic, FindyMail. This is not a new feature but a correctness fix.

---

## Sources

- [Apollo People Search API — confirmed credit-free search](https://docs.apollo.io/reference/people-api-search) — HIGH confidence (official docs, verified statement: "optimized for API usage and does not consume credits")
- [Prospeo Search Person API — 280M contacts, 20+ filters, 1 credit/page, no email in results](https://prospeo.io/api-docs/search-person) — HIGH confidence (official docs)
- [PredictLeads — 100 free API requests/month, 29 event categories, 100M companies, 9.2M job openings](https://predictleads.com/) — HIGH confidence (official site, confirmed statement)
- [PredictLeads Documentation — available signal types and API endpoints](https://docs.predictleads.com/) — HIGH confidence (official docs)
- [Exa.ai pricing — $7/1k standard search, Websets for complex queries](https://exa.ai/pricing) — HIGH confidence (official pricing page)
- [Exa.ai sub-200ms search (Feb 2026 update)](https://exa.ai/blog/fastest-search-api) — HIGH confidence (official blog)
- [Serper.dev — $0.001/query for Google Search + Maps + News, 2,500 free queries on signup](https://serper.dev/) — HIGH confidence (official site)
- [Apify HarvestAPI LinkedIn Profile Search — no cookies, $3/1k profiles](https://apify.com/harvestapi/linkedin-profile-search-by-name/api) — HIGH confidence (official Apify marketplace listing)
- [Apify HarvestAPI LinkedIn Company Employees — no cookies](https://apify.com/harvestapi/linkedin-company-employees) — HIGH confidence (official Apify marketplace)
- [Firecrawl /extract endpoint — AI schema-based extraction, still in Beta](https://docs.firecrawl.dev/features/extract) — HIGH confidence (official docs, Beta status confirmed)
- [AI Ark People Search — filters and 100 free trial credits](https://ai-ark.com/platform/people-search/) — MEDIUM confidence (official site; API doc detail limited; auth header still LOW confidence from v1.0)
- [Growth Engine X cold email methodology — constrained offering framework](https://www.growthenginex.com/) — MEDIUM confidence (confirmed via Salesforge review + SmartLead case study; "3x reply rates" not independently verified)
- [Evergreen campaign pattern — leads added weekly on autopilot](https://www.linkedin.com/posts/george-wauchope_how-to-launch-an-evergreen-cold-email-campaign-activity-7237610414652428289-LKHX) — MEDIUM confidence (practitioner source, consistent with other sources)
- [Signal-triggered messaging 2.3x higher reply rates vs generic](https://www.buzzlead.io/blogs/cold-email-in-2025-the-playbook-has-changed) — LOW confidence (single source, no primary research cited; directionally plausible)
- Existing codebase: `src/lib/agents/runner.ts`, `src/lib/agents/types.ts`, `src/lib/enrichment/providers/prospeo.ts`, `src/lib/enrichment/providers/aiark-person.ts` — HIGH confidence (ground truth; read directly)

---

*Feature research for: Outsignal Lead Engine v2.0 Lead Discovery & Intelligence*
*Researched: 2026-03-03*
