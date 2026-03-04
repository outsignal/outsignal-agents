# Phase 17: Leads Agent Discovery Upgrade - Research

**Researched:** 2026-03-04
**Domain:** Agent orchestration — discovery plan generation, dedup logic, lead promotion, quota enforcement, enrichment waterfall integration
**Confidence:** HIGH — all code paths are in-codebase; no external API research required for this phase

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Discovery plan format:**
- Full breakdown in the plan: sources selected, filters per source, estimated cost per source, estimated volume per source, total cost, quota impact
- Brief 1-line reasoning per source explaining why it was chosen (e.g., "Apollo — best for enterprise B2B with seniority filters")
- Chat-based plan modifications — admin replies to adjust ("remove Serper, add Apollo with seniority=VP"), agent regenerates and re-presents
- Confirm-then-execute flow — after admin approves, agent says "Starting discovery — estimated ~30 seconds..." before firing API calls
- Per-source results breakdown after execution: "Apollo: 142 found, 18 dupes skipped, 124 staged. Total: 206 new leads."
- Totals with sample duplicate names shown (not full list)

**ICP classification & routing:**
- Agent decides freely which sources to use — no hard-coded ICP categories
- System prompt guidance suggests source recommendations (enterprise → Apollo/Prospeo, niche → Firecrawl, local → Maps) as starting points
- Admin reviews and overrides via the approval plan
- On ambiguous requests, agent makes its best guess and builds the plan — the plan IS the clarification step
- AI Ark is an equal peer to Apollo/Prospeo (three people search sources, not a fallback)

**Dedup & promotion flow:**
- Triple-match dedup: email (exact), LinkedIn URL (exact), or full name + company domain (fuzzy)
- Non-duplicate leads auto-promote from DiscoveredPerson to Person table (no manual review step)
- Promoted leads immediately enter the enrichment waterfall (FindyMail → Prospeo → AI Ark → LeadMagic)
- The approval gate is at the plan stage, not at individual lead level

**Quota enforcement:**
- Soft limit — warn when discovery plan would exceed quota, let admin decide to proceed or reduce scope
- Before/after quota display: "Quota: 500/2,000 used → estimated 700/2,000 after this search (200 new leads)"
- Only promoted leads count against quota (duplicates are free)
- Rolling 30-day window for quota tracking (not calendar month)
- Quota usage visible on workspace settings page

### Claude's Discretion

- Exact dedup matching algorithm (fuzzy name+company threshold)
- Discovery plan text formatting in agent chat
- Error handling when individual sources fail mid-discovery
- How to handle partial results (some sources succeed, some fail)

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DISC-07 | Agent deduplicates discovered leads against local Person DB (by LinkedIn URL, email, or name+company match) before enrichment | `Person` table has indexed `linkedinUrl` and `email` (unique). Name+company fuzzy match requires in-process comparison — no pg_trgm needed; Levenshtein via pure TypeScript (`fastest-levenshtein` package or custom) is sufficient given typical batch sizes of 25-100 per source. New `deduplicateAndPromote()` function in `src/lib/discovery/promotion.ts`. |
| DISC-08 | Agent automatically selects best discovery sources based on ICP type without requiring manual source selection | System prompt upgrade tells the agent which sources suit which ICP shapes. Agent assembles a plan using the `buildDiscoveryPlan` tool (returns a structured plan object). No hard-coded routing logic — the LLM selects sources; the tool just computes cost/quota projections and returns them for presentation. |
| DISC-11 | Agent generates a discovery plan (sources selected, reasoning, estimated cost, estimated lead volume per source) and presents for admin approval before executing searches | New `buildDiscoveryPlan` tool in `leadsTools`. Takes workspace slug + intent + proposed sources with filters. Returns formatted plan text + plan state for agent memory. Agent presents plan, then awaits "approve" before calling the actual search tools. |
| DISC-12 | Admin can adjust the discovery plan (add/remove sources, change filters) before approving execution | Multi-turn conversation: admin replies with adjustments, agent calls `buildDiscoveryPlan` again with updated sources/filters. Runner already supports `conversationContext` field in `LeadsInput`. Plan is regenerated and re-presented. |
| DISC-13 | Discovery plan shows how campaign lead volume tracks against workspace monthly lead quota (e.g., "500 of 2,000 monthly leads used") | `getWorkspaceQuotaUsage()` already exists in `src/lib/workspaces/quota.ts`. `buildDiscoveryPlan` calls it, adds estimated new leads to current usage, and shows before/after. Soft limit: if projected total > quota, plan includes a warning line but does NOT block execution. |
</phase_requirements>

---

## Summary

Phase 17 is purely an orchestration and business logic upgrade — no new external APIs, no new schema migrations required. All discovery adapters are already wired into the Leads Agent as callable tools (Phase 16 complete). The `DiscoveredPerson` table is already live with a `status` lifecycle column (`staged → promoted | duplicate | rejected`) and a `personId` soft reference for promotion linkage.

The three pillars of Phase 17 are: (1) a `buildDiscoveryPlan` tool that computes cost and quota projections before any API calls are made; (2) a `deduplicateAndPromote()` function that checks staged records against the Person DB and auto-promotes non-duplicates; and (3) an enrichment trigger that queues promoted leads through the existing waterfall. The agent orchestrates these via conversation: plan → admin approves → execute searches → deduplicate → promote → enrich.

The most non-trivial piece is the fuzzy name+company dedup. Email and LinkedIn URL matches are exact DB lookups. The third leg (name+company) requires a Levenshtein distance comparison in memory between the staged record and a narrowed set of DB candidates filtered by `companyDomain`. Given batch sizes of 25-100 per source, an in-process approach is correct — no full-text search extension needed.

**Primary recommendation:** Implement this as three new files (`src/lib/discovery/promotion.ts`, updates to `src/lib/discovery/staging.ts`) plus a `buildDiscoveryPlan` tool and a `deduplicateAndPromote` tool added to `leadsTools` in `src/lib/agents/leads.ts`. The system prompt needs a substantial upgrade to teach the agent the plan-approve-execute flow.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @prisma/client | ^6.x (project) | All DB queries — Person dedup lookup, DiscoveredPerson status updates, promotion writes | Already used everywhere |
| fastest-levenshtein | — | Fuzzy string distance for name+company dedup | Pure TS, no native deps, zero config. Alternative: hand-roll Levenshtein (trivial, ~30 lines, no dependency needed) |
| ai (Vercel AI SDK) | ^4.x (project) | `tool()` constructor for new agent tools | Already the standard tool pattern in this codebase |
| zod | ^4.x (project) | Input schema for new tools | Already used by all existing tools |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| crypto (Node built-in) | — | `randomUUID()` for discovery run ID grouping | Already used in `staging.ts` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| In-process Levenshtein | PostgreSQL `pg_trgm` extension | pg_trgm requires schema migration + query complexity; in-process is simpler for this batch size |
| In-process Levenshtein | Dedicated fuzzy search library (fuse.js) | fuse.js is overkill — we only need string distance, not ranked search across thousands of records |

**Installation:**
```bash
# No new dependencies likely needed — hand-rolling Levenshtein is ~25 lines of TS
# If a package is preferred:
npm install fastest-levenshtein
```

---

## Architecture Patterns

### Recommended Project Structure

```
src/lib/discovery/
├── adapters/           # Existing — Apollo, Prospeo, AI Ark, Serper, Firecrawl (Phase 16)
├── staging.ts          # Existing — stageDiscoveredPeople() write helper
├── types.ts            # Existing — DiscoveredPersonResult, DiscoveryAdapter, DiscoveryFilter
└── promotion.ts        # NEW — deduplicateAndPromote(), promoteToPersonTable(), triggerEnrichment()

src/lib/agents/
└── leads.ts            # Existing — add buildDiscoveryPlan tool, deduplicateAndPromote tool, system prompt upgrade
```

### Pattern 1: Plan-Approve-Execute Flow

**What:** The agent does NOT call discovery tools directly when asked to find leads. Instead, it first calls `buildDiscoveryPlan` (a read-only tool that computes projections without making any external API calls), presents the plan to the admin, and waits for approval. Only after the admin says "approve" / "go" / "looks good" does it call the actual discovery tools (`searchApollo`, `searchProspeo`, etc.).

**When to use:** Every discovery request, without exception.

**How the agent recognizes approval:** The system prompt instructs the agent that confirmation phrases ("approve", "looks good", "go ahead", "yes", "confirm") trigger execution. Ambiguous responses trigger plan regeneration. This is conversational logic driven by the LLM — no keyword parsing needed in code.

**Example tool flow:**
```
User: "Find 200 CTOs at Series A SaaS companies in the UK for Rise"
Agent: [calls buildDiscoveryPlan]
  → returns plan: { sources: [{name: "apollo", ...}, {name: "prospeo", ...}], totalCost: $0.04, estimatedLeads: 200, quotaBefore: 500, quotaAfter: 700, quotaLimit: 2000 }
Agent: [presents plan as formatted text, waits]
User: "looks good, go"
Agent: "Starting discovery — estimated ~30 seconds..."
Agent: [calls searchApollo] → [calls searchProspeo]
Agent: [calls deduplicateAndPromote with runId]
Agent: "Apollo: 142 found, 18 dupes skipped, 124 promoted. Prospeo: 89 found, 7 dupes skipped, 82 promoted. Total: 206 new leads — enrichment running."
```

### Pattern 2: buildDiscoveryPlan Tool

**What:** A new tool in `leadsTools` that takes the workspace slug + proposed sources with their filters + estimated volume per source. Returns a formatted plan string and a structured plan object. Does NOT make external API calls. Reads quota from DB.

```typescript
// Source: src/lib/agents/leads.ts
buildDiscoveryPlan: tool({
  description: "Build a discovery plan showing sources, cost, estimated volume, and quota impact. Present this to admin before executing any searches. Does NOT make external API calls.",
  inputSchema: z.object({
    workspaceSlug: z.string(),
    sources: z.array(z.object({
      name: z.enum(["apollo", "prospeo", "aiark", "serper-web", "serper-maps", "firecrawl"]),
      reasoning: z.string().describe("1-line explanation of why this source was chosen"),
      estimatedVolume: z.number().describe("Estimated leads from this source"),
      filters: z.record(z.unknown()).describe("Source-specific filters as JSON"),
    })),
  }),
  execute: async (params) => {
    const usage = await getWorkspaceQuotaUsage(params.workspaceSlug);
    const workspace = await prisma.workspace.findUnique({ where: { slug: params.workspaceSlug } });
    const totalEstimatedLeads = params.sources.reduce((sum, s) => sum + s.estimatedVolume, 0);
    const totalCost = computePlanCost(params.sources);
    const quotaAfter = usage.totalLeadsUsed + totalEstimatedLeads;
    const quotaLimit = workspace?.monthlyLeadQuota ?? 2000;
    const overQuota = quotaAfter > quotaLimit;
    return { plan: params.sources, totalCost, totalEstimatedLeads, quotaBefore: usage.totalLeadsUsed, quotaAfter, quotaLimit, overQuota };
  },
}),
```

### Pattern 3: deduplicateAndPromote Tool

**What:** After all search tools have run for an approved plan, the agent calls `deduplicateAndPromote` with the discovery run ID(s). This function fetches all `staged` DiscoveredPerson records for those run IDs, checks each against the Person DB (triple match), marks duplicates, promotes new leads to Person table, and triggers enrichment.

```typescript
// Source: src/lib/agents/leads.ts
deduplicateAndPromote: tool({
  description: "After discovery searches complete, dedup staged leads against Person DB and promote new ones. Triggers enrichment waterfall for promoted leads. Call this after all searchX tools for an approved plan.",
  inputSchema: z.object({
    workspaceSlug: z.string(),
    discoveryRunIds: z.array(z.string()).describe("Run IDs from discovery tools"),
  }),
  execute: async (params) => {
    return deduplicateAndPromote(params.workspaceSlug, params.discoveryRunIds);
  },
}),
```

### Pattern 4: Dedup Logic in promotion.ts

**What:** Three-leg match, attempted in order. First match wins — no need to check further legs.

```typescript
// src/lib/discovery/promotion.ts

export async function deduplicateAndPromote(
  workspaceSlug: string,
  runIds: string[],
): Promise<PromotionResult> {
  // 1. Fetch all staged records for these run IDs
  const staged = await prisma.discoveredPerson.findMany({
    where: { discoveryRunId: { in: runIds }, status: "staged" },
  });

  const results = { promoted: 0, duplicates: 0, duplicateNames: [] as string[], promotedIds: [] as string[] };

  for (const dp of staged) {
    const existingPersonId = await findExistingPerson(dp);

    if (existingPersonId) {
      // Mark as duplicate — update DiscoveredPerson.status + personId
      await prisma.discoveredPerson.update({
        where: { id: dp.id },
        data: { status: "duplicate", personId: existingPersonId, promotedAt: new Date() },
      });
      results.duplicates++;
      // Collect name for sample display
      const name = [dp.firstName, dp.lastName].filter(Boolean).join(" ") || dp.email || "Unknown";
      if (results.duplicateNames.length < 5) results.duplicateNames.push(name);
    } else {
      // Promote: create Person record, link to workspace, mark DiscoveredPerson as promoted
      const person = await promoteToPerson(dp, workspaceSlug);
      await prisma.discoveredPerson.update({
        where: { id: dp.id },
        data: { status: "promoted", personId: person.id, promotedAt: new Date() },
      });
      results.promoted++;
      results.promotedIds.push(person.id);
    }
  }

  // Trigger enrichment for promoted leads
  if (results.promotedIds.length > 0) {
    await triggerEnrichmentForPeople(results.promotedIds, workspaceSlug);
  }

  return results;
}

async function findExistingPerson(dp: DiscoveredPerson): Promise<string | null> {
  // Leg 1: Email exact match
  if (dp.email) {
    const p = await prisma.person.findUnique({ where: { email: dp.email }, select: { id: true } });
    if (p) return p.id;
  }
  // Leg 2: LinkedIn URL exact match
  if (dp.linkedinUrl) {
    const p = await prisma.person.findFirst({ where: { linkedinUrl: dp.linkedinUrl }, select: { id: true } });
    if (p) return p.id;
  }
  // Leg 3: Name + company fuzzy match (only when both are present)
  if (dp.firstName && dp.lastName && dp.companyDomain) {
    return await fuzzyNameCompanyMatch(dp);
  }
  return null;
}
```

### Pattern 5: Fuzzy Name+Company Match

**What:** Query DB candidates by `companyDomain`, then compare full name using Levenshtein distance in memory.

**Threshold:** 0.85 similarity (15% edit distance tolerance) — handles minor spelling variants and abbreviations without false positives on common names.

```typescript
async function fuzzyNameCompanyMatch(dp: DiscoveredPerson): Promise<string | null> {
  if (!dp.companyDomain) return null;

  // Narrow candidate set to same company domain (indexed field)
  const candidates = await prisma.person.findMany({
    where: { companyDomain: dp.companyDomain },
    select: { id: true, firstName: true, lastName: true },
    take: 100, // Safety cap — shouldn't have >100 people per domain normally
  });

  const dpFullName = `${dp.firstName} ${dp.lastName}`.toLowerCase().trim();

  for (const candidate of candidates) {
    if (!candidate.firstName || !candidate.lastName) continue;
    const candidateName = `${candidate.firstName} ${candidate.lastName}`.toLowerCase().trim();
    const similarity = stringSimilarity(dpFullName, candidateName); // Levenshtein-based
    if (similarity >= 0.85) return candidate.id;
  }
  return null;
}

function stringSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const distance = levenshteinDistance(a, b); // 25-line implementation or fastest-levenshtein
  return 1 - distance / maxLen;
}
```

### Pattern 6: Person Promotion

**What:** Creating a Person record from a DiscoveredPerson. Must handle email uniqueness — Apollo/Prospeo often don't have emails, so the promotion creates a Person with a `null` email placeholder, which the enrichment waterfall then fills.

**Problem:** The `Person.email` field has `@unique` — it cannot be null. Current Person model: `email String @unique`. This means we cannot create a Person without an email — we'd get a unique constraint violation with multiple null emails.

**Solutions (Claude's Discretion):**
1. **Generate a placeholder email** using the person's name + company domain: `john.smith@[companyDomain]` (not a real email, enrichment overwrites it). Risk: can collide.
2. **Use a guaranteed unique placeholder** like a UUID: `placeholder-{uuid}@discovery.internal`. Clean, easy to detect later. Enrichment waterfall updates the email when a real one is found.
3. **Only promote when email is known** — skip promotion for email-less discovered leads. Severe: Apollo/Prospeo return identity-only.
4. **Schema change**: make `Person.email` nullable. Requires `prisma db push` + logic changes throughout.

**Recommendation (HIGH confidence):** Option 2 — placeholder email `placeholder-{cuid}@discovery.internal`. The pattern is consistent, detectable, unique, and the enrichment waterfall already updates `Person.email` via `mergePersonData()` when a real email is found. The existing `enrichEmail()` waterfall in `waterfall.ts` handles this correctly — it takes `personId` + `EmailAdapterInput` and writes the email back to the Person record.

```typescript
async function promoteToPerson(dp: DiscoveredPerson, workspaceSlug: string): Promise<Person> {
  const email = dp.email ?? `placeholder-${createId()}@discovery.internal`;

  const person = await prisma.person.upsert({
    where: { email },
    create: {
      email,
      firstName: dp.firstName,
      lastName: dp.lastName,
      jobTitle: dp.jobTitle,
      company: dp.company,
      companyDomain: dp.companyDomain,
      linkedinUrl: dp.linkedinUrl,
      phone: dp.phone,
      location: dp.location,
      source: `discovery-${dp.discoverySource}`,
      status: "new",
    },
    update: {}, // If somehow the same placeholder was used before, don't overwrite
  });

  // Create PersonWorkspace junction record
  await prisma.personWorkspace.upsert({
    where: { personId_workspace: { personId: person.id, workspace: workspaceSlug } },
    create: { personId: person.id, workspace: workspaceSlug },
    update: {},
  });

  return person;
}
```

### Pattern 7: Enrichment Trigger for Promoted Leads

**What:** After promotion, trigger the enrichment waterfall. The existing `EnrichmentJob` / `processNextChunk` queue system is the mechanism. However, the queue is designed for batch jobs processed by cron. For the discovery flow, we want to enqueue a job immediately.

**Approach:** Call `enqueueJob()` from `src/lib/enrichment/queue.ts` with `entityType: "person"`, `provider: "waterfall"` (a logical provider name), and the promoted person IDs. The Railway cron or Vercel cron picks this up.

**Alternative:** Trigger enrichment inline within the agent tool (call `enrichEmail()` for each promoted person directly). This is simpler but blocks the agent response for potentially minutes. Not appropriate for a chat interaction.

**Recommendation:** Enqueue the job and return immediately. The agent reports "Enrichment running in background" and the admin can check enrichment status later. This is consistent with the existing queue architecture.

```typescript
async function triggerEnrichmentForPeople(personIds: string[], workspaceSlug: string): Promise<void> {
  if (personIds.length === 0) return;
  await enqueueJob({
    entityType: "person",
    provider: "findymail", // Start with cheapest-first — waterfall handles multi-provider internally
    entityIds: personIds,
    chunkSize: 25,
    workspaceSlug,
  });
}
```

**Note:** The existing `enqueueJob` takes a single `provider` param, but the actual waterfall runs all providers in sequence. This means the queue handler at `/api/enrichment/process` (or Railway) needs to call `enrichEmail()` (the full waterfall) rather than a single provider. Check the existing cron route to confirm how `onProcess` is wired — this may already be the case.

### Pattern 8: Quota Display on Settings Page

**What:** The settings page already shows quota usage via `getWorkspaceQuotaUsage()` and `PackageQuotasForm`. The `quota.ts` function already counts `DiscoveredPerson` records with `promotedAt` set in the billing window. This means Phase 17's promotion logic (setting `promotedAt` on DiscoveredPerson records) automatically makes quota tracking work — no additional quota UI changes needed.

**Settings page quota:** Already working. The `PackageQuotasForm` component renders a `UsageBar` showing `totalLeadsUsed / monthlyLeadQuota`. As Phase 17 promotes leads and sets `promotedAt`, these counts automatically appear in the UI.

### Anti-Patterns to Avoid

- **Calling discovery tools before plan approval:** The agent must never skip the `buildDiscoveryPlan` → wait → execute flow. The system prompt must make this non-negotiable.
- **Hard-coding ICP routing logic:** No `if (enterprise) use apollo` branches in code. The LLM decides sources; `buildDiscoveryPlan` is just a cost calculator.
- **Blocking the agent on enrichment:** Never call the enrichment waterfall synchronously in the agent tool. Always enqueue.
- **Promoting without creating PersonWorkspace:** A promoted Person without a `PersonWorkspace` record won't appear in workspace searches. Always create both atomically.
- **Deduping by email only:** Apollo/Prospeo return no emails. If email-only dedup, every Apollo result would promote — creating thousands of duplicates with placeholder emails. The LinkedIn URL and name+company legs are essential.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Quota tracking | Custom counter/cache | `getWorkspaceQuotaUsage()` + existing `DiscoveredPerson.promotedAt` index | Already exists, already tested, auto-correct on any DB state |
| Enrichment queuing | Custom job queue | Existing `EnrichmentJob` + `enqueueJob()` | Already handles daily caps, pausing, chunk processing |
| Waterfall execution | Custom provider loop | `enrichEmail()` from `waterfall.ts` | Already handles circuit breakers, retry, normalizers |
| Agent tool scaffolding | Custom routing | `tool()` from `ai` SDK + `runAgent()` | Already the project standard, logs to AgentRun |
| Cost tracking | Custom cost DB | `incrementDailySpend()` from `costs.ts` | Already tracks per-provider daily totals |

**Key insight:** The enrichment infrastructure (waterfall, queue, costs, dedup gate) is fully battle-tested from Phases 15-16. Phase 17's job is to orchestrate it from the agent layer, not rebuild any of it.

---

## Common Pitfalls

### Pitfall 1: Person.email Uniqueness vs Null Emails

**What goes wrong:** Apollo and Prospeo return identity data without emails. `Person.email` is `@unique` and typed `String` (not `String?`) — cannot store null, and cannot store empty string without collision.

**Why it happens:** The Person model was designed for enriched leads that already have emails (Clay, EmailBison ingest). Discovery is the first flow that needs to create Person records without emails.

**How to avoid:** Use placeholder emails `placeholder-{cuid}@discovery.internal`. These are:
1. Unique (cuid guarantees it)
2. Detectable (can query `email LIKE 'placeholder-%@discovery.internal'` to find un-enriched leads)
3. Non-conflicting with real emails
4. Overwritten by enrichment waterfall when a real email is found

**Warning signs:** `Unique constraint failed on field email` errors during promotion.

### Pitfall 2: Fuzzy Dedup False Positives on Common Names

**What goes wrong:** "John Smith at acme.com" matches "James Smith at acme.com" — same company domain, similar name. Or worse: "John Smith" at a large company that has 50 John Smiths.

**Why it happens:** Low similarity thresholds or not requiring BOTH first AND last name for fuzzy match.

**How to avoid:**
- Require both `firstName` AND `lastName` AND `companyDomain` for fuzzy match (if any is missing, skip this leg and don't mark as duplicate)
- Use 0.85 similarity threshold (not lower)
- Never mark fuzzy match as duplicate unless all three fields match with sufficient confidence

**Warning signs:** Legitimate new leads being marked as duplicates, reducing discovery yields unexpectedly.

### Pitfall 3: Discovery Run ID Grouping Across Sources

**What goes wrong:** Agent calls `searchApollo` and `searchProspeo` for the same plan. Each tool call generates its own `runId`. When `deduplicateAndPromote` is called, it needs to know BOTH run IDs to process all staged records.

**Why it happens:** Each `stageDiscoveredPeople()` call generates a new `runId` if none is provided. The agent doesn't pass a shared run ID across tool calls.

**How to avoid:**
Option A — `buildDiscoveryPlan` generates and returns a `planRunId`. The agent passes this as `discoveryRunId` to each search tool call. All records share the same `runId`.
Option B — `deduplicateAndPromote` accepts an array of `discoveryRunIds` (as designed in the tool schema above).

**Recommendation:** Option B (array of run IDs) is simpler — the agent collects run IDs from each tool result and passes them all at once to `deduplicateAndPromote`. No need to pre-generate a plan ID.

**Warning signs:** `deduplicateAndPromote` returning 0 promoted because it's only looking at one source's run ID.

### Pitfall 4: Enrichment Queue Not Processing Discovery Provider

**What goes wrong:** `enqueueJob({ provider: "findymail", ... })` enqueues a job, but the cron handler at `/api/enrichment/process` only runs `enrichEmail()` for specific providers, not the full waterfall.

**Why it happens:** The existing queue was designed for single-provider jobs. The waterfall is a higher-level abstraction.

**How to avoid:** Check the existing enrichment cron handler (`/api/enrichment/process` or Railway equivalent) to confirm it calls `enrichEmail()` (the full waterfall function) in its `onProcess` callback. If it does, all providers run automatically. If it only calls a single provider, we need to pass `provider: "waterfall"` as a sentinel value and handle it in `onProcess`.

**Warning signs:** Promoted leads never getting emails — `EnrichmentLog` empty for promoted leads.

### Pitfall 5: Agent Not Waiting for Approval

**What goes wrong:** The agent interprets an ambiguous reply (like "that sounds like a lot of leads") as approval and starts firing API calls.

**Why it happens:** LLM is trained to be helpful and may interpret any positive-sounding response as confirmation.

**How to avoid:** System prompt must be explicit: "You MUST receive an explicit approval phrase ('approve', 'yes', 'go ahead', 'looks good', 'confirm', or similar) before calling any searchX tools. Any other response (questions, modifications, 'maybe', 'hmm') means: regenerate the plan with adjustments or ask for clarification."

**Warning signs:** Discovery running unexpectedly after user asks a follow-up question.

### Pitfall 6: maxSteps Too Low for Plan-Execute Flow

**What goes wrong:** The agent runs out of steps mid-discovery. Current `maxSteps: 8`. A full plan-execute flow takes: 1 (buildDiscoveryPlan) + N sources (1-5 search calls) + 1 (deduplicateAndPromote) + 1 (final response) = potentially 9+ steps.

**Why it happens:** Phase 16 set `maxSteps: 8` when discovery was simpler. Now we have more tool calls per conversation turn.

**How to avoid:** Increase `maxSteps` to 15 in `leadsConfig`. This covers: buildDiscoveryPlan + up to 5 search tools + deduplicateAndPromote + 1 follow-up search (pagination) + final response.

**Warning signs:** Agent response truncating mid-task, "stopped after N steps" behavior.

---

## Code Examples

### Cost Estimation for Plan

```typescript
// Source: src/lib/agents/leads.ts — buildDiscoveryPlan tool
const SOURCE_COST_PER_REQUEST: Record<string, number> = {
  apollo: 0,           // Free
  prospeo: 1.00,       // $1 per search request (prospeo-search adapter PROSPEO_SEARCH_CREDIT_COST)
  aiark: 0.003,        // Per result (aiark-search adapter estimatedCostPerResult)
  "serper-web": 0.001, // Per search call
  "serper-maps": 0.001,
  firecrawl: 0.015,    // Per extract call (PROVIDER_COSTS.firecrawl from firecrawl-directory.ts)
};

function computePlanCost(sources: PlanSource[]): number {
  return sources.reduce((sum, source) => {
    const costPerRequest = SOURCE_COST_PER_REQUEST[source.name] ?? 0;
    // Apollo: free regardless of volume. Others: estimate 1 request per 25 results.
    const requests = source.name === "apollo" ? 0 : Math.ceil(source.estimatedVolume / 25);
    return sum + costPerRequest * requests;
  }, 0);
}
```

**Note on actual cost values from adapters:**
- Apollo: `estimatedCostPerResult = 0` (free)
- Prospeo: `estimatedCostPerResult = 0.04` BUT this is per-result approximation; `PROSPEO_SEARCH_CREDIT_COST` is the per-request cost (1 credit ≈ $1 per search call returning 25 results)
- AI Ark: `estimatedCostPerResult = 0.003`
- Serper: `costUsd: 0.001` per call (from searchWeb/searchMaps return values)
- Firecrawl: `PROVIDER_COSTS.firecrawl` (check actual value in `firecrawl-directory.ts`)

### Quota Display in Plan Output

```typescript
// Inside buildDiscoveryPlan execute():
const quotaWarn = overQuota
  ? `\n⚠️  This plan would exceed your monthly quota by ${quotaAfter - quotaLimit} leads. You can proceed or reduce scope.`
  : "";

const planText = `
## Discovery Plan

**Workspace:** ${workspaceSlug}
**Quota:** ${quotaBefore.toLocaleString()} / ${quotaLimit.toLocaleString()} used → estimated ${quotaAfter.toLocaleString()} / ${quotaLimit.toLocaleString()} after this search${quotaWarn}

### Sources
${sources.map(s => `
**${s.name}** — ${s.reasoning}
- Filters: ${JSON.stringify(s.filters)}
- Estimated leads: ~${s.estimatedVolume}
- Cost: $${sourceCost(s).toFixed(3)}
`).join('')}

**Total estimated leads:** ~${totalEstimatedLeads}
**Total estimated cost:** $${totalCost.toFixed(3)}

Reply with "approve" to start discovery, or adjust the plan.`.trim();
```

### Promotion to Person Table

```typescript
// Source: src/lib/discovery/promotion.ts

import { createId } from "@paralleldrive/cuid2"; // already a project dep (check package.json)
// OR: import { randomUUID } from "crypto"; and use a UUID-based placeholder

async function promoteToPerson(
  dp: DiscoveredPerson,
  workspaceSlug: string,
): Promise<{ id: string }> {
  const email = dp.email ?? `placeholder-${createId()}@discovery.internal`;

  const person = await prisma.person.upsert({
    where: { email },
    create: {
      email,
      firstName: dp.firstName,
      lastName: dp.lastName,
      jobTitle: dp.jobTitle,
      company: dp.company,
      companyDomain: dp.companyDomain,
      linkedinUrl: dp.linkedinUrl,
      phone: dp.phone,
      location: dp.location,
      source: `discovery-${dp.discoverySource}`,
      status: "new",
    },
    update: {},
  });

  await prisma.personWorkspace.upsert({
    where: {
      personId_workspace: { personId: person.id, workspace: workspaceSlug },
    },
    create: { personId: person.id, workspace: workspaceSlug },
    update: {},
  });

  return person;
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Agent calls discovery tools directly | Agent builds plan → waits for approval → executes | Phase 17 | Admin controls spend; no surprise API costs |
| Discovery results sit in DiscoveredPerson staging forever | Auto-dedup and promote on plan execution | Phase 17 | Promoted leads enter Person DB and enrichment immediately |
| `stageDiscoveredPeople` uses `skipDuplicates: false` intentionally | Still `false` — dedup is now at promotion, not staging | Intentional | DiscoveredPerson is a complete audit log; promotion logic does the actual dedup |
| Single-provider enrichment jobs | Full waterfall triggered on promotion | Phase 17 | Promoted leads get cheapest-first email finding automatically |

**Deprecated/outdated:**
- The Phase 16 STATE.md note "stageDiscoveredPeople uses skipDuplicates: false intentionally — dedup is Phase 17 responsibility" — this is now implemented. Keep staging as-is; dedup moves to `promotion.ts`.

---

## Open Questions

1. **How does the existing enrichment cron call `processNextChunk()`?**
   - What we know: `EnrichmentJob` table exists, `enqueueJob()` creates jobs, `processNextChunk(onProcess)` takes a callback
   - What's unclear: Does the actual cron route (`/api/enrichment/process` or Railway) call `enrichEmail()` as the `onProcess` callback, or does it route by `job.provider`?
   - Recommendation: Read the cron/route handler before implementing `triggerEnrichmentForPeople()`. If it routes by provider, add a `"waterfall"` sentinel case. If it always calls `enrichEmail()`, just enqueue with any provider name.

2. **Does `@paralleldrive/cuid2` exist in the project, or should we use `randomUUID`?**
   - What we know: `cuid()` is used by Prisma for `@id @default(cuid())`. The project has `@prisma/client` which uses cuid internally.
   - What's unclear: Is `createId` from `@paralleldrive/cuid2` directly importable in app code?
   - Recommendation: Use `import { randomUUID } from "crypto"` for the placeholder — no dependency question, Node built-in, already used in `staging.ts`.

3. **What is `PROSPEO_SEARCH_CREDIT_COST` actual dollar value?**
   - What we know: Prospeo charges 1 credit per `/search-person` request. The adapter has `estimatedCostPerResult = 0.04` (approximate per-result cost assuming 25 results/page).
   - What's unclear: The exact dollar-per-credit rate in the codebase constant.
   - Recommendation: Read `src/lib/discovery/adapters/prospeo-search.ts` line 29 for the `PROSPEO_SEARCH_CREDIT_COST` constant value before hardcoding in `buildDiscoveryPlan`.

4. **Levenshtein implementation source?**
   - What we know: No fuzzy matching library is in `package.json` yet.
   - What's unclear: Is it worth adding `fastest-levenshtein` (1.3KB, no deps) or is hand-rolling preferred?
   - Recommendation: Hand-roll the 25-line Levenshtein implementation in `promotion.ts`. Avoids adding a new dependency for trivial functionality.

---

## Sources

### Primary (HIGH confidence)

- `/Users/jjay/programs/outsignal-agents/src/lib/agents/leads.ts` — Full Leads Agent, all existing tools, system prompt, config
- `/Users/jjay/programs/outsignal-agents/src/lib/discovery/staging.ts` — `stageDiscoveredPeople()`, `StagingResult` type
- `/Users/jjay/programs/outsignal-agents/src/lib/discovery/types.ts` — `DiscoveredPersonResult`, `DiscoveryAdapter`
- `/Users/jjay/programs/outsignal-agents/prisma/schema.prisma` — `Person`, `DiscoveredPerson`, `Workspace`, `PersonWorkspace` models
- `/Users/jjay/programs/outsignal-agents/src/lib/enrichment/waterfall.ts` — `enrichEmail()`, circuit breaker pattern
- `/Users/jjay/programs/outsignal-agents/src/lib/enrichment/queue.ts` — `enqueueJob()`, `processNextChunk()`
- `/Users/jjay/programs/outsignal-agents/src/lib/workspaces/quota.ts` — `getWorkspaceQuotaUsage()`, `computeBillingWindowStart()`
- `/Users/jjay/programs/outsignal-agents/src/lib/agents/types.ts` — `LeadsInput`, `LeadsOutput`, `AgentConfig`
- `/Users/jjay/programs/outsignal-agents/src/lib/agents/runner.ts` — `runAgent()` pattern
- `/Users/jjay/programs/outsignal-agents/src/lib/leads/operations.ts` — `searchPeople()`, `PersonSearchResult` types
- `/Users/jjay/programs/outsignal-agents/src/components/workspace/package-quotas-form.tsx` — Existing quota UI
- Discovery adapter cost values verified directly from adapter source files

### Secondary (MEDIUM confidence)

- `.planning/phases/16-discovery-sources/16-RESEARCH.md` — Phase 16 research confirming adapter patterns, cost values, AI Ark auth
- `.planning/STATE.md` — Accumulated decisions, Phase 16 completion status

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all patterns are in-codebase, no external research needed
- Architecture (plan-approve-execute): HIGH — fully derived from CONTEXT.md decisions + existing agent/tool patterns
- Dedup logic: HIGH — triple-match approach is clear; fuzzy threshold is Claude's Discretion (MEDIUM on exact value)
- Promotion pattern: MEDIUM on placeholder email approach — correct solution but depends on confirming no other code breaks on `placeholder-*@discovery.internal` emails
- Enrichment trigger: MEDIUM — depends on how existing cron handler wires `onProcess` (Open Question 1)
- Pitfalls: HIGH — all derived from direct codebase inspection

**Research date:** 2026-03-04
**Valid until:** 2026-04-03 (30 days — stable internal codebase, no external APIs)
