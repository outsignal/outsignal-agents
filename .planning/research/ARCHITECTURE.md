# Architecture Research

**Domain:** Multi-source lead enrichment pipeline (Clay replacement)
**Researched:** 2026-02-26
**Confidence:** HIGH (based on existing codebase analysis + established patterns in enrichment tooling)

---

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Trigger Layer                                    │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│   │  Chat / Agent │  │  API Route   │  │  CLI / Scheduled Job     │  │
│   │  (orchestrator)│  │  (ad-hoc)   │  │  (bulk enrichment)       │  │
│   └──────┬───────┘  └──────┬───────┘  └───────────┬──────────────┘  │
│          │                 │                       │                 │
├──────────┴─────────────────┴───────────────────────┴─────────────────┤
│                   Enrichment Orchestration Layer                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                  EnrichmentPipeline                             │  │
│  │  1. Dedup check (local DB first)                               │  │
│  │  2. Waterfall across providers (cheapest → most expensive)     │  │
│  │  3. Merge results (field-level precedence rules)               │  │
│  │  4. AI normalization (Claude Haiku)                            │  │
│  │  5. Persist to Person/Company + log provenance                 │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                       │
├───────────────────────────────────────────────────────────────────────┤
│                    Provider Abstraction Layer                          │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────────────┐  │
│  │ Prospeo   │  │  AI Ark   │  │ LeadMagic │  │ Firecrawl+Claude  │  │
│  │ (email    │  │ (company/ │  │ (email    │  │ (web scrape +     │  │
│  │  finding) │  │  person)  │  │  verify)  │  │  AI extraction)   │  │
│  └───────────┘  └───────────┘  └───────────┘  └───────────────────┘  │
│                 Each provider: EnrichmentProvider interface            │
├───────────────────────────────────────────────────────────────────────┤
│                       Data Layer                                       │
│  ┌──────────────────┐  ┌───────────────────┐  ┌─────────────────┐    │
│  │ Person / Company │  │ EnrichmentRun log │  │  Provider cache  │    │
│  │ (canonical store)│  │ (provenance audit)│  │  (avoid repeat)  │    │
│  └──────────────────┘  └───────────────────┘  └─────────────────┘    │
└───────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| `EnrichmentPipeline` | Orchestrates dedup check, waterfall, merge, persist | `src/lib/enrichment/pipeline.ts` — pure function, composable |
| `EnrichmentProvider` interface | Common contract all providers implement | TypeScript interface in `src/lib/enrichment/types.ts` |
| Provider adapters (Prospeo, AI Ark, etc.) | Translate provider API → normalized output | `src/lib/enrichment/providers/prospeo.ts` etc. |
| Dedup checker | Query Person/Company by email/domain before API calls | Inline in pipeline, uses Prisma |
| Field merger | Merge multi-source results with precedence rules | Pure utility in `src/lib/enrichment/merge.ts` |
| AI normalizer | Industry classification, title standardization, company name cleanup | Haiku tool call in `src/lib/enrichment/normalize-ai.ts` |
| Provenance logger | Track which source provided which field, when, and at what cost | `EnrichmentRun` DB model |
| Leads Agent | AI agent that drives enrichment on behalf of users via chat | `src/lib/agents/leads.ts` (follows existing runner pattern) |

---

## Recommended Project Structure

```
src/lib/enrichment/
├── pipeline.ts           # Core waterfall orchestrator
├── types.ts              # EnrichmentProvider interface, EnrichmentResult, etc.
├── merge.ts              # Field-level merging + precedence logic
├── normalize-ai.ts       # Claude Haiku normalization (industry, title, company name)
├── dedup.ts              # Local DB lookup before external API calls
├── providers/
│   ├── prospeo.ts        # Email finding (cheapest person source)
│   ├── aiark.ts          # Company + person enrichment (depth)
│   ├── leadmagic.ts      # Email verification (last step before export)
│   └── firecrawl.ts      # Website scrape → AI extraction (qualification)
└── index.ts              # Public API: enrichPerson(), enrichCompany(), enrichBatch()

src/app/api/enrichment/
├── person/route.ts       # POST /api/enrichment/person (triggers pipeline for one)
├── company/route.ts      # POST /api/enrichment/company
└── batch/route.ts        # POST /api/enrichment/batch (bulk, async via queue)

prisma/schema.prisma      # Add: EnrichmentRun model (provenance + cost tracking)
```

### Structure Rationale

- **`src/lib/enrichment/`** — All enrichment logic lives here, not in agents or API routes. Agents and routes call the pipeline; they don't implement it.
- **`providers/` subfolder** — Each provider is isolated. Adding a new source means adding one file and registering it in `pipeline.ts`. No other files change.
- **Separate API routes for enrichment** — Keep these distinct from the existing `/api/people/enrich` (Clay inbound webhook) to avoid confusion. New routes are outbound-triggered enrichment; old routes remain for Clay fallback inbound.
- **Provenance in DB** — Essential for cost tracking and debugging. You need to know which API found which field to avoid re-running the same source.

---

## Architectural Patterns

### Pattern 1: Waterfall Enrichment (Cheapest-First)

**What:** Try sources in order from cheapest to most expensive. Stop when you have enough data. Only escalate to the next source when the current one returns insufficient results.

**When to use:** Always, for cost control. Every field has a "sufficient" threshold — if you have email, name, title, and company, you probably don't need AI Ark's deeper enrichment.

**Trade-offs:**
- Pro: Minimizes API spend dramatically (typically 60-80% cost reduction vs. hitting all sources)
- Pro: Naturally handles provider outages — next source fills the gap
- Con: Slightly slower than parallel (mitigated by async queue for bulk)
- Con: Requires defining "sufficiency" rules per field

**Example:**
```typescript
// src/lib/enrichment/pipeline.ts
export async function enrichPerson(
  email: string,
  options: EnrichmentOptions = {}
): Promise<EnrichmentResult> {
  // Step 1: Dedup — check if we already have this person with sufficient data
  const existing = await dedup.checkPerson(email);
  if (existing && isSufficient(existing, options.requiredFields)) {
    return { source: 'cache', data: existing, cost: 0 };
  }

  const result: Partial<PersonEnrichmentData> = existing ?? {};
  const runLog: ProviderAttempt[] = [];

  // Step 2: Waterfall — cheapest first
  const waterfall: EnrichmentProvider[] = [
    providers.prospeo,    // email finding — cheap, fast
    providers.aiark,      // company + person depth — medium cost
    providers.firecrawl,  // website scrape — use for qualification only
    providers.leadmagic,  // email verification — always last before export
  ];

  for (const provider of waterfall) {
    if (isSufficient(result, options.requiredFields)) break;

    const attempt = await provider.enrich(email, result);
    runLog.push(attempt);
    merge(result, attempt.data); // field-level merge, existing wins on conflict
  }

  // Step 3: AI normalization — always run after waterfall
  const normalized = await normalizeWithAI(result);

  // Step 4: Persist
  await persistEnrichment(email, normalized, runLog);

  return { source: 'pipeline', data: normalized, attempts: runLog };
}
```

---

### Pattern 2: Provider Abstraction Interface

**What:** All enrichment providers implement a common `EnrichmentProvider` interface. The pipeline doesn't know (or care) which specific API it's calling.

**When to use:** From day one. Enforces consistency, makes providers swappable, enables easy addition of new sources.

**Trade-offs:**
- Pro: New provider = one new file, zero changes to pipeline
- Pro: Easy to mock in tests
- Con: Some providers return wildly different data shapes — normalization happens inside the adapter

**Example:**
```typescript
// src/lib/enrichment/types.ts

export interface PersonEnrichmentData {
  email?: string;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  company?: string;
  companyDomain?: string;
  linkedinUrl?: string;
  location?: string;
  phone?: string;
  industry?: string;
  seniority?: string;
  emailVerified?: boolean;
  emailConfidence?: number;   // 0-100
  [key: string]: unknown;     // provider-specific extras go to enrichmentData
}

export interface ProviderAttempt {
  provider: string;
  success: boolean;
  fieldsAdded: string[];
  creditsUsed: number;
  durationMs: number;
  error?: string;
}

export interface EnrichmentProvider {
  name: string;
  priority: number;             // lower = runs earlier in waterfall
  canEnrichPerson: boolean;
  canEnrichCompany: boolean;
  enrich(
    identifier: string,         // email for person, domain for company
    existing: Partial<PersonEnrichmentData>
  ): Promise<ProviderAttempt & { data: Partial<PersonEnrichmentData> }>;
}
```

---

### Pattern 3: Field-Level Merge with Precedence

**What:** When multiple providers return the same field, apply explicit precedence rules rather than overwriting. Some fields should "first write wins" (e.g., email from Prospeo is authoritative). Others should "highest confidence wins" (e.g., email verification score from LeadMagic should always overwrite).

**When to use:** Any time two providers return overlapping fields.

**Trade-offs:**
- Pro: Data quality improves — you keep the best value per field, not just the last one
- Pro: Prevents cheap/low-quality source from corrupting high-quality data
- Con: Rules need to be defined and maintained

**Example:**
```typescript
// src/lib/enrichment/merge.ts

const PRECEDENCE: Record<string, 'first' | 'last' | 'highest-confidence'> = {
  email: 'first',                // trust initial source
  emailVerified: 'last',         // LeadMagic runs last, always authoritative
  emailConfidence: 'last',       // same
  firstName: 'first',            // don't overwrite good data with guesses
  lastName: 'first',
  jobTitle: 'first',             // first good title wins
  company: 'first',
  companyDomain: 'first',
  linkedinUrl: 'first',
  phone: 'first',
  location: 'last',              // more recent location data preferred
  industry: 'last',              // AI normalization runs last, most accurate
  seniority: 'last',             // same
};

export function merge(
  base: Partial<PersonEnrichmentData>,
  incoming: Partial<PersonEnrichmentData>
): void {
  for (const [key, value] of Object.entries(incoming)) {
    if (value === null || value === undefined || value === '') continue;

    const rule = PRECEDENCE[key] ?? 'first'; // default: don't overwrite

    if (rule === 'first' && base[key] != null) continue;
    if (rule === 'last') {
      base[key] = value;
    } else if (rule === 'first' && base[key] == null) {
      base[key] = value;
    }
    // 'highest-confidence' would compare numeric scores
  }
}
```

---

### Pattern 4: Provenance Tracking (EnrichmentRun)

**What:** Every enrichment operation is logged to the DB with: which providers were tried, which fields each added, credits consumed, duration, and final state. This makes the system auditable and cost-trackable.

**When to use:** From day one. Without this, you cannot answer "why does this person have this data?" or "how much did enriching 500 people cost?"

**Trade-offs:**
- Pro: Full audit trail, cost tracking, debugging support
- Pro: Enables "re-enrich if stale" logic based on enrichedAt timestamp
- Con: Extra DB write per enrichment (acceptable — runs are infrequent compared to reads)

**Example schema addition:**
```prisma
model EnrichmentRun {
  id           String   @id @default(cuid())
  entityType   String   // "person" | "company"
  entityId     String   // Person.id or Company.id
  triggeredBy  String   // "pipeline" | "agent" | "manual" | "api"
  providers    String   // JSON: ProviderAttempt[]
  fieldsAdded  String   // JSON: string[] of field names that changed
  totalCredits Int      @default(0)
  durationMs   Int?
  status       String   @default("complete") // complete | partial | failed
  createdAt    DateTime @default(now())

  @@index([entityType, entityId])
  @@index([createdAt])
}
```

---

### Pattern 5: AI Normalization as Final Pass

**What:** After the waterfall produces raw data, run a Claude Haiku call to normalize messy outputs: classify industry into standard categories, standardize job titles to seniority tiers, clean up company names, derive missing fields where inferable.

**When to use:** After every enrichment run, before persisting. This replaces what Clay's "AI column" was doing.

**Trade-offs:**
- Pro: All data ends up in consistent shape regardless of which provider sourced it
- Pro: Haiku is cheap (sub-penny per call)
- Pro: Normalizing once at write-time means reads are always clean
- Con: Adds latency (300-800ms per call) — acceptable for individual enrichment, batched for bulk

**Example:**
```typescript
// src/lib/enrichment/normalize-ai.ts
export async function normalizeWithAI(
  data: Partial<PersonEnrichmentData>
): Promise<Partial<PersonEnrichmentData>> {
  const result = await generateText({
    model: anthropic('claude-haiku-4-5-20251001'),
    system: NORMALIZATION_PROMPT,
    messages: [{
      role: 'user',
      content: JSON.stringify(data)
    }],
  });
  // parse JSON from result.text, merge back into data
  return { ...data, ...parseNormalized(result.text) };
}

// NORMALIZATION_PROMPT tells Haiku to:
// - Map industry to one of: SaaS, Agencies, E-commerce, Manufacturing, Finance, etc.
// - Map jobTitle to seniority: C-Suite, VP, Director, Manager, IC
// - Clean company name (remove Inc., Ltd., LLC unless meaningful)
// - Derive location if city/state/country are separate fields
// - Output ONLY changed fields as JSON
```

---

## Data Flow

### Single Person Enrichment

```
API Route / Agent Tool
    ↓ enrichPerson(email)
EnrichmentPipeline
    ↓ dedup check (prisma.person.findUnique)
    ├─ FOUND + sufficient → return cached data (cost: $0)
    └─ MISSING or stale →
        ↓ waterfall: Prospeo → AI Ark → Firecrawl → LeadMagic
        ↓ each provider: HTTP call → normalize response → merge into result
        ↓ AI normalization (Haiku): clean industry/title/company
        ↓ persist: person.upsert + company.upsert + enrichmentRun.create
        ↓ return EnrichmentResult { data, attempts, cost }
```

### Bulk Enrichment (List Building)

```
Leads Agent or API route
    ↓ enrichBatch(emails[], options)
    ↓ split into chunks of 10 (rate limit safety)
    ↓ for each chunk: parallel enrichPerson() calls
    ↓ aggregate results + cost summary
    ↓ return BatchResult { enriched, cached, failed, totalCost }
```

### Qualification Flow (ICP fit check)

```
List of enriched people
    ↓ filter: has companyDomain
    ↓ for each person: firecrawl.scrapeUrl(website)
    ↓ claude-haiku: classify ICP fit (YES/MAYBE/NO) against workspace ICP criteria
    ↓ store: person.enrichmentData.icpFit + icpFitReason
    ↓ segment into lists by fit tier
```

### Key Data Flows

1. **Dedup saves money:** The pipeline reads before it writes. If Person already has email + title + company + LinkedIn, the waterfall short-circuits entirely. Given 14,563 existing people, this is the single biggest cost control lever.

2. **Waterfall stops early:** Most leads only need 1-2 providers. Prospeo finds the email; AI Ark fills in company data. LeadMagic (email verification) only runs right before export to EmailBison — not during general enrichment.

3. **Normalization decoupled from sourcing:** The AI normalization step is a separate pass, not embedded in any provider. This means you can re-normalize existing data independently of re-enriching it.

4. **Company enrichment backfills people:** When a Company record is enriched (domain → industry, headcount), the pipeline can batch-update all Person records with that `companyDomain` to inherit the `vertical` and `industry`. This is already partially done in the current Clay endpoint.

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Prospeo | REST API — POST with email, returns email + confidence + name | Use for primary email finding/verification on new leads |
| AI Ark | REST API — company lookup by domain, person lookup by email | Best depth for company data (headcount, description, industry) |
| LeadMagic | REST API — email verification endpoint | Run last, right before EmailBison export |
| Firecrawl | Already integrated (`src/lib/firecrawl/client.ts`) | Reuse for prospect qualification scraping |
| Claude Haiku | Vercel AI SDK — already integrated | Normalization + ICP classification; Haiku keeps cost low |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Leads Agent ↔ EnrichmentPipeline | Direct function call | Agent calls `enrichPerson()` / `enrichBatch()` as a tool |
| EnrichmentPipeline ↔ Providers | Function call (each provider is a module) | No HTTP between internal components |
| EnrichmentPipeline ↔ DB | Prisma — same pattern as rest of codebase | Person, Company, EnrichmentRun models |
| API Routes ↔ EnrichmentPipeline | Direct import — `enrichPerson()` from `src/lib/enrichment` | Routes are thin; all logic in pipeline |
| Chat Orchestrator ↔ Leads Agent | Existing `delegateToLeads` tool pattern | Leads Agent follows exact same runner.ts pattern as Research Agent |

---

## Suggested Build Order

This order respects dependencies — each phase delivers usable value and unblocks the next.

### Phase 1: Foundation (unblocks everything)
1. `EnrichmentProvider` interface + types (`src/lib/enrichment/types.ts`)
2. `merge.ts` — field-level merge with precedence
3. `dedup.ts` — check existing Person/Company before calling APIs
4. `EnrichmentRun` Prisma model + migration
5. Basic `pipeline.ts` — dedup + single provider + persist

**Why first:** No enrichment feature works without these. Define the contract before implementing providers.

### Phase 2: Provider Adapters (run in parallel once Phase 1 done)
- Prospeo adapter — email finding
- AI Ark adapter — company + person depth
- LeadMagic adapter — email verification
- Wire all three into waterfall in `pipeline.ts`

**Why here:** Provider adapters are independent of each other. Once the interface is defined, all three can be written simultaneously.

### Phase 3: AI Normalization
- `normalize-ai.ts` — Haiku normalization pass
- Wire into pipeline as final step
- Write normalization prompt (industry taxonomy, title seniority map)

**Why third:** Normalization depends on providers being wired — you need data to normalize. Also needs the industry/title taxonomy to be defined upfront.

### Phase 4: Leads Agent
- `src/lib/agents/leads.ts` — follows existing `research.ts` pattern exactly
- Tools: `enrichPerson`, `enrichBatch`, `searchPeople`, `createList`, `exportToEmailBison`
- Wire into orchestrator's `delegateToLeads` (currently a stub)

**Why fourth:** Agents are the user-facing layer. Pipeline must work before the agent can use it.

### Phase 5: Lead Search + List Building UI
- `/api/people/search` route — filter by company, vertical, enrichment status, score
- Lead search page component
- List builder page — save searches as named lists, export

**Why last:** UI work needs the data to be good first. Showing un-enriched, un-normalized data in a search UI creates bad UX.

---

## Anti-Patterns

### Anti-Pattern 1: Hitting All Providers in Parallel

**What people do:** Run Prospeo + AI Ark + LeadMagic simultaneously for every lead.

**Why it's wrong:** You pay for all three even when the first one is sufficient. For a batch of 1,000 leads, this might triple your API spend. Parallel execution is also harder to debug when one provider returns bad data.

**Do this instead:** Waterfall — sequential with early exit. Only parallelize the final batch of leads where multiple are fully enriched and being sent to EmailBison for verification.

---

### Anti-Pattern 2: Storing Raw Provider Responses Verbatim

**What people do:** Dump the entire API response JSON into `enrichmentData` and query it later.

**Why it's wrong:** Every provider returns different field names. `"title"` vs `"job_title"` vs `"position"`. Querying across providers becomes impossible. You can't filter by job title if it's buried in different JSON keys per person.

**Do this instead:** Normalize all provider outputs to the `PersonEnrichmentData` shape immediately in the provider adapter. Only put genuinely novel/extra fields into `enrichmentData`.

---

### Anti-Pattern 3: Enriching on Every Request

**What people do:** Enrich a person every time they appear in a search result or list.

**Why it's wrong:** For 14k+ people, this burns credits re-enriching people who were enriched yesterday.

**Do this instead:** Treat enrichment as a batch operation with staleness rules. Re-enrich only when: (a) triggered explicitly, (b) record is older than N days and missing key fields, or (c) person enters a new campaign. Cache `enrichedAt` on Person and check it in `dedup.ts`.

---

### Anti-Pattern 4: Running Email Verification Too Early

**What people do:** Verify emails at enrichment time, for every lead.

**Why it's wrong:** Email verification (LeadMagic) has a per-verification cost. Many enriched leads will never make it into a campaign — they'll be filtered out by ICP score, headcount, or vertical. Verifying them is waste.

**Do this instead:** Run verification as the final step before EmailBison export only, not during general enrichment. Gate it on: "this lead is in a finalized list being sent to campaign."

---

### Anti-Pattern 5: Embedding Provider Logic in Agent Tools

**What people do:** Put `fetch('https://api.prospeo.com/...')` calls directly inside an agent tool.

**Why it's wrong:** Agents are orchestrators, not executors. If you hardwire provider calls into tools, you can't reuse the same logic from an API route, a CLI script, or a batch job. You also can't test providers independently.

**Do this instead:** Agent tools call `enrichPerson()` from `src/lib/enrichment`. The pipeline handles provider selection. Agents stay thin.

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Current (14k people, 6 workspaces) | Synchronous enrichment is fine. No queue needed. Pipeline runs in-request for single records, batch loops for bulk. |
| 100k people, 20 workspaces | Add background job pattern. Bulk enrichment should be async (POST to kick off, poll for status). Vercel has 5-minute serverless limit — long batches need chunking. |
| 500k+ people | Add a proper queue (BullMQ + Redis, or Trigger.dev). Rate limiting per provider becomes critical. Consider a dedicated enrichment worker. |

### Scaling Priorities

1. **First bottleneck:** Vercel's 300-second function timeout during bulk enrichment. Fix: chunk batches into 50-person groups, either loop with short sleeps or use a background task pattern.

2. **Second bottleneck:** Provider rate limits (Prospeo, AI Ark both have per-minute caps). Fix: implement per-provider rate limit tracking with a simple in-memory counter or Redis if available.

---

## Sources

- Codebase analysis: `/Users/jjay/programs/outsignal-agents` (HIGH confidence — direct inspection)
- Existing enrichment endpoint: `src/app/api/people/enrich/route.ts` (HIGH — shows current field alias + upsert pattern to extend)
- Agent architecture: `src/lib/agents/runner.ts`, `types.ts`, `research.ts` (HIGH — defines the exact pattern the Leads Agent must follow)
- Project requirements: `.planning/PROJECT.md` — confirms provider choices (Prospeo, AI Ark, LeadMagic, Firecrawl) and constraints (waterfall, dedup-first, pluggable)
- Cold email framework: `/tmp/cold-email-engine-framework.md` — confirms scoring model (1-10 signal overlap), list sizes (3k-7.5k), qualification tiers
- DB schema: `prisma/schema.prisma` — shows existing Person/Company models to extend, AgentRun pattern to replicate for EnrichmentRun
- Waterfall enrichment pattern: Training knowledge on multi-source data pipeline architecture (MEDIUM — well-established pattern in B2B data industry, consistent with validated agency approach described in PROJECT.md)
- Provider integration patterns: Training knowledge on Prospeo, AI Ark, LeadMagic APIs (MEDIUM — verify specific endpoint shapes against each provider's official docs during implementation)

---

*Architecture research for: Multi-source lead enrichment pipeline (Clay replacement)*
*Researched: 2026-02-26*
