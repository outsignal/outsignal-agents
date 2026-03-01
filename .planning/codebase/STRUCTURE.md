# Codebase Structure

**Analysis Date:** 2025-03-01

## Directory Layout

```
outsignal-agents/
├── .planning/                          # GSD documentation
│   └── codebase/
│       ├── ARCHITECTURE.md             # This architecture overview
│       ├── STRUCTURE.md                # This structure guide
│       ├── CONVENTIONS.md              # Coding standards
│       ├── TESTING.md                  # Testing patterns
│       ├── CONCERNS.md                 # Technical debt
│       ├── STACK.md                    # Technology stack
│       └── INTEGRATIONS.md             # External services
├── src/
│   ├── app/                            # Next.js 16 app directory (routes + pages)
│   │   ├── (admin)/                    # Admin dashboard route group
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx                # Dashboard homepage
│   │   │   ├── companies/
│   │   │   ├── enrichment-costs/
│   │   │   ├── lists/
│   │   │   ├── people/
│   │   │   ├── settings/
│   │   │   ├── onboard/
│   │   │   ├── onboarding/
│   │   │   ├── workspace/[slug]/       # Workspace detail + sub-pages
│   │   │   │   ├── page.tsx
│   │   │   │   ├── campaigns/
│   │   │   │   ├── linkedin/
│   │   │   │   ├── inbox/
│   │   │   │   ├── inbox-health/
│   │   │   │   └── settings/
│   │   │   └── error.tsx
│   │   ├── (portal)/                   # Client portal route group
│   │   │   ├── layout.tsx
│   │   │   ├── portal/
│   │   │   │   ├── page.tsx            # Portal homepage (campaign list)
│   │   │   │   ├── login/
│   │   │   │   ├── campaigns/
│   │   │   │   ├── linkedin/
│   │   │   │   ├── error.tsx
│   │   │   │   ├── loading.tsx
│   │   │   │   └── not-found.tsx
│   │   ├── (customer)/                 # Public customer flows (no auth)
│   │   │   ├── p/[token]/              # Proposal viewing + e-signature
│   │   │   │   ├── layout.tsx
│   │   │   │   ├── page.tsx
│   │   │   │   └── onboard/
│   │   │   └── o/[token]/              # Onboarding invite acceptance
│   │   │       ├── layout.tsx
│   │   │       └── page.tsx
│   │   ├── api/                        # All API routes
│   │   │   ├── admin/                  # Admin auth
│   │   │   │   ├── login/
│   │   │   │   └── logout/
│   │   │   ├── campaigns/              # Campaign CRUD + publish
│   │   │   │   ├── route.ts
│   │   │   │   └── [id]/
│   │   │   ├── chat/                   # Agent orchestrator chat
│   │   │   │   └── route.ts
│   │   │   ├── companies/              # Company search + enrichment
│   │   │   │   ├── search/
│   │   │   │   └── enrich/
│   │   │   ├── domains/                # Domain suggestions
│   │   │   ├── enrichment/             # Enrichment pipeline control
│   │   │   │   ├── costs/
│   │   │   │   ├── jobs/
│   │   │   │   └── run/
│   │   │   ├── linkedin/               # LinkedIn sender management
│   │   │   │   ├── actions/
│   │   │   │   ├── senders/
│   │   │   │   └── usage/
│   │   │   ├── lists/                  # Target list CRUD
│   │   │   │   ├── route.ts
│   │   │   │   └── [id]/
│   │   │   ├── onboard/                # Customer onboarding
│   │   │   ├── onboarding-invites/     # Onboarding invite management
│   │   │   ├── people/                 # People search + enrichment + import
│   │   │   │   ├── enrich/
│   │   │   │   ├── import/
│   │   │   │   ├── search/
│   │   │   │   └── sync/
│   │   │   ├── portal/                 # Portal auth + campaign approval
│   │   │   │   ├── login/
│   │   │   │   ├── logout/
│   │   │   │   ├── verify/
│   │   │   │   └── campaigns/
│   │   │   ├── proposals/              # Proposal CRUD + accept
│   │   │   │   ├── route.ts
│   │   │   │   └── [id]/
│   │   │   ├── stripe/                 # Payment webhooks
│   │   │   │   ├── checkout/
│   │   │   │   └── webhook/
│   │   │   ├── webhooks/               # External service webhooks
│   │   │   │   └── emailbison/
│   │   │   └── workspace/              # Workspace configuration
│   │   ├── login/                      # Admin login page
│   │   ├── layout.tsx                  # Root layout + fonts
│   │   ├── globals.css                 # Global Tailwind styles
│   │   └── not-found.tsx               # 404 page
│   ├── components/                     # React components (organized by feature)
│   │   ├── ui/                         # Shadcn UI primitives
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── input.tsx
│   │   │   ├── label.tsx
│   │   │   ├── select.tsx
│   │   │   ├── tabs.tsx
│   │   │   ├── table.tsx
│   │   │   ├── textarea.tsx
│   │   │   ├── badge.tsx
│   │   │   ├── checkbox.tsx
│   │   │   ├── dropdown-menu.tsx
│   │   │   ├── scroll-area.tsx
│   │   │   ├── separator.tsx
│   │   │   ├── skeleton.tsx
│   │   │   └── tooltip.tsx
│   │   ├── layout/
│   │   │   ├── app-shell.tsx
│   │   │   ├── header.tsx
│   │   │   └── sidebar.tsx
│   │   ├── dashboard/
│   │   │   ├── metric-card.tsx
│   │   │   └── overview-table.tsx
│   │   ├── search/                     # Lead/company search UI
│   │   │   ├── people-search-page.tsx
│   │   │   ├── companies-search-page.tsx
│   │   │   ├── list-index-page.tsx
│   │   │   ├── list-detail-page.tsx
│   │   │   ├── filter-sidebar.tsx
│   │   │   ├── bulk-action-bar.tsx
│   │   │   ├── add-to-list-dropdown.tsx
│   │   │   └── enrichment-badge.tsx
│   │   ├── linkedin/                   # LinkedIn sender setup
│   │   │   ├── connect-button.tsx
│   │   │   ├── connect-modal.tsx
│   │   │   ├── add-account-button.tsx
│   │   │   └── connect-button.tsx
│   │   ├── onboarding/                 # Client onboarding flow
│   │   │   ├── onboarding-client.tsx
│   │   │   ├── onboarding-steps.ts
│   │   │   ├── domain-step.tsx
│   │   │   ├── typeform-engine.tsx
│   │   │   └── send-invite-button.tsx
│   │   ├── portal/                     # Client portal components
│   │   │   ├── portal-nav.tsx
│   │   │   ├── campaign-card.tsx
│   │   │   ├── campaign-approval-leads.tsx
│   │   │   ├── campaign-approval-content.tsx
│   │   │   └── logout-button.tsx
│   │   ├── proposal/                   # Proposal document
│   │   │   ├── proposal-document.tsx
│   │   │   ├── proposal-actions.tsx
│   │   │   ├── e-signature.tsx
│   │   │   └── pricing-table.tsx
│   │   ├── proposals/                  # Proposal management (admin)
│   │   │   ├── copy-link-button.tsx
│   │   │   └── mark-paid-button.tsx
│   │   ├── chat/                       # Chat sidebar + panels
│   │   │   ├── chat-panel.tsx
│   │   │   ├── chat-sidebar.tsx
│   │   │   └── chat-toggle.tsx
│   │   ├── inbox/                      # Reply detail view
│   │   │   └── reply-detail.tsx
│   │   ├── charts/                     # Campaign metrics visualization
│   │   │   └── campaign-chart.tsx
│   │   ├── brand/
│   │   │   └── outsignal-logo.tsx
│   │   ├── settings/
│   │   │   └── api-token-form.tsx
│   │   └── workspace/
│   │       └── workspace-settings-form.tsx
│   ├── lib/                            # Business logic & utilities
│   │   ├── agents/                     # AI agent system
│   │   │   ├── runner.ts               # Core execution engine: runAgent()
│   │   │   ├── orchestrator.ts         # Master agent (delegation to research/leads/writer/campaign)
│   │   │   ├── research.ts             # Research Agent (ICP analysis, website crawl)
│   │   │   ├── leads.ts                # Leads Agent (search, list ops, export, scoring)
│   │   │   ├── writer.ts               # Writer Agent (email/LinkedIn copy generation)
│   │   │   ├── campaign.ts             # Campaign Agent (sequence design, deployment)
│   │   │   ├── shared-tools.ts         # Tool definitions (knowledge search, workspace query)
│   │   │   └── types.ts                # AgentConfig, AgentRunResult interfaces
│   │   ├── enrichment/                 # Lead enrichment pipeline
│   │   │   ├── waterfall.ts            # Multi-provider orchestration + deduplication
│   │   │   ├── queue.ts                # Job queuing, batch processing, resume logic
│   │   │   ├── merge.ts                # Merge enrichment results into Person/Company
│   │   │   ├── dedup.ts                # Check if field already enriched
│   │   │   ├── costs.ts                # Cost tracking
│   │   │   ├── log.ts                  # EnrichmentLog helper
│   │   │   ├── status.ts               # Job status queries
│   │   │   ├── types.ts                # EnrichmentProvider interface
│   │   │   └── providers/              # Individual enrichment providers
│   │   │       ├── prospeo.ts
│   │   │       ├── aiark.ts
│   │   │       ├── aiark-person.ts
│   │   │       ├── findymail.ts
│   │   │       ├── leadmagic.ts
│   │   │       └── firecrawl-company.ts
│   │   ├── linkedin/                   # LinkedIn sender + action system
│   │   │   ├── sender.ts               # Sender account operations
│   │   │   ├── actions.ts              # Action queuing + execution
│   │   │   ├── queue.ts                # LinkedInAction processor
│   │   │   ├── rate-limiter.ts         # Rate limit enforcement by sender tier
│   │   │   ├── auth.ts                 # Session refresh + login
│   │   │   └── types.ts                # LinkedInAction, Sender interfaces
│   │   ├── campaigns/                  # Campaign lifecycle operations
│   │   │   └── operations.ts           # createCampaign, updateStatus, deploy, etc.
│   │   ├── leads/                      # Lead lifecycle operations
│   │   │   └── operations.ts           # addLeadsToList, scoreICP, export, etc.
│   │   ├── knowledge/                  # Knowledge base for agents
│   │   │   ├── store.ts                # Vector search + retrieval
│   │   │   └── embeddings.ts           # OpenAI embeddings client
│   │   ├── icp/                        # ICP scoring
│   │   │   ├── scorer.ts               # Score Person against workspace criteria
│   │   │   └── crawl-cache.ts          # Cache homepage markdown per Company
│   │   ├── emailbison/                 # EmailBison API client
│   │   │   ├── client.ts               # HTTP methods (getCampaigns, sendEmail, etc.)
│   │   │   └── types.ts                # Campaign, Lead, Reply types
│   │   ├── export/                     # Data export utilities
│   │   │   ├── csv.ts                  # Generate CSV from leads
│   │   │   └── verification-gate.ts    # Check lead verification before export
│   │   ├── clay/                       # Clay integration
│   │   │   └── sync.ts                 # Fetch from Clay, enqueue enrichment
│   │   ├── firecrawl/                  # Firecrawl API client
│   │   │   └── client.ts               # Scrape website, return markdown
│   │   ├── normalizer/                 # Data normalization
│   │   │   ├── index.ts                # Main normalizer entry
│   │   │   ├── company.ts              # Company name normalization
│   │   │   ├── job-title.ts            # Job title standardization
│   │   │   ├── industry.ts             # Industry/vertical mapping
│   │   │   └── vocabulary.ts           # Lookup tables
│   │   ├── verification/               # Email verification providers
│   │   │   └── leadmagic.ts            # Email validation
│   │   ├── chat/                       # Chat tool definitions for orchestrator
│   │   │   └── tools.ts                # Tool schema for chat endpoint
│   │   ├── db.ts                       # Prisma singleton
│   │   ├── notifications.ts            # Slack + email sender (campaigns, approvals, replies)
│   │   ├── admin-auth.ts               # Admin session creation/verification
│   │   ├── admin-auth-edge.ts          # Edge-compatible admin auth
│   │   ├── portal-auth.ts              # Magic link auth for clients
│   │   ├── portal-auth-edge.ts         # Edge-compatible portal auth
│   │   ├── portal-session.ts           # Session helpers
│   │   ├── workspaces.ts               # Workspace queries (by slug, details)
│   │   ├── stripe.ts                   # Stripe client
│   │   ├── slack.ts                    # Slack API client
│   │   ├── resend.ts                   # Resend email client
│   │   ├── tokens.ts                   # Token generation (proposals, onboarding)
│   │   ├── cron-auth.ts                # Cron job signature verification
│   │   ├── crypto.ts                   # AES-256-GCM encryption (LinkedIn credentials)
│   │   ├── normalize.ts                # Company name + free email domain detection
│   │   ├── content-preview.ts          # Draft email HTML preview
│   │   ├── porkbun.ts                  # Domain WHOIS lookup
│   │   ├── proposal-templates.ts       # Default pricing, template HTML
│   │   └── utils.ts                    # Shared utilities
│   ├── mcp/                            # Model Context Protocol server
│   │   └── leads-agent/                # Claude Desktop integration
│   │       ├── index.ts                # MCP server entrypoint
│   │       └── tools/
│   │           ├── enrich.ts
│   │           ├── export.ts
│   │           ├── lists.ts
│   │           ├── score.ts
│   │           ├── search.ts
│   │           ├── status.ts
│   │           └── workspace.ts
│   └── middleware.ts                   # Route protection + subdomain routing
├── prisma/
│   ├── schema.prisma                   # Database schema (14+ models)
│   └── migrations/                     # Migration history
├── scripts/
│   └── ingest-document.ts              # Knowledge base document ingestion CLI
├── src/__tests__/                      # Unit tests (Vitest)
│   ├── api-routes.test.ts
│   ├── enrichment-dedup.test.ts
│   ├── enrichment-queue.test.ts
│   ├── emailbison-client.test.ts
│   ├── linkedin-sender.test.ts
│   ├── linkedin-queue.test.ts
│   ├── linkedin-rate-limiter.test.ts
│   ├── normalizer.test.ts
│   ├── slack.test.ts
│   ├── resend-notifications.test.ts
│   ├── lib-utils.test.ts
│   └── setup.ts
├── public/
│   └── favicon.ico
├── next.config.ts                      # Next.js configuration
├── tsconfig.json                       # TypeScript configuration
├── vitest.config.ts                    # Vitest configuration
├── vercel.json                         # Vercel cron + deployment config
├── .env.example                        # Environment variable template
├── .eslintrc.mjs                       # ESLint config
├── postcss.config.mjs                  # PostCSS config
├── components.json                     # Shadcn UI config
└── package.json                        # Dependencies + build scripts
```

## Directory Purposes

**src/app:**
- Purpose: Define routes, pages, and API endpoints (Next.js app directory)
- Contains: Page.tsx files, layout.tsx, API route handlers
- Key files: `(admin)/workspace/[slug]/page.tsx`, `api/campaigns/route.ts`, `api/webhooks/emailbison/route.ts`

**src/components:**
- Purpose: Organize reusable React components by feature
- Contains: Page components, feature-specific components, Shadcn primitives
- Key files: `layout/app-shell.tsx`, `search/people-search-page.tsx`, `proposal/proposal-document.tsx`

**src/lib:**
- Purpose: Business logic, integrations, utilities (not UI)
- Contains: Agent system, enrichment pipeline, auth, external API clients
- Key files: `agents/runner.ts`, `enrichment/waterfall.ts`, `campaigns/operations.ts`

**prisma:**
- Purpose: Database schema and migrations
- Contains: schema.prisma (14 models: Workspace, Person, Company, Campaign, Sender, etc.)
- Committed: Yes (schema is source of truth)

**scripts:**
- Purpose: One-off CLI tasks
- Contains: `ingest-document.ts` (add docs to knowledge base)
- Run: `npx ts-node scripts/ingest-document.ts <path>`

**src/__tests__:**
- Purpose: Unit and integration tests
- Contains: Test files (*.test.ts), setup.ts for test environment
- Pattern: Co-located by feature (e.g., `enrichment-dedup.test.ts` tests dedup logic)

## Key File Locations

**Entry Points:**
- `src/app/layout.tsx` — Root layout with fonts
- `src/app/(admin)/page.tsx` — Admin dashboard homepage
- `src/app/(portal)/portal/page.tsx` — Client portal homepage
- `src/middleware.ts` — Route protection + subdomain routing

**Configuration:**
- `prisma/schema.prisma` — Database models
- `next.config.ts` — Next.js settings
- `tsconfig.json` — TypeScript compiler options
- `vercel.json` — Cron job definitions

**Core Logic:**
- `src/lib/agents/runner.ts` — AI agent execution engine
- `src/lib/enrichment/waterfall.ts` — Multi-provider enrichment orchestration
- `src/lib/campaigns/operations.ts` — Campaign lifecycle state machine
- `src/lib/linkedin/queue.ts` — LinkedIn action processor
- `src/lib/notifications.ts` — Slack + email sender

**Testing:**
- `src/__tests__/enrichment-dedup.test.ts` — Dedup logic tests
- `src/__tests__/slack.test.ts` — Slack formatting tests
- `src/__tests__/normalizer.test.ts` — Company/job title normalization tests

## Naming Conventions

**Files:**
- `*.ts` — TypeScript files (logic, utilities, types)
- `*.tsx` — React components
- `route.ts` — Next.js API route handler
- `page.tsx` — Next.js page component
- `*.test.ts` — Vitest unit tests
- `[dynamic].ts` — Dynamic route segment (e.g., `[slug]`)

**Directories:**
- Lowercase, dash-separated for feature areas: `src/lib/linkedin`, `src/components/search`
- Parentheses for route groups: `src/app/(admin)`, `src/app/(portal)` — not in URL
- Brackets for dynamic segments: `src/app/(admin)/workspace/[slug]`

**Functions:**
- camelCase: `createCampaign()`, `enrichPerson()`, `runAgent()`
- Prefixes for clarity: `useWorkspace()` (hooks), `verifySession()` (auth), `getWorkspace()` (queries)

**Variables:**
- camelCase: `campaignId`, `workspaceSlug`, `isApproved`
- UPPER_SNAKE_CASE for constants: `FREE_EMAIL_DOMAINS`, `VALID_TRANSITIONS`, `MAX_RETRY_ATTEMPTS`
- `_` prefix for unused params: `(_req: NextRequest)` → tells TypeScript it's intentional

**Types:**
- PascalCase: `Campaign`, `Person`, `EnrichmentProvider`, `AgentRunResult`
- Suffix `Params` for function argument interfaces: `CreateCampaignParams`, `UpdateWorkspaceParams`
- Suffix `Result` for return types: `EnrichmentResult`, `AgentRunResult`

## Where to Add New Code

**New Feature (e.g., SMS outreach):**
- Primary code: `src/lib/sms/` (client, types, operations)
- API routes: `src/app/api/sms/` (send, status, webhook)
- Components: `src/components/sms/` (setup UI)
- Tests: `src/__tests__/sms.test.ts`
- Database: Add models to `prisma/schema.prisma` (SMS_Action, etc.)

**New Component/Module:**
- Implementation: `src/components/{feature}/` (e.g., `src/components/video/`)
- Export via index: Create barrel file at `src/components/{feature}/index.ts`
- Use in pages: Import from barrel, then use in page.tsx or layout.tsx

**Utilities:**
- Shared helpers: `src/lib/utils.ts` (small utilities)
- Domain-specific: `src/lib/{feature}/utils.ts` or new file (e.g., `src/lib/export/utils.ts`)
- Type definitions: Co-locate in same file as usage, or in `{feature}/types.ts` if shared

**Agent Tools:**
- New tool: Add to `src/lib/agents/shared-tools.ts` (if used by multiple agents)
- Agent-specific tool: Add to agent file (e.g., `src/lib/agents/campaign.ts`)
- Tool implementation: Keep function in tool closure, delegate logic to operations layer

**API Routes:**
- Standard CRUD: `src/app/api/{resource}/route.ts` (GET, POST) + `[id]/route.ts` (GET, PATCH, DELETE)
- Webhooks: `src/app/api/webhooks/{service}/route.ts` (POST only, async processing)
- Complex operations: `src/app/api/{resource}/{action}/route.ts` (e.g., `campaigns/[id]/publish/route.ts`)

**Database Models:**
- Edit: `prisma/schema.prisma` → `npx prisma migrate dev --name {description}`
- Relations: Use FK or soft links (@map for renamed fields)
- Indexes: Add for query columns, especially workspace, status, timestamps

**Tests:**
- Unit tests: `src/__tests__/{feature}.test.ts`
- Setup mocks: `src/__tests__/setup.ts` (prisma, environment)
- Pattern: Describe > Test > Expect

## Special Directories

**src/app/(admin):**
- Purpose: Protected admin dashboard pages
- Generated: No (source files)
- Committed: Yes
- Auth: Cookie-based (verified by middleware)
- Contains: Pages for workspace, people, campaigns, lists, onboarding, settings

**src/app/(portal):**
- Purpose: Client portal (campaign approvals)
- Generated: No (source files)
- Committed: Yes
- Auth: Magic link tokens (verified by middleware)
- Contains: Login, campaign list, approval forms

**src/app/(customer):**
- Purpose: Public customer flows (proposals, onboarding)
- Generated: No (source files)
- Committed: Yes
- Auth: Token-based (proposal token, onboarding invite)
- Contains: Proposal view + e-signature, onboarding form

**src/app/api:**
- Purpose: All API endpoints (admin, portal, webhooks, public)
- Generated: No (source files)
- Committed: Yes
- Auth: Varies by route (session cookie, API key, webhook signature, Bearer token)
- Contains: 50+ route files organized by resource

**prisma:**
- Purpose: Database schema and migrations
- Generated: node_modules/.prisma (client code, not committed)
- Committed: Yes (schema.prisma, migrations/)
- Updated: Via `npx prisma migrate dev`

**.next:**
- Purpose: Build output
- Generated: Yes (`npm run build`)
- Committed: No (.gitignore)
- Contents: Compiled routes, static assets, server functions

---

*Structure analysis: 2025-03-01*
