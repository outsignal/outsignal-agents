# Architecture Research

**Domain:** Multi-source lead discovery, signal monitoring, Creative Ideas copy, CLI orchestrator, signal dashboard
**Researched:** 2026-03-03
**Confidence:** HIGH — based on direct codebase inspection + verified API docs

---

## System Overview

This is an integration architecture document for v2.0 additions to an existing system. Every decision must fit within the established patterns of:
- Agent pattern: `AgentConfig` + `runAgent()` + typed tools
- Enrichment pattern: provider adapter + waterfall orchestrator + circuit breaker + dedup gate
- Railway: long-running Node.js worker process polling via `ApiClient`
- Vercel: Next.js App Router, 2-cron limit already saturated

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              VERCEL (Next.js 16)                             │
├─────────────────────┬───────────────────────┬───────────────────────────────┤
│  Admin Dashboard    │   API Routes          │   Agent Framework              │
│  /admin/*           │   /api/chat           │   src/lib/agents/              │
│  /signals (NEW)     │   /api/discovery/*    │   orchestrator, runner, types  │
│  Cmd+J sidebar      │   /api/signals/*      │   leads (UPGRADE), writer,     │
│                     │   /api/cron/* (2 max) │   research, campaign           │
└─────────────────────┴───────────────────────┴───────────────────────────────┘
         │                       │                           │
         ▼                       ▼                           ▼
┌──────────────┐     ┌───────────────────┐     ┌──────────────────────────────┐
│  PostgreSQL  │     │  External APIs    │     │   src/lib/ modules            │
│  (Neon)      │     │  (Discovery)      │     │   enrichment/ (EXTEND)        │
│              │     │  Apollo           │     │   discovery/ (NEW)            │
│  Person      │     │  Prospeo Search   │     │   knowledge/store             │
│  Company     │     │  AI Ark Search    │     │   agents/shared-tools         │
│  SignalEvent │     │  Exa.ai           │     │                               │
│  (NEW)       │     │  Serper.dev       │     │   src/mcp/leads-agent/        │
│  SignalCamp  │     │  Apify LinkedIn   │     │   (EXTEND with new tools)     │
│  (NEW)       │     │  PredictLeads     │     │                               │
│  Campaign    │     │  Firecrawl        │     │   scripts/cli-chat.ts (NEW)   │
│  TargetList  │     └───────────────────┘     └──────────────────────────────┘
│  KBDocument  │
│  AgentRun    │
└──────────────┘
         ▲
         │  (all reads/writes via ApiClient → Vercel API)
         │
┌─────────────────────────────────────────────────────────────────────────────┐
│                         RAILWAY (Node.js workers)                            │
├──────────────────────────────┬──────────────────────────────────────────────┤
│  LinkedIn Worker (existing)  │  Signal Monitor Worker (NEW)                 │
│  worker/src/worker.ts        │  worker/src/signal-worker.ts                 │
│  - Polls LinkedIn action Q   │  - Long-running poll loop (same pattern)     │
│  - Voyager HTTP API          │  - Polls PredictLeads + Serper.dev           │
│  - Reports via ApiClient     │  - Writes SignalEvent via POST /api/signals  │
│                              │  - Triggers auto-pipeline on match           │
└──────────────────────────────┴──────────────────────────────────────────────┘
```

---

## Component Boundaries

### New vs Existing

| Component | Status | Location | Responsibility |
|-----------|--------|----------|----------------|
| `src/lib/discovery/` | NEW module | Vercel | Provider adapters for lead search (Apollo, Prospeo Search, AI Ark Search, Exa.ai, Serper.dev, Apify) |
| `src/lib/enrichment/` | EXTEND (not replace) | Vercel | Add discovery providers to Provider union; enrichment waterfall stays separate |
| `src/lib/agents/leads.ts` | UPGRADE | Vercel | New `discoverLeads` tool replaces/supplements DB-only `searchPeople` |
| `src/lib/agents/writer.ts` | EXTEND | Vercel | Add Creative Ideas mode via new tool + system prompt section |
| `src/lib/agents/orchestrator.ts` | EXTEND | Vercel | Add `delegateToSignalPipeline` delegation tool |
| `src/mcp/leads-agent/tools/` | EXTEND | Claude Code | New `discover.ts` and `signals.ts` tool modules |
| `worker/src/signal-worker.ts` | NEW | Railway | Long-running PredictLeads + Serper.dev poll loop |
| `worker/src/index.ts` | EXTEND | Railway | Launch signal worker alongside LinkedIn worker |
| `prisma/schema.prisma` | EXTEND | Both | Add SignalEvent, SignalCampaign models |
| `src/app/(admin)/signals/` | NEW page | Vercel | Signal dashboard UI |
| `src/app/api/signals/` | NEW routes | Vercel | Signal CRUD + pipeline trigger endpoints |
| `scripts/cli-chat.ts` | NEW script | Local | Interactive CLI orchestrator session |

---

## 1. Discovery Module: `src/lib/discovery/`

### Why a separate module (not inside `src/lib/enrichment/`)

Enrichment and discovery are architecturally different operations:
- **Enrichment**: takes a known person/company, fills in missing fields (email, title, etc.)
- **Discovery**: searches a provider's database to return a list of matching leads from criteria

Mixing them would bloat waterfall.ts and confuse the adapter interface contracts. Keep them separate.

### Structure

```
src/lib/discovery/
├── types.ts           # DiscoveryInput, DiscoveryResult, DiscoveryAdapter
├── index.ts           # discoverLeads(input, sources) — fan-out across providers
├── providers/
│   ├── apollo.ts      # Apollo /people/search → DiscoveryResult[]
│   ├── prospeo.ts     # Prospeo /search endpoint (separate from enrichment adapter)
│   ├── aiark.ts       # AI Ark search endpoint
│   ├── exa.ts         # Exa.ai company/person semantic search
│   ├── serper.ts      # Serper.dev Google + Reddit + Twitter search
│   └── apify.ts       # Apify LinkedIn scraping actor
```

### Core Types

```typescript
// src/lib/discovery/types.ts

export interface DiscoveryInput {
  jobTitles?: string[];
  industries?: string[];
  locations?: string[];
  companySizeMin?: number;
  companySizeMax?: number;
  keywords?: string[];
  companyType?: "enterprise" | "smb" | "niche" | "local";
  limit?: number;
}

export interface DiscoveryResult {
  email?: string;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  company?: string;
  companyDomain?: string;
  linkedinUrl?: string;
  location?: string;
  source: DiscoveryProvider;
  confidence: "high" | "medium" | "low";
  rawResponse?: unknown;
}

export type DiscoveryProvider =
  | "apollo"
  | "prospeo-search"
  | "aiark-search"
  | "exa"
  | "serper"
  | "apify";

export type DiscoveryAdapter = (
  input: DiscoveryInput
) => Promise<DiscoveryResult[]>;
```

### Source Selection Logic (in `index.ts`)

```typescript
// Agent provides ICP type hint — index.ts picks providers accordingly
// enterprise → Apollo (250M contacts, deep firmographics)
// niche → Exa.ai (semantic search, finds obscure verticals)
// local → Serper.dev (Google Maps + local business search)
// linkedin-heavy → Apify (LinkedIn scraping, profile data)
// default → Prospeo Search + AI Ark Search (cheapest first)
```

The Leads Agent calls `discoverLeads()` with the workspace ICP and a source hint. The function runs the appropriate providers in parallel (or sequenced by cost) and deduplicates against the local DB before returning.

---

## 2. Signal Monitoring: Railway Signal Worker

### Why Railway (not Vercel cron)

Vercel Hobby plan: 2 cron slots, both already used (enrichment + inbox-health). Adding a third would require a plan upgrade. Railway already runs the LinkedIn worker as a long-running process. The signal worker follows the identical architectural pattern.

### Pattern: Mirror the LinkedIn Worker

```
worker/
├── src/
│   ├── index.ts             # EXTEND: launch signal worker alongside LinkedIn worker
│   ├── worker.ts            # Existing LinkedIn worker (unchanged)
│   ├── signal-worker.ts     # NEW: PredictLeads + Serper.dev poll loop
│   ├── api-client.ts        # EXTEND: add postSignalEvent(), getSignalCampaigns()
│   ├── voyager-client.ts    # Unchanged
│   └── scheduler.ts         # Unchanged (reuse business hours logic)
```

### Signal Worker Loop

```typescript
// worker/src/signal-worker.ts

class SignalWorker {
  async tick(): Promise<void> {
    // 1. Fetch active SignalCampaigns from API
    const campaigns = await this.api.getSignalCampaigns();

    for (const campaign of campaigns) {
      // 2. Query PredictLeads for matching signals since last check
      const signals = await this.predictLeads.query({
        domains: campaign.targetDomains,
        signalTypes: campaign.signalTypes,  // job_change | funding | hiring | tech | news
        since: campaign.lastCheckedAt,
      });

      // 3. For each signal, POST to /api/signals/events
      for (const signal of signals) {
        await this.api.postSignalEvent({
          signalCampaignId: campaign.id,
          workspaceSlug: campaign.workspaceSlug,
          type: signal.type,
          companyDomain: signal.domain,
          payload: signal,
        });
      }

      // 4. Update campaign.lastCheckedAt
      await this.api.updateSignalCampaignLastChecked(campaign.id);
    }

    // 5. Social listening via Serper.dev (Reddit/Twitter)
    await this.runSocialListening();
  }
}
```

The signal worker polls every 4 hours (configurable per campaign). PredictLeads is queried per company domain list — this is efficient as PredictLeads is designed for agent-style polling.

---

## 3. Prisma Schema Extensions

### New Models

```prisma
// Add to prisma/schema.prisma

model SignalCampaign {
  id            String   @id @default(cuid())
  workspaceSlug String
  name          String
  description   String?

  // What signals to monitor
  signalTypes   String   // JSON array: ["job_change", "funding", "hiring", "tech", "news"]
  targetDomains String?  // JSON array of company domains to monitor (null = use workspace ICP)

  // Auto-pipeline config
  autoPipeline  Boolean  @default(false)  // trigger enrich→score→campaign→copy on match
  campaignTemplateId String?  // Campaign to clone as template for auto-pipeline

  // Monitoring cadence
  checkIntervalHours Int  @default(4)
  lastCheckedAt DateTime?

  status  String  @default("active")  // active | paused | archived
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  workspace Workspace      @relation(fields: [workspaceSlug], references: [slug])
  events    SignalEvent[]

  @@index([workspaceSlug, status])
}

model SignalEvent {
  id               String   @id @default(cuid())
  signalCampaignId String
  workspaceSlug    String
  type             String   // "job_change" | "funding" | "hiring_spike" | "tech_adoption" | "news" | "social_mention"

  // Source entity
  companyDomain    String?
  personEmail      String?  // if signal is person-level (job change)

  // Pipeline status
  pipelineStatus   String   @default("pending")  // pending | enriching | scoring | draft | portal | deployed | skipped
  personId         String?  // set after enrichment
  campaignId       String?  // set after campaign creation

  payload          String   // JSON - raw signal data from PredictLeads/Serper

  detectedAt       DateTime @default(now())
  processedAt      DateTime?

  campaign  SignalCampaign @relation(fields: [signalCampaignId], references: [id])

  @@index([signalCampaignId, pipelineStatus])
  @@index([workspaceSlug, type])
  @@index([detectedAt])
}
```

### Relationships to Existing Models

- `SignalCampaign` → `Workspace` (many-to-one, existing pattern matches Campaign → Workspace)
- `SignalEvent.personId` → `Person` (soft reference, resolved after enrichment)
- `SignalEvent.campaignId` → `Campaign` (created by auto-pipeline)
- `SignalCampaign.campaignTemplateId` → `Campaign` (optional template to clone)

---

## 4. Leads Agent Upgrade

### Current tools (local DB only)

`searchPeople`, `createList`, `addPeopleToList`, `getList`, `getLists`, `scoreList`, `exportListToEmailBison`, `searchKnowledgeBase`

### New tools to ADD (not replace)

```typescript
// src/lib/agents/leads.ts — add to leadsTools

discoverLeads: tool({
  description: "Search external discovery providers for new leads matching ICP criteria. " +
    "Use when: local DB has insufficient leads, client needs fresh contacts, " +
    "or agent selects 'enterprise' ICP type. Results are deduped against local DB before returning. " +
    "COSTS CREDITS. Always preview count before running.",
  inputSchema: z.object({
    workspaceSlug: z.string(),
    jobTitles: z.array(z.string()).optional(),
    industries: z.array(z.string()).optional(),
    locations: z.array(z.string()).optional(),
    companySizeMin: z.number().optional(),
    companySizeMax: z.number().optional(),
    keywords: z.array(z.string()).optional(),
    sources: z.array(z.enum(["apollo", "prospeo-search", "aiark-search", "exa", "serper", "apify"])).optional(),
    limit: z.number().optional().default(50),
  }),
  execute: async (params) => {
    return operations.discoverLeads(params);
  },
}),

searchDirectory: tool({
  description: "Scrape a niche directory or curated list URL via Firecrawl to extract leads. " +
    "Use for ultra-niche ICPs (e.g. 'all members of UK Promotional Merchandise Association'). " +
    "COSTS CREDITS (Firecrawl).",
  inputSchema: z.object({
    url: z.string(),
    extractionPrompt: z.string().describe("What to extract from each listing"),
    workspaceSlug: z.string(),
  }),
  execute: async (params) => {
    return operations.scrapeDirectory(params);
  },
}),
```

### Updated system prompt section

The Leads Agent system prompt gains a new section:

```
## Discovery Mode
When local DB results are insufficient or user asks to "find new leads" / "discover leads":
1. Check workspace ICP to determine best source(s)
   - Enterprise (>500 employees): Apollo (best firmographic depth)
   - Niche/unusual vertical: Exa.ai (semantic search)
   - Local/regional: Serper.dev (Google Maps, local queries)
   - LinkedIn-heavy ICP: Apify LinkedIn scraper
   - Default: Prospeo Search + AI Ark Search
2. Call discoverLeads with appropriate sources
3. Import discovered results into local DB via importDiscoveredLeads
4. Proceed with normal list-building flow on imported people
```

---

## 5. Writer Agent: Creative Ideas Mode

### What it is

A new generation mode that produces 3 constrained, client-specific "Creative Ideas" for a prospect — not generic "congrats on funding" hooks but ideas grounded in the client's specific value proposition and the prospect's situation.

### Implementation: New tool + system prompt section (not a new agent)

The Writer Agent already has the client context machinery. Adding Creative Ideas is a new tool + a new system prompt section.

```typescript
// Add to writerTools in src/lib/agents/writer.ts

getCreativeIdeasExamples: tool({
  description: "Retrieve per-client Creative Ideas examples from the knowledge base. " +
    "Tag format: 'creative-ideas-{workspaceSlug}'. These are admin-approved examples " +
    "for this specific client that the agent should emulate in style and constraint.",
  inputSchema: z.object({
    workspaceSlug: z.string(),
    prospectVertical: z.string().optional().describe("Prospect's industry to find relevant examples"),
    limit: z.number().optional().default(5),
  }),
  execute: async ({ workspaceSlug, prospectVertical, limit }) => {
    const tags = `creative-ideas-${workspaceSlug}`;
    const query = prospectVertical
      ? `creative ideas ${prospectVertical} examples`
      : "creative ideas examples constrained personalized";
    return searchKnowledge(query, { limit, tags });
  },
}),

saveCreativeIdeas: tool({
  description: "Save generated Creative Ideas for a prospect to the Campaign entity.",
  inputSchema: z.object({
    campaignId: z.string(),
    personId: z.string().optional(),
    ideas: z.array(z.object({
      title: z.string(),
      hook: z.string(),
      body: z.string(),
      rationale: z.string(),
    })),
  }),
  execute: async (params) => {
    // Stores in Campaign.emailSequence as a special "creative_ideas" type
    return saveCampaignCreativeIdeas(params);
  },
}),
```

### System prompt section to add

```
## Creative Ideas Mode
Triggered when task contains "creative ideas" or mode="creative_ideas".

Creative Ideas are 3 constrained, specific copy hooks for a single prospect.
NOT generic. NOT signal-as-hook. The signal is your targeting reason (invisible).
The hook is the creative angle that resonates with the prospect's world.

Process:
1. getCreativeIdeasExamples for this workspace + prospect vertical
2. getWorkspaceIntelligence for client context
3. searchKnowledgeBase for "creative ideas frameworks constrained personalization"
4. Generate 3 ideas, each with: Title | Hook (1 sentence) | Body (under 60 words) | Rationale
5. saveCreativeIdeas to campaign

Rules:
- Ideas must feel specific to this client's value prop (not generic)
- Constraint: reference something the prospect already does/has/believes
- No signal as hook — signal is targeting, not copy
- Vary the angle: one pain, one aspiration, one social proof
```

### Knowledge base tagging for per-client examples

Admin ingests Creative Ideas examples with tag `creative-ideas-{workspaceSlug}`. The ingest CLI already supports tags (`scripts/ingest-document.ts`). No new infrastructure needed — just tagging convention.

---

## 6. CLI Orchestrator

### Why a script (not MCP extension)

The existing MCP server (`src/mcp/leads-agent/`) is for Claude Code tool use — the model calls tools autonomously. The CLI orchestrator is a *human-in-the-loop* chat session where the admin types requests and the orchestrator responds interactively. These are different UX modes.

MCP tools are still available as discrete operations. The CLI chat is the conversational interface.

### Implementation

```typescript
// scripts/cli-chat.ts

/**
 * Interactive CLI chat session with the Outsignal Orchestrator.
 *
 * Usage:
 *   npx tsx scripts/cli-chat.ts [workspace-slug]
 *   npx tsx scripts/cli-chat.ts rise
 *
 * Features:
 * - Full orchestrator (same config as Cmd+J sidebar)
 * - Stateful conversation history within session
 * - Workspace context pre-loaded
 * - Ctrl+C to exit
 */

import readline from "node:readline";
import { generateText, stepCountIs } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
// Import orchestratorConfig and orchestratorTools with relative paths
// (path alias @/ not available in scripts)

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const history: Array<{ role: "user" | "assistant"; content: string }> = [];

async function chat(userInput: string): Promise<string> {
  history.push({ role: "user", content: userInput });

  const result = await generateText({
    model: anthropic(orchestratorConfig.model),
    system: orchestratorConfig.systemPrompt,
    messages: history,
    tools: orchestratorTools,
    stopWhen: stepCountIs(12),
  });

  const reply = result.text;
  history.push({ role: "assistant", content: reply });
  return reply;
}

// readline loop — prompt → chat() → print → repeat
```

### Key difference from scripts/generate-copy.ts

The existing scripts are single-shot (one task, exit). The CLI chat maintains `history` across turns, enabling multi-step orchestration:

```
> find 50 CTOs in UK manufacturing for Rise
[Leads Agent discovers 50 leads, returns results]
> create a list called "Rise UK Manufacturing CTOs"
[uses previous context — knows which people to add]
> write email copy for this campaign
[Writer Agent uses campaign context]
```

This matches the existing `conversationContext` pattern already in `LeadsInput`.

---

## 7. Signal Dashboard Page

### Route: `/admin/signals`

New page in the `(admin)` route group, following existing page patterns.

```
src/app/(admin)/signals/
├── page.tsx              # Main signal dashboard
├── [id]/
│   └── page.tsx          # Signal campaign detail + event feed
```

### API Routes

```
src/app/api/signals/
├── campaigns/
│   ├── route.ts          # GET list, POST create SignalCampaign
│   └── [id]/
│       ├── route.ts      # GET, PATCH, DELETE SignalCampaign
│       └── check/route.ts  # POST — manual trigger signal check
├── events/
│   ├── route.ts          # POST — receive signal from Railway worker
│   └── [id]/
│       └── route.ts      # GET event, PATCH pipeline status
└── pipeline/
    └── trigger/route.ts  # POST — trigger auto-pipeline for a SignalEvent
```

### Dashboard UI Components

```
Signal Dashboard (page.tsx)
├── KPI row: Signals today | Active campaigns | Pipeline queued | Deployed this week
├── Live feed: recent SignalEvents across all workspaces (paginated, filterable by type)
├── Per-client breakdown: table of workspaces + active signal counts
└── Cost tracking: PredictLeads credits used this period

Signal Campaign Detail ([id]/page.tsx)
├── Campaign config (signal types, target domains, cadence)
├── Event timeline (chronological signal events with pipeline status badges)
└── Auto-pipeline toggle + template campaign selector
```

---

## 8. Auto-Pipeline Orchestration

### Pattern: Event-driven pipeline in API route (not agent)

When a `SignalEvent` is created, the auto-pipeline runs as a sequential API-triggered workflow — not an agent call. The agent is only used for the copy generation step. This keeps the pipeline predictable and auditable.

```
POST /api/signals/events
    ↓
Validate + create SignalEvent
    ↓
If autoPipeline=true on SignalCampaign:
    ↓
POST /api/signals/pipeline/trigger (async via fetch, don't await)
    ↓
    Return 201 to Railway worker immediately

--- pipeline runs async ---
POST /api/signals/pipeline/trigger
    ↓
1. Enrich: enrichEmail() + enrichCompany() (existing waterfall)
    update SignalEvent.personId, pipelineStatus = "enriching" → "scoring"
2. Score: runIcpScorer() (existing)
    if score < threshold, pipelineStatus = "skipped", stop
3. Campaign: createCampaign() using template
    update SignalEvent.campaignId, pipelineStatus = "draft"
4. Copy: runWriterAgent({ mode: "creative_ideas", campaignId, personId })
    saves creative ideas to campaign
    pipelineStatus = "portal"
5. Notify client: existing notification system (Slack + email)
    "New signal campaign ready for review"
    ↓
Client sees campaign in portal → reviews Creative Ideas → approves
    ↓
Deploy to EmailBison + LinkedIn (existing deploy flow)
```

### Why async (fire-and-forget pattern)

PredictLeads API delivers signals in batches. Railway worker POSTs each event and must not wait for the pipeline to complete (could take 60-300s for enrichment + AI). The worker fires the event, Vercel's `/api/signals/events` route creates the DB record and triggers the pipeline async, then returns 201.

For Vercel Hobby (60s function limit), the pipeline trigger route may timeout on heavy enrichment runs. **Recommended approach**: write `SignalEvent` with `pipelineStatus = "pending"`, then a pipeline runner picks it up via a poll mechanism that the signal worker triggers by calling `/api/signals/pipeline/trigger` explicitly after posting each event — avoiding the Vercel function timeout entirely.

---

## Data Flow

### Discovery Flow

```
User (CLI/Chat): "find 50 CFOs in UK fintech for Lime"
    ↓
Orchestrator → delegateToLeads
    ↓
Leads Agent: discoverLeads({ jobTitles: ["CFO"], industries: ["fintech"], locations: ["UK"], sources: ["apollo"] })
    ↓
src/lib/discovery/index.ts → apolloAdapter.search(input)
    ↓
Dedup: filter out emails already in Person table
    ↓
Import: create Person records (source = "apollo"), PersonWorkspace records
    ↓
Return: { imported: 42, deduped: 8, total: 50 }
    ↓
Leads Agent: createList → addPeopleToList
    ↓
User: "ok score them" → scoreList (existing)
```

### Signal Auto-Pipeline Flow

```
PredictLeads API (polled by Railway signal worker every 4h)
    ↓
Signal detected: "Acme Corp received Series B funding"
    ↓
POST /api/signals/events { type: "funding", domain: "acme.com", ... }
    ↓ (async)
Pipeline trigger:
    enrichCompany(acme.com) → Company record updated
    enrichEmail(CFO at acme.com) → Person record found/created
    runIcpScorer(personId, workspaceSlug) → score: 82
    createCampaign("Acme - Funding Signal") from template
    runWriterAgent({ mode: "creative_ideas", campaignId, personId })
    Campaign.pipelineStatus = "portal"
    Slack notification: "New signal campaign ready"
    ↓
Client sees campaign in portal → reviews Creative Ideas → approves
    ↓
Deploy to EmailBison + LinkedIn (existing deploy flow)
```

### CLI Chat Session Flow

```
Admin: npx tsx scripts/cli-chat.ts rise
    ↓
readline.createInterface (stdin/stdout)
    ↓ (loop)
User input → generateText({ model, system, messages: history, tools: orchestratorTools })
    → tool calls execute (same as dashboard chat)
    → result.text printed
    → history accumulates
    ↓
Ctrl+C → process.exit
```

---

## Architectural Patterns

### Pattern 1: Extend Existing Agent (not fork)

**What:** Add new tools to `leadsTools` and `writerTools` objects. New system prompt sections are additive (append, not replace).

**When to use:** Feature fits within the agent's domain. Leads Agent owns pipeline ops. Writer Agent owns copy generation.

**Do not:** Create a "Discovery Agent" as a separate agent — it would duplicate orchestration logic and add a delegation hop. The Leads Agent handles discovery natively.

**Example:**
```typescript
// CORRECT — add to leadsTools in src/lib/agents/leads.ts
const leadsTools = {
  searchPeople,     // existing
  discoverLeads,    // NEW
  searchDirectory,  // NEW
  createList,       // existing
  // ...
};
```

### Pattern 2: Provider Adapter (pluggable)

**What:** Each discovery provider implements `DiscoveryAdapter`. The orchestrator in `discovery/index.ts` selects and runs adapters based on ICP type hint.

**Mirrors:** The enrichment `EmailAdapter` / `CompanyAdapter` pattern exactly.

**Example:**
```typescript
// src/lib/discovery/providers/apollo.ts
export const apolloAdapter: DiscoveryAdapter = async (input) => {
  const response = await fetch("https://api.apollo.io/v1/mixed_people/search", {
    method: "POST",
    headers: { "x-api-key": process.env.APOLLO_API_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({
      person_titles: input.jobTitles,
      organization_industry_tag_ids: resolveApolloIndustries(input.industries),
      person_locations: input.locations,
      per_page: input.limit ?? 50,
    }),
  });
  const data = await response.json();
  return data.people.map(mapApolloPersonToDiscoveryResult);
};
```

### Pattern 3: Railway Worker Extension (not new service)

**What:** Signal worker is a new class in `worker/src/`, launched alongside the LinkedIn worker in `index.ts`.

**When to use:** Any continuous background monitoring that cannot be a Vercel cron.

**Do not:** Deploy a second Railway service. One service, multiple worker classes running concurrently.

**Example:**
```typescript
// worker/src/index.ts — EXTENDED
const linkedinWorker = new Worker({ ... });
const signalWorker = new SignalWorker({ apiUrl: API_URL, apiSecret: API_SECRET });

// Run both concurrently
Promise.all([
  linkedinWorker.start(),
  signalWorker.start(),
]).catch(console.error);
```

### Pattern 4: Knowledge Base Tags for Per-Client Context

**What:** Use tag convention `creative-ideas-{workspaceSlug}` to segregate per-client examples in the shared KB. No new DB tables needed.

**When to use:** Content that needs per-client isolation within the shared knowledge store.

**Example:** Admin runs ingest CLI with `--tags creative-ideas-rise` for Rise-specific examples. Writer Agent queries with `tags = "creative-ideas-rise"`.

---

## Anti-Patterns

### Anti-Pattern 1: Creating a "Discovery Agent" as a separate agent

**What people do:** Create `src/lib/agents/discovery.ts` as a new specialist agent with its own config/tools.

**Why it's wrong:** Adds a delegation hop (Orchestrator → Leads Agent → Discovery Agent) with no benefit. The Leads Agent already owns pipeline operations. Discovery is a new *capability* of the Leads Agent, not a new domain.

**Do this instead:** Add `discoverLeads` and `searchDirectory` tools directly to `leadsTools` in `src/lib/agents/leads.ts`.

### Anti-Pattern 2: Third Vercel cron

**What people do:** Add signal monitoring as a third Vercel cron job.

**Why it's wrong:** Vercel Hobby plan limits to 2 crons. This would silently fail or require a paid plan upgrade.

**Do this instead:** Run signal monitoring in Railway alongside the LinkedIn worker. Signal events POST to the Vercel API, which is the established pattern.

### Anti-Pattern 3: Putting discovery providers in `src/lib/enrichment/providers/`

**What people do:** Add Apollo, Exa, etc. adapters to the enrichment providers folder.

**Why it's wrong:** Enrichment adapters have a different contract (`EmailAdapter`, `CompanyAdapter` — they take identifiers, return field values). Discovery adapters take search criteria and return lead lists. Mixing them breaks the type contracts and confuses the waterfall.

**Do this instead:** Create `src/lib/discovery/providers/` with the `DiscoveryAdapter` interface.

### Anti-Pattern 4: Blocking Railway worker on pipeline completion

**What people do:** Have the signal worker POST an event and await the full enrich→score→copy pipeline before returning.

**Why it's wrong:** The pipeline takes 60-300 seconds. The signal worker would timeout or hold up processing of subsequent signals.

**Do this instead:** POST signal event → receive 201 → move on. Pipeline runs async. Worker only reports the signal.

### Anti-Pattern 5: New MCP server for CLI orchestrator

**What people do:** Create a new MCP server in `src/mcp/cli-agent/` for the CLI chat experience.

**Why it's wrong:** MCP servers are for Claude Code tool-use (the model initiates tool calls autonomously). The CLI chat is a *human-driven* interactive session. MCP protocol overhead is unnecessary.

**Do this instead:** `scripts/cli-chat.ts` — simple readline loop calling `generateText()` with `orchestratorTools` and accumulated history. Same tools, different entry point.

---

## Build Order

Dependencies determine sequence. Each phase unblocks the next.

```
Phase 1: Prisma schema (SignalEvent, SignalCampaign)
    → enables all downstream data writes

Phase 2: Discovery module (src/lib/discovery/)
    → provider adapters, index.ts fan-out, dedup logic

Phase 3: Leads Agent upgrade (discoverLeads + searchDirectory tools)
    → depends on Phase 2 discovery module

Phase 4: Signal API routes (src/app/api/signals/)
    → depends on Phase 1 schema

Phase 5: Signal Worker (worker/src/signal-worker.ts)
    → depends on Phase 1 schema + Phase 4 API routes

Phase 6: Auto-pipeline (/api/signals/pipeline/trigger)
    → depends on Phase 1 schema + existing enrichment + existing writer

Phase 7: Signal Dashboard page (/admin/signals)
    → depends on Phase 4 API routes

Phase 8: Writer Agent Creative Ideas mode
    → depends on KB tagging convention only (can build anytime)

Phase 9: CLI orchestrator (scripts/cli-chat.ts)
    → depends on nothing — can be built anytime after orchestrator exists
```

Phases 8 and 9 are independent — can be parallelized with Phases 2-7.

---

## Integration Points

### External Services

| Service | Integration Pattern | Auth | Notes |
|---------|---------------------|------|-------|
| Apollo.io | REST POST `/v1/mixed_people/search` | `x-api-key` header | 250M+ contacts, best for enterprise firmographics |
| Prospeo Search | REST (separate from enrichment endpoint) | API key | Different endpoint from enrichment adapter |
| AI Ark Search | REST search endpoint | API key (LOW confidence — verify) | May differ from person enrichment endpoint |
| Exa.ai | REST `/search` with `type: "company"` | `x-exa-api-key` | Semantic search, MCP server available |
| Serper.dev | REST POST `/search` | `X-API-KEY` | Google + Maps + news + Reddit/Twitter |
| Apify | REST Actor run + dataset GET | Bearer token | LinkedIn scraping actor |
| PredictLeads | REST GET `/signals` | API key | 5 signal types, query by domain list, designed for agent polling |

### Internal Boundaries

| Boundary | Communication | Pattern |
|----------|---------------|---------|
| Railway signal worker → Vercel API | HTTP POST | `ApiClient.postSignalEvent()` (same pattern as LinkedIn worker) |
| Vercel API → pipeline trigger | Async fetch (fire-and-forget) | `fetch(url).catch(console.error)` — don't await |
| Leads Agent → discovery module | Direct function call | `import { discoverLeads } from "@/lib/discovery"` |
| Writer Agent → creative ideas KB | Tool call via searchKnowledge | Tag: `creative-ideas-{slug}` |
| Signal dashboard → signal events | REST GET `/api/signals/events` | Standard App Router pattern |
| CLI chat → orchestrator | Direct `generateText()` call | Same `orchestratorTools` object as `/api/chat` |

---

## Confidence Assessment

| Area | Confidence | Basis |
|------|------------|-------|
| Agent extension pattern | HIGH | Direct read of src/lib/agents/* |
| Railway worker extension | HIGH | Direct read of worker/src/worker.ts + index.ts |
| Vercel cron constraint | HIGH | vercel.json confirms exactly 2 crons registered |
| Enrichment vs discovery separation | HIGH | Direct read of enrichment/types.ts, confirmed type contract difference |
| Prisma schema additions | HIGH | Direct read of full schema, modeled on Campaign/Workspace patterns |
| Apollo API | MEDIUM | Official docs verified, field mappings need test at build time |
| PredictLeads API | MEDIUM | REST API confirmed, exact endpoint shapes need verification |
| Exa.ai company search | MEDIUM | Company Search feature confirmed via changelog |
| Pipeline async pattern | HIGH | Matches existing enrichment queue architecture |
| CLI readline pattern | HIGH | Standard Node.js + Vercel AI SDK generateText() pattern |

---

## Sources

- [Apollo.io People API Search](https://docs.apollo.io/reference/people-api-search)
- [Exa.ai company search changelog](https://exa.ai/docs/changelog/company-search-launch)
- [PredictLeads integration patterns](https://blog.predictleads.com/)
- [Vercel AI SDK Node.js getting started](https://ai-sdk.dev/docs/getting-started/nodejs)
- [Exa MCP server reference](https://github.com/exa-labs/exa-mcp-server)
- Existing codebase: direct inspection of all `src/lib/agents/`, `src/lib/enrichment/`, `worker/src/`, `prisma/schema.prisma`

---

*Architecture research for: Outsignal v2.0 Lead Discovery & Intelligence*
*Researched: 2026-03-03*
