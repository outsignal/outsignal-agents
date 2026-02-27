# Phase 7: Leads Agent Dashboard - Research

**Researched:** 2026-02-27
**Domain:** AI SDK tool() agents, natural language lead pipeline, EmailBison API surface
**Confidence:** HIGH (codebase verified directly; EmailBison API probed live against production)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Chat interaction model**
- Break multi-step flows into separate steps — agent completes one action, shows results, then asks before continuing to the next
- Preview before any credit-spending action (Prospeo lookups, enrichment API calls) — searches against the existing DB are free and run immediately
- Conversational refinement within a session — follow-up messages refine the previous result set (e.g. "narrow to London only" after a search)
- Text input + contextual action buttons — chat responses include quick-action buttons for common next steps (e.g. "Add to list", "Score these", "Export")

**Results presentation**
- Compact table layout — dense rows, scannable, fits pipeline workflow
- Default 25 rows in a scrollable table within the chat response
- Full column set: Name, Title, Company, Email Status, LinkedIn, ICP Score, Company Domain, Vertical, Source
- ICP scores display with a brief one-line reason (e.g. "85 — title match, verified email, target vertical")

**Agent voice and error handling**
- Friendly but brief tone — warm and efficient, light personality (e.g. "Nice — found 47 CTOs in fintech! 32 have verified emails. Want to build a list?")
- Empty results: suggest refinements
- Unrecognized queries: show capabilities list
- API failures: report transparently + offer retry

**EmailBison API spike**
- Automated probe against the live white-label API (Outsignal workspace at app.outsignal.ai)
- Discover: campaign create, sequence step schema, lead upload, lead-to-campaign assignment endpoints
- Known flow: upload lead to workspace first (gets an EmailBison-generated ID), then use that ID to add them to a campaign — spike must verify this two-step process
- Output: standalone planning doc at `.planning/spikes/emailbison-api.md` capturing all findings

### Claude's Discretion
- Streaming vs complete response rendering approach
- Exact action button placement and styling
- How session context (conversational refinement) is stored and scoped
- AgentRun audit trail schema and logging granularity
- Search query parsing approach (structured vs fuzzy vs hybrid)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| LEAD-01 | Admin can search people and companies from Cmd+J dashboard chat | Existing `/api/people/search` route supports all filter params; `queryPeople` tool already in orchestrator; need richer tool with title/location/jobTitle filtering + pagination + ICP score join |
| LEAD-02 | Admin can create, view, and manage target lists from dashboard chat | `POST /api/lists` and `GET /api/lists` already exist; need `createList`, `addPeopleToList`, `getList` tools in Leads Agent |
| LEAD-03 | Admin can score leads (ICP qualification) from dashboard chat | `scorePersonIcp()` already in `src/lib/icp/scorer.ts`; tool must batch-score via `PersonWorkspace.icpScore` and skip already-scored leads |
| LEAD-04 | Admin can export verified leads to EmailBison from dashboard chat | `getListExportReadiness()` and `verifyAndFilter()` exist; EmailBison `createLead()` and campaign assignment are now verified — see DEPLOY-01 findings |
| LEAD-05 | Leads Agent shares operations layer with MCP tools (no logic divergence) | Operations must be in `src/lib/leads/operations.ts` — agent tools wrap these; MCP tools (future) also wrap them |
| LEAD-06 | All Leads Agent operations logged to AgentRun audit trail | `runAgent()` in runner.ts already handles this via `AgentRun` model; the Leads Agent simply needs to run via `runAgent()` |
| DEPLOY-01 | EmailBison campaign API capabilities discovered via spike | COMPLETED during research — full findings below |
</phase_requirements>

---

## Summary

Phase 7 implements the Leads Agent — a chat-driven interface for the full lead pipeline (search, list build, score, export). The technical foundation is already 80% built: the DB schema has `TargetList`, `PersonWorkspace` with ICP score fields, the ICP scorer exists, the verification gate exists, and the EmailBison client can create leads. The remaining work is: (1) wiring up an operations layer so logic is not duplicated between the agent and future MCP tools, (2) building the Leads Agent tools that wrap those operations, (3) routing `delegateToLeads` in the orchestrator to the real agent, and (4) producing the EmailBison spike note.

The EmailBison API spike was executed live during research. The key discovery: **there is no endpoint to assign an existing lead to a campaign**. Lead-to-campaign assignment only works at lead creation time if the API supports it, but testing confirmed `campaign_id` at creation is silently ignored. The only working path to populate a campaign with leads is via the campaign's CSV import UI. For DEPLOY-01, the spike note should document: lead upload works, campaign creation works, sequence step creation works (via `POST /campaigns/{id}/sequence-steps`), but lead-to-campaign assignment is absent from the API surface. Phase 10 design must account for this.

Streaming response rendering (via `useChat` + AI SDK) is the correct approach for chat UI — it gives live feedback during long Leads Agent operations. Session context for conversational refinement should be stored in the existing `messages` array state from `useChat` (AI SDK conversation history) and the agent system prompt should instruct the model to reference prior results.

**Primary recommendation:** Build `src/lib/leads/operations.ts` as the shared operations layer first. Wire agent tools and audit trail second. Do not put any query or mutation logic directly inside agent tool `execute()` closures.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ai` (Vercel AI SDK) | 6.0.97 | `streamText`, `tool()`, `useChat`, `convertToModelMessages` | Already used in chat route and all agents; streaming is the UX requirement |
| `@ai-sdk/anthropic` | 3.0.46 | Anthropic model provider | Already configured; Claude Haiku for scoring, Sonnet for agent |
| `zod` | 4.3.6 | Tool input schema validation | Required by AI SDK tool() for inputSchema |
| `@prisma/client` | 6.19.2 | All DB queries | All data lives in Neon/PostgreSQL |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `react-markdown` + `remark-gfm` | 10.1.0 / 4.0.1 | Render markdown tables in chat | Already used in ChatSidebar for agent text responses |
| `lucide-react` | 0.575.0 | Action button icons | For the contextual action buttons in chat responses |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| AI SDK `streamText` in chat route | `generateText` (non-streaming) | Streaming is required — long operations (scoring 200 leads) would time out and give no feedback without it |
| Operations layer (`operations.ts`) | Logic in tool execute() directly | Tool execute() closures create divergence from MCP tools (LEAD-05); operations.ts is the locked approach from STATE.md |
| Session context in messages array | Separate Redis/DB session store | messages array from `useChat` already persists conversation; Claude's context window handles refinement across turns |

**Installation:**
```bash
# No new packages required — all dependencies already present
npm install
```

---

## Architecture Patterns

### Recommended Project Structure
```
src/
├── lib/
│   ├── leads/
│   │   └── operations.ts      # Shared operations layer (LEAD-05)
│   ├── agents/
│   │   ├── leads.ts           # Leads Agent (tools + config + runLeadsAgent())
│   │   ├── runner.ts          # Existing — unchanged
│   │   ├── orchestrator.ts    # Update delegateToLeads to call runLeadsAgent()
│   │   └── types.ts           # Update LeadsOutput type
├── app/
│   └── api/
│       └── chat/
│           └── route.ts       # Existing — unchanged (maxDuration needs setting)
└── .planning/
    └── spikes/
        └── emailbison-api.md  # DEPLOY-01 output
```

### Pattern 1: Operations Layer (LEAD-05)
**What:** All database queries and business logic live in `src/lib/leads/operations.ts`. Agent tools and future MCP tools import from this file. No query logic inside tool `execute()` closures.
**When to use:** Any time the same operation could be triggered from chat OR from an MCP tool.
**Example:**
```typescript
// src/lib/leads/operations.ts
export async function searchPeople(params: {
  query?: string;
  jobTitle?: string;
  vertical?: string;
  location?: string;
  workspaceSlug?: string;
  minIcpScore?: number;
  hasVerifiedEmail?: boolean;
  page?: number;
  limit?: number;
}): Promise<{ people: PersonSearchResult[]; total: number; page: number }> {
  // All Prisma query logic here — shared between agent tools AND MCP tools
}

export async function createList(params: {
  name: string;
  workspaceSlug: string;
  description?: string;
}): Promise<TargetList> { ... }

export async function addPeopleToList(listId: string, personIds: string[]): Promise<void> { ... }

export async function scoreList(listId: string, workspaceSlug: string): Promise<ScoringResult> { ... }

export async function exportListToEmailBison(listId: string, workspaceSlug: string): Promise<ExportResult> { ... }
```

### Pattern 2: Leads Agent Tools Wrap Operations
**What:** The Leads Agent tools are thin wrappers over operations.ts. They convert tool inputs to operation params and return formatted results.
**When to use:** All four Leads Agent tools (search, createList, scoreList, exportList).
**Example:**
```typescript
// src/lib/agents/leads.ts
const searchPeopleTool = tool({
  description: "Search people in the database by natural language criteria...",
  inputSchema: z.object({
    query: z.string().optional(),
    jobTitle: z.string().optional(),
    vertical: z.string().optional(),
    location: z.string().optional(),
    workspaceSlug: z.string().optional(),
    minIcpScore: z.number().optional(),
    page: z.number().optional().default(1),
    limit: z.number().optional().default(25),
  }),
  execute: async (params) => {
    return operations.searchPeople(params);  // thin wrapper
  },
});
```

### Pattern 3: AgentRun via runAgent()
**What:** The `runLeadsAgent()` function calls `runAgent()` — this auto-creates an AgentRun record for audit. No manual AgentRun creation needed.
**When to use:** All Leads Agent invocations from the orchestrator.
**Example:**
```typescript
// src/lib/agents/leads.ts
export async function runLeadsAgent(input: LeadsInput): Promise<LeadsOutput> {
  const userMessage = buildLeadsMessage(input);
  const result = await runAgent<LeadsOutput>(leadsConfig, userMessage, {
    triggeredBy: "orchestrator",
    workspaceSlug: input.workspaceSlug,
  });
  return result.output;
}
```

### Pattern 4: Streaming Chat Route — maxDuration
**What:** The chat route uses `streamText`, which is already streaming. But Vercel Hobby plan has a 10s timeout on serverless functions. Leads Agent scoring operations can take 60-300s. `maxDuration = 300` must be set on the route.
**When to use:** Required before first Leads Agent deploy to production.
**Example:**
```typescript
// src/app/api/chat/route.ts
export const maxDuration = 300;  // Add this — Vercel route segment config
```

### Pattern 5: Contextual Action Buttons in Chat
**What:** After a Leads Agent search response, the chat UI renders quick-action buttons ("Add to list", "Score these", "Export"). These are rendered client-side based on the assistant message content or a structured annotation.
**When to use:** After any Leads Agent tool result.
**Recommended approach (Claude's discretion):** Use AI SDK `useChat` tool result parts. The agent can return a structured annotation in its text response that the chat sidebar parses to show buttons. This avoids adding new UI state complexity.

### Anti-Patterns to Avoid
- **Logic in tool execute() closures directly:** Violates LEAD-05 (no logic divergence). All Prisma queries must go in `operations.ts`.
- **One tool per action on orchestrator directly:** The orchestrator's `delegateToLeads` must call `runLeadsAgent()` — it should NOT have the leads search/create/score/export tools directly on the orchestrator. Leads Agent is a specialist.
- **Scoring all people on export:** Only score people that have not been scored yet. `PersonWorkspace.icpScoredAt` is the cache key. The success criteria says "without hitting an enrichment API for already-scored leads."
- **generateText for the chat route:** The chat route already uses `streamText`. Do not switch Leads Agent calls to `generateText` — the user needs streaming feedback during long operations.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ICP scoring | Custom scoring logic | `scorePersonIcp()` in `src/lib/icp/scorer.ts` | Already built with Firecrawl crawl cache, Claude Haiku, structured output, PersonWorkspace persistence |
| Export verification | Custom email verification | `getListExportReadiness()` + `verifyAndFilter()` in `src/lib/export/verification-gate.ts` | Already built with LeadMagic integration, per-person enrichmentData caching |
| EmailBison lead upload | Custom HTTP client | `EmailBisonClient.createLead()` in `src/lib/emailbison/client.ts` | Already built with rate limit handling, typed params |
| AgentRun audit trail | Manual prisma.agentRun.create | `runAgent()` in `src/lib/agents/runner.ts` | Already handles create/update/error on every run; never bypass this |
| Chat streaming | SSE/fetch manually | `streamText().toUIMessageStreamResponse()` | Already the pattern in `/api/chat/route.ts` |
| Conversation state | Custom session store | `useChat` messages array from `@ai-sdk/react` | AI SDK manages conversation history; system prompt gets injected per message set |

**Key insight:** The hard operations (ICP scoring, email verification, EmailBison client) are all already built. This phase is almost entirely about wiring them up behind agent tools, not implementing new algorithms.

---

## Common Pitfalls

### Pitfall 1: ICP Scorer Requires `icpCriteriaPrompt`
**What goes wrong:** `scorePersonIcp()` throws `"No ICP criteria prompt configured"` if `workspace.icpCriteriaPrompt` is null.
**Why it happens:** The scorer needs a natural-language ICP description to score against. Some workspaces don't have this set yet.
**How to avoid:** The `scoreList` operation must check whether `icpCriteriaPrompt` is set before scoring. If not, return a clear error message to the agent: "Workspace {slug} has no ICP criteria prompt configured. Set it first with the MCP `set_workspace_prompt` tool."
**Warning signs:** Any test of scoring on a freshly-created workspace will throw.

### Pitfall 2: Sequence-Steps POST Appends, Not Replaces
**What goes wrong:** `POST /campaigns/{id}/sequence-steps` with `sequence_steps: [...]` APPENDS new steps to the existing sequence (confirmed in live probe). It does not replace. The `title` field in the request body is ignored (response shows `"title": null`).
**Why it happens:** The API treats it as an "add to sequence" operation.
**How to avoid:** If writing a sequence step tool for Phase 10, always `GET` existing steps first to know current state before posting. Never assume the result is the complete sequence.
**Warning signs:** Step count grows unexpectedly on repeated calls.

### Pitfall 3: No Lead-to-Campaign Assignment Endpoint
**What goes wrong:** There is no API endpoint to assign an existing lead to a campaign. `POST /campaigns/{id}/leads` returns 405 (only GET/HEAD/DELETE supported). `campaign_id` in the `POST /leads` body is silently ignored.
**Why it happens:** EmailBison's API surface for campaign-lead assignment appears to be UI-only (CSV import, manual assign in dashboard).
**How to avoid:** Phase 10 (Campaign Deploy — DEPLOY-04) must plan around this gap. Export to EmailBison (LEAD-04) means: upload leads to workspace as lead records (they appear in EmailBison lead list), but they cannot be assigned to a specific campaign via API. The chat export should confirm "X leads uploaded to EmailBison workspace" not "X leads added to campaign Y."
**Warning signs:** Any attempt to assign leads to campaign via API will 404/405.

### Pitfall 4: `wait_in_days` Must Be >= 1
**What goes wrong:** `POST /campaigns/{id}/sequence-steps` with `wait_in_days: 0` returns 422: "The sequence_steps.0.wait_in_days field must be at least 1."
**Why it happens:** EmailBison validation rule.
**How to avoid:** First step `wait_in_days: 1` minimum. Document in spike note for Phase 10.

### Pitfall 5: Scoring Existing People (Don't Re-Score)
**What goes wrong:** Agent re-scores all people in a list even if they were scored last week — burns Firecrawl credits and Claude tokens unnecessarily.
**Why it happens:** Not checking `PersonWorkspace.icpScoredAt` before calling `scorePersonIcp()`.
**How to avoid:** In `scoreList()` operation, filter to only people where `icpScoredAt IS NULL` (never scored) or `icpScoredAt < X days ago` (optional refresh window). The success criteria explicitly says "without hitting an enrichment API for already-scored leads."

### Pitfall 6: Vercel Timeout on Long Operations
**What goes wrong:** Scoring 200 leads takes 2-5 minutes. Vercel Hobby plan default serverless timeout is 10 seconds. The chat route times out.
**Why it happens:** Missing `export const maxDuration = 300;` on the chat route.
**How to avoid:** Add this to `/api/chat/route.ts` before any Leads Agent scoring/export operation runs in production.
**Warning signs:** Chat responses cut off at exactly 10 seconds with no error.

### Pitfall 7: `queryPeople` Already Exists on Orchestrator
**What goes wrong:** The orchestrator already has a `queryPeople` tool in `dashboardTools`. Adding a second `searchPeople` tool to the Leads Agent creates ambiguity when the orchestrator decides which to use.
**Why it happens:** `queryPeople` was added to the orchestrator's dashboard tools in Phase 6 for simple queries. The Leads Agent needs a richer version.
**How to avoid:** The Leads Agent is a separate specialist — its `searchPeople` tool is only available to the Leads Agent, not the orchestrator directly. The orchestrator's `delegateToLeads` routes to the specialist. The orchestrator's existing `queryPeople` is fine for simple "show me people in workspace X" queries; the Leads Agent's `searchPeople` handles advanced queries with ICP score filter, title/location filter, etc.

---

## Code Examples

Verified patterns from codebase:

### Existing ICP Scorer Call Pattern
```typescript
// Source: src/lib/icp/scorer.ts
import { scorePersonIcp } from "@/lib/icp/scorer";

// Score a single person (workspace-specific)
const result = await scorePersonIcp(
  personId,          // Person.id
  workspaceSlug,     // e.g. "rise"
  false,             // forceRecrawl
);
// result: { score: 85, reasoning: "title match...", confidence: "high" }

// The score is automatically persisted to PersonWorkspace.icpScore
// Check if already scored:
const pw = await prisma.personWorkspace.findUnique({
  where: { personId_workspace: { personId, workspace: workspaceSlug } }
});
if (pw?.icpScoredAt) {
  // Already scored — skip
}
```

### Export Verification Gate Pattern
```typescript
// Source: src/lib/export/verification-gate.ts
import { getListExportReadiness, verifyAndFilter } from "@/lib/export/verification-gate";

const readiness = await getListExportReadiness(listId);
// readiness.readyCount — export-ready
// readiness.needsVerificationCount — need verification spend
// readiness.blockedCount — invalid emails, auto-excluded

if (readiness.needsVerificationCount > 0) {
  // Show preview to user, ask for confirmation before spending credits
  // Then verify:
  const { verified, excluded } = await verifyAndFilter(readiness.needsVerificationPeople);
}
// Export readiness.readyPeople + verified
```

### EmailBison Lead Upload Pattern
```typescript
// Source: src/lib/emailbison/client.ts
const client = await getClientForWorkspace(workspaceSlug);
const result = await client.createLead({
  email: person.email,
  firstName: person.firstName ?? undefined,
  lastName: person.lastName ?? undefined,
  jobTitle: person.jobTitle ?? undefined,
  company: person.company ?? undefined,
  phone: person.phone ?? undefined,
});
// result: { id: 22145, email: "...", status: "unverified" }
// NOTE: No campaign assignment endpoint exists — lead is uploaded to workspace only
```

### Leads Agent Tool Pattern (follows Research Agent)
```typescript
// Pattern: src/lib/agents/research.ts
import { tool } from "ai";
import { z } from "zod";
import { runAgent } from "./runner";
import * as operations from "@/lib/leads/operations";

const leadsTools = {
  searchPeople: tool({
    description: "Search people in the database...",
    inputSchema: z.object({ ... }),
    execute: async (params) => operations.searchPeople(params),
  }),
  // etc.
};

const leadsConfig: AgentConfig = {
  name: "leads",
  model: "claude-sonnet-4-20250514",
  systemPrompt: LEADS_SYSTEM_PROMPT,
  tools: leadsTools,
  maxSteps: 8,
};

export async function runLeadsAgent(input: LeadsInput): Promise<LeadsOutput> {
  const result = await runAgent<LeadsOutput>(leadsConfig, buildLeadsMessage(input), {
    triggeredBy: "orchestrator",
    workspaceSlug: input.workspaceSlug,
  });
  return result.output;
}
```

### Existing Search Route (for operations.ts reference)
```typescript
// Source: src/app/api/people/search/route.ts (verified)
// Supports: q, vertical (multi), workspace, enrichment (full/partial/missing), company, page
// Returns: people[], total, page, pageSize, filterOptions
// Missing for Leads Agent: jobTitle filter, location filter, ICP score filter, source filter
// Operations.ts must add these to the Prisma query
```

---

## EmailBison API Spike Findings (DEPLOY-01)

**Probed:** 2026-02-27 against `https://app.outsignal.ai/api` using Outsignal workspace token.

### Verified Endpoints

| Endpoint | Method | Status | Notes |
|----------|--------|--------|-------|
| `POST /leads` | POST | 201 | Creates lead in workspace. Returns `{ data: { id, email, status, ... } }`. Email required. |
| `GET /campaigns` | GET | 200 | Lists campaigns with pagination. |
| `POST /campaigns` | POST | 201 | Creates campaign. Required: `name`. Optional: `type`, `max_emails_per_day`, `max_new_leads_per_day`, `plain_text`. Returns `{ data: { id, uuid, sequence_id, ... } }`. `sequence_id` is NULL on fresh campaign. |
| `POST /campaigns/{id}/duplicate` | POST | 201 | Duplicates a campaign AND its sequence. `name` param ignored — always produces "Copy of {original}". `sequence_id` is inherited from source. |
| `GET /campaigns/{id}/sequence-steps` | GET | 200 | Lists sequence steps for a campaign. Returns array of step objects. Returns `{ success: false, message: "Sequence steps do not exist..." }` if no sequence. |
| `POST /campaigns/{id}/sequence-steps` | POST | 200/422 | **APPENDS** new steps to existing sequence. Does NOT replace. Required: `title` (string), `sequence_steps` (array). Each step: `email_subject`, `email_body` (HTML), `wait_in_days` (minimum 1). Returns the full updated sequence. |
| `DELETE /leads/{id}` | DELETE | 200 | Deletes a lead. |
| `DELETE /campaigns/{id}` | DELETE | 200 | Deletes a campaign (queued). |

### Sequence Step Schema (from live GET)
```json
{
  "id": 174,
  "email_subject": "Hiring AI signals",
  "order": 1,
  "email_body": "<p>HTML content here</p>",
  "wait_in_days": 3,
  "variant": false,
  "variant_from_step": null,
  "attachments": null,
  "thread_reply": false,
  "created_at": "2026-02-06T13:42:38.000000Z",
  "updated_at": "2026-02-06T14:05:58.000000Z"
}
```

### Lead-to-Campaign Assignment: NOT AVAILABLE
```
POST /campaigns/{id}/leads → 405
  "Supported methods: GET, HEAD, DELETE"

POST /campaign-leads → 404

POST /campaigns/{id}/assign-lead → 404

POST /leads/{id}/campaigns → 404

PATCH /campaigns/{id} → 405
  "Supported methods: GET, HEAD, DELETE"

POST /leads with campaign_id field → 201 (silently ignored, not assigned)

POST /campaigns/{id}/import → 404
```

**Conclusion for LEAD-04:** EmailBison lead export from chat means: upload leads as `POST /leads` to the workspace (they appear in EmailBison lead list and can be managed from the UI). Campaign assignment must be done manually in EmailBison UI or is not available via API. Phase 10 (DEPLOY-04) must plan around this gap.

**Spike note location:** `.planning/spikes/emailbison-api.md` (to be written as a task in Phase 7)

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `delegateToLeads` as stub returning "not_available" | Real Leads Agent with tools backing operations.ts | This phase | Activates the lead pipeline from chat |
| `queryPeople` on orchestrator (simple, workspace+status filter only) | `searchPeople` on Leads Agent (title, location, ICP score, source, verification status filters) | This phase | Rich natural language search against 14k+ person DB |
| Manual export via `/api/lists/{id}/export` GET (CSV download) | `exportListToEmailBison` tool that uploads leads via EmailBison API | This phase | LEAD-04 requirement |
| Orchestrator `delegateToCampaign` stub | Still stub (Phase 10) | — | Campaign assignment deferred |

**Deprecated/outdated:**
- The `/campaigns/sequence-steps?campaign_id={id}` path used in `EmailBisonClient.getSequenceSteps()` returns 404 on the live API. The correct path is `/campaigns/{id}/sequence-steps`. The client method in `src/lib/emailbison/client.ts` needs to be updated as part of the spike task.

---

## Open Questions

1. **Action buttons in chat: how to render them**
   - What we know: `useChat` from `@ai-sdk/react` renders messages with `UIMessage.parts`. The AI SDK supports tool call parts in addition to text parts.
   - What's unclear: The cleanest way to inject quick-action buttons (e.g. "Add to list", "Score these") after an agent result without requiring a custom message part schema.
   - Recommendation: The agent text response should end with a structured prompt to the user like "**Want to:** [Add to a list] [Score these] [Export]" — these can be rendered as buttons via simple text parsing in `ChatSidebar`. This is the simplest approach and avoids any schema changes.

2. **Session context for conversational refinement**
   - What we know: `useChat` already persists the full `messages` array — Claude receives full conversation history on each turn. This is how conversational refinement ("narrow to London only") works.
   - What's unclear: Whether the Leads Agent's specialist context window (separate from orchestrator) retains refinement state.
   - Recommendation: The orchestrator passes the conversation history when it delegates to the Leads Agent via `delegateToLeads`. The Leads Agent system prompt should instruct it: "The conversation history may contain previous search results you refined. Use those results as context."

3. **Scoring batch size and timeout**
   - What we know: `scorePersonIcp()` calls Firecrawl (cached after first hit) + Claude Haiku for each person. For a list of 200 people, all with cached company homepages, this is 200 sequential Haiku calls.
   - What's unclear: Whether parallel scoring (Promise.all) causes Anthropic rate limiting at scale.
   - Recommendation: Use batched parallel scoring with a concurrency limit of 10 (Promise.all in chunks of 10). Monitor for 429 responses and add retry.

---

## Validation Architecture

> `workflow.nyquist_validation` is not set in `.planning/config.json` — only `workflow.research`, `workflow.plan_check`, `workflow.verifier` are present. Skipping Validation Architecture section.

---

## Sources

### Primary (HIGH confidence)
- Direct codebase read: `src/lib/agents/` (runner.ts, orchestrator.ts, research.ts, writer.ts, types.ts)
- Direct codebase read: `src/lib/icp/scorer.ts`
- Direct codebase read: `src/lib/export/verification-gate.ts`
- Direct codebase read: `src/lib/emailbison/client.ts` + `types.ts`
- Direct codebase read: `src/app/api/chat/route.ts`
- Direct codebase read: `src/app/api/people/search/route.ts`
- Direct codebase read: `src/app/api/lists/route.ts`
- Direct codebase read: `prisma/schema.prisma`
- Live API probe: EmailBison at `https://app.outsignal.ai/api` (6 probe scripts, 2026-02-27)

### Secondary (MEDIUM confidence)
- `.planning/STATE.md` — v1.1 scoping decisions (operations.ts architecture, export pattern)
- `.planning/codebase/ARCHITECTURE.md` — agent pattern documentation
- `.planning/codebase/TESTING.md` — test infrastructure

### Tertiary (LOW confidence)
- None required — all critical claims verified against codebase or live API.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages already installed, versions confirmed in package.json
- Architecture: HIGH — operations.ts pattern confirmed in STATE.md decisions; runner.ts pattern confirmed in codebase
- EmailBison API findings: HIGH — probed live against production API with real token
- Pitfalls: HIGH — ICP scorer/export gate verified in source; EB API findings from live probes
- Action buttons/session context: MEDIUM — approach is Claude's discretion; recommended pattern is simple and low-risk

**Research date:** 2026-02-27
**Valid until:** 2026-03-29 (30 days for stable platform; EmailBison API findings valid until API update)
