# Stack Research

**Domain:** Outsignal Lead Engine v2.0 — Multi-source lead discovery, signal monitoring, Creative Ideas copy, CLI orchestrator chat, signal dashboard
**Researched:** 2026-03-03
**Confidence:** HIGH (Apollo, Exa SDK, Apify client, cron libs — verified via npm/docs), MEDIUM (PredictLeads auth pattern, Serper patterns — docs/community sources), LOW (AI Ark People Search API — not publicly documented, verify in dashboard)

---

## Scope

This document covers only NET NEW stack additions for v2.0. The existing stack (Next.js 16, Prisma 6, PostgreSQL/Neon, Vercel, Railway, `ai@6`, `@ai-sdk/anthropic@3`, `@mendable/firecrawl-js@4`, `zod@4`, `recharts@3`, Prospeo, AI Ark, LeadMagic, FindyMail) is already validated and must not be touched.

The key constraint: exact versions installed in `package.json` (as of v1.1) are the compatibility baseline.

---

## New npm Packages Required

Two new packages. Everything else uses `fetch()` or existing dependencies.

```bash
npm install exa-js apify-client
```

| Package | Version | Why This One | Why Not Alternative |
|---------|---------|--------------|---------------------|
| `exa-js` | `2.6.1` | Official Exa SDK — handles Websets async polling loop natively; TypeScript types included | Raw `fetch()` for Exa would require ~100 lines of polling/retry code since Websets is async-first |
| `apify-client` | `2.22.2` | Official Apify client — smart polling, exponential backoff, paginated dataset fetching | Raw `fetch()` for Apify requires polling actor run status then paginating the dataset — SDK abstracts all of it |

Everything else is `fetch()` with typed adapters, consistent with the existing enrichment provider pattern.

---

## Do NOT Install

| Package | Why | Use Instead |
|---------|-----|-------------|
| `serper` npm (v1.0.6) | Last release was 1+ year ago; no TypeScript types; unhealthy release cadence | `fetch()` directly — Serper API is 3 lines: POST endpoint + `X-API-KEY` header + JSON body |
| `node-cron` (v4.2.1) | Vercel serverless incompatible; Railway cron pattern is cleaner | Railway native cron schedule (set in service settings, process exits on completion) |
| `croner` (v10.0.1) | Only needed if in-process scheduling is required; Railway native cron is simpler | Railway native cron schedule; add croner only if multiple schedules in same process |
| Apollo.io SDK | No official Apollo.io REST SDK exists | `fetch()` with typed adapter |
| LangChain / LlamaIndex | Heavyweight abstraction on top of AI SDK already in use | Existing `ai@6` + `@ai-sdk/anthropic@3` |
| Playwright / Puppeteer for LinkedIn | Detection risk; Voyager HTTP API already in use for outreach | Apify no-cookie actors for discovery search |
| Redis / BullMQ | Overkill for signal monitoring scale; adds Redis dependency | Extend existing Prisma-backed queue pattern |
| FullEnrich | Explicitly Out-of-Scope per PROJECT.md | Existing waterfall: Prospeo → AI Ark → LeadMagic → FindyMail |
| StoreLeads ($75-950/mo) | Expensive; PROJECT.md explicitly excluded | Serper.dev Google Maps queries for local/ecommerce discovery |

---

## API Integrations — Raw fetch() Adapters

All discovery and signal APIs below use `fetch()` with typed adapters. Each becomes a new file in `src/lib/discovery/providers/`, mirroring the existing `src/lib/enrichment/providers/` architecture.

### Apollo.io People API (HIGH confidence)

**Purpose:** Search 275M contacts — free, no credits consumed for search. Email not returned (run enrichment waterfall after).

| Property | Value |
|----------|-------|
| Endpoint | `POST https://api.apollo.io/api/v1/mixed_people/api_search` |
| Auth | `x-api-key` header (master API key) OR `Authorization: Bearer {token}` |
| Credits | Zero — search is free; email reveal costs credits (use enrichment waterfall instead) |
| Pagination | 100 results/page, max 500 pages, 50k total per query |
| New env var | `APOLLO_API_KEY` |

Key filter parameters:

```typescript
{
  person_titles: string[],              // ["CEO", "Founder", "Head of Sales"]
  person_locations: string[],           // ["California, US", "United Kingdom"]
  organization_industry_tag_ids: string[], // Apollo industry IDs
  organization_num_employees_ranges: string[], // ["1,10", "11,50", "51,200"]
  person_seniority_tags: string[],      // ["c_suite", "vp", "director", "manager"]
  organization_locations: string[],     // company HQ location
  q_keywords: string,                   // keyword search
  page: number,
  per_page: number                      // max 100
}
```

Returns: `{ people: [{ name, title, city, state, country, organization: { name, website_url, linkedin_url }, linkedin_url }] }`. No email, no phone.

### Prospeo Search Person API (HIGH confidence)

**Purpose:** 20+ filter search over Prospeo's B2B database. Separate from existing enrichment integration.

| Property | Value |
|----------|-------|
| Endpoint | `POST https://api.prospeo.io/search-person` |
| Auth | `X-KEY` header — same `PROSPEO_API_KEY` already in use |
| Credits | 1 credit per request (returns up to 25 results) |
| Pagination | `page` param, max 1000 pages (25k results/query) |
| New env var | None — existing `PROSPEO_API_KEY` |

Returns contact list without email (use enrichment waterfall for email).

### AI Ark People Search API (LOW confidence — verify in dashboard)

**Purpose:** Search AI Ark's 200M+ B2B contact database.

| Property | Value |
|----------|-------|
| Endpoint | Unknown — check AI Ark dashboard API docs (not publicly indexed) |
| Auth | Likely same API key as existing AI Ark enrichment; verify header name |
| New env var | Likely none — existing `AIARK_API_KEY` |

The AI Ark platform confirms a "People Search" / semantic search feature exists, but the API endpoint and request schema are not publicly documented. **Must verify in AI Ark dashboard before implementing.**

### Exa.ai Websets API (MEDIUM confidence)

**Purpose:** Semantic company search — "find companies like X" lookalikes, market mapping. Async-first (results take seconds to minutes).

| Property | Value |
|----------|-------|
| Endpoint | `https://api.exa.ai/websets/v1/` |
| Auth | `x-api-key` header |
| Pattern | Async: create webset → poll items OR receive webhook |
| New env var | `EXA_API_KEY` |

Use `exa-js@2.6.1` SDK — it handles the Websets async lifecycle:

```typescript
import Exa from "exa-js";

const exa = new Exa(process.env.EXA_API_KEY);

// Create a webset — async, returns when search completes
const webset = await exa.websets.create({
  search: {
    query: "B2B SaaS companies in fintech with 50-500 employees similar to Stripe",
    count: 25,
  },
  enrichments: [
    { description: "Company industry" },
    { description: "Headcount range" },
  ],
});

// Items available via webset.items
```

Best use case: ICP lookalike expansion ("find companies like our best 3 clients"), niche market mapping for ultra-niche ICPs where Apollo filters don't capture intent.

### Serper.dev API (MEDIUM confidence)

**Purpose:** Google search (all types) — news monitoring, Google Maps local discovery, social mention tracking.

| Property | Value |
|----------|-------|
| Endpoint | `https://google.serper.dev/{type}` |
| Auth | `X-API-KEY` header |
| Types | `search`, `news`, `maps`, `places`, `images`, `videos`, `scholar`, `shopping` |
| Pricing | $1/1k queries; 2,500 free queries with no credit card |
| New env var | `SERPER_API_KEY` |

Raw fetch pattern (no SDK):

```typescript
const response = await fetch("https://google.serper.dev/news", {
  method: "POST",
  headers: {
    "X-API-KEY": process.env.SERPER_API_KEY!,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ q: "Acme Corp funding OR partnership OR hiring", num: 10 }),
});
const data = await response.json();
```

v2.0 uses:
- `news` endpoint — company news monitoring for signal detection
- `search` endpoint — Google query-driven directory scraping (seed URLs for Firecrawl)
- `maps` endpoint — local business discovery (replaces StoreLeads for local-focused ICPs)

### Apify LinkedIn Actors (MEDIUM confidence)

**Purpose:** LinkedIn people search without cookies or Voyager auth. Supplements Voyager (which is used for outreach) with discovery search.

| Property | Value |
|----------|-------|
| SDK | `apify-client@2.22.2` |
| Recommended actor | `harvestapi/linkedin-profile-search` — no-cookie, search by filters |
| Pricing | $0.10/search page (25 results/page); $0.004/full profile if needed |
| Auth | `Authorization: Bearer {APIFY_API_TOKEN}` |
| New env var | `APIFY_API_TOKEN` |

**Call pattern — always from Railway worker, never from Vercel** (actor runs can take 30-120 seconds; Vercel function timeout risk):

```typescript
import { ApifyClient } from "apify-client";

const client = new ApifyClient({ token: process.env.APIFY_API_TOKEN });

const run = await client.actor("harvestapi/linkedin-profile-search").call({
  searchUrl: "https://www.linkedin.com/search/results/people/?keywords=CEO&geoUrn=[...]",
  maxItems: 100,
});

const { items } = await client.dataset(run.defaultDatasetId).listItems();
```

### PredictLeads Signal API (MEDIUM confidence)

**Purpose:** B2B company signals — job openings (hiring spikes), tech adoption changes, news events, funding rounds, company connections.

| Property | Value |
|----------|-------|
| Endpoint base | `https://predictleads.com/api/v3/` |
| Auth | Query params: `?api_token={TOKEN}&api_key={KEY}` (NOT Authorization header) |
| Signal datasets | Job Openings, Technology Detections, News Events, Financing Events, Connections |
| Response format | JSON API (`{ data: [{ id, type, attributes, relationships }], included: [...] }`) |
| Pricing | 100 free credits/month, then pay-per-use |
| New env vars | `PREDICTLEADS_API_TOKEN` + `PREDICTLEADS_API_KEY` |

Key endpoints for signal monitoring cron:

```
GET /api/v3/companies/{domain}/job_openings      — hiring signals
GET /api/v3/companies/{domain}/news_events        — company news / funding
GET /api/v3/companies/{domain}/financing_events   — funding rounds
GET /api/v3/discover/technologies/{id}/technology_detections — tech adoption
```

Cron pattern: for each active workspace ICP → fetch top 100 target company domains from DB → poll PredictLeads for each → write `SignalEvent` records → exit.

---

## New Prisma Model — SignalEvent

Add to `prisma/schema.prisma`. Deploy with `npx prisma db push` (consistent with established project convention — no migrate dev).

```prisma
model SignalEvent {
  id             String    @id @default(cuid())
  workspaceSlug  String
  companyDomain  String?
  companyId      String?
  personId       String?
  signalType     String    // "job_opening" | "funding" | "hiring_spike" | "tech_adoption" | "news" | "social_mention"
  signalSource   String    // "predictleads" | "serper_news" | "serper_social"
  signalData     Json      // Raw payload from provider
  relevanceScore Float?    // AI-scored 0-1 ICP relevance (set by signal monitor worker)
  processed      Boolean   @default(false) // Fed into pipeline yet?
  processedAt    DateTime?
  detectedAt     DateTime  // When signal occurred (provider timestamp)
  createdAt      DateTime  @default(now())

  workspace Workspace @relation(fields: [workspaceSlug], references: [slug])

  @@index([workspaceSlug, processed])
  @@index([companyDomain])
  @@index([signalType])
  @@index([createdAt])
}
```

Optional: `CreativeIdea` model for per-client approved idea vault (only if admin review workflow is required — KB tagging is zero-migration-cost alternative):

```prisma
model CreativeIdea {
  id            String    @id @default(cuid())
  workspaceSlug String
  idea          String    // The constrained offer/value proposition idea
  exampleCopy   String?   // Example cold email body using this idea
  status        String    @default("pending") // "pending" | "approved" | "rejected"
  reviewedAt    DateTime?
  createdAt     DateTime  @default(now())

  workspace Workspace @relation(fields: [workspaceSlug], references: [slug])

  @@index([workspaceSlug, status])
}
```

---

## Discovery Provider Architecture

New directory following existing enrichment adapter pattern exactly:

```
src/lib/discovery/
  providers/
    apollo.ts             — Apollo mixed_people search adapter (fetch)
    prospeo-search.ts     — Prospeo Search Person (fetch, distinct from enrichment)
    aiark-search.ts       — AI Ark People Search (fetch, verify endpoint in dashboard)
    exa-websets.ts        — Exa Websets async adapter (exa-js SDK)
    serper.ts             — Serper adapter (fetch, all 3 types: search/news/maps)
    apify-linkedin.ts     — Apify actor runner (apify-client SDK)
    predictleads.ts       — PredictLeads signal adapter (fetch)
  types.ts                — DiscoveryResult, SignalResult, DiscoverySource union type
  orchestrator.ts         — Source selection logic: ICP type → which sources to use
  index.ts                — Re-exports
```

Source selection logic in `orchestrator.ts` drives which providers the Leads Agent calls per ICP type:

| ICP Type | Primary Sources | Secondary |
|----------|----------------|-----------|
| Enterprise (500+ employees) | Apollo (headcount filter) | Exa Websets (lookalike), Prospeo |
| SMB / niche industry | Apollo + Prospeo (20+ filters) | AI Ark |
| Local business | Serper Maps | Apollo (location filter) |
| Ultra-niche / custom directory | Firecrawl + Serper search (seed) | Exa Websets |
| LinkedIn-first (relationship ICP) | Apify LinkedIn (via Railway) | Apollo |

---

## CLI Orchestrator Chat Session

No new packages needed. `streamText` is already in `ai@6.0.97`. `tsx` is already in devDependencies at `4.21.0`.

**Entry point:** `scripts/chat.ts`
**Run command:** `npx tsx scripts/chat.ts [--workspace rise]`

Pattern (using existing Vercel AI SDK + existing orchestrator tools):

```typescript
import { streamText, stepCountIs } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createInterface } from "readline/promises";
import { stdin as input, stdout as output } from "process";

const rl = createInterface({ input, output });
const messages: CoreMessage[] = [];

while (true) {
  const userInput = await rl.question("\nYou: ");
  if (userInput.toLowerCase() === "exit") break;

  messages.push({ role: "user", content: userInput });

  const result = streamText({
    model: anthropic("claude-opus-4-20250514"),
    system: orchestratorSystemPrompt,
    messages,
    tools: orchestratorTools,
    stopWhen: stepCountIs(20),
  });

  process.stdout.write("\nAgent: ");
  for await (const delta of result.textStream) {
    process.stdout.write(delta);
  }
  process.stdout.write("\n");

  messages.push({ role: "assistant", content: await result.text });
}
rl.close();
```

The CLI reuses the exact same `orchestratorTools` from `src/lib/agents/orchestrator.ts` — no duplication, same agent behavior as the dashboard chat but in the terminal with `streamText` instead of `useChat`.

---

## Creative Ideas Copy Framework — Writer Agent Extension

No new packages. Prompt engineering + data retrieval pattern extending existing `src/lib/agents/writer.ts`.

**What gets added:**
1. New tool `getCreativeIdeasExamples` in `writerTools` — queries approved `CreativeIdea` records (or KB documents tagged `creative-ideas`) for the workspace
2. Updated Writer Agent system prompt section: instructs model to generate exactly 3 constrained, specific, deliverable ideas per prospect — not generic signal observations
3. New `creativeIdeas?: CreativeIdea[]` array in `WriterOutput` type

**Framework constraint** (goes in system prompt):
```
For each prospect, generate exactly 3 Creative Ideas:
- Each idea must be a specific, deliverable offer or collaboration
- Each must be actionable within 30 days without a sales call
- Do NOT reference signals (funding, hiring) as the hook — use them for targeting only
- Ground each idea in the client's actual service capability
- Ideas must be different from each other (not variations)
```

---

## Signal Dashboard Page

No new packages. Existing Recharts (`3.7.0`) handles charts. New page at `src/app/admin/signals/page.tsx` queries `SignalEvent` from PostgreSQL via Prisma.

Dashboard shows:
- Live signal feed (filterable by workspace, signal type, date range)
- Per-client signal volume chart (Recharts `BarChart`)
- Cost tracking table (API calls per provider per period)
- Processed vs. unprocessed signals breakdown

---

## Railway Background Worker — Signal Monitor

Signal monitoring runs on Railway alongside the existing LinkedIn sequencer. Uses Railway's native cron schedule (set in service settings UI — no code change needed for scheduling).

Worker script: `workers/signal-monitor.ts`

Pattern:
1. Fetch all active workspaces from DB
2. For each workspace, get ICP target company domains
3. Poll PredictLeads for each domain (job openings, news, funding)
4. Run Serper news queries for key company names
5. Score signals with `claude-haiku-4-5-20251001` (cheapest model — batch scoring)
6. Write `SignalEvent` records to DB
7. Close Prisma connection and exit (Railway restarts on next cron)

**No `croner` needed** — Railway native cron is the scheduler. The process starts, runs, and exits. Zero connection leak risk.

---

## Environment Variables — New

Add to Vercel (production + preview) and local `.env`:

```bash
# Lead Discovery APIs
APOLLO_API_KEY=           # Apollo.io master API key (from Apollo dashboard)
EXA_API_KEY=              # Exa.ai API key (from exa.ai dashboard)
APIFY_API_TOKEN=          # Apify platform token (from apify.com/account/integrations)
PREDICTLEADS_API_TOKEN=   # PredictLeads api_token param (from predictleads.com dashboard)
PREDICTLEADS_API_KEY=     # PredictLeads api_key param (from predictleads.com dashboard)
SERPER_API_KEY=           # Serper.dev API key (from serper.dev)

# Existing keys — verify these work for the new search endpoints:
# PROSPEO_API_KEY — same key, new endpoint (search-person vs email-finder)
# AIARK_API_KEY   — verify auth header name for People Search in AI Ark dashboard
```

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `exa-js@2.6.1` | `ai@6.0.97`, Node 20+, TypeScript 5+ | No AI SDK dependency — pure fetch wrapper with TS types |
| `apify-client@2.22.2` | Node 20+, TypeScript 5+ | Works in Node.js and browser; built-in TypeScript types |
| All new `fetch()` adapters | `prisma@6.19.2`, `zod@4.3.6`, `typescript@5+` | Follow existing provider adapter pattern; validate responses with zod |
| `streamText` (CLI chat) | `ai@6.0.97` (already installed) | Already in use — `generateText` is used in runner.ts; `streamText` is same package |
| `tsx@4.21.0` (CLI runner) | Already installed as devDependency | `npx tsx scripts/chat.ts` — no new install needed |

---

## Alternatives Considered

| Recommended | Alternative | When Alternative Makes Sense |
|-------------|-------------|------------------------------|
| `exa-js` SDK | `fetch()` for Exa | Never — Websets async polling makes raw fetch impractical |
| `apify-client` | `fetch()` for Apify | Never — actor run polling + dataset pagination is exactly what the client handles |
| `fetch()` for Serper | `serper` npm | If Serper adds complex features requiring abstraction (currently unnecessary) |
| `fetch()` for Apollo | Any SDK | No official SDK exists; `fetch()` is the only option |
| Railway native cron | `croner` in-process | If multiple signals need different schedules in same process (add croner@10.0.1 then) |
| KB tagging for Creative Ideas | `CreativeIdea` model | `CreativeIdea` model wins if admin review workflow is required (recommended) |
| Apify no-cookie actors | Playwright/Puppeteer headless | Never for LinkedIn — detection risk is too high; Apify managed actors handle stealth |

---

## Sources

- Apollo.io People API Search official docs — `https://docs.apollo.io/reference/people-api-search` — endpoint `POST /api/v1/mixed_people/api_search`, no-credits confirmed, filter params (HIGH confidence)
- Apollo.io Find People Using Filters — `https://docs.apollo.io/docs/find-people-using-filters` — `person_titles`, `person_locations`, `organization_industry_tag_ids`, `organization_num_employees_ranges` (HIGH confidence)
- Exa.ai Websets overview — `https://exa.ai/docs/websets/api/overview` — async/structured/event-driven pattern confirmed (MEDIUM confidence)
- exa-js version — `npm view exa-js version` → `2.6.1` (HIGH confidence)
- exa-js GitHub — `https://github.com/exa-labs/exa-js` — Websets support, TypeScript types (HIGH confidence)
- apify-client version — `npm view apify-client version` → `2.22.2` (HIGH confidence)
- Apify client JS docs — `https://docs.apify.com/api/client/js/docs` — actor call + dataset retrieval pattern (HIGH confidence)
- HarvestAPI LinkedIn no-cookie actor — `https://apify.com/harvestapi/linkedin-profile-search` — no cookies, $0.10/search page (MEDIUM confidence)
- PredictLeads API v3 — `https://docs.predictleads.com/v3` — signal datasets, JSON API format, no Node SDK (MEDIUM confidence)
- PredictLeads auth — `https://blog.predictleads.com/2024/08/21/introducing-predictleads-new-technology-detection-api-endpoint` — `api_token` + `api_key` query params confirmed (MEDIUM confidence)
- Prospeo Search Person — `https://prospeo.io/api-docs/search-person` — 1 credit/request, 25 results, 25k max (HIGH confidence)
- Serper.dev — `https://serper.dev/` — search types (search/news/maps/places), `X-API-KEY` header, $1/1k queries (MEDIUM confidence — marketing page)
- serper npm staleness — `https://socket.dev/npm/package/serper` — last release 1+ year ago (HIGH confidence — do not use)
- Vercel AI SDK Node.js CLI pattern — `https://ai-sdk.dev/docs/getting-started/nodejs` — `streamText` + readline/promises pattern (HIGH confidence)
- Railway cron docs — `https://docs.railway.com/cron-jobs` — native cron schedule, exit-when-done best practice (HIGH confidence)
- node-cron version — `npm view node-cron version` → `4.2.1` (HIGH confidence — verified but not recommended)
- croner version — `npm view croner version` → `10.0.1` (HIGH confidence — add only if in-process scheduling needed)
- AI Ark People Search — `https://ai-ark.com/platform/semantic-search/` — feature confirmed; API docs not publicly indexed (LOW confidence — verify in dashboard before implementing)
- Existing codebase — `src/lib/enrichment/providers/`, `src/lib/agents/`, `package.json` — all versions and patterns verified against live files (HIGH confidence)

---

*Stack research for: Outsignal Lead Engine v2.0 — Lead Discovery & Intelligence*
*Researched: 2026-03-03*
