# Architecture

**Analysis Date:** 2025-03-01

## Pattern Overview

**Overall:** Multi-tenant B2B SaaS with three distinct customer-facing surfaces:
- Admin dashboard (`admin.outsignal.ai`) — internal lead gen management
- Client portal (`portal.outsignal.ai`) — campaign approval workflow
- Public API — webhooks, proposals, enrichment endpoints

**Key Characteristics:**
- **Layered API design:** Route handlers → business operations → Prisma ORM → PostgreSQL
- **Agent-driven workflows:** Four specialized agents (research, leads, writer, campaign) orchestrated via Claude AI
- **Multi-channel campaign execution:** Email (EmailBison) + LinkedIn (custom sender framework)
- **Enrichment waterfall:** Six external providers queued and deduplicated to avoid redundant API calls
- **Workspace-scoped isolation:** All data partitioned by `workspaceSlug` (clients are isolated)
- **Event-driven notifications:** Slack + email triggered by webhooks and rich business events

## Layers

**Presentation (Pages & API Routes):**
- Purpose: Handle HTTP requests, parse parameters, delegate to operations layer
- Location: `src/app/(admin)`, `src/app/(portal)`, `src/app/(customer)`, `src/app/api`
- Contains: Next.js page components, API route handlers, middleware
- Depends on: Operations layer, auth utilities, response formatters
- Used by: Web browsers, EmailBison webhooks, Clay enrichment webhooks, Stripe

**Operations (Business Logic):**
- Purpose: Implement domain logic, state machines, data transformations
- Location: `src/lib/campaigns/operations.ts`, `src/lib/leads/operations.ts`
- Contains: Pure functions that orchestrate Prisma queries, validate state transitions
- Depends on: Prisma ORM, external clients (EmailBison, Slack, Resend)
- Used by: API routes, agents, MCP tools
- Example: `updateCampaignStatus()` validates state machine, queries DB, publishes events

**Agent System (Multi-turn AI Workflows):**
- Purpose: Execute complex research and lead operations via Claude AI with tools
- Location: `src/lib/agents/` (runner.ts, orchestrator.ts, research.ts, writer.ts, leads.ts, campaign.ts, shared-tools.ts)
- Contains: Agent configurations, tool definitions, prompt engineering
- Depends on: Operations layer, knowledge base, embeddings
- Used by: Chat endpoint, MCP server, orchestrator agent for delegation
- Pattern: Each agent is a `runAgent()` call with config (model, system prompt, tools array)

**Data Access (Prisma Client):**
- Purpose: Provide type-safe database queries and transactions
- Location: `src/lib/db.ts` (singleton)
- Contains: Prisma instance
- Depends on: PostgreSQL connection (DATABASE_URL env var)
- Used by: Operations layer exclusively (never query from routes directly)

**External Integrations:**
- **EmailBison:** `src/lib/emailbison/client.ts` — send campaigns, fetch replies, manage leads
- **LinkedIn:** `src/lib/linkedin/` — sender auth, action queue, rate limiting, browser automation
- **Clay:** Webhook receivers at `src/app/api/people/enrich` and `src/app/api/companies/enrich`
- **Stripe:** Payment processing at `src/app/api/stripe/`
- **Slack:** `src/lib/slack.ts` — notification delivery
- **Resend:** `src/lib/resend.ts` — email delivery
- **Firecrawl:** `src/lib/firecrawl/client.ts` — web scraping for ICP analysis

**Authentication & Authorization:**
- **Admin auth:** `src/lib/admin-auth.ts` (session-based) + `src/lib/admin-auth-edge.ts` (Edge runtime)
- **Portal auth:** `src/lib/portal-auth.ts` (magic link tokens) + `src/lib/portal-auth-edge.ts` (Edge runtime)
- **API auth:** Workspace API tokens, Bearer tokens (LinkedIn worker), webhook signatures
- Enforced via middleware at `src/middleware.ts`

## Data Flow

**Campaign Creation to Deployment:**

1. Admin creates campaign via UI (`POST /api/campaigns`)
2. Route handler validates input, calls `createCampaign()` operation
3. Operation creates Campaign record (status: "draft"), returns summary
4. Admin fills sequences (email + LinkedIn), calls campaign agent via chat
5. Campaign agent generates/refines content using writer agent + knowledge base
6. Admin publishes for client review (`POST /api/campaigns/{id}/publish`)
7. Operation updates status to "pending_approval", notifies client via Slack/email
8. Client portal loads campaign, approves or requests changes
9. Once approved, admin deploys: `POST /api/campaigns/{id}/publish`
10. Operation fetches target list, pushes to EmailBison, enqueues LinkedIn actions
11. Campaign becomes "active", EmailBison begins sending
12. Replies/opens flow back via webhook to update metrics and trigger notifications

**Lead Enrichment Pipeline:**

1. Admin searches for leads or imports list
2. Leads Agent searches external DBs (Clay, Prospeo, etc.), returns results
3. Admin adds leads to list
4. Leads Agent triggers enrichment job: `POST /api/enrichment/run`
5. Route enqueues providers in waterfall order (dedup checks existing data)
6. Cron job processes queue: `GET /api/enrichment/jobs/process`
7. Each provider runs in batch, logs cost + results
8. Results merged into Person/Company records (auto-derive companyDomain)
9. Metrics cached in CachedMetrics for dashboard
10. ICP scoring triggered if enabled: scores stored in PersonWorkspace.icpScore

**State Management:**

- **Campaign lifecycle:** State machine enforces valid transitions (draft→internal_review→pending_approval→approved→deployed→active)
- **Lead status:** Tracks in both Person (global) and PersonWorkspace (workspace-scoped): new → contacted → replied → interested → bounced
- **LinkedIn sender health:** Monitored in Sender.healthStatus (healthy/warning/paused/blocked), adjusted by warm-up day
- **Enrichment jobs:** Queued with resume capability (paused until daily cap resets)
- **Sessions:** Portal + admin stored in encrypted cookies, verified at Edge runtime for zero-latency auth

## Key Abstractions

**Workspace (Multi-tenancy):**
- Purpose: Isolate all data by client
- Examples: `src/lib/workspaces.ts`, Campaign model, PersonWorkspace junction
- Pattern: Every data-scoped query filters by workspaceSlug; API routes extract from auth headers

**Campaign (State Machine):**
- Purpose: Manage outbound campaign lifecycle with approvals
- Examples: `src/lib/campaigns/operations.ts`, Campaign model in schema
- Pattern: VALID_TRANSITIONS dict, guard functions prevent invalid state changes

**Enrichment Queue:**
- Purpose: Batch process external provider calls, deduplicate, handle daily caps
- Examples: `src/lib/enrichment/queue.ts`, `src/lib/enrichment/waterfall.ts`
- Pattern: Job record tracks progress, resume time, error log; cron processes in chunks

**Sender (LinkedIn Account Management):**
- Purpose: Represent a warm-up LinkedIn account with credentials, session, health metrics
- Examples: Sender model, `src/lib/linkedin/sender.ts`, `src/lib/linkedin/rate-limiter.ts`
- Pattern: Credentials encrypted at rest, session refreshed on login, rate limits adjusted by warm-up day

**Agent (Agentic AI):**
- Purpose: Execute multi-turn Claude AI workflows with tools
- Examples: `src/lib/agents/runner.ts` (core), research/writer/leads/campaign agents
- Pattern: `runAgent(config, userMessage)` returns AgentRunResult with output + step log

**Person ↔ Company (Soft Link):**
- Purpose: Store enrichment data centrally, normalize across workspaces
- Examples: Person.companyDomain → Company.domain, Person.vertical auto-derived
- Pattern: companyDomain auto-extracted from email (skip free domains), backfilled from company enrichment

## Entry Points

**Admin Dashboard:**
- Location: `src/app/(admin)/page.tsx`
- Triggers: User navigates to `admin.outsignal.ai`
- Responsibilities: Display workspace list, redirect to workspace detail

**Workspace Detail:**
- Location: `src/app/(admin)/workspace/[slug]/page.tsx`
- Triggers: User clicks workspace
- Responsibilities: Fetch campaigns + replies from EmailBison, render metrics, show campaign table

**Client Portal:**
- Location: `src/app/(portal)/portal/page.tsx`
- Triggers: Magic link or session cookie
- Responsibilities: List campaigns awaiting approval, render approval UI

**Campaign Chat:**
- Location: `src/app/api/chat/route.ts`
- Triggers: User sends message in campaign builder
- Responsibilities: Delegate to orchestrator agent, return multi-turn response

**EmailBison Webhook:**
- Location: `src/app/api/webhooks/emailbison/route.ts`
- Triggers: EmailBison sends event (reply, open, bounce)
- Responsibilities: Log event, trigger notifications, update lead status

**Enrichment Cron:**
- Location: `src/app/api/enrichment/jobs/process/route.ts`
- Triggers: Daily at 6am UTC (Vercel cron, triggered by external scheduler)
- Responsibilities: Dequeue enrichment jobs, batch process providers, log costs

**Clay Webhooks:**
- Location: `src/app/api/people/enrich/route.ts`, `src/app/api/companies/enrich/route.ts`
- Triggers: Clay sends enriched record
- Responsibilities: Normalize fields, upsert Person/Company, backfill vertical

## Error Handling

**Strategy:** Fail-safe with retries + alerting

**Patterns:**
- **Enrichment provider failures:** Logged in EnrichmentLog (status="error"), retried up to maxAttempts, error saved
- **Campaign deployment:** If EmailBison push fails, campaign stays in "pending" status, admin retries
- **Webhook processing:** Signature validation + 3-second response timeout; failed webhooks logged but don't block
- **Agent failures:** AgentRun record captures error + step log, returned to user, no side effects committed
- **Database constraints:** Unique index violations caught, duplicate leads merged via dedup logic

## Cross-Cutting Concerns

**Logging:**
- Using `console.log()` + structured JSON for errors
- All API routes log errors with `[CONTEXT] Error:` prefix
- Agent runs logged with full step trace via AgentRun model

**Validation:**
- Input validation at route handler level (e.g., check required fields)
- Business logic validation in operations (e.g., state machine transitions)
- Zod schemas for agent tool inputs

**Authentication:**
- Admin pages + API: Cookie-based session (verified at Edge via `verifyAdminSessionEdge()`)
- Portal pages + API: Magic link tokens (verified at Edge via `verifySessionEdge()`)
- Public API: API key (for workspace token auth), Bearer token (for LinkedIn worker), webhook signature (HMAC)
- Middleware enforces all checks before route handler executes

**Notifications:**
- Slack: Rich blocks via `src/lib/slack.ts` (new replies, approvals needed, campaign deployed)
- Email: Plain text + button via `src/lib/resend.ts` (replies, approvals)
- Always include workspace + action context, link back to relevant page

---

*Architecture analysis: 2025-03-01*
