# Architecture

**Analysis Date:** 2026-02-26

## Pattern Overview

**Overall:** Layered API + Agent-Driven Framework

**Key Characteristics:**
- Multi-agent system with specialist orchestration (Research, Writer, Leads, Campaign agents planned)
- Next.js 16 App Router with server/client separation
- AI SDK-powered agents using Claude models with tool calling
- Webhook-driven updates from EmailBison
- Modular workspace management (env-based + database workspaces)

## Layers

**Presentation Layer:**
- Purpose: User interfaces for admin dashboard, customer onboarding, proposal flow, and live chat
- Location: `src/app/(admin)`, `src/app/(customer)`, `src/components/`
- Contains: Next.js pages (TSX), React components (UI library from shadcn), chat interface
- Depends on: API layer (via HTTP), agent system
- Used by: End users (admin, customer, visitors)

**API Layer:**
- Purpose: HTTP endpoints for webhooks, data mutations, chat streaming, enrichment callbacks
- Location: `src/app/api/`
- Contains: Route handlers for webhooks (EmailBison), chat streaming, proposal management, people/company enrichment
- Depends on: Core services (database, EmailBison client, notifications)
- Used by: Frontend clients, external services (EmailBison, Clay)

**Agent Layer:**
- Purpose: Intelligent automation for research, content generation, lead management, campaign orchestration
- Location: `src/lib/agents/`
- Contains: Orchestrator (dispatcher), Research Agent, Writer Agent, placeholder Leads/Campaign agents, type definitions
- Depends on: Knowledge store, workspace config, external APIs (Firecrawl, EmailBison), database
- Used by: Chat interface, orchestration for complex tasks

**Core Services Layer:**
- Purpose: Business logic, external API integration, data enrichment, notifications
- Location: `src/lib/` (flat structure with topic subdirs)
- Contains:
  - Database client: `db.ts` (Prisma singleton)
  - Email/SMS: `emailbison/client.ts`, `resend.ts` (Email notifications)
  - Workspace management: `workspaces.ts` (loads from env or DB)
  - Notifications: `notifications.ts` (Slack + email replies)
  - Knowledge base: `knowledge/store.ts` (document ingestion and chunking)
  - External crawling: `firecrawl/client.ts` (website analysis)
  - Utilities: `tokens.ts`, `normalize.ts`, `stripe.ts`, `porkbun.ts`
- Depends on: Database, external APIs
- Used by: API layer, agent layer

**Data Layer:**
- Purpose: Data persistence and schema
- Location: `prisma/schema.prisma`
- Contains: Models for Workspace, Person (Lead), PersonWorkspace (junction), Company, WebhookEvent, Proposal, AgentRun, KnowledgeDocument, EmailDraft, etc.
- Depends on: PostgreSQL database
- Used by: All layers

## Data Flow

**EmailBison Webhook Flow:**

1. EmailBison sends `LEAD_REPLIED` / `LEAD_INTERESTED` event to `/api/webhooks/emailbison?workspace={slug}`
2. Webhook handler (`src/app/api/webhooks/emailbison/route.ts`) receives payload
3. Creates `WebhookEvent` record for audit
4. Updates `Person` and `PersonWorkspace` status (replied/interested)
5. Triggers notification if not auto-reply:
   - Slack message to workspace channel (if configured)
   - Email to notification recipients (if configured)
6. Notifications use templates in `src/lib/notifications.ts`

**Chat/Orchestration Flow:**

1. User sends message in chat interface
2. Frontend POSTs to `/api/chat` with messages + context (workspace, page)
3. Handler calls `orchestratorConfig` with message
4. Orchestrator (Claude model) analyzes request and calls tools:
   - Delegation tools: `delegateToResearch`, `delegateToWriter`, `delegateToLeads`, `delegateToCampaign`
   - Dashboard tools: `listWorkspaces`, `getWorkspaceInfo`, `getCampaigns`, `queryPeople`, etc.
5. Each delegation calls `runAgent()` with specialist agent config
6. Agent runs, logs tool calls, saves `AgentRun` record
7. Response streams back to client
8. Specialist agents save results to database (e.g., `WebsiteAnalysis`, `EmailDraft`)

**Agent Execution Flow:**

1. `runAgent(config, message)` creates `AgentRun` record (audit trail)
2. Calls `generateText()` from AI SDK with:
   - Model: Anthropic Claude
   - System prompt: Agent-specific instructions
   - Tools: Agent's tool set
   - stopWhen: maxSteps (10-12)
3. Extracts tool calls from response steps
4. Attempts to parse structured output from JSON markdown blocks
5. Updates `AgentRun` with status, output, steps, duration
6. Returns `AgentRunResult<T>` with typed output + metadata

**Research Agent Flow:**

1. Input: workspace slug (optional), URL (optional), task description
2. Tools: `crawlWebsite` (Firecrawl), `scrapeUrl`, `getWorkspaceInfo`, `saveWebsiteAnalysis`
3. Crawls website with Firecrawl (up to 10 pages as markdown)
4. Analyzes content with Claude to extract:
   - Company overview
   - ICP indicators (industries, titles, company size, countries)
   - Value propositions
   - Case studies
   - Pain points
   - Differentiators
   - Pricing signals
5. Saves `WebsiteAnalysis` record with crawl data + structured analysis
6. Returns `ResearchOutput` with findings

**Writer Agent Flow:**

1. Input: workspace slug, task, channel (email/linkedin/both), campaign name (for revisions), feedback
2. Tools: `getWorkspaceIntelligence` (ICP + latest website analysis), `getCampaignPerformance`, `searchKnowledge` (knowledge base chunks), `saveEmailDraft`
3. Retrieves workspace data, campaign metrics, relevant knowledge chunks
4. Claude writes sequences with:
   - Email steps: subject, body, variants, delay, notes
   - LinkedIn steps: type (connection/message/inmail), body, delay, notes
5. Saves drafts as `EmailDraft` records
6. Returns `WriterOutput` with structured campaign plan

**Data Synchronization (Clay/Enrichment):**

1. External sources (Clay, enrichment tools) POST to `/api/people/enrich?workspace={slug}` or similar
2. Payload contains: email, firstName, lastName, jobTitle, company, companyDomain, linkedinUrl, etc.
3. Handler normalizes field names (`FIELD_ALIASES` map)
4. Creates or updates `Person` record (unique by email)
5. Creates or updates `PersonWorkspace` junction entry
6. Caches `Company` record if new company domain
7. Returns confirmation

**State Management:**

- Global state: Workspace context via URL params or environment variables
- Per-session: Chat history in client-side React state
- Persistent: Database (PostgreSQL via Prisma)
- Audit trail: `AgentRun` records track all agent executions with inputs, outputs, tool calls, duration
- Cached content: Website analyses, knowledge base chunks, email drafts (with version tracking)

## Key Abstractions

**Workspace:**
- Purpose: Logical container for a client's cold outbound campaign
- Examples: `src/lib/workspaces.ts`, Workspace model in schema
- Pattern: Loaded from environment variables (EMAILBISON_WORKSPACES JSON) or database
- Properties: slug (unique), name, vertical, apiToken, ICP config, sender info, campaign brief
- Access: `getAllWorkspaces()`, `getWorkspaceBySlug()`, `getWorkspaceDetails()`, `getClientForWorkspace()`

**Person/Lead:**
- Purpose: Unique contact record (workspace-agnostic, enriched once)
- Examples: `prisma/schema.prisma` Person model, junction PersonWorkspace
- Pattern: Many-to-many via PersonWorkspace (per-workspace status, tags, vertical)
- Enrichment: Data stored once on Person record (name, email, jobTitle, company, LinkedIn URL)
- Workspace-specific: status, sourceId, tags per workspace
- Indexed by: email (unique), status, company, vertical, source

**Agent/Specialist:**
- Purpose: Autonomous AI worker with specific domain (Research, Writer, Leads, Campaign)
- Examples: `src/lib/agents/research.ts`, `writer.ts`, `orchestrator.ts`
- Pattern: Config (name, model, systemPrompt, tools, maxSteps) + runner (`runAgent()`)
- Tool calling: Each agent has custom tools for its domain (crawl, save analysis, write drafts, etc.)
- Audit: Every run logged to `AgentRun` with input, output, steps, duration, status

**Orchestrator/Dispatcher:**
- Purpose: Central intelligence that routes user requests to specialists or queries dashboard
- Examples: `src/lib/agents/orchestrator.ts`
- Pattern: Meta-agent with tools for delegation + direct dashboard queries
- Delegation decision: Complex tasks (research, writing) delegate to specialists; simple queries use dashboard tools directly
- Model: Claude Sonnet 4

**Knowledge Store:**
- Purpose: Reference corpus for Writer Agent (best practices, templates, past examples)
- Examples: `src/lib/knowledge/store.ts`
- Pattern: Documents chunked (~800 chars per chunk) and stored in KnowledgeDocument
- Search: Simple text matching (searchKnowledge function filters by tags)
- Extensibility: Can upgrade to embeddings/semantic search later

## Entry Points

**Web Application:**
- Location: `src/app/layout.tsx` (root)
- Triggers: Browser navigation, HTTP requests
- Responsibilities: Sets up fonts, metadata, global layout

**Admin Dashboard:**
- Location: `src/app/(admin)/layout.tsx`, pages under `(admin)/`
- Triggers: Admin user accessing dashboard routes
- Responsibilities: App shell with sidebar, navigation, workspace context

**Customer Onboarding:**
- Location: `src/app/(customer)/p/[token]/` (proposal flow), `o/[token]/` (team member invites)
- Triggers: Customer clicking proposal link or invite link
- Responsibilities: Guided onboarding to collect ICP, campaign brief, sender details

**Chat API:**
- Location: `src/app/api/chat/route.ts`
- Triggers: Frontend chat client POSTs messages
- Responsibilities: Streams orchestrator responses with agent delegation

**Webhook Handlers:**
- Location: `src/app/api/webhooks/emailbison/route.ts`
- Triggers: EmailBison sends LEAD_REPLIED, LEAD_INTERESTED, UNTRACKED_REPLY_RECEIVED
- Responsibilities: Update lead status, notify via Slack/email

**Enrichment Hooks:**
- Location: `src/app/api/people/enrich/route.ts`, `companies/enrich/route.ts`
- Triggers: Clay or enrichment services POST contact/company data
- Responsibilities: Normalize fields, upsert Person/Company records, link to workspace

## Error Handling

**Strategy:** Try-catch with fallback, error logging, graceful degradation

**Patterns:**

- **API Routes:** Try-catch wrapping entire handler, return JSON error responses
  - Example: `src/app/api/webhooks/emailbison/route.ts` catches and logs errors
  - Returns NextResponse with 500 status if fatal

- **Agent Execution:** Errors caught in `runAgent()`, stored in `AgentRun` record with status "failed"
  - Saves error message for audit
  - Re-throws for caller to handle
  - Example: Research Agent catches crawl failures, logs, returns error to orchestrator

- **Notifications:** Wrapped in try-catch, logged but don't block main flow
  - If Slack post fails, error logged but webhook still returns success
  - If email fails, logged but doesn't crash agent

- **Database:** Prisma errors propagate (connection issues, constraint violations)
  - Handled at API layer with generic error responses
  - Not exposed to client

## Cross-Cutting Concerns

**Logging:** Console-based (browser console for client, server logs for backend)
- Agent runs logged with `AgentRun` records containing input/output/steps/duration
- Webhook events logged to database via `WebhookEvent` model
- Errors logged to console with context

**Validation:**
- API payload validation via Zod schemas (e.g., `EnrichmentPayload` in people/enrich)
- Field alias mapping handles variations from Clay/external sources
- Database constraints (unique email on Person, unique domain on Company)

**Authentication:**
- Workspace context via URL params or environment variables
- API tokens stored in Workspace model (EmailBison integration)
- No user auth system (internal tool, assumes trusted access)

**Rate Limiting:**
- EmailBison API client handles 429 responses with RateLimitError
- Tracks retry-after headers
- Not globally enforced at API layer

**Caching:**
- Firecrawl responses cached in `WebsiteAnalysis` with status tracking
- Knowledge documents stored once, searched by chunk
- Workspace env vars read once at startup
- Prisma manages query caching per request

---

*Architecture analysis: 2026-02-26*
