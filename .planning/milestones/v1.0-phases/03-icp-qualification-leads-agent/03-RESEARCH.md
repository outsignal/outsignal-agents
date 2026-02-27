# Phase 3: ICP Qualification + Leads Agent - Research

**Researched:** 2026-02-26
**Domain:** ICP scoring (Firecrawl + Claude Haiku), email verification (LeadMagic), MCP server tools for Claude Code, workspace AI prompt overrides
**Confidence:** HIGH (LeadMagic API, MCP SDK), MEDIUM (ICP scoring design, crawl caching)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**ICP Scoring**
- Numeric score 0-100 per person, not pass/fail or tiered
- Every score includes a 1-3 sentence text reasoning explaining why the prospect scored that way
- Scoring inputs: company website crawl (Firecrawl) + enrichment data from Phase 2 providers (headcount, industry, job title) + LinkedIn profile data if available
- Cache crawl results to prevent re-crawling the same company website
- Persist ICP score and reasoning on the person record

**Leads Agent**
- Built as MCP server tools for Claude Code — NOT a browser chat UI
- Uses Max Plan subscription ($0 AI cost) — no Claude API calls needed
- Only the project owner uses this, not clients
- Hybrid conversational style: accepts natural language input, returns structured data (tables, lists)
- Session memory across messages within a Claude Code conversation
- Confirms before expensive actions (enrichment calls, exports)
- 6 capabilities:
  1. Enrich a person (trigger waterfall)
  2. Search people (filter by fields)
  3. Build a list (create/manage named lists)
  4. Trigger export to EmailBison
  5. Score a prospect or batch-score a list
  6. Update lead status (interested, replied, bounced)

**Email Verification**
- Verify on export to EmailBison only — NOT on enrichment or on demand
- Use LeadMagic verification API
- Persist verification result on the person record in the database
- Only re-verify if the same lead is being re-exported (stale check)
- Invalid emails: block from export, show "verification failed" badge in UI
- Risky/catch-all emails: also blocked from export (strict policy)
- Cache verification result permanently — no automatic re-verification

**Workspace AI Customization**
- Three freeform text prompt fields per workspace, stored in DB:
  1. ICP criteria prompt (e.g., "Our ideal customer is a SaaS company with 50-200 employees in the UK")
  2. Normalization rules prompt (e.g., "Classify 'promo products' as 'Branded Merchandise'")
  3. Outreach tone prompt (e.g., "Professional but friendly, mention their recent funding round")
- Managed via MCP tools in Claude Code — no admin UI needed
- Only the project owner configures these, clients don't access them directly
- AI pipeline reads workspace prompts when scoring/normalizing/generating

### Claude's Discretion
- MCP tool naming and schema design
- Exact ICP scoring algorithm (how to weight different signals)
- How to handle missing data during scoring (confidence indicator approach)
- Firecrawl crawl caching strategy (TTL, storage format)
- LeadMagic verification API integration details
- Session memory implementation approach

### Deferred Ideas (OUT OF SCOPE)
- Browser-based chat UI for the Leads Agent — could be added in a future phase if clients need self-service access (would require Claude API costs)
- Automatic bulk re-verification of stale emails — not needed if verification happens on export
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AI-04 | System qualifies leads against ICP using Firecrawl + Haiku — crawl prospect's website and classify fit | Firecrawl scrape() API documented; generateObject() with Claude Haiku is the established normalizer pattern in this codebase; score 0-100 + reasoning via Zod schema |
| AI-05 | System supports custom AI enrichment prompts per workspace/project (different clients need different personalization and normalization rules) | Three DB-stored prompt fields on Workspace model; injected into system prompts at scoring/normalization time; managed via MCP tools |
| ENRICH-05 | System verifies email addresses via LeadMagic before export (hard gate — no unverified emails exported) | LeadMagic email-validation endpoint fully documented; status: valid/invalid/catch_all/unknown; store result in Person.enrichmentData JSON |
</phase_requirements>

---

## Summary

Phase 3 has three independent technical concerns: (1) ICP scoring via website crawl + AI classification, (2) email verification gating via LeadMagic, and (3) the Leads Agent as a local MCP server for Claude Code. All three have clear implementation paths using technologies already present in the codebase.

The ICP scoring logic follows the same `generateObject()` + Claude Haiku pattern already established in `src/lib/normalizer/`. Firecrawl's `scrape()` method (not the heavier `crawl()`) is the right call here — it fetches one URL and returns markdown, which is sufficient for homepage-level ICP signal extraction. Crawl results should be cached on the Company record (new `crawlCache` JSON column + `crawledAt` timestamp) to prevent re-crawling; the dedup gate pattern from `shouldEnrich()` can be reused by checking if `crawledAt` exists.

The LeadMagic email verification API is fully documented at `https://api.leadmagic.io/v1/people/email-validation` with clear status semantics. The project's strict policy (only `valid` allowed through) maps cleanly to blocking `invalid`, `catch_all`, and `unknown`. Verification results persist in `Person.enrichmentData` as `{ emailVerificationStatus, emailVerifiedAt }`. No new Prisma model is needed.

The Leads Agent is a local stdio MCP server using `@modelcontextprotocol/sdk` v1.27.1. It lives in `src/mcp/leads-agent/` as a standalone TypeScript entry point compiled and registered in `.mcp.json`. Tools call the same Prisma client and enrichment/waterfall functions as the rest of the codebase — no API boundary needed. The MCP server does not need Claude API calls; Claude Code runs locally and invokes the tools directly.

**Primary recommendation:** Build the MCP server first (schema + wiring), then ICP scoring (highest value), then email verification gate (required for export but Phase 5 is export — coordinate timing).

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | 1.27.1 | MCP server for Claude Code | Official SDK; McpServer + StdioServerTransport is the established pattern |
| `@mendable/firecrawl-js` | 4.13.2 (already installed) | Scrape prospect website for ICP signals | Already used in `firecrawl-company.ts`; no new dep needed |
| `ai` + `@ai-sdk/anthropic` | already installed | ICP classification via `generateObject()` | Same pattern as existing normalizers in `src/lib/normalizer/` |
| `zod` | 4.3.6 (already installed) | Schema for ICP score output + MCP tool inputs | Already in codebase; MCP SDK uses zod schemas for tools |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `tsx` | (devDep) | Run TypeScript MCP server entry without build step | Needed for `--command tsx src/mcp/leads-agent/index.ts` in `.mcp.json` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `scrape()` for ICP | `crawl()` (multi-page) | `scrape()` is faster and cheaper; homepage markdown is sufficient for ICP signals; `crawl()` already exists for deeper analysis |
| ICP score on Person | Separate IcpScore model | Keeping it on Person (via `enrichmentData` JSON) avoids schema changes; same pattern as `seniority` field already stored in `enrichmentData` |
| DB-stored crawl cache | In-memory or Redis | DB is simpler and persistent; no additional infra; aligns with how DailyCostTotal and EnrichmentLog work |

**Installation:**
```bash
npm install @modelcontextprotocol/sdk tsx
```

---

## Architecture Patterns

### Recommended Project Structure
```
src/
├── mcp/
│   └── leads-agent/
│       ├── index.ts          # MCP server entry point (connect + register tools)
│       └── tools/
│           ├── enrich.ts     # enrich_person tool
│           ├── search.ts     # search_people tool
│           ├── lists.ts      # create_list, add_to_list, view_list tools
│           ├── score.ts      # score_person, batch_score_list tools
│           ├── export.ts     # export_to_emailbison tool (calls verification gate)
│           ├── status.ts     # update_lead_status tool
│           └── workspace.ts  # set_workspace_prompt, get_workspace_prompts tools
├── lib/
│   ├── icp/
│   │   ├── scorer.ts         # scorePerson(personId, workspaceSlug) → IcpScoreResult
│   │   └── crawl-cache.ts    # getCachedCrawl(domain) + cacheCrawlResult(domain, markdown)
│   └── verification/
│       └── leadmagic.ts      # verifyEmail(email) → VerificationResult
```

### Pattern 1: MCP Server Entry Point (stdio)
**What:** Instantiate McpServer, register all tools, connect StdioServerTransport
**When to use:** Always — this is the only transport supported for local Claude Code agents

```typescript
// Source: https://github.com/modelcontextprotocol/typescript-sdk (v1.27.1)
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "outsignal-leads", version: "1.0.0" });

server.tool(
  "search_people",
  "Search people in the database by name, email, company, or job title",
  {
    query: z.string().describe("Search term"),
    workspace: z.string().optional().describe("Filter by workspace slug"),
    limit: z.number().default(20).describe("Max results"),
  },
  async ({ query, workspace, limit }) => {
    // ... call prisma
    return { content: [{ type: "text", text: JSON.stringify(results) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

**CRITICAL:** `console.log` in an MCP stdio server corrupts the JSON-RPC stream. Use `console.error` for debugging. All stdout is reserved for the protocol.

### Pattern 2: ICP Scoring via generateObject()
**What:** Scrape homepage → pass markdown + enrichment data to Claude Haiku → return structured score
**When to use:** When scoring a single prospect or batch-scoring a list

```typescript
// Source: follows pattern in src/lib/normalizer/industry.ts
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

const IcpScoreSchema = z.object({
  score: z.number().min(0).max(100),
  reasoning: z.string().describe("1-3 sentence explanation"),
  confidence: z.enum(["high", "medium", "low"]).describe("Data completeness"),
});

export async function scorePersonIcp(
  personData: PersonData,
  websiteMarkdown: string,
  workspaceIcpPrompt: string,
): Promise<IcpScoreResult> {
  const { object } = await generateObject({
    model: anthropic("claude-haiku-4-5-20251001"),
    schema: IcpScoreSchema,
    system: workspaceIcpPrompt, // workspace-specific ICP criteria
    prompt: buildScoringPrompt(personData, websiteMarkdown),
  });
  return object;
}
```

### Pattern 3: LeadMagic Email Verification
**What:** POST to `/v1/people/email-validation`, parse status, gate on `valid` only
**When to use:** Called from the `export_to_emailbison` MCP tool before any export proceeds

```typescript
// Source: https://leadmagic.io/docs/v1/reference/email-validation (verified 2026-02-26)
const VERIFY_ENDPOINT = "https://api.leadmagic.io/v1/people/email-validation";

const VerifyResponseSchema = z.object({
  email_status: z.enum(["valid", "invalid", "valid_catch_all", "catch_all", "unknown"]),
  email: z.string().optional(),
  credits_consumed: z.number().optional(),
});

export async function verifyEmail(email: string): Promise<VerificationResult> {
  const res = await fetch(VERIFY_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": getApiKey() },
    body: JSON.stringify({ email }),
  });
  const parsed = VerifyResponseSchema.parse(await res.json());
  return {
    status: parsed.email_status,
    isExportable: parsed.email_status === "valid", // strict policy — valid only
    credits: parsed.credits_consumed ?? 0,
  };
}
```

### Pattern 4: Crawl Cache on Company Record
**What:** Add `crawlMarkdown` + `crawledAt` to Company; check before calling Firecrawl
**When to use:** Any ICP scoring call — cache hit avoids Firecrawl API call

```typescript
// Cache is stored as TEXT column on Company (consistent with existing pattern)
// Check: company.crawledAt != null → use cached markdown
// Miss: call firecrawl.scrapeUrl(website), write to company record

async function getCrawlMarkdown(domain: string): Promise<string | null> {
  const company = await prisma.company.findUnique({ where: { domain } });
  if (company?.crawledAt && company.crawlMarkdown) {
    return company.crawlMarkdown; // cache hit
  }
  // miss → scrape + cache
  const result = await scrapeUrl(`https://${domain}`);
  await prisma.company.update({
    where: { domain },
    data: { crawlMarkdown: result.markdown, crawledAt: new Date() },
  });
  return result.markdown;
}
```

### Pattern 5: .mcp.json Registration
**What:** Register the MCP server at project scope so it's available to Claude Code
**When to use:** After building the MCP server entry point

```json
// .mcp.json at project root — checked into version control
{
  "mcpServers": {
    "outsignal-leads": {
      "command": "npx",
      "args": ["tsx", "src/mcp/leads-agent/index.ts"],
      "env": {
        "DATABASE_URL": "${DATABASE_URL}",
        "FIRECRAWL_API_KEY": "${FIRECRAWL_API_KEY}",
        "LEADMAGIC_API_KEY": "${LEADMAGIC_API_KEY}",
        "ANTHROPIC_API_KEY": "${ANTHROPIC_API_KEY}"
      }
    }
  }
}
```

**Note:** `tsx` must be installed (`npm install --save-dev tsx`) so `npx tsx` can run without a build step.

### Pattern 6: Workspace Prompt Storage
**What:** Add three TEXT columns to Workspace model; read at scoring/normalization time
**When to use:** ICP scoring, normalization, and outreach generation all read these fields

```prisma
// Addition to Workspace model in schema.prisma
icpCriteriaPrompt     String?  // "Our ICP is SaaS companies, 50-200 employees in UK"
normalizationPrompt   String?  // "Classify 'promo products' as 'Branded Merchandise'"
outreachTonePrompt    String?  // "Professional but friendly"
```

### Anti-Patterns to Avoid
- **Using `crawl()` for ICP scraping:** Much slower (crawls multiple pages, minutes vs seconds), more expensive, and overkill for homepage-level ICP signals. Use `scrapeUrl()` from the existing firecrawl client.
- **`console.log` in MCP server:** Corrupts stdio JSON-RPC stream silently. Use `console.error` only.
- **Storing ICP score as a new Prisma model:** Adds schema complexity with no benefit. Store `icpScore` and `icpReasoning` in `Person.enrichmentData` JSON (same as `seniority`), OR add two nullable columns to Person. Columns are preferable if the planner needs to filter/sort by score.
- **Verifying emails at enrichment time:** Contradicts the locked decision. Verification is export-only.
- **Building session memory in the MCP server:** Claude Code maintains conversation context natively. The MCP server should be stateless; tools can pass `workspace` slug on every call if needed.
- **Auto-launching MCP server with HTTP transport:** Stdio is the correct local transport. HTTP is for remote servers.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MCP server protocol | Custom stdio parser | `@modelcontextprotocol/sdk` McpServer + StdioServerTransport | Protocol negotiation, capability handshake, JSON-RPC framing are complex |
| ICP scoring prompt engineering | Custom scoring framework | `generateObject()` with Zod schema | Ensures structured output; same pattern as existing normalizers |
| Email format validation before LeadMagic call | Custom regex validator | None needed — LeadMagic returns `invalid` for RFC non-compliant emails | LeadMagic handles it; don't double-validate |
| Crawl rate limiting | Custom throttle | Firecrawl's own rate limits + existing retry/backoff in waterfall | Already solved in waterfall.ts; reuse the pattern |

**Key insight:** The MCP SDK handles all protocol complexity. The MCP server is just a thin wrapper that calls existing lib functions (Prisma, waterfall, normalizers) and formats the response as `{ content: [{ type: "text", text: "..." }] }`.

---

## Common Pitfalls

### Pitfall 1: stdout Pollution in MCP Server
**What goes wrong:** Any `console.log()` statement in the MCP server process writes to stdout, which is reserved for JSON-RPC protocol messages. This silently corrupts the communication with Claude Code and causes mysterious tool failures or "Connection closed" errors.
**Why it happens:** Node.js developers habitually use `console.log` for debugging.
**How to avoid:** Use `console.error()` (writes to stderr, safe) or a proper logger that writes to stderr. Add an ESLint rule or code comment warning in the MCP server entry file.
**Warning signs:** MCP tool calls failing with no error message; Claude Code shows "Connection closed" for the server.

### Pitfall 2: Firecrawl scrape() vs extract() for ICP Scoring
**What goes wrong:** Using `extract()` (the pattern in `firecrawl-company.ts`) for ICP scoring returns AI-extracted structured fields. For ICP scoring we want raw markdown so Claude Haiku can apply the workspace-specific ICP criteria prompt. `extract()` bakes in a fixed schema and loses signal.
**Why it happens:** `extract()` feels more "structured" but removes the flexibility needed for custom workspace prompts.
**How to avoid:** Use `scrapeUrl(url)` from `src/lib/firecrawl/client.ts` — returns raw markdown. Pass markdown to Claude Haiku with the workspace ICP criteria prompt.
**Warning signs:** ICP scores that seem "generic" and don't reflect workspace-specific criteria.

### Pitfall 3: LeadMagic `valid_catch_all` vs `catch_all`
**What goes wrong:** The API returns two similar-sounding statuses: `valid_catch_all` (domain verified AND accepts all, charged 0.05 credits) and `catch_all` (unverifiable, free). The strict policy blocks both from export, but the cost accounting differs.
**Why it happens:** Naming is confusing; developers assume `valid_catch_all` is safe because "valid" is in the name.
**How to avoid:** Only `valid` status → exportable. All others → blocked. Document this in the verifyEmail function with a comment. Log status for cost tracking.
**Warning signs:** Catch-all emails appearing in EmailBison campaigns.

### Pitfall 4: Missing `crawledAt` when Company Record Doesn't Exist Yet
**What goes wrong:** ICP scoring is called for a person whose company doesn't have a DB record yet. The cache check returns null, but there's also no `domain` to update after scraping.
**Why it happens:** Company records are created lazily (on first enrichment); some people may not have triggered company creation.
**How to avoid:** The `getCrawlMarkdown` function should upsert the Company record if it doesn't exist before writing `crawlMarkdown`. Alternatively, run ICP scoring only after company enrichment.
**Warning signs:** `prisma.company.update()` throwing "Record not found" errors during scoring.

### Pitfall 5: ICP Score on Wrong Record Level
**What goes wrong:** Scoring a person's ICP fit is workspace-specific (Rise's ICP ≠ Lime's ICP), but the Person model is workspace-agnostic. Storing `icpScore` directly on Person means a single score shared across workspaces.
**Why it happens:** The Person model is the natural "home" for person-level data.
**How to avoid:** Store ICP score on `PersonWorkspace` (junction table), NOT on `Person`. This means `PersonWorkspace` needs `icpScore Int?` and `icpReasoning String?` and `icpScoredAt DateTime?` columns. Alternatively, store in `PersonWorkspace.tags` JSON if that field is already JSON — but dedicated columns are cleaner.
**Warning signs:** Rise's score for a prospect overwriting Lime's score for the same person.

### Pitfall 6: MCP Server tsx Invocation on macOS
**What goes wrong:** `npx tsx ...` may fail if `tsx` is not installed as a devDependency and npx has to download it on every invocation, which can be slow or fail in certain environments.
**How to avoid:** Install `tsx` as a devDependency (`npm install --save-dev tsx`). The `.mcp.json` `args` should reference `tsx` via npx or direct path. An alternative is to add a `"mcp:leads"` script to `package.json` and use `npm run mcp:leads` as the command.

---

## Code Examples

### ICP Scoring Prompt Template
```typescript
// Source: informed by existing normalizer pattern + workspace prompt design
function buildScoringPrompt(person: PersonData, websiteMarkdown: string): string {
  return `
Score this prospect's ICP fit from 0-100 based on the workspace ICP criteria and the following data:

## Person Data
- Name: ${person.firstName} ${person.lastName}
- Job Title: ${person.jobTitle ?? "Unknown"}
- Company: ${person.company ?? "Unknown"}
- Industry: ${person.vertical ?? "Unknown"}
- Headcount: ${person.headcount ?? "Unknown"}
- Location: ${person.location ?? "Unknown"}

## Company Website (homepage excerpt)
${websiteMarkdown.slice(0, 3000)}

Return a score from 0-100 and 1-3 sentence reasoning. Include a confidence level based on data completeness.
`.trim();
}
```

### LeadMagic Verification with Cost Tracking
```typescript
// Source: verified API spec at leadmagic.io/docs (2026-02-26)
// Status values: valid | valid_catch_all | invalid | catch_all | unknown
// Cost: 0.05 credits for valid/invalid/valid_catch_all; FREE for catch_all/unknown

const VERIFICATION_COST: Record<string, number> = {
  valid: 0.05,
  invalid: 0.05,
  valid_catch_all: 0.05,
  catch_all: 0,     // free
  unknown: 0,       // free
};

// Export gate — strict policy: only 'valid' allowed
const EXPORTABLE_STATUSES = new Set(["valid"]);

async function verifyAndGate(email: string): Promise<{ allowed: boolean; status: string }> {
  const result = await verifyEmail(email);
  // Record cost if charged
  if (VERIFICATION_COST[result.status] > 0) {
    await incrementDailySpend("leadmagic-verify", VERIFICATION_COST[result.status]);
  }
  // Persist verification result
  await persistVerificationResult(email, result.status);
  return { allowed: EXPORTABLE_STATUSES.has(result.status), status: result.status };
}
```

### MCP Tool: search_people
```typescript
// Source: @modelcontextprotocol/sdk v1.27.1 patterns
server.tool(
  "search_people",
  "Search people in the database by name, email, company, or job title. Returns paginated table.",
  {
    query: z.string().describe("Text to search across name, email, company, job title"),
    workspace: z.string().optional().describe("Filter by workspace slug (e.g. 'rise')"),
    limit: z.number().default(25).describe("Max results (default 25)"),
    offset: z.number().default(0).describe("Pagination offset"),
  },
  async ({ query, workspace, limit, offset }) => {
    const where = {
      OR: [
        { email: { contains: query, mode: "insensitive" as const } },
        { firstName: { contains: query, mode: "insensitive" as const } },
        { lastName: { contains: query, mode: "insensitive" as const } },
        { company: { contains: query, mode: "insensitive" as const } },
        { jobTitle: { contains: query, mode: "insensitive" as const } },
      ],
      ...(workspace ? { workspaces: { some: { workspace } } } : {}),
    };
    const [people, total] = await prisma.$transaction([
      prisma.person.findMany({ where, take: limit, skip: offset }),
      prisma.person.count({ where }),
    ]);
    const table = formatAsMarkdownTable(people);
    return { content: [{ type: "text", text: `${total} total\n\n${table}` }] };
  }
);
```

### Schema Additions for Phase 3
```prisma
// Person model additions
model Person {
  // ... existing fields ...
  icpScore       Int?      // 0-100, workspace-specific → better on PersonWorkspace
  icpReasoning   String?   // 1-3 sentences
  icpScoredAt    DateTime?
  // email verification (workspace-agnostic, email is global)
  // store in enrichmentData JSON: { emailVerificationStatus, emailVerifiedAt }
}

// PersonWorkspace additions (preferred for ICP — workspace-scoped)
model PersonWorkspace {
  // ... existing fields ...
  icpScore     Int?
  icpReasoning String?
  icpScoredAt  DateTime?
}

// Company additions (crawl cache)
model Company {
  // ... existing fields ...
  crawlMarkdown  String?   // raw homepage markdown from Firecrawl
  crawledAt      DateTime? // when last crawled (null = not yet crawled)
}

// Workspace additions (AI prompt overrides)
model Workspace {
  // ... existing fields ...
  icpCriteriaPrompt    String?
  normalizationPrompt  String?
  outreachTonePrompt   String?
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Claude Desktop config (`claude_desktop_config.json`) | `.mcp.json` at project root (project-scope) | ~2025 | Claude Code prefers `.mcp.json`; team-shareable via git |
| `server.registerTool()` (docs) | `server.tool()` (actual API in v1.27.1) | SDK v1.x | Both work; `server.tool()` is the simpler shorthand |
| SSE transport for local servers | stdio transport | 2025 | SSE deprecated; stdio is the standard for local processes |
| `FirecrawlApp` (v1 SDK class) | `FirecrawlClient` as default export (v2 SDK) | Phase 2 research | Already handled in `firecrawl-company.ts` with zod cast |

**Deprecated/outdated:**
- `crawl()` for single-page data extraction: Use `scrapeUrl()` instead for ICP scoring; faster, cheaper
- SSE transport: Use stdio for local MCP servers

---

## Design Recommendations (Claude's Discretion Areas)

### ICP Scoring Algorithm
Recommended weighting approach (all signals → 0-100 score):
- **Website content match** (heaviest weight, ~50 pts max): Does the homepage describe the target market, product type, and business model matching the ICP criteria?
- **Enrichment data match** (~35 pts max): Headcount within range? Industry match? Location match?
- **Job title/seniority fit** (~15 pts max): Is this a decision-maker title? Seniority level matches?
- **Penalty for missing data**: Reduce confidence to "low", subtract up to 15 pts from score, include note in reasoning.

This is all implemented as a single Claude Haiku prompt with the workspace ICP criteria injected — no hand-coded weighting math needed.

### Missing Data Handling
Store a `confidence` field alongside the score: `high` (all three signal types present), `medium` (2/3 present), `low` (only 1 present or sparse data). Scores with `low` confidence get flagged in reasoning (e.g., "Scored with limited data — no headcount or website available").

### ICP Score Location: PersonWorkspace (recommended)
Store `icpScore`, `icpReasoning`, `icpScoredAt` on `PersonWorkspace`, not `Person`. This correctly captures that ICP fit is workspace-specific — a prospect who is a perfect fit for Rise (branded merchandise) may be a poor fit for Lime (recruitment). The MCP tools always scope scoring to a workspace.

### Crawl Cache TTL
Store permanently (no TTL). A company's homepage content changes infrequently; re-crawling on every score would waste Firecrawl credits. If a user wants a fresh crawl, the MCP tool can accept a `force_recrawl: true` parameter that overwrites the cache.

### Session Memory
No implementation needed. Claude Code maintains conversation context natively. Each tool call can optionally accept a `workspace` parameter. The only "session state" needed is which workspace the user is operating in — this should be passed on each tool call, not stored server-side.

### MCP Tool Naming Convention
Use snake_case tool names matching `{verb}_{noun}` pattern:
- `search_people`, `enrich_person`, `score_person`, `batch_score_list`
- `create_list`, `add_to_list`, `view_list`
- `export_to_emailbison`, `update_lead_status`
- `set_workspace_prompt`, `get_workspace_prompts`

---

## Open Questions

1. **Should ICP scoring trigger automatically after enrichment, or only on demand?**
   - What we know: Phase 3 scopes scoring to on-demand (via MCP tool or batch command)
   - What's unclear: Should a cron job batch-score all enriched people nightly?
   - Recommendation: On-demand only for Phase 3; batch scoring can be a cron job in Phase 4 or 5

2. **Does `provider` type need to include `"leadmagic-verify"` for cost tracking?**
   - What we know: `PROVIDER_COSTS` in `costs.ts` is keyed by provider name; `Provider` type in `types.ts` is a union
   - What's unclear: Should we reuse `"leadmagic"` or add `"leadmagic-verify"` as a distinct provider?
   - Recommendation: Add `"leadmagic-verify"` as a distinct provider in the `Provider` union — keeps verification separate from email finding in the cost dashboard

3. **LeadMagic API key — same key as email finding?**
   - What we know: The email-finding adapter uses `LEADMAGIC_API_KEY`; the verification endpoint uses `X-API-Key` header
   - What's unclear: Same API key works for both endpoints (likely yes, same account)
   - Recommendation: Assume same key (`LEADMAGIC_API_KEY`); one env var, two adapters

4. **PersonWorkspace schema — does Prisma `@@map("LeadWorkspace")` need updating?**
   - What we know: `PersonWorkspace` maps to DB table `"LeadWorkspace"`; adding columns requires `db push`
   - What's unclear: Any conflict with the `@@map` naming
   - Recommendation: `db push` with new columns on `PersonWorkspace` model is safe; the `@@map` is just a table name alias

---

## Sources

### Primary (HIGH confidence)
- LeadMagic email validation API spec — fetched directly from `leadmagic.io/docs/v1/reference/email-validation` (2026-02-26): endpoint URL, status values, pricing confirmed
- `@modelcontextprotocol/sdk` v1.27.1 — confirmed via `npm info @modelcontextprotocol/sdk version`; exports confirmed via `npm info @modelcontextprotocol/sdk exports`; import paths confirmed as `@modelcontextprotocol/sdk/server/mcp.js` and `@modelcontextprotocol/sdk/server/stdio.js`
- Claude Code MCP documentation — fetched from `code.claude.com/docs/en/mcp`: `.mcp.json` format, scope hierarchy, stdio transport, stdout warning confirmed
- Existing codebase patterns — `src/lib/normalizer/industry.ts` (generateObject pattern), `src/lib/firecrawl/client.ts` (scrapeUrl), `src/lib/enrichment/dedup.ts` (shouldEnrich gate pattern), `prisma/schema.prisma` (current models)

### Secondary (MEDIUM confidence)
- MCP server tool() method signature — verified via hackteam.io tutorial showing `server.tool("name", "description", zodSchema, asyncHandler)` pattern; consistent with SDK exports
- ICP scoring via generateObject() — inferred from existing normalizer pattern in codebase (HIGH confidence for the pattern, MEDIUM for ICP-specific weighting)

### Tertiary (LOW confidence)
- `tsx` as MCP server runner — multiple sources confirm npx tsx works for ts files without build; LOW confidence only because not tested in this specific Next.js monorepo context

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages already installed (except `@modelcontextprotocol/sdk` + `tsx`); versions confirmed
- Architecture: HIGH — follows established codebase patterns; LeadMagic API confirmed; MCP SDK confirmed
- Pitfalls: HIGH — stdout corruption is a documented MCP gotcha; ICP scope on PersonWorkspace is a correctness concern

**Research date:** 2026-02-26
**Valid until:** 2026-03-28 (stable stack; MCP SDK v2 pre-alpha not expected to land stable before then)
