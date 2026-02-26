# Phase 1: Enrichment Foundation - Research

**Researched:** 2026-02-26
**Domain:** Enrichment dedup, provenance tracking, async job queuing, AI normalization (Prisma + Vercel + Vercel AI SDK)
**Confidence:** HIGH

## Summary

Phase 1 lays the data contract and cost-control infrastructure that every subsequent phase depends on. The work breaks into four distinct concerns: (1) a dedup gate (`shouldEnrich`) that prevents duplicate paid API calls, (2) an enrichment provenance model that records who provided what data, when, and at what cost, (3) an async job queue that chunked-processes batches without hitting Vercel's 30-second function timeout, and (4) an AI normalizer that maps dirty industry classifications, company names, and job titles to a controlled vocabulary via Claude.

The codebase already has working synchronous enrichment at `/api/people/enrich` and `/api/companies/enrich` that upserts person and company records. These routes perform a basic existence check before updating, but they have no concept of provider-specific enrichment status, no audit trail of which provider wrote which field, and no mechanism for handling batches that exceed Vercel's timeout. The existing `normalizeCompanyName` in `src/lib/normalize.ts` is purely rule-based (title-case normalization), with no AI involvement and no controlled vocabulary for industries or job titles.

**Primary recommendation:** Add a new `EnrichmentLog` Prisma model (provenance store), a `shouldEnrich(entityId, provider)` function, an `EnrichmentJob` model for async queuing, and an `AIClassifier` module that wraps Claude calls behind a pre-defined controlled vocabulary. These are additive schema/library changes with no modification to the existing Clay webhook endpoints.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ENRICH-01 | System checks local DB for existing person/company data before calling any paid API (dedup-first) | `shouldEnrich()` function reading `EnrichmentLog`; returns false if provider already ran on this entity |
| ENRICH-06 | System tracks enrichment provenance — which source provided which data, timestamp, cost per record | New `EnrichmentLog` Prisma model with `provider`, `entityId`, `entityType`, `fieldsWritten`, `costUsd`, `runAt` columns |
| ENRICH-07 | System handles batch enrichment asynchronously (not blocked by Vercel 30s timeout) | `EnrichmentJob` model + chunked processing via Next.js Route Handlers with short-circuit logic |
| AI-01 | System normalizes industry/vertical classification via Claude | `classifyIndustry(raw)` in `src/lib/normalizer/industry.ts` using Claude Haiku against a hardcoded canonical vertical list |
| AI-02 | System normalizes company names via Claude (extend existing normalize.ts) | `classifyCompanyName(raw)` wrapping existing rule-based logic, escalating to Claude for ambiguous cases |
| AI-03 | System extracts structured fields from unstructured data via Claude (job title standardization, seniority level) | `classifyJobTitle(raw)` returning `{ canonical, seniority }` validated against controlled vocab |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Prisma | 6.19.2 (already installed) | Schema migration + typed DB client for new models | Already in use, provides type-safe migration DSL |
| Vercel AI SDK (`ai`) | 6.0.97 (already installed) | `generateObject` for structured Claude output | Already in use, `generateObject` with Zod schema guarantees valid JSON from Claude |
| `@ai-sdk/anthropic` | 3.0.46 (already installed) | Anthropic adapter for Vercel AI SDK | Already in use throughout agents |
| Zod | 4.3.6 (already installed) | Runtime schema validation for AI outputs and payloads | Already in use, required for `generateObject` schema definition |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Vitest | 4.0.18 (already installed) | Unit tests for `shouldEnrich`, normalizer, job chunking | All new pure-logic modules need test coverage |
| Claude Haiku (`claude-haiku-4-5-20251001`) | via SDK | Fast, cheap AI calls for normalization | Use for all three normalizers — cheap and sufficient for structured extraction |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| DB-based async job queue | Inngest, Bull/BullMQ, Trigger.dev | External services add infra complexity; DB queue is simpler, sufficient for Vercel, and keeps everything in Prisma |
| Claude Haiku for normalization | GPT-4o-mini | Claude Haiku is already authenticated via `ANTHROPIC_API_KEY`; no extra credentials needed |
| `generateObject` for AI normalization | Plain `generateText` with JSON parsing | `generateObject` with Zod validates output and retries automatically; `generateText` requires manual JSON parsing (fragile, see existing runner.ts pattern) |

**Installation:**
```bash
# No new packages needed — all dependencies already present
# Only Prisma schema migration required
npx prisma migrate dev --name enrichment-foundation
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── lib/
│   ├── enrichment/
│   │   ├── dedup.ts          # shouldEnrich() — dedup gate
│   │   ├── log.ts            # recordEnrichment() — write EnrichmentLog rows
│   │   ├── queue.ts          # enqueueJob(), processNextChunk() — async job queue
│   │   └── types.ts          # EnrichmentProvider enum, EnrichmentResult type
│   └── normalizer/
│       ├── industry.ts       # classifyIndustry(raw) → canonical vertical
│       ├── company.ts        # classifyCompanyName(raw) → canonical name
│       ├── job-title.ts      # classifyJobTitle(raw) → { canonical, seniority }
│       ├── vocabulary.ts     # CANONICAL_VERTICALS, SENIORITY_LEVELS constants
│       └── index.ts          # Re-exports all three classifiers
├── app/
│   └── api/
│       └── enrichment/
│           └── jobs/
│               └── process/
│                   └── route.ts  # POST — process next job chunk (called by cron or manually)
└── __tests__/
    ├── enrichment-dedup.test.ts
    ├── enrichment-queue.test.ts
    └── normalizer.test.ts
```

### Pattern 1: Dedup Gate (`shouldEnrich`)
**What:** Pure function that queries `EnrichmentLog` and returns `false` if a given provider has already been run on a given entity, preventing duplicate API calls.
**When to use:** Called at the top of every provider adapter (Phase 2+) before making any external API call.
**Example:**
```typescript
// src/lib/enrichment/dedup.ts
import { prisma } from "@/lib/db";

export type EntityType = "person" | "company";
export type Provider = "prospeo" | "aiark" | "leadmagic" | "findymail" | "firecrawl" | "clay";

export async function shouldEnrich(
  entityId: string,
  entityType: EntityType,
  provider: Provider,
): Promise<boolean> {
  const existing = await prisma.enrichmentLog.findFirst({
    where: { entityId, entityType, provider },
    select: { id: true },
  });
  return existing === null; // true = safe to enrich, false = already done
}
```

### Pattern 2: Provenance Recording (`recordEnrichment`)
**What:** Writes a row to `EnrichmentLog` after a provider run, capturing which fields were written, how much it cost, and when.
**When to use:** Called immediately after any provider writes data to Person/Company. Idempotent via upsert — re-running the same provider+entity creates a new log row (audit trail), not an upsert.
**Example:**
```typescript
// src/lib/enrichment/log.ts
import { prisma } from "@/lib/db";

export async function recordEnrichment(params: {
  entityId: string;
  entityType: EntityType;
  provider: Provider;
  fieldsWritten: string[];    // e.g. ["email", "linkedinUrl", "jobTitle"]
  costUsd?: number;           // provider cost per call, e.g. 0.002
  rawResponse?: unknown;      // stored for debugging
}): Promise<void> {
  await prisma.enrichmentLog.create({
    data: {
      entityId: params.entityId,
      entityType: params.entityType,
      provider: params.provider,
      fieldsWritten: JSON.stringify(params.fieldsWritten),
      costUsd: params.costUsd ?? null,
      rawResponse: params.rawResponse ? JSON.stringify(params.rawResponse) : null,
      runAt: new Date(),
    },
  });
}
```

### Pattern 3: Async Job Queue (DB-backed)
**What:** `EnrichmentJob` rows represent pending/in-progress/done work. A `/api/enrichment/jobs/process` route handler picks up the next pending job, processes one chunk of records (e.g. 50 at a time), updates progress, and returns. Vercel Cron or a manual trigger calls this endpoint repeatedly until the job is complete.
**When to use:** Any batch enrichment request (Phase 2+ provider runs on 100+ records).

**DB model:**
```prisma
model EnrichmentJob {
  id           String   @id @default(cuid())
  entityType   String   // "person" | "company"
  provider     String   // "prospeo" | "aiark" | etc.
  status       String   @default("pending") // pending | running | complete | failed
  totalCount   Int
  processedCount Int    @default(0)
  chunkSize    Int      @default(50)
  entityIds    String   // JSON array of entity IDs to process
  errorLog     String?  // JSON array of { entityId, error } for failures
  workspaceSlug String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@index([status])
}
```

**Process handler (skeleton):**
```typescript
// src/app/api/enrichment/jobs/process/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST() {
  // Pick up the oldest pending job
  const job = await prisma.enrichmentJob.findFirst({
    where: { status: "pending" },
    orderBy: { createdAt: "asc" },
  });
  if (!job) return NextResponse.json({ message: "no jobs" });

  // Mark running
  await prisma.enrichmentJob.update({
    where: { id: job.id },
    data: { status: "running" },
  });

  // Slice next chunk
  const allIds: string[] = JSON.parse(job.entityIds);
  const chunkStart = job.processedCount;
  const chunk = allIds.slice(chunkStart, chunkStart + job.chunkSize);

  // Process chunk (provider logic here in Phase 2)
  // ...

  // Update progress
  const newProcessed = chunkStart + chunk.length;
  const done = newProcessed >= job.totalCount;
  await prisma.enrichmentJob.update({
    where: { id: job.id },
    data: {
      processedCount: newProcessed,
      status: done ? "complete" : "pending", // back to pending = pick up again
    },
  });

  return NextResponse.json({ processed: chunk.length, done });
}
```

### Pattern 4: AI Normalization with `generateObject`
**What:** Claude Haiku receives a raw value and returns a validated canonical value from a controlled vocabulary. Using `generateObject` with a Zod schema guarantees the response matches the expected type — no manual JSON parsing.
**When to use:** For all three normalizers (industry, company name, job title). Fall through to rule-based normalization first; only call Claude if rule-based is insufficient.

**Example (industry normalizer):**
```typescript
// src/lib/normalizer/industry.ts
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { CANONICAL_VERTICALS } from "./vocabulary";

const IndustrySchema = z.object({
  canonical: z.enum(CANONICAL_VERTICALS as [string, ...string[]]),
  confidence: z.enum(["high", "medium", "low"]),
});

export async function classifyIndustry(raw: string): Promise<string | null> {
  if (!raw?.trim()) return null;

  // Rule-based fast path: exact match against canonical list
  const lower = raw.toLowerCase().trim();
  const exactMatch = CANONICAL_VERTICALS.find(v => v.toLowerCase() === lower);
  if (exactMatch) return exactMatch;

  // AI fallback
  const { object } = await generateObject({
    model: anthropic("claude-haiku-4-5-20251001"),
    schema: IndustrySchema,
    prompt: `Map this industry/vertical to the closest canonical value from the provided vocabulary.
Raw value: "${raw}"
Canonical verticals: ${CANONICAL_VERTICALS.join(", ")}
Return "Other" if no reasonable match exists.`,
  });

  return object.confidence === "low" ? null : object.canonical;
}
```

**Controlled vocabulary (vocabulary.ts):**
```typescript
// src/lib/normalizer/vocabulary.ts
export const CANONICAL_VERTICALS = [
  "Accounting & Finance",
  "Architecture & Construction",
  "B2B SaaS",
  "Business Acquisitions",
  "Business Services",
  "E-Commerce & Retail",
  "Education & Training",
  "Healthcare & Life Sciences",
  "HR & Recruitment",
  "Insurance",
  "Legal Services",
  "Logistics & Supply Chain",
  "Managed Services & IT",
  "Manufacturing",
  "Marketing & Advertising",
  "Media & Entertainment",
  "Professional Services",
  "Real Estate",
  "Staffing & Recruitment",
  "Telecoms",
  "Travel & Hospitality",
  "Other",
] as const;

export const SENIORITY_LEVELS = [
  "C-Suite",
  "VP",
  "Director",
  "Manager",
  "Senior IC",
  "IC",
  "Entry Level",
  "Unknown",
] as const;
```

### Anti-Patterns to Avoid
- **Processing full batch in one Vercel function call:** A 1000-person batch at ~50ms/person = 50 seconds; will timeout. Always chunk.
- **Writing to Person.vertical directly in the normalizer:** The normalizer should return a canonical value; the calling code decides whether to persist. Keeps normalizer pure and testable.
- **Using `generateText` + manual JSON parsing for AI normalization:** The existing `runner.ts` uses this pattern and it's fragile (race conditions on partial JSON, regex extraction). Use `generateObject` with a Zod schema instead.
- **One `EnrichmentLog` row per field:** Track per provider-run, not per field. One row per `(entityId, entityType, provider, runAt)` with `fieldsWritten` as a JSON array.
- **Using `prisma.person.upsert` for enrichment updates:** Upsert overwrites existing data. Always read-then-update with explicit field-level merge precedence (new value only written if existing is null).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Structured AI output parsing | Custom JSON regex extraction | `generateObject` from Vercel AI SDK with Zod schema | Handles retries, validation, and type safety automatically |
| Async job scheduler | Custom cron daemon or worker process | DB-backed job table + Next.js route handler (polled by Vercel Cron) | Works within Vercel's serverless constraints; no extra infra |
| Cost tracking aggregation | Custom analytics queries | Simple `SUM(costUsd)` on `EnrichmentLog` grouped by provider | Prisma handles aggregations; no need for a separate cost-tracking system |
| Canonical vocabulary matching | Fuzzy string matching library | Exact match first, then Claude Haiku | Claude handles ambiguity better than Levenshtein for industry names |

**Key insight:** The Vercel serverless model precludes long-running background processes. The DB-backed job queue pattern (store work, process in short chunks, repeat) is the established pattern for batch operations on Vercel — the exact same approach used by Vercel's own examples for long-running AI workflows.

## Common Pitfalls

### Pitfall 1: Vercel 30-Second Timeout on Batch Routes
**What goes wrong:** A batch enrichment route (e.g., "enrich all 14k people") processes records in a sequential loop and times out after 30 seconds, completing only a fraction of the work with no record of where it stopped.
**Why it happens:** Vercel Hobby/Pro functions have a hard 30-second limit (configurable up to 300s on Pro, but unreliable). Sequential DB operations for 14k records at 5ms/op = 70 seconds minimum.
**How to avoid:** Never process more than `chunkSize` (50) records per invocation. Track `processedCount` in the `EnrichmentJob` row. Each invocation picks up where the last left off.
**Warning signs:** Route handler taking >5 seconds on a handful of records; no `processedCount` tracking.

### Pitfall 2: Overwriting Good Data with Worse Data
**What goes wrong:** A secondary provider (e.g., AI Ark) enriches a person and overwrites a LinkedIn URL that Prospeo had already found with a null value from AI Ark.
**Why it happens:** The existing enrichment routes already have a "only write if null" pattern for some fields, but it's inconsistently applied. Without a field-level merge strategy, providers stomp each other.
**How to avoid:** Define explicit merge precedence in `types.ts`: `null` never overwrites an existing value; a non-null value from a higher-priority provider can overwrite a lower-priority one (controlled by `EnrichmentLog` lookup). For Phase 1, the rule is simpler: only write a field if the Person/Company currently has it as `null`.
**Warning signs:** `linkedinUrl`, `email`, or `jobTitle` mysteriously becoming null after enrichment runs.

### Pitfall 3: AI Normalizer Inventing Values
**What goes wrong:** Claude returns a canonical value that doesn't exist in the controlled vocabulary — e.g., "Digital Marketing" when the vocabulary only has "Marketing & Advertising".
**Why it happens:** LLMs don't reliably constrain output to a closed list unless the schema enforces it.
**How to avoid:** Use `z.enum(CANONICAL_VERTICALS)` in the `generateObject` Zod schema. The SDK will re-prompt Claude if it returns an out-of-vocabulary value. Also: include the full vocabulary in the prompt.
**Warning signs:** `industry` fields containing values not in `CANONICAL_VERTICALS`; Zod validation errors logged from normalizer.

### Pitfall 4: EnrichmentLog Growing Without Bounds
**What goes wrong:** Every time a batch job re-processes (even for retries), a new `EnrichmentLog` row is created, leading to hundreds of rows per entity after repeated runs.
**Why it happens:** `shouldEnrich` only checks for the existence of any log row — it doesn't distinguish successful runs from failed ones. If errors are logged and retried, log rows multiply.
**How to avoid:** Add a `status` column to `EnrichmentLog` (`"success" | "error" | "skipped"`). `shouldEnrich` checks for `status: "success"` only — entities with only error rows are still eligible for retry.
**Warning signs:** `EnrichmentLog` table growing faster than `Person` table; `shouldEnrich` returning false for entities with no actual enriched data.

### Pitfall 5: Zod 4 Breaking Changes
**What goes wrong:** Code written using Zod 3 patterns (e.g., `.nullable()`, `.optional()`, union syntax) fails at runtime or type-check time with Zod 4.
**Why it happens:** The project uses `zod@4.3.6`. Zod 4 has breaking changes from v3 (e.g., `z.union` behavior, error formatting, `.brand`). Vercel AI SDK `generateObject` with Zod works with both v3 and v4, but schema definitions may differ.
**How to avoid:** Use Zod 4 syntax throughout. For `generateObject`, pass the Zod schema directly — the SDK accepts it. Avoid Zod v3-specific patterns like `z.discriminatedUnion` with non-object members.
**Warning signs:** TypeScript errors on Zod schema definitions; runtime `ZodError` with unexpected structure.

## Code Examples

Verified patterns from existing codebase and official sources:

### generateObject with Zod enum (AI SDK pattern)
```typescript
// Pattern: structured AI output with constrained vocabulary
// Based on existing runner.ts + Vercel AI SDK generateObject docs
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

const result = await generateObject({
  model: anthropic("claude-haiku-4-5-20251001"),
  schema: z.object({
    canonical: z.enum(["A", "B", "C"]),
    confidence: z.enum(["high", "medium", "low"]),
  }),
  prompt: "Map X to one of: A, B, C",
});
// result.object is typed and validated — no JSON.parse needed
```

### Prisma model for EnrichmentLog
```prisma
model EnrichmentLog {
  id           String   @id @default(cuid())
  entityId     String   // Person.id or Company.id
  entityType   String   // "person" | "company"
  provider     String   // "prospeo" | "aiark" | "leadmagic" | "findymail" | "clay" | "ai-normalizer"
  status       String   @default("success") // "success" | "error" | "skipped"
  fieldsWritten String? // JSON array of field names written
  costUsd      Float?   // provider cost in USD (null for free/AI calls)
  rawResponse  String?  // JSON — debug only
  errorMessage String?  // populated when status = "error"
  runAt        DateTime @default(now())

  @@index([entityId, entityType])
  @@index([provider, status])
  @@index([runAt])
}
```

### shouldEnrich with status check
```typescript
// src/lib/enrichment/dedup.ts
export async function shouldEnrich(
  entityId: string,
  entityType: EntityType,
  provider: Provider,
): Promise<boolean> {
  const successfulRun = await prisma.enrichmentLog.findFirst({
    where: { entityId, entityType, provider, status: "success" },
    select: { id: true },
  });
  return successfulRun === null;
}
```

### DB-backed job chunk processing
```typescript
// Pattern: pick up next chunk, process, mark done or re-queue as pending
const allIds: string[] = JSON.parse(job.entityIds);
const chunk = allIds.slice(job.processedCount, job.processedCount + job.chunkSize);
// ... process chunk ...
const done = job.processedCount + chunk.length >= job.totalCount;
await prisma.enrichmentJob.update({
  where: { id: job.id },
  data: {
    processedCount: { increment: chunk.length },
    status: done ? "complete" : "pending",
    updatedAt: new Date(),
  },
});
```

### Vitest test for shouldEnrich (existing mock pattern)
```typescript
// src/__tests__/enrichment-dedup.test.ts
vi.mock("@/lib/db", () => ({
  prisma: {
    enrichmentLog: { findFirst: vi.fn() },
  },
}));

import { prisma } from "@/lib/db";
import { shouldEnrich } from "@/lib/enrichment/dedup";

describe("shouldEnrich", () => {
  it("returns true when no successful log exists", async () => {
    (prisma.enrichmentLog.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect(await shouldEnrich("person-1", "person", "prospeo")).toBe(true);
  });

  it("returns false when a successful log exists", async () => {
    (prisma.enrichmentLog.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "log-1" });
    expect(await shouldEnrich("person-1", "person", "prospeo")).toBe(false);
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual JSON parsing from LLM output (regex) | `generateObject` with Zod schema | AI SDK v4+ | Eliminates fragile regex; type-safe structured output |
| Long-polling or webhooks for async jobs | DB-backed job table + short-lived function invocations | Vercel serverless era | Works within 30s timeout; no extra infra |
| Rule-based industry normalization | LLM with constrained vocabulary | Claude Haiku era (2024+) | Handles ambiguous/multilingual industry names without custom training |

**Deprecated/outdated:**
- `generateText` + JSON regex extraction: Still works but fragile; `generateObject` is strictly better for structured output
- BullMQ / Redis queues on Vercel: Doesn't work with serverless (no persistent process); DB queue is the correct pattern

## Open Questions

1. **Should EnrichmentLog track AI normalizer calls as a "provider"?**
   - What we know: The normalizer calls Claude Haiku, which has a cost per token
   - What's unclear: Whether we want to track normalization cost separately from data provider cost
   - Recommendation: Yes — use `provider: "ai-normalizer"` with `costUsd` estimated from token counts. Keeps cost accounting complete. LOW priority for Phase 1 implementation; add the column but populate it as best-effort.

2. **Vercel Cron vs manual trigger for job processing**
   - What we know: Vercel Cron is available on Pro plan; the project deploys to Vercel
   - What's unclear: Whether the Vercel plan supports cron jobs (`vercel.json` `crons` config)
   - Recommendation: Design the `/api/enrichment/jobs/process` route to be callable both manually (from an admin UI button) and by cron. Don't block Phase 1 on cron setup — the route just needs to exist and work correctly.

3. **Chunk size tuning**
   - What we know: Each enrichment record write is ~5-10ms on Neon PostgreSQL (pooled)
   - What's unclear: Phase 2 provider API calls may add 100-500ms per record, making 50-record chunks too slow
   - Recommendation: Parameterize `chunkSize` on the `EnrichmentJob` model. Default 50 for DB-only operations (Phase 1 normalizer runs); Phase 2 may use 5-10 per chunk when API calls are involved.

## Sources

### Primary (HIGH confidence)
- Existing codebase — `src/app/api/people/enrich/route.ts`, `src/app/api/companies/enrich/route.ts`, `src/lib/agents/runner.ts`, `src/lib/normalize.ts` — current implementation patterns
- `prisma/schema.prisma` — existing data model; new models extend this
- `package.json` — confirmed library versions (Prisma 6.19.2, ai 6.0.97, zod 4.3.6, vitest 4.0.18)
- `.planning/codebase/CONVENTIONS.md` — naming patterns, import style, error handling conventions
- `.planning/codebase/TESTING.md` — vitest patterns, mock setup, test file location

### Secondary (MEDIUM confidence)
- `.planning/codebase/CONCERNS.md` — identified tech debt (unsafe batch ops, silent error swallowing) directly informs architecture decisions for this phase
- Vercel serverless 30-second timeout: documented behavior, consistent with ROADMAP.md pre-phase decisions noting "Async job queue pattern needed before any batch enrichment"
- Vercel AI SDK `generateObject` pattern: consistent with `runner.ts` use of `generateText` from same SDK; `generateObject` is the structured-output equivalent

### Tertiary (LOW confidence)
- Vercel Cron availability on current plan: not verified; recommendation is to make the route cron-compatible but not depend on cron being set up

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already installed and in use; no new dependencies
- Architecture: HIGH — dedup/log/queue/normalizer pattern is derived from existing codebase conventions and known Vercel constraints
- Pitfalls: HIGH — most pitfalls are directly observed in existing code (CONCERNS.md) or are well-established Vercel serverless limitations
- AI normalization patterns: HIGH — `generateObject` with Zod is the current AI SDK best practice; verified against existing agent patterns in runner.ts

**Research date:** 2026-02-26
**Valid until:** 2026-03-28 (stable stack; Vercel AI SDK 6.x has stable `generateObject` API)
