# Phase 2: Provider Adapters + Waterfall - Research

**Researched:** 2026-02-26
**Domain:** HTTP provider adapters, waterfall orchestration, error handling, cost tracking, data merge
**Confidence:** MEDIUM (provider APIs partially verified via docs; AI Ark auth header name LOW)

## Summary

Phase 2 wires five external enrichment providers (Prospeo, LeadMagic, FindyMail, AI Ark, Firecrawl) into two sequential waterfall pipelines built on top of the Phase 1 infrastructure (dedup gate, provenance log, async job queue). The architecture is straightforward: each provider gets its own adapter module implementing a shared interface; the waterfall orchestrators call adapters in order and stop at the first success. All coordination logic sits in `src/lib/enrichment/providers/` and `src/lib/enrichment/waterfall.ts`.

The biggest research risk is API shape confidence. Prospeo's "Enrich Person" endpoint is well-documented (`POST https://api.prospeo.io/enrich-person`, `X-KEY` header, `linkedin_url` in `data` object). LeadMagic's LinkedIn-to-email endpoint is confirmed (`POST https://api.leadmagic.io/v1/people/b2b-profile-to-email`, `X-API-Key` header, `profile_url` body param, 5 credits on success). AI Ark's auth header name is "Header" per docs but the actual header key name (`X-TOKEN`?) is unconfirmed — the docs show it as a security scheme name, not the literal header key. FindyMail's LinkedIn endpoint URL is confirmed (`POST https://app.findymail.com/api/search/linkedin`, Bearer auth) but exact request body field name is unconfirmed. Firecrawl has a structured `extract()` method (Zod schema-based) usable for company data extraction — already has a client in the codebase.

A critical schema gap exists: `EnrichmentJob` currently has no `"paused"` status, but the cost cap requirement needs jobs to pause and auto-resume. This requires a schema change (adding `"paused"` to the status enum and a `resumeAt` timestamp). The daily cost cap also needs a new tracking mechanism — either a separate DB model or a date-keyed Redis key. Given no Redis is in the stack, a lightweight `DailyCostTotal` DB model is the right choice.

**Primary recommendation:** Build adapters as pure fetch-wrapping functions (no SDK), use native `fetch` with TypeScript typed responses, mock fetch in tests. Wire the waterfall as a simple `for...of` loop with try/catch per provider. Add `"paused"` status to EnrichmentJob schema and a `DailyCostTotal` model for cap tracking. Use in-memory circuit breaker state (per batch run, not DB-backed) since jobs are single-process-per-chunk.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Waterfall logic & ordering
- Fixed global provider order, not configurable per workspace
- Email waterfall: Prospeo -> LeadMagic -> FindyMail (sequential, stop at first success)
- Company waterfall: AI Ark -> Firecrawl (Firecrawl only fires if AI Ark returns nothing)
- Stop at first email found — don't continue for additional fields
- When a person has no LinkedIn URL: try Prospeo name+company lookup as fallback, skip waterfall entirely if that also fails
- Sequential execution (one provider at a time) — no parallel provider calls
- Separate entry points: `enrichEmail(personId)` and `enrichCompany(domain)` as independent functions
- Each provider is a standalone module (prospeo.ts, leadmagic.ts, findymail.ts, aiark.ts, firecrawl.ts) implementing a shared adapter interface

#### Error handling & retries
- Rate limit (429): exponential backoff (1s, 2s, 4s), 3 retries, then skip to next provider
- Permanent errors (404, 422): log in EnrichmentLog with status "error" and move to next provider — no retry, no flagging
- Timeout: 10 seconds per individual provider API call
- Circuit breaker: if a provider fails 5+ consecutive times within a batch, skip it for the rest of that batch (resets on next batch run)

#### Cost controls & limits
- Global daily spending cap — enrichment pauses when hit, jobs resume next day
- Cost tracked via fixed cost-per-call values defined in config (e.g., Prospeo: $0.002, LeadMagic: $0.005) — updated manually when pricing changes
- When cap is hit: mark in-progress jobs as "paused", resume automatically when daily cap resets
- Cost dashboard in the app showing spend per workspace (client) with per-provider breakdown (Prospeo: $X, LeadMagic: $Y, etc.)

#### Data merge strategy
- Existing data wins — never overwrite a field that already has a value
- New provider data only fills empty fields
- Keep partial data — any fields returned are written, even if the response is incomplete
- Store full raw API response in EnrichmentLog.rawResponse for every call (debugging + re-extraction)
- Run AI normalizers inline after writing provider data (classifyIndustry, classifyJobTitle, classifyCompanyName from Phase 1)

### Claude's Discretion
- Exact adapter interface design (method signatures, return types)
- Provider-specific request/response mapping details
- Daily cap reset mechanism (midnight UTC, rolling 24h, etc.)
- Circuit breaker implementation approach (in-memory counter vs DB-backed)
- Cost dashboard page layout and components

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PROV-01 | Prospeo API integration — email finding from LinkedIn URL or name+company | Prospeo `POST /enrich-person` with `linkedin_url` or `first_name+last_name+company_name` in `data` object; `X-KEY` auth header; response has `person.email.email` field |
| PROV-02 | AI Ark API integration — person and company data enrichment | AI Ark has `POST https://api.ai-ark.com/api/developer-portal/v1/companies` and `/v1/people`; auth header name not confirmed; response has `staff`, `industry`, `description` fields |
| PROV-03 | LeadMagic API integration — email finding and verification | LeadMagic `POST /v1/people/b2b-profile-to-email` with `profile_url` for LinkedIn-to-email; `X-API-Key` auth; 5 credits per found email |
| PROV-04 | FindyMail API integration — fallback email finding | FindyMail `POST https://app.findymail.com/api/search/linkedin`; Bearer auth; exact request body field name needs verification at runtime |
| PROV-05 | Firecrawl integration extended — company website crawling for structured data | Firecrawl already has client at `src/lib/firecrawl/client.ts`; new `extract()` method with Zod schema extracts headcount/industry/description from company website |
| ENRICH-02 | System enriches person data via waterfall strategy | `enrichEmail(personId)` orchestrates Prospeo → LeadMagic → FindyMail; dedup gate from Phase 1 prevents re-enrichment; merge writes only empty fields |
| ENRICH-03 | System enriches company data via waterfall strategy — AI Ark → Firecrawl, with local cache | `enrichCompany(domain)` tries AI Ark first; falls back to Firecrawl scrape+extract; dedup gate prevents repeat crawls |
| ENRICH-04 | System finds email addresses via waterfall — Prospeo → LeadMagic → FindyMail | Same as ENRICH-02; these requirements overlap (ENRICH-02 is person data broadly, ENRICH-04 is email specifically — implement together in `enrichEmail`) |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Native `fetch` | Node 18+ built-in | HTTP calls to provider APIs | Already in use (emailbison/client.ts uses global fetch); no extra dependency; easy to mock in tests |
| Prisma | 6.19.2 (installed) | New models (DailyCostTotal) + existing EnrichmentLog | Already in use; schema additions are additive |
| Zod | 4.3.6 (installed) | Validate provider API responses, Firecrawl extract schemas | Already in use; validates and types untrusted external API responses |
| Next.js API routes | 16.1.6 (installed) | Cost dashboard API endpoint, enrichment trigger endpoints | Already in use throughout |
| Recharts | 3.7.0 (installed) | Cost dashboard charts (per-workspace, per-provider breakdown) | Already installed in the project |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@mendable/firecrawl-js` | 4.13.2 (installed) | Firecrawl `extract()` for structured company data | Only for company waterfall Firecrawl adapter; existing client.ts extended |
| Vercel AI SDK + Claude Haiku | installed | Run AI normalizers inline after enrichment write | Already in Phase 1 normalizer; call `classifyIndustry`, `classifyJobTitle`, `classifyCompanyName` after any provider writes data |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Native fetch | axios, got | Native fetch is already used in emailbison/client.ts; no extra dep needed |
| In-memory circuit breaker | DB-backed circuit breaker | In-memory is sufficient since each job chunk runs in a single serverless invocation; DB-backed adds latency for a per-batch-run state |
| DailyCostTotal DB model | Redis key | No Redis in stack; Prisma model is consistent with existing data layer; daily rollup query on EnrichmentLog also viable but slower |
| Midnight UTC cap reset | Rolling 24h reset | Midnight UTC is simpler to implement and reason about; avoids edge cases with rolling windows |

**Installation:**
```bash
# No new packages needed — all dependencies already present
# Prisma schema change required (db push, not migrate dev — matches project pattern)
npx prisma db push
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── lib/
│   └── enrichment/
│       ├── types.ts          # (exists) — add ProviderAdapter interface, ProviderResult type
│       ├── dedup.ts          # (exists) — no changes
│       ├── log.ts            # (exists) — no changes
│       ├── queue.ts          # (exists) — update processNextChunk to call waterfall; add "paused" status handling
│       ├── costs.ts          # NEW — PROVIDER_COSTS config, dailySpend(), checkCap(), pauseIfCapHit()
│       ├── waterfall.ts      # NEW — enrichEmail(personId), enrichCompany(domain) orchestrators
│       ├── merge.ts          # NEW — mergePersonData(), mergeCompanyData() — "existing data wins" logic
│       └── providers/
│           ├── prospeo.ts    # NEW — Prospeo adapter (linkedin_url → email)
│           ├── leadmagic.ts  # NEW — LeadMagic adapter (profile_url → email)
│           ├── findymail.ts  # NEW — FindyMail adapter (linkedin url → email)
│           ├── aiark.ts      # NEW — AI Ark adapter (domain → company data)
│           └── firecrawl-company.ts  # NEW — Firecrawl extract adapter (domain → company data)
├── app/
│   └── api/
│       └── enrichment/
│           ├── jobs/
│           │   └── process/
│           │       └── route.ts     # (exists) — wire in waterfall via onProcess callback
│           ├── run/
│           │   └── route.ts         # NEW — POST trigger: enqueue batch enrichment job
│           └── costs/
│               └── route.ts         # NEW — GET cost dashboard data (by workspace + provider)
├── __tests__/
│   ├── providers-prospeo.test.ts    # NEW
│   ├── providers-leadmagic.test.ts  # NEW
│   ├── providers-findymail.test.ts  # NEW
│   ├── providers-aiark.test.ts      # NEW
│   ├── providers-firecrawl-company.test.ts  # NEW
│   ├── enrichment-waterfall.test.ts # NEW
│   ├── enrichment-costs.test.ts     # NEW
│   └── enrichment-merge.test.ts     # NEW
```

### Pattern 1: Provider Adapter Interface
**What:** Each provider implements a common interface — a single async function that takes the minimum input and returns a typed result. No class hierarchy; just function + type contract.
**When to use:** All five provider modules follow this pattern.

```typescript
// src/lib/enrichment/types.ts — additions
export interface EmailProviderResult {
  email: string | null;
  source: Provider;
  rawResponse: unknown;
  costUsd: number;
}

export interface CompanyProviderResult {
  name?: string;
  industry?: string;
  headcount?: number;
  description?: string;
  website?: string;
  location?: string;
  yearFounded?: number;
  source: Provider;
  rawResponse: unknown;
  costUsd: number;
}

// Provider adapter signature (email)
export type EmailAdapter = (input: {
  linkedinUrl?: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  companyDomain?: string;
}) => Promise<EmailProviderResult>;

// Provider adapter signature (company)
export type CompanyAdapter = (domain: string) => Promise<CompanyProviderResult>;
```

### Pattern 2: Provider Adapter Implementation (fetch-based)
**What:** Each adapter wraps a `fetch()` call, handles HTTP errors, returns typed result. Uses AbortController for the 10-second timeout.
**When to use:** All five providers.

```typescript
// src/lib/enrichment/providers/prospeo.ts
import type { EmailAdapter } from "../types";

const BASE_URL = "https://api.prospeo.io";
const COST_USD = 0.002; // Update in PROVIDER_COSTS config

function getApiKey(): string {
  const key = process.env.PROSPEO_API_KEY;
  if (!key) throw new Error("PROSPEO_API_KEY not set");
  return key;
}

export const prospeoAdapter: EmailAdapter = async (input) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(`${BASE_URL}/enrich-person`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-KEY": getApiKey(),
      },
      body: JSON.stringify({
        data: {
          linkedin_url: input.linkedinUrl,
          first_name: input.firstName,
          last_name: input.lastName,
          company_name: input.companyName,
          company_website: input.companyDomain,
        },
      }),
      signal: controller.signal,
    });

    const raw = await res.json();

    if (res.status === 429) {
      const err = new Error("Rate limited");
      (err as any).status = 429;
      throw err;
    }
    if (res.status === 404 || res.status === 422) {
      const err = new Error(`Permanent error: ${res.status}`);
      (err as any).status = res.status;
      throw err;
    }
    if (!res.ok || raw.error) {
      throw new Error(raw.error_message ?? `Prospeo error ${res.status}`);
    }

    const email = raw?.person?.email?.email ?? null;
    return { email, source: "prospeo", rawResponse: raw, costUsd: COST_USD };
  } finally {
    clearTimeout(timeout);
  }
};
```

### Pattern 3: Waterfall Orchestrator
**What:** Iterates providers in order, checks circuit breaker, calls adapter, handles errors. Stops at first success (email found).
**When to use:** `enrichEmail()` and `enrichCompany()` both use this pattern.

```typescript
// src/lib/enrichment/waterfall.ts
import { shouldEnrich } from "./dedup";
import { recordEnrichment } from "./log";
import { checkDailyCap, incrementDailySpend } from "./costs";
import { prospeoAdapter } from "./providers/prospeo";
import { leadmagicAdapter } from "./providers/leadmagic";
import { findymailAdapter } from "./providers/findymail";
import { sleep, exponentialBackoff } from "./utils";
import type { Provider } from "./types";

interface CircuitBreaker {
  consecutiveFailures: Map<Provider, number>;
}

const EMAIL_PROVIDERS = [prospeoAdapter, leadmagicAdapter, findymailAdapter] as const;
const EMAIL_PROVIDER_NAMES: Provider[] = ["prospeo", "leadmagic", "findymail"];
const CIRCUIT_BREAKER_THRESHOLD = 5;

export async function enrichEmail(
  personId: string,
  input: { linkedinUrl?: string; firstName?: string; lastName?: string; companyName?: string; companyDomain?: string },
  breaker: CircuitBreaker,
): Promise<void> {
  for (let i = 0; i < EMAIL_PROVIDERS.length; i++) {
    const adapter = EMAIL_PROVIDERS[i];
    const providerName = EMAIL_PROVIDER_NAMES[i];

    // Circuit breaker check
    if ((breaker.consecutiveFailures.get(providerName) ?? 0) >= CIRCUIT_BREAKER_THRESHOLD) {
      console.warn(`Circuit breaker open for ${providerName}, skipping`);
      continue;
    }

    // Dedup gate
    const eligible = await shouldEnrich(personId, "person", providerName);
    if (!eligible) continue;

    // Daily cap check
    const capHit = await checkDailyCap();
    if (capHit) throw new Error("DAILY_CAP_HIT");

    // Attempt with exponential backoff on 429
    let result = null;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        result = await adapter(input);
        break;
      } catch (err: unknown) {
        const error = err as Error & { status?: number };
        lastError = error;

        if (error.status === 429) {
          // Rate limit: backoff and retry
          await sleep(exponentialBackoff(attempt)); // 1s, 2s, 4s
          continue;
        }
        // Permanent error (404, 422): log and move to next provider
        break;
      }
    }

    if (!result && lastError) {
      await recordEnrichment({
        entityId: personId,
        entityType: "person",
        provider: providerName,
        status: "error",
        errorMessage: lastError.message,
        costUsd: 0,
      });
      const isRateLimit = (lastError as any).status === 429;
      if (!isRateLimit) {
        // Non-429 errors reset consecutive failures for the next call
        breaker.consecutiveFailures.set(providerName, (breaker.consecutiveFailures.get(providerName) ?? 0) + 1);
      }
      continue;
    }

    if (result && result.email) {
      // Write email to Person, record enrichment
      await writeEmailToPerson(personId, result.email);
      await incrementDailySpend(providerName, result.costUsd);
      await recordEnrichment({
        entityId: personId,
        entityType: "person",
        provider: providerName,
        status: "success",
        fieldsWritten: ["email"],
        costUsd: result.costUsd,
        rawResponse: result.rawResponse,
      });
      breaker.consecutiveFailures.set(providerName, 0); // reset on success
      return; // stop waterfall
    }
  }
}
```

### Pattern 4: Cost Cap + Daily Spend Tracking
**What:** A `DailyCostTotal` model accumulates spend per day. Before each provider call, `checkDailyCap()` compares today's total against the global cap. On cap hit, jobs get marked "paused" and the queue ignores them until the next UTC day.
**When to use:** Gate every provider call.

```typescript
// src/lib/enrichment/costs.ts

// Provider costs — update this object when pricing changes
export const PROVIDER_COSTS: Record<string, number> = {
  prospeo: 0.002,
  leadmagic: 0.005,   // 5 credits at $0.001/credit example
  findymail: 0.001,
  aiark: 0.003,
  firecrawl: 0.001,   // Firecrawl cost per scrape
};

const DAILY_CAP_USD = parseFloat(process.env.ENRICHMENT_DAILY_CAP_USD ?? "10.00");

export async function checkDailyCap(): Promise<boolean> {
  const today = todayUtc();
  const record = await prisma.dailyCostTotal.findUnique({ where: { date: today } });
  return (record?.totalUsd ?? 0) >= DAILY_CAP_USD;
}

export async function incrementDailySpend(provider: string, costUsd: number): Promise<void> {
  const today = todayUtc();
  await prisma.dailyCostTotal.upsert({
    where: { date: today },
    update: { totalUsd: { increment: costUsd } },
    create: { date: today, totalUsd: costUsd },
  });
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}
```

**New Prisma model needed:**
```prisma
model DailyCostTotal {
  id       String   @id @default(cuid())
  date     String   @unique   // "YYYY-MM-DD" UTC
  totalUsd Float    @default(0)
  updatedAt DateTime @updatedAt

  @@index([date])
}
```

**EnrichmentJob status update needed:**
```prisma
// Add "paused" to the status comment in EnrichmentJob
// status: "pending" | "running" | "complete" | "failed" | "paused"
// Also add resumeAt field for automatic daily reset
model EnrichmentJob {
  // ... existing fields ...
  status    String   @default("pending") // pending | running | complete | failed | paused
  resumeAt  DateTime? // set when paused; queue ignores jobs where resumeAt > now()
}
```

### Pattern 5: "Existing Data Wins" Merge
**What:** Before writing any field from a provider response, check if the Person/Company already has a non-null value. Only write if the field is currently null/empty.
**When to use:** All provider writes.

```typescript
// src/lib/enrichment/merge.ts

export async function mergePersonData(
  personId: string,
  data: Partial<{
    email: string;
    firstName: string;
    lastName: string;
    jobTitle: string;
    linkedinUrl: string;
    location: string;
  }>,
): Promise<string[]> {
  const person = await prisma.person.findUniqueOrThrow({ where: { id: personId } });

  const updates: Record<string, unknown> = {};
  const fieldsWritten: string[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (value != null && (person as any)[key] == null) {
      updates[key] = value;
      fieldsWritten.push(key);
    }
  }

  if (Object.keys(updates).length > 0) {
    await prisma.person.update({ where: { id: personId }, data: updates });
  }

  return fieldsWritten; // empty array if nothing was written
}
```

### Pattern 6: Firecrawl Company Extract (structured data)
**What:** Use Firecrawl's `extract()` method with a Zod schema to pull structured company data from a website. More reliable than free-form scrape + Claude parse.
**When to use:** Company waterfall, Firecrawl adapter only.

```typescript
// src/lib/enrichment/providers/firecrawl-company.ts
import { z } from "zod";
import Firecrawl from "@mendable/firecrawl-js";
import type { CompanyAdapter } from "../types";

const CompanySchema = z.object({
  headcount: z.number().optional(),
  industry: z.string().optional(),
  description: z.string().optional(),
  yearFounded: z.number().optional(),
  location: z.string().optional(),
});

export const firecrawlCompanyAdapter: CompanyAdapter = async (domain) => {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY not set");

  const client = new Firecrawl({ apiKey });
  const result = await client.extract([`https://${domain}`], {
    prompt: "Extract company headcount (as a number), industry, description, year founded, and headquarters location.",
    schema: CompanySchema,
  });

  const data = result.data ?? {};
  return {
    headcount: data.headcount,
    industry: data.industry,
    description: data.description,
    yearFounded: data.yearFounded,
    location: data.location,
    source: "firecrawl",
    rawResponse: result,
    costUsd: PROVIDER_COSTS.firecrawl,
  };
};
```

### Pattern 7: Queue Integration (wire onProcess callback)
**What:** The existing `processNextChunk(onProcess)` callback is Phase 2's entry point. The callback receives an entityId and job metadata, then calls the appropriate waterfall function.

```typescript
// In /api/enrichment/jobs/process/route.ts (updated)
import { enrichEmail } from "@/lib/enrichment/waterfall";

const breaker = { consecutiveFailures: new Map() }; // in-memory per invocation

await processNextChunk(async (entityId, job) => {
  if (job.entityType === "person") {
    const person = await prisma.person.findUniqueOrThrow({ where: { id: entityId } });
    await enrichEmail(entityId, {
      linkedinUrl: person.linkedinUrl ?? undefined,
      firstName: person.firstName ?? undefined,
      lastName: person.lastName ?? undefined,
      companyName: person.company ?? undefined,
      companyDomain: person.companyDomain ?? undefined,
    }, breaker);
  } else if (job.entityType === "company") {
    const company = await prisma.company.findUniqueOrThrow({ where: { id: entityId } });
    await enrichCompany(company.domain, breaker);
  }
});
```

### Anti-Patterns to Avoid
- **Parallel provider calls:** The waterfall MUST be sequential (for...of, not Promise.all). Parallel calls burn credits on all providers simultaneously even when the first succeeds.
- **DB-backed circuit breaker:** Don't store consecutive failure count in the DB — each chunk invocation is independent. In-memory state within the invocation is correct.
- **Re-calling provider after cap hit:** The cap check must happen BEFORE each provider call, not just at job start. A batch can hit the cap mid-job.
- **Overwriting existing email on Person:** The merge pattern is strict — never write email if `person.email` is already set (even if the provider found a different one).
- **Forgetting to clear the circuit breaker on success:** Reset a provider's consecutive failure count to 0 on any success.
- **Using prisma.person.update without reading first:** Always read the current record before writing (merge pattern requires it). Never blind-write provider data.

## Provider API Reference

### Prospeo (PROV-01)
**Confidence:** HIGH — documented at prospeo.io/api-docs/enrich-person

| Property | Value |
|----------|-------|
| Endpoint | `POST https://api.prospeo.io/enrich-person` |
| Auth | `X-KEY: {api_key}` header |
| Input (LinkedIn) | `{ data: { linkedin_url: "https://linkedin.com/in/..." } }` |
| Input (name+co) | `{ data: { first_name, last_name, company_name, company_website } }` |
| Email field | `response.person.email.email` (string or null) |
| Status check | `response.error` boolean; also HTTP status |
| 429 handling | HTTP 429 status code |
| 404/422 | HTTP 400 with `NO_MATCH` or `INVALID_DATAPOINTS` error body |
| Cost per call | ~$0.002 (pricing page visit required to confirm) |
| Env var needed | `PROSPEO_API_KEY` |

**Note:** Prospeo deprecated their old "Social URL Enrichment" endpoint (removed March 2026). Use `/enrich-person` with `data.linkedin_url` instead.

### LeadMagic (PROV-03)
**Confidence:** HIGH — documented at leadmagic.io/docs and directly fetched

| Property | Value |
|----------|-------|
| Endpoint | `POST https://api.leadmagic.io/v1/people/b2b-profile-to-email` |
| Auth | `X-API-Key: {api_key}` header |
| Input | `{ profile_url: "https://linkedin.com/in/..." }` |
| Email field | `response.email` (string or null) |
| Cost field | `response.credits_consumed` (5 if found, 0 if not) |
| Rate limits | 3,000 req/min |
| Cost per success | 5 credits (verify credit cost at account level) |
| Env var needed | `LEADMAGIC_API_KEY` |

**Additional LeadMagic endpoints available:**
- `POST /email-finder` — find by `first_name`, `last_name`, `domain` (1 credit)
- `POST /v1/people/email-validation` — verify deliverability (1 credit per 20)
- `POST /profile-search` — profile enrichment (1 credit)

### FindyMail (PROV-04)
**Confidence:** MEDIUM — endpoint URL confirmed, request body field name unconfirmed

| Property | Value |
|----------|-------|
| Endpoint | `POST https://app.findymail.com/api/search/linkedin` |
| Auth | `Authorization: Bearer {api_key}` header |
| Input (expected) | `{ linkedin_url: "..." }` — field name UNCONFIRMED, verify at runtime |
| Email field | Likely `response.email` — UNCONFIRMED |
| Cost | 1 credit per verified email found |
| Env var needed | `FINDYMAIL_API_KEY` |

**Action:** FindyMail adapter must be written defensively — validate response schema with Zod and log the full rawResponse on first successful call to confirm field names.

### AI Ark (PROV-02)
**Confidence:** MEDIUM (endpoint URLs confirmed) / LOW (auth header literal name)

| Property | Value |
|----------|-------|
| Company endpoint | `POST https://api.ai-ark.com/api/developer-portal/v1/companies` |
| People endpoint | `POST https://api.ai-ark.com/api/developer-portal/v1/people` |
| Auth header | Unknown literal name — docs say security scheme is "Header"; likely `X-TOKEN` or `Authorization: Bearer` — MUST verify |
| Company lookup by domain | Filter via `account.domain.include: [domain]` (from doc structure) |
| Company response fields | `name`, `description`, `industry`, `staff.total` (headcount), `links.website`, `headquarter`, `founded_year` |
| Rate limits | 5 req/sec, 300/min, 18,000/hour |
| Env var needed | `AIARK_API_KEY` |

**Action:** Must sign up for AI Ark API access and verify auth header name before implementation. Plan should include a "verify auth header" step.

### Firecrawl (PROV-05)
**Confidence:** HIGH — existing client in codebase, extract() API verified at docs.firecrawl.dev

| Property | Value |
|----------|-------|
| SDK | `@mendable/firecrawl-js` v4.13.2 (installed) |
| Method | `client.extract(urls, { prompt, schema })` |
| Zod schema support | Yes — pass Zod object directly |
| Input | `[`https://${domain}`]` |
| Output | `result.data` matching schema |
| Existing client | `src/lib/firecrawl/client.ts` (uses `crawl()` and `scrape()`, does NOT have `extract()`) |
| Env var | `FIRECRAWL_API_KEY` (already in use) |

**Note:** The existing Firecrawl client does NOT wrap `extract()`. The new `firecrawl-company.ts` adapter creates its own Firecrawl instance (same pattern as existing client.ts) and calls `extract()` directly.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP timeout | Custom Promise.race timeout wrapper | `AbortController` + `setTimeout` | Native, works with `fetch`, no extra dependency |
| Exponential backoff | Custom timing logic | Simple sleep formula: `2^attempt * 1000ms` | Three retries max; no need for a library |
| JSON response validation | Manual field existence checks | Zod `.safeParse()` on provider responses | Catches schema drift early; gives typed output |
| Circuit breaker | Feature-flag DB column or Redis counter | In-memory `Map<Provider, number>` per invocation | Sufficient for per-batch-run behavior; zero overhead |
| Cost aggregation | Custom SQL GROUP BY | Prisma `groupBy` on EnrichmentLog | Already have the data; groupBy by provider+date gives dashboard data |
| Firecrawl structured extraction | Parse markdown with Claude | `client.extract()` with Zod schema | Firecrawl's built-in structured extraction is more reliable than markdown parsing |

**Key insight:** These adapters are thin wrappers. The complexity is in the waterfall orchestration (error handling, circuit breaker, cost gate, merge) — all of which should live in `waterfall.ts`, not in individual adapters. Adapters should be "dumb" — just fetch and return.

## Common Pitfalls

### Pitfall 1: AI Ark Auth Header Unknown
**What goes wrong:** Implementation uses wrong header name (e.g., `Authorization: Bearer` when it should be `X-TOKEN`), all calls return 401, CI passes because tests mock fetch, but prod fails silently.
**Why it happens:** The AI Ark docs describe the security scheme as "Header" without specifying the literal header name.
**How to avoid:** Before writing the full adapter, make a single manual curl test to verify the auth header. Document the exact header name in a comment in aiark.ts. Test the adapter with a real API key in a one-off script before wiring into the waterfall.
**Warning signs:** Consistent 401 responses with no useful error body; empty company data on all records.

### Pitfall 2: FindyMail Response Schema Mismatch
**What goes wrong:** Code accesses `response.email` but FindyMail returns `response.data.email` or `response.verified_email`.
**Why it happens:** FindyMail docs are not publicly accessible at the time of research; exact response schema is unconfirmed.
**How to avoid:** Use Zod `.safeParse()` on the response and log `rawResponse` on every FindyMail call for the first 10 calls. Handle the null case gracefully (treat as "not found").
**Warning signs:** FindyMail always returning null email even when logs show `status: success`; raw response in EnrichmentLog has the email in a different field.

### Pitfall 3: Daily Cap Check Race Condition
**What goes wrong:** Two chunk-processing invocations run concurrently (if cron fires twice), both check the cap and both pass, overspending by one chunk worth of API calls.
**Why it happens:** The cap check (`checkDailyCap`) and the spend increment (`incrementDailySpend`) are two separate DB operations — not atomic.
**How to avoid:** Use `prisma.$transaction()` for the check+increment pair, OR accept the small overspend risk (one chunk = chunkSize × highest provider cost ≈ a few cents). The latter is acceptable for this use case; note it in a comment.
**Warning signs:** DailyCostTotal showing values 10-20% over DAILY_CAP_USD consistently.

### Pitfall 4: Merge Pattern Missing Normalizer Call
**What goes wrong:** Provider writes `jobTitle: "VP of Sales"` to Person without running `classifyJobTitle`, so the `seniority` field remains null and downstream ICP qualification (Phase 3) has no seniority data.
**Why it happens:** The merge function writes raw data; the normalizer call is easy to forget when adding new fields.
**How to avoid:** After any write that touches `jobTitle`, `company`, or `vertical`, call the appropriate normalizer inline and write the normalized value too (if not already set). Document this in merge.ts with a comment.
**Warning signs:** `Person.vertical` remaining null after enrichment even though `company` is populated; `seniority` null when `jobTitle` is not null.

### Pitfall 5: Circuit Breaker Not Resetting Between Batches
**What goes wrong:** A provider has an outage during batch 1. All records in batch 1 skip it. Batch 2 runs the next day and the provider is healthy, but the circuit breaker (if DB-backed) still shows 5+ failures and skips it again.
**Why it happens:** DB-backed circuit breaker state persists across batches.
**How to avoid:** Use in-memory state (a local Map initialized fresh in the processNextChunk handler). Each batch run gets a fresh breaker. This is the explicitly decided approach.
**Warning signs:** A healthy provider never being called; EnrichmentLog showing no attempts for a provider even when it's known to be working.

### Pitfall 6: Prospeo Deprecated Endpoint
**What goes wrong:** Old docs or blog posts reference `/social-url-finder` or similar. Code uses the deprecated endpoint which was removed March 1, 2026.
**Why it happens:** Lots of third-party tutorials reference the old endpoint.
**How to avoid:** Use `/enrich-person` with `data.linkedin_url` — confirmed from current prospeo.io/api-docs documentation.
**Warning signs:** 404 or 410 responses from Prospeo on every call.

## Code Examples

Verified patterns from codebase and fetched docs:

### Adapter with AbortController timeout + exponential backoff
```typescript
// Pattern: 10s timeout + 3 retries on 429
const MAX_RETRIES = 3;

async function callWithRetry(fn: () => Promise<Response>): Promise<Response> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fn(); // pass signal to fetch inside fn()
      clearTimeout(timeout);
      if (res.status === 429 && attempt < MAX_RETRIES - 1) {
        await sleep(Math.pow(2, attempt) * 1000); // 1s, 2s, 4s
        continue;
      }
      return res;
    } catch (err) {
      clearTimeout(timeout);
      if (attempt === MAX_RETRIES - 1) throw err;
    }
  }
  throw new Error("Max retries exceeded");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

### Zod validation of provider response
```typescript
// Source: Zod 4.x (installed version)
import { z } from "zod";

const ProspeoResponseSchema = z.object({
  error: z.boolean(),
  person: z.object({
    email: z.object({
      email: z.string().nullable().optional(),
    }).optional(),
  }).optional(),
});

const parsed = ProspeoResponseSchema.safeParse(rawJson);
if (!parsed.success) {
  // Log and treat as null email
  console.error("Prospeo response schema mismatch:", parsed.error);
  return { email: null, ... };
}
const email = parsed.data.person?.email?.email ?? null;
```

### Firecrawl extract() with Zod schema
```typescript
// Source: docs.firecrawl.dev/features/extract (fetched 2026-02-26)
import { z } from "zod";
import Firecrawl from "@mendable/firecrawl-js";

const schema = z.object({
  headcount: z.number().optional(),
  industry: z.string().optional(),
  description: z.string().optional(),
});

const client = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY! });
const result = await client.extract(
  [`https://${domain}`],
  { prompt: "Extract company headcount, industry, and description.", schema }
);
// result.data is typed as z.infer<typeof schema>
```

### Prisma groupBy for cost dashboard
```typescript
// Cost by provider for a date range
const costBreakdown = await prisma.enrichmentLog.groupBy({
  by: ["provider"],
  where: {
    status: "success",
    runAt: { gte: startOfDay, lte: endOfDay },
  },
  _sum: { costUsd: true },
});
// Returns: [{ provider: "prospeo", _sum: { costUsd: 1.24 } }, ...]
```

### Prisma groupBy for per-workspace cost
```typescript
// Cost per workspace (via EnrichmentJob.workspaceSlug join pattern)
// EnrichmentLog doesn't have workspaceSlug directly; join via job
// OR: store workspaceSlug on EnrichmentLog (schema addition)
// Recommendation: add optional workspaceSlug to EnrichmentLog for dashboard queries
```

**Schema note:** The cost dashboard's "per workspace" breakdown requires either joining EnrichmentLog → EnrichmentJob → workspaceSlug, or adding `workspaceSlug` to `EnrichmentLog` directly. Adding it to `EnrichmentLog` is simpler and makes dashboard queries O(1) instead of O(n joins).

## Schema Changes Required

### 1. EnrichmentJob — add `paused` status and `resumeAt`
```prisma
model EnrichmentJob {
  // ... existing fields unchanged ...
  status    String   @default("pending") // pending | running | complete | failed | paused
  resumeAt  DateTime? // non-null when paused; queue processor skips until this time
}
```

### 2. EnrichmentLog — add optional `workspaceSlug`
```prisma
model EnrichmentLog {
  // ... existing fields unchanged ...
  workspaceSlug String? // for cost dashboard grouping
  @@index([workspaceSlug, provider]) // add this index
}
```

### 3. DailyCostTotal — new model
```prisma
model DailyCostTotal {
  id        String   @id @default(cuid())
  date      String   @unique // "YYYY-MM-DD" UTC
  totalUsd  Float    @default(0)
  updatedAt DateTime @updatedAt

  @@index([date])
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Prospeo Social URL Enrichment | Prospeo `/enrich-person` with `data.linkedin_url` | March 2026 removal | Must use new endpoint; old docs/tutorials are wrong |
| Firecrawl scrape + Claude parse | Firecrawl `extract()` with Zod schema | Firecrawl v4+ | More reliable structured extraction without Claude round-trip |
| Custom retry loops | AbortController + exponential backoff | Modern Node/fetch | Simpler, no axios dependency |

**Deprecated/outdated:**
- Prospeo `/social-url-finder` endpoint: removed March 1, 2026
- LeadMagic "Email Finder" (name+domain): lower confidence for email finding; use `b2b-profile-to-email` (LinkedIn URL) for waterfall since that's what we have

## Open Questions

1. **AI Ark authentication header literal name**
   - What we know: Docs say security scheme type is "Header"; base URL is `api.ai-ark.com`
   - What's unclear: Is it `X-TOKEN`, `Authorization: Bearer`, or something else?
   - Recommendation: Sign up for AI Ark API access before planning the adapter task. Verify header with a manual curl. If can't access docs: try `X-TOKEN` first (common pattern for token-based APIs), then `Authorization: Bearer`.

2. **FindyMail request body field name for LinkedIn URL**
   - What we know: Endpoint is `POST https://app.findymail.com/api/search/linkedin`
   - What's unclear: Is the field `linkedin_url`, `url`, `profile`, or something else?
   - Recommendation: Sign up for FindyMail API, check the actual docs in the dashboard. Fallback: write adapter with `linkedin_url` (most common convention) and log rawResponse for first few calls to verify.

3. **Daily cap reset mechanism — midnight UTC vs rolling 24h**
   - What we know: User said "resume automatically when daily cap resets"
   - What's unclear: Whether reset is midnight UTC or 24h rolling from when cap was hit
   - Recommendation: Use midnight UTC (simpler — store date as "YYYY-MM-DD" string, new day = reset). Set `resumeAt` on paused jobs to midnight UTC of tomorrow.

4. **Cost dashboard — is it a UI page or just an API endpoint?**
   - What we know: "Cost dashboard in the app showing spend per workspace"
   - What's unclear: Does this mean a new Next.js page at `/dashboard/costs` or just the API data?
   - Recommendation: Build both: a GET API endpoint `/api/enrichment/costs` that returns the aggregated data, and a simple React page at `/admin/enrichment-costs` that displays it using Recharts (already installed).

5. **EnrichmentJob.workspaceSlug for per-workspace cost filtering**
   - What we know: Jobs already have `workspaceSlug`; EnrichmentLog does not
   - What's unclear: Whether to add `workspaceSlug` to EnrichmentLog or join via job ID
   - Recommendation: Add `workspaceSlug` to EnrichmentLog (schema addition) — makes dashboard queries simple groupBy without joins.

## Validation Architecture

> `workflow.nyquist_validation` is not in config.json (field absent) — treating as false/not required. Skipping formal validation section.

## Sources

### Primary (HIGH confidence)
- `src/lib/enrichment/types.ts` — Provider type enum, confirmed provider names
- `src/lib/enrichment/queue.ts` — onProcess callback pattern, chunk processing structure
- `src/lib/firecrawl/client.ts` — Existing Firecrawl integration pattern
- `prisma/schema.prisma` — Current models (EnrichmentJob, EnrichmentLog, Person, Company)
- `package.json` — Confirmed installed versions
- Prospeo API docs (`prospeo.io/api-docs/enrich-person`, fetched 2026-02-26) — `/enrich-person` endpoint, `X-KEY` header, request/response schema
- LeadMagic docs (fetched 2026-02-26) — `/v1/people/b2b-profile-to-email` endpoint, `X-API-Key` header, `profile_url` field, 5 credits
- Firecrawl Extract docs (`docs.firecrawl.dev/features/extract`, fetched 2026-02-26) — `extract()` method, Zod schema support

### Secondary (MEDIUM confidence)
- AI Ark docs (`docs.ai-ark.com/reference`, fetched 2026-02-26) — Company/People endpoint URLs confirmed; auth header literal name not found
- FindyMail search results (multiple sources, 2026-02-26) — Endpoint URL `POST /api/search/linkedin` confirmed; request body fields unconfirmed

### Tertiary (LOW confidence)
- AI Ark auth header: "Header" security scheme name from docs; "X-TOKEN" is a guess based on common patterns
- FindyMail request body field name: `linkedin_url` is assumed based on common naming conventions; not verified

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already installed; pattern follows existing emailbison/client.ts
- Architecture: HIGH — waterfall pattern is well-established; queue integration point (onProcess callback) is verified in Phase 1
- Pitfalls: HIGH — identified from research findings (deprecated endpoint, unconfirmed schemas, race condition)
- Provider APIs: MIXED — Prospeo HIGH, LeadMagic HIGH, Firecrawl HIGH, FindyMail MEDIUM, AI Ark MEDIUM/LOW

**Research date:** 2026-02-26
**Valid until:** 2026-03-12 (provider APIs can change; verify auth headers before implementation)
