# Project Research Summary

**Project:** Outsignal Lead Engine v2.0 — Lead Discovery & Intelligence
**Domain:** Multi-source lead discovery, signal monitoring, Creative Ideas copy generation, CLI orchestrator
**Researched:** 2026-03-03
**Confidence:** HIGH (architecture grounded in live codebase inspection; API behavior from official docs)

## Executive Summary

Outsignal v2.0 extends an already-functional cold outbound engine (14.5k contacts, 6 clients, enrichment waterfall, campaign lifecycle, portal) with three major capabilities: (1) multi-source lead discovery from external databases (Apollo, Prospeo, Exa.ai, Apify LinkedIn, Serper.dev, AI Ark) that feeds into the existing enrichment waterfall; (2) automated signal monitoring via PredictLeads and Serper.dev that detects funding, hiring, and tech adoption events and routes them into an "evergreen campaign" auto-pipeline; and (3) a Creative Ideas copy framework that generates 3 constrained, specific offering ideas per prospect using the Growth Engine X methodology, grounded in each client's real service capabilities. The recommended build strategy is additive: new modules mirror existing patterns exactly (discovery mirrors enrichment/providers/, signal worker mirrors LinkedIn worker, Creative Ideas mode is a Writer Agent extension), and nothing in the existing v1.0/v1.1 system gets modified except targeted tool and prompt additions to existing agents.

The key architectural constraint the research validates is platform separation: all signal processing and async work runs on Railway (where the LinkedIn worker already lives), not on Vercel, which is already at its 2-cron Hobby limit and has a 300s function timeout that would kill multi-company signal processing. Discovery adapters run on Vercel (short-lived API calls), but the signal monitoring cron, signal-to-enrichment pipeline triggers, and Apify LinkedIn scraping actor calls all live on Railway. The Railway worker writes directly to Neon via a shared Prisma client rather than going through Vercel API routes — this is a hard architectural requirement due to timeout constraints, not a preference.

The highest-risk area is the combination of Apollo.io ToS restrictions, auto-pipeline gate integrity, and cost explosion from signal burst events. Apollo explicitly prohibits running API searches across multiple paying clients from a shared key — each workspace must have its own Apollo API key from day one, and Apollo should be treated as enrichment-targeted rather than bulk discovery. The auto-pipeline must have a cryptographic human gate before any campaign reaches EmailBison — no automated code path should be able to set `status: "approved"` without a timestamped human approval event. Signal monitoring must have a per-workspace daily budget cap checked before spawning enrichment jobs, because a single burst event (85 companies raising Series A simultaneously) can generate $30-50 in external API costs in one cron run.

---

## Key Findings

### Recommended Stack

The stack is minimal: only 2 new npm packages are required (`exa-js@2.6.1` and `apify-client@2.22.2`). Everything else uses `fetch()` with typed adapters or reuses existing dependencies (`ai@6`, `@ai-sdk/anthropic@3`, `tsx@4.21.0`, `recharts@3`). The `exa-js` SDK is required because Exa Websets uses an async polling lifecycle that would require ~100 lines of retry/polling code if done raw; the `apify-client` SDK handles actor-run polling and paginated dataset retrieval that Apify's REST API exposes as multi-step operations. No cron libraries, no Redis, no additional AI frameworks.

**Core new packages:**
- `exa-js@2.6.1`: Exa Websets async SDK — handles async lifecycle natively; TypeScript types included
- `apify-client@2.22.2`: Apify platform client — handles actor polling + dataset pagination; TypeScript types included

**New environment variables required:**
- `APOLLO_API_KEY` — per-workspace (NOT shared); Apollo.io People Search
- `EXA_API_KEY` — Exa.ai Websets
- `APIFY_API_TOKEN` — Apify LinkedIn actors
- `PREDICTLEADS_API_TOKEN` + `PREDICTLEADS_API_KEY` — PredictLeads (both required as query params, not Authorization header)
- `SERPER_API_KEY` — Serper.dev (search/news/maps)

**Existing keys extend to new use cases:**
- `PROSPEO_API_KEY` — already installed; `/search-person` endpoint is separate from existing enrichment endpoint; no new key needed
- `AIARK_API_KEY` — already installed; People Search endpoint unconfirmed (LOW confidence — verify in AI Ark dashboard before implementing)

**Do not install:** `node-cron`, `croner`, `serper` npm package, any LangChain/LlamaIndex abstraction, Playwright/Puppeteer, Redis/BullMQ. All are either incompatible with the Railway/Vercel architecture, redundant over existing deps, or explicitly excluded from PROJECT.md scope.

### Expected Features

**Must have (table stakes for v2.0 MVP):**
- Apollo people search adapter — free, 275M contacts, validates the discovery module pattern with zero credit cost
- Prospeo Search Person adapter — same existing API key, natural extension, 1 credit/page of 25 results
- PredictLeads signal ingestion (job openings + funding events) — the defining feature of the milestone; without it, evergreen campaigns never receive leads
- Evergreen signal campaign pipeline — end-to-end: signal fires, enrich, ICP score, add to campaign, Writer Agent, portal notification, deploy
- Creative Ideas copy framework — 3 constrained ideas per prospect; Writer Agent system prompt update + KB tag convention; no new agent
- Signal dashboard (`/admin/signals`) — feed, per-client breakdown, pipeline status; needed for debugging and demonstrating value to clients
- CLI orchestrator chat — `scripts/cli-chat.ts`; ~100 lines; reuses existing `orchestratorTools`; highest value-to-effort ratio in the milestone

**Should have (add in v2.x after core validates):**
- Exa.ai Websets adapter — async pattern adds UX complexity; add after sync sources validated
- Apify LinkedIn no-cookie scrapers — for "find all employees at Company X" use case; add when a client requests it
- Agent-driven source selection (automatic ICP-to-source routing) — add once 3+ sources are live and cost patterns are observable
- Per-client Creative Ideas KB examples workflow — admin ingestion with tag convention; improves output quality substantially once framework is generating

**Defer to v2.x or v3+:**
- AI Ark People Search — LOW confidence on API endpoint; marginal value over Apollo + Prospeo until confirmed
- Firecrawl directory scraping — valid use case but requires per-directory extraction schema; too manual for this milestone
- Serper.dev social/Reddit listening — supplementary to PredictLeads; add after primary signal source is stable
- Serper.dev Google Maps for local SMB — not relevant to any of the current 6 clients' ICPs
- Evergreen batching config UI — currently hardcoded per SignalCampaignRule; expose in UI only when clients ask to tune it
- Signal scoring weights calibration — requires 30+ days of historical data to calibrate

**Anti-features (do not build):**
- Signal-triggered email hooks ("congrats on funding") — the Creative Ideas framework is explicitly built on the opposite principle: signals are targeting inputs only, never copy hooks; Writer Agent rule 12 enforces this
- Per-lead approve/reject in portal — ruled out in v1.0; binary list-level approval ships
- Real-time WebSocket signal feed — 30s polling refresh is sufficient at 6-client scale; WebSockets add complexity with no real benefit
- StoreLeads.io integration — explicitly excluded in PROJECT.md; Serper Maps covers the use case at $0.001/query vs $75-950/mo
- Twitter/X full API social listening — $100+/mo developer access; Serper Google News + Reddit covers B2B signal value at $0.001/query

### Architecture Approach

The architecture is strictly additive: new `src/lib/discovery/` module mirrors `src/lib/enrichment/providers/` exactly; new `worker/src/signal-worker.ts` mirrors the existing `worker/src/worker.ts` pattern; new Writer Agent tools are appended to existing `writerTools` object without modifying existing tools; new Leads Agent tools are appended to existing `leadsTools`. The signal worker runs inside the same Railway service as the LinkedIn worker, launched in parallel from `worker/src/index.ts`. The CLI chat is a standalone `scripts/cli-chat.ts` readline loop calling `generateText()` with the same `orchestratorTools` used by the dashboard — no new MCP server, no new agent type, no new service.

**Critical separation: discovery vs enrichment.** Discovery adapters take search criteria and return lead lists (no emails). Enrichment adapters take identifiers and return field values. These must live in separate modules (`src/lib/discovery/` vs `src/lib/enrichment/`) with separate type contracts. Mixing them breaks the waterfall interface and confuses the adapter contracts.

**Critical separation: Railway vs Vercel.** Signal monitoring cron runs on Railway (Vercel is already at 2-cron Hobby limit; 300s function timeout would kill multi-company signal processing). Vercel handles only short-lived HTTP endpoints. The Railway worker writes directly to Neon via Prisma — never through Vercel API routes for signal processing.

**Major components:**
1. `src/lib/discovery/` (NEW) — `DiscoveryAdapter` interface; provider adapters for Apollo, Prospeo Search, AI Ark Search, Exa.ai, Serper.dev, Apify; fan-out orchestrator in `index.ts`; `DiscoveredPerson` staging table before promotion to `Person`
2. `worker/src/signal-worker.ts` (NEW on Railway) — polls PredictLeads every 4h per workspace; writes SignalEvents directly to Neon; fires lightweight pipeline trigger call to Vercel API (fast only)
3. `src/app/(admin)/signals/` (NEW Vercel page) — signal dashboard with feed, per-client breakdown, KPI row; 30s client-side polling refresh; no WebSockets
4. `src/app/api/signals/` (NEW Vercel routes) — SignalCampaign CRUD; SignalEvent ingest; async pipeline trigger (fire-and-forget, not awaited)
5. Prisma schema additions — `SignalCampaign` and `SignalEvent` models; deployed via `prisma db push` (consistent with existing practice)
6. Writer Agent extension — `getCreativeIdeasExamples` + `saveCreativeIdeas` tools; Creative Ideas system prompt section; `creative-ideas-{workspaceSlug}` KB tag convention; `groundedIn` field on each generated idea
7. `scripts/cli-chat.ts` (NEW local script) — readline loop; `generateText()` with `orchestratorTools`; accumulated message history across turns; `--workspace [slug]` flag

**Build order (hard dependency chain):**
1. Prisma schema (SignalEvent, SignalCampaign, DiscoveredPerson) — unblocks all downstream
2. Discovery module (src/lib/discovery/) + Apollo + Prospeo adapters
3. Leads Agent upgrade (discoverLeads + searchDirectory tools added)
4. Signal API routes (src/app/api/signals/)
5. Signal Worker on Railway (signal-worker.ts alongside LinkedIn worker)
6. Auto-pipeline (/api/signals/pipeline/trigger async endpoint)
7. Signal dashboard page (/admin/signals)
8. Writer Agent Creative Ideas mode — independent, can parallelize with steps 2-7
9. CLI orchestrator chat — independent, can parallelize with steps 2-7

### Critical Pitfalls

1. **Apollo ToS violation from shared API key across workspaces** — Apollo explicitly prohibits sublicensing; running discovery for 6 paying clients through one API key is prohibited. Prevention: per-workspace Apollo API keys architected from day one; rate delays 2-3s between calls; max 50 calls/day per key; treat Apollo as targeted enrichment, not bulk discovery sweep. This is a Phase 1 architectural decision that cannot be retrofitted.

2. **Auto-pipeline sends unreviewed campaigns to EmailBison** — the existing system already has campaign status and EmailBison deploy logic; the path from signal to send has few hard stops. Prevention: `requiresHumanReview: true` flag only clearable by a human HTTP request with valid session; daily cap on campaigns created from signals per workspace (default 10); audit log entry required before `status: "approved"` is set. The gate must be designed before the pipeline is built.

3. **Signal burst cost explosion** — a batch funding event (85 companies) triggers 425 enrichment calls + 85 Firecrawl crawls + 425 Creative Ideas generations in one cron cycle, generating $30-50 in external API costs from a single run. Prevention: per-workspace signal processing budget envelope (default $2/day) checked before spawning enrichment; max 10 companies per signal type per cron run; priority ordering (funding > hiring spike > news) with budget gates between tiers.

4. **Creative Ideas hallucination of non-existent client services** — without explicit grounding constraints, Claude extrapolates from what sounds plausible for a company type rather than what the client actually offers. Prevention: system prompt must enumerate only the services in `ResearchOutput.valuePropositions`; each idea includes a `groundedIn` field citing the specific service; admin reviews first 20 generated ideas per client before auto-generation is enabled.

5. **Multi-source dedup failure from partial discovery records** — Exa.ai and Serper.dev return records without emails; the existing `Person` unique constraint is on email, so email-less discoveries create duplicate records when multiple sources return the same person. Prevention: `DiscoveredPerson` staging table holds raw discoveries until enrichment confirms a unique email; LinkedIn URL normalization for secondary dedup key; no direct writes to `Person` from discovery without email confirmation.

---

## Implications for Roadmap

The dependency structure maps cleanly to 6-7 implementation phases. Phases 5-6 (Creative Ideas, CLI, Signal Dashboard UI) are partially independent and can be parallelized with earlier phases by a second agent.

### Phase 1: Foundation — Schema + Discovery Module

**Rationale:** Prisma schema unblocks all downstream data writes. Discovery module establishes the reusable adapter pattern before any specific source is integrated. Both have zero external dependencies. Apollo ToS per-workspace key architecture must be locked in here — retrofitting it later requires a schema migration.
**Delivers:** `SignalCampaign`, `SignalEvent`, `DiscoveredPerson` Prisma models (via `prisma db push`); `src/lib/discovery/` with `DiscoveryAdapter` interface and types; Apollo people search adapter; Prospeo Search Person adapter; dedup logic against `DiscoveredPerson` staging table; per-workspace Apollo API key config.
**Addresses:** Apollo people search (P1), Prospeo Search (P1) from FEATURES.md.
**Avoids:** Pitfall 1 (Apollo ToS — per-workspace key architecture set from day one); Pitfall 5 (multi-source dedup — staging table built before any live discovery).
**Research flag:** Standard patterns — mirrors existing enrichment/providers/ exactly. Apollo and Prospeo endpoints are HIGH confidence. No deeper research needed.

### Phase 2: Signal Monitoring Infrastructure

**Rationale:** Signal monitoring is the triggering mechanism for the entire evergreen pipeline. It must exist before the auto-pipeline can be built. Railway worker pattern is established (mirrors LinkedIn worker in worker/src/). The cost budget governor must be built here, not added later as an afterthought.
**Delivers:** `worker/src/signal-worker.ts`; PredictLeads adapter (fetch-based, both query params auth); Serper.dev news adapter; `/api/signals/events` ingest route; `/api/signals/campaigns` CRUD; per-workspace signal processing budget governor (daily cap checked before enrichment spawns); `lastCheckedAt` timestamp tracking to avoid duplicate signals.
**Addresses:** PredictLeads signal ingestion (P1) from FEATURES.md.
**Avoids:** Pitfall 3 (cost explosion — budget governor is a Phase 2 prerequisite, not an optimization); Pitfall 7 (Vercel 300s timeout — Railway-only signal processing enforced); Technical debt of single Railway process (acceptable for MVP, document as known trade-off).
**Research flag:** Needs validation — PredictLeads pricing beyond 100 free requests is demo-only and not public. Test at low volume (2 workspaces, 50 domains) before scaling. Also confirm Railway TypeScript execution (tsx vs compiled JS) for signal-worker.ts.

### Phase 3: Leads Agent Discovery Upgrade

**Rationale:** With the discovery module and schema in place, upgrading the Leads Agent is a straightforward tool addition. This phase validates the full discovery → staging → enrichment → Person promotion flow end-to-end. Critically: do not create a separate Discovery Agent — discovery is a Leads Agent capability, not a new agent domain.
**Delivers:** `discoverLeads` and `searchDirectory` tools added to `leadsTools` in `src/lib/agents/leads.ts`; Leads Agent system prompt Discovery Mode section (ICP-to-source routing logic); import flow that stages discovered records, runs enrichment waterfall, promotes to `Person`; pre-discovery ICP classification in system prompt (not a separate LLM call).
**Addresses:** Agent-driven source selection foundation (P2), end-to-end discovery-to-enrichment flow from FEATURES.md.
**Avoids:** Anti-pattern 1 (creating a Discovery Agent — adds delegation hop with no benefit); Anti-pattern 3 (discovery adapters in enrichment/ directory — different type contracts).
**Research flag:** Standard pattern — tool additions mirror existing enrichment tool pattern exactly. No deeper research needed.

### Phase 4: Evergreen Signal Campaign Auto-Pipeline

**Rationale:** The main v2.0 value proposition. Depends on Phase 1 schema, Phase 2 signals, and the existing enrichment + campaign + writer infrastructure. The human approval gate must be designed and hardcoded before the pipeline is wired — if the pipeline ships without the gate, it will never get the gate.
**Delivers:** `/api/signals/pipeline/trigger` async endpoint (fire-and-forget from signal event creation); full pipeline: signal → enrich → ICP score → campaign create → Writer Agent Creative Ideas → portal notification; `requiresHumanReview` flag with hard gate on EmailBison deploy call; daily pipeline cap (configurable per workspace, default 10 campaigns); `SignalCampaignRule` junction with batch accumulation config; pipeline status audit log.
**Addresses:** Evergreen campaign pipeline (P1) from FEATURES.md.
**Avoids:** Pitfall 2 (auto-pipeline gate — the gate is the core deliverable, not an add-on); Pitfall 3 (cost explosion — pipeline uses budget envelope from Phase 2); Anti-pattern 4 (blocking Railway worker on pipeline completion — fire-and-forget).
**Research flag:** Highest integration complexity in the milestone. Gate logic requires careful testing before `autoPipeline=true` is enabled for any workspace. Consider building with flag disabled initially, enabling manually per workspace after verification.

### Phase 5: Creative Ideas Copy Framework

**Rationale:** Genuinely independent of the signal pipeline. Can be parallelized with Phases 2-4. The Writer Agent already has all the machinery (Research Agent output, KB search, system prompt, output types). This is a targeted extension, not a new agent.
**Delivers:** `getCreativeIdeasExamples` and `saveCreativeIdeas` tools in Writer Agent; Creative Ideas system prompt section (3 ideas, constrained, grounded); `creative-ideas-{workspaceSlug}` KB tag convention; `groundedIn` field required on each generated idea; admin review workflow documentation for first 20 ideas per client; Writer Agent quality rule 12 ("never reference signals, funding, job changes as email hook").
**Addresses:** Creative Ideas copy framework (P1) from FEATURES.md.
**Avoids:** Pitfall 4 (hallucination — `groundedIn` field + explicit service enumeration in system prompt + admin review before auto-generation enabled).
**Research flag:** Standard prompt engineering. The critical risk is hallucination, addressed by grounding constraint design. No deeper API research needed.

### Phase 6: Signal Dashboard + CLI Chat

**Rationale:** Both are lower-complexity deliverables that can be built in parallel with Phase 4-5. Dashboard depends on Phase 1 schema + Phase 2 API routes. CLI chat depends only on the existing orchestrator (available now). Bundle together since both are UI/UX work with no novel integration challenges.
**Delivers:** `/admin/signals` page with KPI row (signals today, active campaigns, pipeline queued, deployed this week); live signal feed with 30s polling refresh; per-client breakdown table; signal campaign detail page with event timeline; `scripts/cli-chat.ts` readline loop with multi-turn accumulated history; `npm run chat` script alias in package.json; CLI session persistence to DB (`AgentRun` with `source: "cli"`).
**Addresses:** Signal dashboard (P1), CLI orchestrator chat (P1) from FEATURES.md.
**Avoids:** Anti-pattern 5 (new MCP server for CLI — simple readline script is correct); UX pitfall of global-first signal feed (default to per-client view, global is opt-in).
**Research flag:** Standard patterns. Signal dashboard mirrors existing admin pages. CLI readline pattern is documented with HIGH confidence from Vercel AI SDK official docs. No research needed.

### Phase 7: Exa.ai Websets + Apify LinkedIn (Advanced Discovery)

**Rationale:** Both sources add async complexity — Exa Websets queries can take minutes; Apify actor runs take 30-120s. Best added after the sync-source discovery module is validated and cost patterns are observable. Adding async complexity before the sync sources are stable creates debugging difficulty.
**Delivers:** `exa.ts` Websets adapter using `exa-js@2.6.1` SDK with async polling; `apify.ts` LinkedIn actor runner using `apify-client@2.22.2`; async discovery UX in Leads Agent ("this search runs in the background — I'll report back when complete"); Apify residential proxy rotation; agent-driven source selection (ICP classification → source routing).
**Addresses:** Exa.ai Websets (P2), Apify LinkedIn (P2), agent-driven source selection (P2) from FEATURES.md.
**Research flag:** Needs validation during planning — Exa Websets actual latency range must be tested before designing agent UX (synchronous vs. background). Apify actor input schema (`harvestapi/linkedin-profile-search`) confirmed on marketplace but exact params require a live test call.

### Phase Ordering Rationale

- Schema-first (Phase 1) is non-negotiable — all other phases write to models that must exist before any code runs
- Discovery module before Leads Agent upgrade (Phases 1 then 3) — the tool imports from the module; the module must be built and tested first
- Signal infrastructure before auto-pipeline (Phase 2 then 4) — the pipeline triggers on signal events; signals must be ingested and stored before the trigger logic is built
- Creative Ideas (Phase 5) and Dashboard/CLI (Phase 6) are genuinely independent and can be built in parallel with Phases 2-4 by a second agent thread, cutting total calendar time
- Async discovery sources (Phase 7) deliberately deferred — async UX complexity is easier to design once sync source patterns are established and cost data is observable
- Enrichment waterfall reorder (flagged in PROJECT.md as v2.0 tech debt) is intentionally NOT in these phases — treat it as a separate surgical migration requiring Railway downtime, scheduled after Phase 4 is stable and no batch jobs are in flight

### Research Flags

Phases needing deeper research or validation during planning:
- **Phase 2 (Signal Monitoring):** PredictLeads pricing beyond 100 free requests/month is by demo only. Must get pricing before designing polling frequency and per-client cost model. If expensive, polling interval may shift from 4-hourly to daily. Also confirm Railway TypeScript execution pattern for signal-worker.ts.
- **Phase 7 (Exa + Apify):** Exa Websets actual P50/P95 latency must be tested — documentation says "minutes" but variance is unknown. This determines whether results can be surfaced synchronously in Leads Agent chat or must be asynchronous. Apify HarvestAPI actor input schema requires a live test call to verify exact params and output field names.

Phases with well-documented patterns (skip research-phase):
- **Phase 1 (Foundation):** Apollo and Prospeo endpoints are HIGH confidence from official docs. Prisma schema additions mirror existing Campaign/Workspace model patterns exactly.
- **Phase 3 (Leads Agent Upgrade):** Tool addition pattern is fully documented in existing codebase — same shape as all existing agent tools.
- **Phase 5 (Creative Ideas):** Writer Agent extension pattern is established. Grounding constraints are a prompt engineering decision, not an API research question.
- **Phase 6 (Dashboard + CLI):** Next.js App Router page patterns are standard; CLI readline + generateText() pattern has HIGH confidence from Vercel AI SDK official docs.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | exa-js@2.6.1 and apify-client@2.22.2 verified via npm. All other integrations use fetch() with existing deps. Existing stack versions locked and not touched. |
| Features | HIGH | Apollo and Prospeo search endpoints confirmed via official docs (credit-free confirmed for Apollo). PredictLeads 100 free requests and 5 signal types confirmed on official site. Growth Engine X framework validated via practitioner sources (3x reply rate claim not independently verified but directionally credible). |
| Architecture | HIGH | Grounded in direct codebase inspection of existing agents, worker, enrichment module, and vercel.json. All patterns verified against live files. Vercel 2-cron constraint confirmed from vercel.json. Railway direct-to-Neon pattern validated from existing worker architecture. |
| Pitfalls | HIGH | Apollo ToS verified from official terms. Vercel 300s timeout from official docs. Neon pooling requirement from Neon docs. Railway resource limits from official docs. AI hallucination risk well-established. Cost burst math verified against provider pricing pages. |

**Overall confidence:** HIGH

### Gaps to Address

- **AI Ark People Search endpoint** (LOW confidence): API endpoint and auth header for the People Search feature are not publicly documented. Must verify in AI Ark dashboard before implementing `aiark-search.ts`. Fallback: skip AI Ark search in MVP; Apollo + Prospeo cover the use case adequately.
- **PredictLeads paid pricing** (MEDIUM confidence): Pricing for plans beyond 100 free requests/month is demo-only. Must get pricing before committing to per-workspace polling frequency. If expensive, polling interval may need to shift from 4-hourly to daily, which changes the signal freshness guarantee.
- **Exa Websets latency** (MEDIUM confidence): Documented as "minutes" for complex queries. Need a live test call to understand actual P50/P95. This determines whether Websets results can surface synchronously in Leads Agent chat or require a "background job" UX pattern.
- **Railway TypeScript execution for signal-worker.ts**: Existing LinkedIn worker runs TypeScript via tsx. Confirm signal-worker.ts can be imported and run identically — no compiled JS build step required for new files.
- **Enrichment waterfall reorder** (v2.0 tech debt flagged in PROJECT.md): Current order is Prospeo → AI Ark → LeadMagic → FindyMail. Reordering to cheapest-first requires verifying actual cost-per-successful-email per provider, then a scheduled downtime deploy. Treat as a separate surgical migration, not part of these 7 phases.
- **Creative Ideas example bootstrap**: Growth Engine X guidance implies 10+ hand-written examples per client for stable output quality. For 6 clients that is 60+ examples. Practical bootstrap plan: AI drafts examples per client → admin reviews 20 → ingests to KB → enables auto-generation. Admin review is a workflow dependency, not a code dependency — plan it as a task alongside Phase 5.

---

## Sources

### Primary (HIGH confidence)
- Apollo.io People API Search official docs — `POST /api/v1/mixed_people/api_search`, credit-free search confirmed
- Apollo.io API Terms of Service — sublicensing prohibition and internal use clause confirmed
- Prospeo Search Person API — `POST /api/prospeo.io/search-person`, 1 credit/25 results, confirmed
- PredictLeads official site and docs — 100 free requests/month, 5 signal types (job openings, financing, news events, tech detections, connections), JSON API format
- exa-js npm + GitHub — version 2.6.1, Websets support confirmed, TypeScript types included
- apify-client npm + Apify docs — version 2.22.2, actor run + dataset pattern confirmed
- HarvestAPI LinkedIn actors (Apify marketplace) — no-cookie actor confirmation, $3/1k profiles pricing confirmed
- Serper.dev official site — $0.001/query, search/news/maps types, X-API-KEY header
- Vercel AI SDK Node.js docs — streamText/generateText + readline pattern, HIGH confidence
- Railway cron and worker docs — native cron scheduling, exit-when-done pattern
- Neon connection pooling docs — PgBouncer pooler required for long-running workers
- Vercel serverless timeout docs — 300s hard max confirmed on Hobby and Pro plans
- Existing codebase (direct inspection) — `src/lib/agents/`, `src/lib/enrichment/providers/`, `worker/src/`, `prisma/schema.prisma`, `vercel.json` — all patterns and constraints verified against live files

### Secondary (MEDIUM confidence)
- Exa.ai Websets overview — async/event-driven pattern confirmed, latency described as "minutes" (range not tested)
- PredictLeads API v3 blog — `api_token` + `api_key` query params auth pattern confirmed
- Serper.dev — $0.001/query pricing from marketing page (rate limits not independently verified)
- Growth Engine X cold email methodology — constrained offering framework, 3 ideas per prospect structure (validated via Salesforge review and SmartLead case study)
- Evergreen campaign pattern — practitioner source (LinkedIn post), directionally credible
- Signal-triggered messaging 2.3x reply rate claim — single source, no primary research cited

### Tertiary (LOW confidence)
- AI Ark People Search API — feature existence confirmed on marketing site; API endpoint and auth header not publicly indexed; must verify in AI Ark dashboard before building `aiark-search.ts`

---
*Research completed: 2026-03-03*
*Ready for roadmap: yes*
