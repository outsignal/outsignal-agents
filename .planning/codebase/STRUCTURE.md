# Codebase Structure

**Analysis Date:** 2026-02-26

## Directory Layout

```
outsignal-agents/
├── .planning/                      # GSD documentation (generated)
├── prisma/
│   └── schema.prisma              # Prisma data models and database schema
├── public/                         # Static assets (logos, fonts, etc.)
├── scripts/                        # One-time setup and utility scripts
├── src/
│   ├── app/                        # Next.js App Router
│   │   ├── layout.tsx              # Root layout (fonts, metadata)
│   │   ├── globals.css             # Global styles (Tailwind)
│   │   ├── (admin)/                # Admin dashboard routes
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx            # Dashboard home
│   │   │   ├── workspace/[slug]/   # Workspace-specific pages
│   │   │   ├── onboard/            # Client onboarding management
│   │   │   ├── onboarding/         # Onboarding invites UI
│   │   │   ├── people/             # People/leads database view
│   │   │   └── settings/           # Admin settings
│   │   ├── (customer)/             # Customer-facing routes
│   │   │   ├── p/[token]/          # Proposal signing flow
│   │   │   └── o/[token]/          # Team member onboarding invites
│   │   └── api/                    # HTTP endpoints
│   │       ├── chat/               # Chat interface endpoint
│   │       ├── webhooks/emailbison # EmailBison webhook receiver
│   │       ├── people/             # Person enrichment endpoints
│   │       ├── companies/          # Company enrichment endpoints
│   │       ├── workspace/          # Workspace configuration
│   │       ├── proposals/          # Proposal CRUD
│   │       ├── onboard/            # Onboarding flow
│   │       ├── stripe/             # Stripe payment webhooks
│   │       └── domains/            # Domain suggestion helper
│   ├── lib/                        # Business logic and utilities
│   │   ├── agents/                 # AI agent system
│   │   │   ├── orchestrator.ts     # Meta-agent dispatcher
│   │   │   ├── research.ts         # Research specialist agent
│   │   │   ├── writer.ts           # Content writing specialist agent
│   │   │   ├── runner.ts           # Agent execution engine
│   │   │   └── types.ts            # Type definitions (AgentConfig, etc.)
│   │   ├── chat/                   # Chat system
│   │   │   └── tools.ts            # Tool definitions (legacy, now in orchestrator)
│   │   ├── knowledge/              # Knowledge base
│   │   │   └── store.ts            # Document chunking and search
│   │   ├── emailbison/             # EmailBison API integration
│   │   │   ├── client.ts           # HTTP client for EmailBison API
│   │   │   └── types.ts            # Type definitions
│   │   ├── clay/                   # Clay CRM integration
│   │   │   └── sync.ts             # Import/sync functions (contacts, companies)
│   │   ├── firecrawl/              # Website crawling
│   │   │   └── client.ts           # Firecrawl API wrapper
│   │   ├── db.ts                   # Prisma singleton
│   │   ├── notifications.ts        # Slack and email notifications
│   │   ├── slack.ts                # Slack WebClient wrapper
│   │   ├── resend.ts               # Resend email wrapper
│   │   ├── stripe.ts               # Stripe API wrapper
│   │   ├── tokens.ts               # Token generation utilities
│   │   ├── normalize.ts            # Data normalization (company names)
│   │   ├── workspaces.ts           # Workspace loading and management
│   │   ├── porkbun.ts              # Domain registration API
│   │   ├── proposal-templates.ts   # Pricing templates for proposals
│   │   └── utils.ts                # General utilities
│   └── components/                 # React components
│       ├── ui/                     # Shadcn UI components
│       │   ├── button.tsx
│       │   ├── card.tsx
│       │   ├── dialog.tsx
│       │   ├── input.tsx
│       │   ├── select.tsx
│       │   ├── tabs.tsx
│       │   ├── table.tsx
│       │   └── [other UI primitives]
│       ├── layout/                 # Layout components
│       │   ├── app-shell.tsx       # Main app container
│       │   ├── sidebar.tsx         # Navigation sidebar
│       │   └── header.tsx          # Top navigation
│       ├── chat/                   # Chat interface
│       │   ├── chat-panel.tsx      # Main chat UI
│       │   ├── chat-toggle.tsx     # Toggle button
│       │   └── chat-sidebar.tsx    # Chat conversation history
│       ├── inbox/                  # Inbox/replies view
│       │   └── reply-detail.tsx    # Reply expansion
│       └── settings/               # Settings forms
│           └── api-token-form.tsx
├── .env.local                      # Local environment variables (not committed)
├── package.json                    # NPM dependencies
├── tsconfig.json                   # TypeScript configuration with path aliases
├── tailwind.config.ts              # Tailwind CSS configuration
├── next.config.ts                  # Next.js configuration
└── prisma.config.js                # Prisma client generation
```

## Directory Purposes

**`.planning/codebase/`:**
- Purpose: GSD (Get Shit Done) documentation
- Contains: ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, CONCERNS.md
- Generated: Yes (by GSD tools)
- Committed: Yes

**`prisma/`:**
- Purpose: Database schema and migrations
- Contains: schema.prisma (data models), migration history
- Key files: `schema.prisma` (all models: Workspace, Person, Company, AgentRun, etc.)

**`src/app/`:**
- Purpose: Next.js pages and API routes
- Contains: App Router structure, layouts, page components, HTTP endpoints
- Subdirectories: `(admin)` admin dashboard, `(customer)` public flows, `api/` endpoints

**`src/app/(admin)/`:**
- Purpose: Admin dashboard pages
- Contains: Workspace management, onboarding, people database, settings
- Key pages:
  - `page.tsx`: Dashboard home
  - `workspace/[slug]/page.tsx`: Workspace dashboard
  - `workspace/[slug]/inbox/page.tsx`: Email replies view
  - `workspace/[slug]/campaigns/[id]/page.tsx`: Campaign details
  - `onboard/page.tsx`: Onboarding management interface
  - `people/page.tsx`: People/leads database

**`src/app/(customer)/`:**
- Purpose: Customer-facing flows (no authentication)
- Contains: Proposal signing, team member onboarding invites
- Key pages:
  - `p/[token]/page.tsx`: Proposal document (view and sign)
  - `o/[token]/page.tsx`: Team member invite acceptance

**`src/app/api/`:**
- Purpose: HTTP endpoints for webhooks, data mutations, streaming
- Contains: Route handlers for all external integrations and data operations
- Key routes:
  - `POST /api/chat`: Chat interface (streams orchestrator responses)
  - `POST /api/webhooks/emailbison`: EmailBison webhook handler
  - `POST /api/people/enrich`: Person enrichment webhook
  - `POST /api/companies/enrich`: Company enrichment webhook
  - `POST /api/proposals`: Proposal creation
  - `POST /api/stripe/webhook`: Stripe payment status updates

**`src/lib/`:**
- Purpose: Reusable business logic, services, utilities
- Contains: Agent system, API clients, database helpers, domain logic
- Pattern: No subdirectories except for agents, chat, knowledge, clay, emailbison, firecrawl (5 topic areas)

**`src/lib/agents/`:**
- Purpose: AI agent framework and specialist implementations
- Contains: Orchestrator, Research, Writer agents + runner + types
- Files:
  - `orchestrator.ts`: Meta-agent with delegation tools
  - `research.ts`: Website analysis specialist
  - `writer.ts`: Content generation specialist
  - `runner.ts`: Universal agent execution engine
  - `types.ts`: Shared type definitions

**`src/lib/knowledge/`:**
- Purpose: Knowledge base for Writer Agent
- Contains: Document chunking, storage, search
- Files: `store.ts` (chunkText, searchKnowledge, ingestDocument)

**`src/lib/emailbison/`:**
- Purpose: EmailBison API integration
- Contains: HTTP client, type definitions
- Files: `client.ts` (EmailBisonClient class), `types.ts` (Campaign, Lead, Reply, etc.)

**`src/components/`:**
- Purpose: React component library
- Contains: Shadcn UI primitives, feature components
- Subdirectories:
  - `ui/`: Reusable UI components (button, input, dialog, table, etc.)
  - `layout/`: Page structure (app shell, sidebar, header)
  - `chat/`: Chat interface components
  - `inbox/`: Email reply components
  - `settings/`: Configuration forms

**`scripts/`:**
- Purpose: One-time utilities (not part of app runtime)
- Examples: setup-client.ts (one-time onboarding setup), ingest-document.ts (knowledge base ingestion)

**`public/`:**
- Purpose: Static assets served by Next.js
- Contains: Images, icons, fonts
- Generated: No
- Committed: Yes

## Key File Locations

**Entry Points:**
- `src/app/layout.tsx`: Root HTML structure, fonts, metadata
- `src/app/(admin)/layout.tsx`: Admin dashboard shell and navigation
- `src/app/(customer)/p/[token]/layout.tsx`: Proposal layout
- `src/app/api/chat/route.ts`: Chat endpoint (streamed responses)

**Configuration:**
- `tsconfig.json`: TypeScript with path alias `@/*` → `./src/*`
- `tailwind.config.ts`: Tailwind CSS setup
- `next.config.ts`: Next.js configuration (middleware, etc.)
- `package.json`: Dependencies and scripts

**Core Logic:**
- `prisma/schema.prisma`: All data models and schema
- `src/lib/db.ts`: Prisma client singleton
- `src/lib/workspaces.ts`: Workspace loading (env + DB)
- `src/lib/agents/orchestrator.ts`: Agent dispatcher and tools
- `src/lib/agents/runner.ts`: Agent execution engine with audit logging

**Testing:**
- Tests are co-located with source files (not found; project may not have tests yet)
- Config: `vitest.config.ts` (testing framework)

**Environment:**
- `.env.local`: Local env vars (DATABASE_URL, API keys, etc.) — NOT committed
- Environment setup: Load from `.env.local` + Vercel deployment env vars

## Naming Conventions

**Files:**
- Pages: `page.tsx` (Next.js convention)
- Layouts: `layout.tsx` (Next.js convention)
- API routes: `route.ts` (Next.js convention)
- Components: PascalCase.tsx (e.g., `ChatPanel.tsx`, `ReplyDetail.tsx`)
- Utilities: camelCase.ts (e.g., `workspaces.ts`, `normalize.ts`)
- Types: Same file or separate `types.ts` in same directory

**Directories:**
- Feature directories: lowercase, plural (e.g., `agents/`, `components/`, `api/`)
- Route groups: parentheses notation (e.g., `(admin)/`, `(customer)/`)
- Dynamic routes: square brackets (e.g., `[slug]/`, `[token]/`, `[id]/`)
- Nested routes: nested directories (e.g., `workspace/[slug]/inbox/`)

**TypeScript/React:**
- Components: PascalCase function names
- Functions: camelCase
- Constants: UPPER_SNAKE_CASE
- Interfaces: PascalCase with `I` prefix (some files don't follow this)
- Types: PascalCase
- Props: Inline type or dedicated `Props` interface

**Database:**
- Models: PascalCase (Workspace, Person, Company)
- Fields: camelCase (createdAt, firstName, jobTitle)
- Relations: Lowercase, plural (workspaces, person)
- Maps: @map("LegacyTableName") for renamed fields

## Where to Add New Code

**New Feature (e.g., new campaign type):**
- Primary code: `src/lib/[domain]/` (e.g., `src/lib/linkedin-campaigns/`)
- API endpoint: `src/app/api/[resource]/route.ts`
- Types: `src/lib/[domain]/types.ts`
- Database: Add model to `prisma/schema.prisma`
- Agent tools (if needed): Add tool function to specialist agent

**New Component/Module:**
- Implementation: `src/components/[feature]/ComponentName.tsx`
- Utilities: `src/lib/[domain]/` (if cross-cutting)
- Exports: Use barrel files (index.ts) if group related

**Utilities & Helpers:**
- Shared helpers: `src/lib/utils.ts` (general) or topic-specific (e.g., `src/lib/normalize.ts`)
- Type-only files: `src/lib/[domain]/types.ts`
- API clients: `src/lib/[service]/client.ts` (EmailBison, Firecrawl, etc.)

**New Agent:**
- File: `src/lib/agents/[agentname].ts`
- Pattern: Define tools, system prompt, config, run function
- Example: See `research.ts` and `writer.ts` for structure
- Registration: Add to `orchestratorTools` in `src/lib/agents/orchestrator.ts`

**Testing:**
- Co-located: `*.test.ts` or `*.spec.ts` in same directory as source
- Config: `vitest.config.ts` (already present, but tests not found yet)

## Special Directories

**`node_modules/`:**
- Purpose: Installed dependencies
- Generated: Yes (npm install)
- Committed: No

**`.next/`:**
- Purpose: Next.js build output
- Generated: Yes (npm run build)
- Committed: No

**`.git/`:**
- Purpose: Git repository
- Committed: Yes (system file)

**`.env.local`:**
- Purpose: Local environment configuration (secrets, API keys, DATABASE_URL)
- Generated: Manual setup
- Committed: No (in .gitignore)
- Contains: DATABASE_URL, Slack tokens, EmailBison tokens, Resend API key, etc.

**`prisma/migrations/`:**
- Purpose: Database schema version history
- Generated: Yes (prisma migrate)
- Committed: Yes

---

## Route Structure Quick Reference

```
Admin Dashboard (authenticated by workspace context):
/                                 → Dashboard home
/workspace/[slug]                 → Workspace overview
/workspace/[slug]/inbox           → Email replies
/workspace/[slug]/inbox-health    → Sender health metrics
/workspace/[slug]/campaigns/[id]  → Campaign details
/workspace/[slug]/settings        → Workspace configuration
/people                           → People/leads database
/onboard                          → Onboarding client management
/onboarding                       → Onboarding invite management
/settings                         → Admin settings

Customer Flows (public, token-gated):
/p/[token]                        → Proposal document
/p/[token]/onboard                → Onboarding after proposal
/o/[token]                        → Team member invite

API Endpoints:
POST /api/chat                    → Chat interface (streams)
POST /api/webhooks/emailbison     → EmailBison webhook
POST /api/people/enrich           → Person enrichment
POST /api/companies/enrich        → Company enrichment
POST /api/proposals               → Create proposal
POST /api/workspace/[slug]/configure → Update workspace
POST /api/stripe/webhook          → Stripe payment updates
GET  /api/domains/suggest         → Domain suggestions
```

*Structure analysis: 2026-02-26*
