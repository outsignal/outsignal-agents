# Project Research Summary

**Project:** outsignal-agents — Lead Enrichment Pipeline (Clay Replacement)
**Domain:** Multi-source B2B lead enrichment, waterfall orchestration, ICP qualification
**Researched:** 2026-02-26
**Confidence:** MEDIUM overall (HIGH on codebase integration patterns; MEDIUM/LOW on external provider pricing and API shapes — verify before implementation)

---

## Executive Summary

This project replaces Clay ($300+/mo) with a self-hosted enrichment pipeline built on top of the existing outsignal-agents codebase. The approach is validated: a LinkedIn-referenced lead gen agency uses the same unbundled stack (Prospeo + AI Ark + Firecrawl + Haiku + EmailBison) and it demonstrably replicates Clay's functionality at a fraction of the cost. The existing Next.js 16/Prisma 6/PostgreSQL/Vercel AI SDK stack requires no changes — only two new npm packages (`p-limit`, `p-retry`) and typed REST clients for Prospeo, AI Ark, LeadMagic, and FindyMail are needed. The enrichment logic itself is pure TypeScript, not a new framework.

The recommended architecture is a waterfall pipeline: check local DB first (free, instant), escalate to cheap API sources, stop as soon as sufficient data is found, and run AI normalization as a final pass. This dedup-first pattern is the central cost control mechanism. With 14,563 existing person records, a high proportion of requests will short-circuit before hitting any paid API. Estimated cost per 1,000 new prospects is $67–165 versus Clay's effective ~$300+/mo flat rate. However, these cost estimates have LOW confidence — a 100-record test run against each provider is required to establish real per-record costs before committing to any subscription tier.

The most important risk is the interaction between schema design and data quality: the pipeline must define field-level merge precedence, enrichment status tracking, and a canonical industry taxonomy before any provider is wired in. Retrofitting these after the fact requires data migrations across the existing 14k+ person records. The second significant risk is Vercel serverless timeouts for batches larger than 5–10 leads — the async job queue pattern must be chosen and implemented before any bulk enrichment is written. Both of these are Phase 1 concerns, not afterthoughts.

---

## Key Findings

### Recommended Stack

The existing stack is the stack. Only two additions are needed: `p-limit` for concurrency control and `p-retry` for exponential backoff against provider 429s. All four enrichment providers (Prospeo, AI Ark, LeadMagic, FindyMail) are called via plain `fetch()` with typed wrappers — no SDKs. This is intentional: provider SDKs for smaller B2B data services are poorly maintained and harder to mock. Claude Haiku (already wired via `@ai-sdk/anthropic`) handles both AI normalization and ICP qualification at sub-penny-per-call economics.

**Core technologies:**
- `Next.js 16.1.6`: API routes for enrichment trigger points — no changes, already deployed
- `Prisma 6.19.2`: ORM for dedup checks, upsert logic, and provenance logging — extend with EnrichmentRun model and new Person fields
- `p-limit ^6.0.0`: Concurrency limiter for parallel waterfall calls — prevents simultaneous rate-limit breaches across providers
- `p-retry ^6.0.0`: Exponential backoff for transient provider failures — essential since enrichment APIs return 429s under load
- `claude-haiku-4-5-20251001`: AI normalization and ICP classification — already wired, ~$0.0004/prospect
- `Prospeo` (REST): Primary email finder, especially LinkedIn URL → email; 1 credit per find
- `AI Ark` (REST): Company and person depth enrichment (headcount, industry, description, tech stack); cheapest Clay replacement for data fields
- `LeadMagic` (REST): Email verification (run last, before EmailBison export only); also fallback email finder
- `FindyMail` (REST): Third-level fallback email finder; superior catch-all domain handling
- `Firecrawl` (already integrated): ICP qualification via website scraping; use `scrapeUrl()` on homepage only, not full crawl

**Critical version note:** `p-limit` v6 and `p-retry` v6 are ESM-only. Next.js 16 handles this correctly — use `import`, never `require()`.

---

### Expected Features

The MVP goal is "Cancel Clay" — replicating all active Clay usage for the 6 client workspaces. Everything on the P1 list must ship before Clay is cancelled.

**Must have (table stakes — P1, cancel Clay):**
- Dedup check before every external API call — the single most important cost control
- Email finding waterfall: Prospeo (LinkedIn URL path) → Prospeo (name+domain) → LeadMagic → FindyMail
- Email verification (LeadMagic) — hard gate before any EmailBison export
- Person enrichment: name, title, company, LinkedIn URL via AI Ark / Prospeo
- Company enrichment: industry, headcount, revenue estimate, description via AI Ark
- AI normalization: industry taxonomy, seniority classification, company name cleanup via Claude Haiku
- Lead scoring: 1–10 signal overlap score using 3-layer cold email framework signal model
- Search and filter UI: browse by name, company, vertical, enrichment status, score with pagination
- List building: create named lists, filter-to-list workflow, workspace-scoped
- Export to EmailBison: direct API push from list to campaign (verified emails only)

**Should have (competitive differentiators — P2, after pipeline proven):**
- ICP fit qualification via Firecrawl + Haiku — higher per-lead cost, validate ROI first
- Signal-based segmentation — requires rich enough signal data to be reliably populated first
- Enrichment cost transparency — surface per-lead API cost; less urgent than the pipeline itself
- Vertical-aware scoring tuning — per-client scoring rule customization; start shared, tune after

**Defer to v2+:**
- Real-time intent signals (RB2B, Warmly) — separate infrastructure, out of scope per PROJECT.md
- Copy Agent ↔ enrichment data integration — Writer Agent exists but needs enrichment context pipeline wired first
- Bulk enrichment scheduling (nightly refresh cron)
- LinkedIn profile-sourced enrichment — defer until pipeline is stable

**Anti-features (never build):**
- LinkedIn automation or scraping (ToS violation; use AI Ark's compliant data instead)
- Email campaign sending (EmailBison already does this; do not duplicate)
- AI-generated enrichment hallucination ("fill in missing fields with AI facts") — only use AI for normalization of real data, never generation of facts
- Full CRM features — EmailBison is the system of record

---

### Architecture Approach

The architecture is a layered enrichment pipeline sitting between trigger surfaces (API routes, Leads Agent, CLI) and the existing Prisma data layer. All enrichment logic lives in `src/lib/enrichment/` — agents and API routes call the pipeline; they never implement provider logic directly. Each provider is an isolated module implementing a common `EnrichmentProvider` interface, making new providers addable as single-file additions. An `EnrichmentRun` Prisma model provides full provenance tracking (which provider found which field, cost, duration) from day one — without it, cost tracking and debugging are impossible.

**Major components:**
1. `EnrichmentPipeline` (`src/lib/enrichment/pipeline.ts`) — orchestrates dedup, waterfall, merge, AI normalization, persist; the single entry point
2. `EnrichmentProvider` interface (`src/lib/enrichment/types.ts`) — common contract for all provider adapters; enables swappability and mocking
3. Provider adapters (`src/lib/enrichment/providers/`) — Prospeo, AI Ark, LeadMagic, Firecrawl; each translates provider API → normalized `PersonEnrichmentData`
4. Field merger (`src/lib/enrichment/merge.ts`) — field-level precedence rules (first-write-wins for most fields; last-write for verification status and AI-normalized fields)
5. AI normalizer (`src/lib/enrichment/normalize-ai.ts`) — Claude Haiku final pass; must use `generateObject` with Zod schema, never freeform text
6. Leads Agent (`src/lib/agents/leads.ts`) — follows existing `runner.ts` pattern exactly; provides chat-driven enrichment, search, list building, export as agent tools
7. `EnrichmentRun` model — provenance log, cost tracking, `triggeredBy` source attribution

---

### Critical Pitfalls

1. **Enrichment overwrites good data with bad data** — The current `route.ts` unconditionally overwrites `linkedinUrl`, `companyDomain`, and `location` when any new payload value is present. The new pipeline must implement field-level precedence merge (`merge.ts`) before any provider is wired in. Define provider authority per field: AI Ark > Prospeo for LinkedIn URLs; LeadMagic is authoritative for email verification status.

2. **No dedup gate before API calls burns credits exponentially** — With 14k+ existing person records and 6 workspaces running concurrent campaigns, even a 1% re-enrichment rate wastes 140+ API credits/week. Implement `shouldEnrich(person, provider)` — checks `enrichedAt` timestamp and `enrichmentSources` JSON — as the first function called in every enrichment path, including job enqueue time.

3. **Vercel serverless timeouts kill batch enrichment** — 10-lead batches at 3 providers × 2s each = 60s, which exceeds Vercel's default timeout. Never run enrichment for batches > 5 leads synchronously in a request handler. Use a DB-backed job queue (EnrichmentJob table + Vercel Cron) or chunked batch pattern (5 leads/invocation, DB offset tracking) from the start.

4. **Inconsistent industry taxonomy breaks filtering and segmentation** — Without a controlled vocabulary, Claude produces 40+ variations of "recruitment". Define a canonical vertical list in `src/lib/enrichment/verticals.ts` before building the normalization prompt. Validate Claude output against the canonical list before DB write — reject and retry if invalid.

5. **Firecrawl cost spiral on invalid/blocked URLs** — A significant percentage of B2B company URLs are behind Cloudflare, parked, or return 404. Cache crawl results on `Company.enrichmentData.firecrawl_crawled_at`; use single-page `scrapeUrl()` not full `crawlWebsite()`; run a HEAD pre-flight before dispatching any Firecrawl job.

6. **Email verification not gating list export** — A single unverified bulk export can push bounce rates above 5-8%, damaging sending domain reputation for all 6 client workspaces. The export function must refuse if `emailVerified != true`. This is a hard gate, not a soft warning.

7. **Missing enrichment status tracking = invisible pipeline** — Without `enrichedAt`, `enrichmentStatus`, and `enrichmentSources` fields on Person, the pipeline cannot distinguish "not yet tried" from "tried and failed." Add these fields and DB indexes in the schema migration before any enrichment code runs.

---

## Implications for Roadmap

Based on combined research, the following 5-phase structure is recommended. The ordering is driven by hard dependencies: schema must precede pipeline, pipeline must precede providers, providers must precede agents, agents and pipeline must precede UI.

### Phase 1: Schema Extension + Enrichment Foundation

**Rationale:** Every subsequent phase depends on the data model and core pipeline contract being correct from the start. Retrofitting field-level merge, enrichment status tracking, and the canonical taxonomy after 14k+ records are enriched with the new system requires expensive migrations. This phase has no user-visible deliverable but is the highest-leverage work in the project.

**Delivers:**
- `EnrichmentRun` Prisma model (provenance, cost tracking, attribution)
- New Person fields: `enrichedAt`, `enrichmentStatus`, `enrichmentSources` (JSON), with DB indexes
- `EnrichmentProvider` interface + `PersonEnrichmentData` type definitions
- `merge.ts` — field-level precedence merge with defined provider authority
- `dedup.ts` — `shouldEnrich(person, provider)` function
- `verticals.ts` — canonical industry taxonomy (covering all 6 client verticals)
- `normalize-ai.ts` — Haiku normalization with `generateObject` + Zod schema validation
- Basic `pipeline.ts` shell (dedup + single provider placeholder + persist)
- Decision: async job queue pattern (EnrichmentJob table + Vercel Cron recommended)

**Avoids:** Pitfalls 1, 2, 3, 5, 6, 7 (all Phase 1 concerns per pitfall-to-phase mapping)

**Research flag:** Standard patterns — high confidence from codebase inspection. Skip `/gsd:research-phase`.

---

### Phase 2: Provider Adapters + Waterfall Wiring

**Rationale:** Once the interface and merge logic exist, all four provider adapters can be written (and tested with mocks) independently and in parallel. This is the core Clay-replacement work. The waterfall order and sufficiency rules are the critical decisions here.

**Delivers:**
- `providers/prospeo.ts` — LinkedIn URL → email (primary path), name+domain → email (fallback)
- `providers/aiark.ts` — company enrichment (headcount, industry, description, tech stack) + person depth
- `providers/leadmagic.ts` — email verification (called last, before export only — NOT during general enrichment)
- `providers/firecrawl.ts` — ICP qualification scrape (homepage only, cached, pre-flighted)
- Full waterfall wiring in `pipeline.ts` with early-exit sufficiency rules
- `p-limit` + `p-retry` concurrency and retry wrappers per provider
- Provider-level error distinction: 404 (permanent, don't retry) vs 429 (transient, backoff) vs 422 (invalid input, fix data)
- Unit tests for waterfall logic with mocked provider responses (Vitest)

**Uses:** Prospeo, AI Ark, LeadMagic, FindyMail APIs; `p-limit`, `p-retry`

**Avoids:** Pitfall 1 (merge.ts already exists), Pitfall 2 (dedup.ts already exists), Pitfall 4 (LeadMagic wired correctly as verification-only step)

**Research flag:** Needs `/gsd:research-phase` — provider API endpoint shapes (especially AI Ark) have LOW confidence from training data. Verify exact request/response schemas against official docs for each provider before implementation.

---

### Phase 3: Leads Agent

**Rationale:** With the pipeline working, the Leads Agent is a thin orchestration layer over it — identical in structure to the existing `research.ts` agent. This follows the established `runner.ts` pattern exactly, with no new patterns to invent. The agent makes the pipeline accessible to chat-driven workflows.

**Delivers:**
- `src/lib/agents/leads.ts` — follows `research.ts` pattern exactly
- Tools: `enrichPerson`, `enrichBatch`, `searchPeople`, `createList`, `exportToEmailBison`
- `delegateToLeads` in orchestrator (`orchestrator.ts`) — currently a stub, wire it in
- Enrichment job status tool (poll EnrichmentJob table)

**Implements:** Leads Agent component from architecture

**Research flag:** Standard patterns — follows existing runner.ts exactly. Skip `/gsd:research-phase`.

---

### Phase 4: Search, Filter + List Building UI

**Rationale:** The UI should be built after the pipeline produces high-quality, normalized, consistently-shaped data. Building UI on top of un-enriched, un-normalized data produces bad UX and forces UI rework once the data layer improves. This phase is the highest-complexity UI work (filter combinations, pagination, workspace scoping).

**Delivers:**
- `/api/people/search` route — filter by company, vertical, enrichment status, score, with pagination
- Lead search page component — default sort: most recently enriched, secondary: most complete profile
- List builder page — save filter results as named workspace-scoped lists
- Enrichment status indicators per lead (enriched / partial / missing fields)
- Inline edit on lead detail for `vertical`, `jobTitle`, `company`, `companyDomain` (manually-edited fields flagged, not overwritten by pipeline)
- Enrichment cost transparency: per-lead API cost and total cost per list

**Addresses:** Search/filter UI, list building, enrichment status indicators, cost transparency (from FEATURES.md)

**Research flag:** Standard patterns — Next.js app router + Prisma filters. Skip `/gsd:research-phase`.

---

### Phase 5: EmailBison Export + ICP Qualification

**Rationale:** Export is last because it is the highest-stakes operation (domain reputation damage is the hardest to recover from). The verification gate and export preview step must be proven correct in a low-scale pilot before enabling for all 6 workspaces. ICP qualification (Firecrawl + Haiku) is bundled here as it gates which leads are worth exporting.

**Delivers:**
- List export to EmailBison: direct API push with hard `emailVerified = true` gate
- Export Preview: lead count, email verification %, vertical breakdown, estimated bounce risk — confirmed before push
- ICP fit qualification: Firecrawl `scrapeUrl()` → Haiku classification → `icpFit` score on Person
- Firecrawl caching: `Company.enrichmentData.firecrawl_crawled_at` read before any new crawl job
- HEAD pre-flight for URL validity before dispatching Firecrawl
- Signal-based segmentation: filter by signal stack (headcount + ICP fit + recency)
- Pilot test: 10-lead list through full pipeline → export → bounce rate validation before scaling

**Avoids:** Pitfall 4 (Firecrawl cost spiral), Pitfall 7 (unverified export)

**Research flag:** Needs `/gsd:research-phase` for EmailBison API export integration (confirm campaign lead push endpoint and authentication pattern).

---

### Phase Ordering Rationale

- **Schema before everything:** Fields added to Person later require migrations against 14k+ records. Define once, migrate once.
- **Interface before providers:** The `EnrichmentProvider` contract ensures all four adapters are swappable and mockable. Writing providers before the interface means retrofitting the contract.
- **Provider adapters before agent:** The Leads Agent calls `enrichPerson()` — that function must exist and be tested before the agent is written.
- **Data quality before UI:** Showing partially-enriched, inconsistently-normalized data in a search UI requires UI rework when the data improves. Build UI on clean data.
- **Export last, with pilot gate:** Domain reputation is the only pitfall with HIGH recovery cost (4-6 week warm-up delay). The 10-lead pilot before full export is non-negotiable.

### Research Flags Summary

Needs deeper research during planning:
- **Phase 2:** AI Ark, Prospeo, LeadMagic, FindyMail API docs — endpoint shapes, exact request/response schemas, rate limits. LOW confidence from training data.
- **Phase 5:** EmailBison API for campaign lead push — confirm exact endpoint and auth pattern.

Standard patterns (skip research-phase):
- **Phase 1:** Schema extension and TypeScript interface patterns — HIGH confidence from codebase
- **Phase 3:** Leads Agent — follows existing runner.ts pattern exactly
- **Phase 4:** Next.js UI + Prisma filter queries — well-documented, established patterns

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM | Core stack (Next.js, Prisma, Claude, Firecrawl) is HIGH — direct codebase confirmation. p-limit/p-retry patterns are HIGH. Provider API shapes are MEDIUM/LOW — training data cutoff Aug 2025; AI Ark is the lowest confidence. |
| Features | MEDIUM | Table stakes features are HIGH confidence (domain-standard). Differentiator features (scoring, vertical-aware rules) are MEDIUM — validated by cold email framework and agency reference in PROJECT.md but not externally sourced. |
| Architecture | HIGH | Patterns (waterfall, provider abstraction, provenance logging) are well-established in B2B data tooling and directly supported by codebase inspection of existing agent/enrichment patterns. Build order has HIGH confidence. |
| Pitfalls | HIGH | 7 critical pitfalls are all grounded in direct codebase analysis (identified specific lines with issues) + domain knowledge of cold email deliverability. These are not speculative. |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **AI Ark API shape:** The endpoint URL, exact field names, and response schema in STACK.md are LOW confidence (training data only). This is the highest research priority before Phase 2 begins. Check `aiark.com` docs before writing the adapter.
- **Provider pricing:** All pricing numbers in STACK.md are MEDIUM/LOW confidence. Run a 100-record test against each provider before choosing a subscription tier. Don't commit to annual plans.
- **Rate limits:** No provider officially publishes their rate limits. Use `p-limit(5)` (5 concurrent requests) as the conservative default for all providers; tune up if monitoring shows headroom.
- **FindyMail API shape:** LOW confidence — verify endpoint and authentication before implementing the adapter.
- **EmailBison export API:** Not researched. Confirm campaign lead push endpoint and authentication pattern before Phase 5 planning.
- **Vertical taxonomy:** Six client verticals are defined in project memory, but a full canonical list covering all prospect industry segments has not been drafted. This must be written in Phase 1 (`verticals.ts`) before the normalization prompt is built.

---

## Sources

### Primary (HIGH confidence — direct codebase inspection)
- `/Users/jjay/programs/outsignal-agents/src/lib/agents/runner.ts` — existing agent runner pattern (Leads Agent must match this exactly)
- `/Users/jjay/programs/outsignal-agents/src/lib/agents/types.ts` — Claude model IDs confirmed
- `/Users/jjay/programs/outsignal-agents/src/lib/firecrawl/client.ts` — existing Firecrawl integration
- `/Users/jjay/programs/outsignal-agents/src/app/api/people/enrich/route.ts` — current enrichment write logic (specific overwrite bugs identified)
- `/Users/jjay/programs/outsignal-agents/prisma/schema.prisma` — existing data models; extension points identified
- `/Users/jjay/programs/outsignal-agents/package.json` — exact installed package versions
- `/Users/jjay/programs/outsignal-agents/.planning/PROJECT.md` — milestone scope, provider choices, constraints (project's own spec)
- `/Users/jjay/programs/outsignal-agents/.planning/STATE.md` — confirmed external APIs: Prospeo, LeadMagic, FindyMail, AI Ark, SerperDev

### Secondary (MEDIUM confidence — operational frameworks and community-validated patterns)
- `/tmp/cold-email-engine-framework.md` — signal layer model, 4-tier qualification, list building strategy
- `/tmp/clay_prompts.md` — Clay's 102 Claygent prompt categories (defines what AI normalization must cover)
- Agency validation referenced in PROJECT.md: Prospeo + AI Ark + Firecrawl + Haiku + EmailBison replacing Clay — community-validated stack

### Tertiary (LOW confidence — training data, verify before implementation)
- Provider API shapes and pricing: Prospeo, AI Ark, LeadMagic, FindyMail — training data Aug 2025 cutoff; verify at each provider's docs before implementing adapters
- p-limit / p-retry ESM compatibility — confirmed from npm registry; MEDIUM
- Vercel timeout limits — MEDIUM confidence; current limits are 10s default / 300s Pro; verify current Vercel plan limits

---
*Research completed: 2026-02-26*
*Ready for roadmap: yes*
