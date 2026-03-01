# External Integrations

**Analysis Date:** 2026-03-01

## APIs & External Services

**LLM & AI:**
- Anthropic (Claude) - Primary AI model for research, lead qualification, content generation
  - SDK: `@ai-sdk/anthropic` 3.0.46
  - Auth: `ANTHROPIC_API_KEY` env var (sk-ant-* format)
  - Usage: `src/lib/agents/`, chat endpoints, MCP server integration
  - Streaming: React hooks via `@ai-sdk/react`

- OpenAI - Embeddings and text processing
  - Client: `openai` 6.25.0 package
  - Auth: `OPENAI_API_KEY` env var
  - Usage: `src/lib/knowledge/embeddings.ts` for knowledge base vectorization
  - Model: text-embedding-3-small (1536 dimensions)

**Email Outreach:**
- EmailBison (white-labeled as Outsignal) - Campaign management and lead sending
  - Client: `src/lib/emailbison/client.ts` (custom wrapper)
  - Base URL: `https://app.outsignal.ai/api`
  - Auth: Bearer token per workspace (stored in Prisma `Workspace.apiToken`)
  - Config: JSON array in `EMAILBISON_WORKSPACES` env var
  - Endpoints: `/campaigns`, `/leads`, `/replies`, `/sender-emails`, `/custom-variables`, `/sequence-steps`
  - Webhook: `src/app/api/webhooks/emailbison/route.ts` - receives LEAD_REPLIED, LEAD_INTERESTED, UNTRACKED_REPLY_RECEIVED

- Resend - Transactional email notifications
  - Client: `resend` 6.9.2 package
  - Auth: `RESEND_API_KEY` env var (re_* format)
  - From: `RESEND_FROM` env var (default: "Outsignal <notifications@notification.outsignal.ai>")
  - Usage: `src/lib/resend.ts` - Onboarding invites, payment confirmations, reply notifications

**Payment Processing:**
- Stripe - Payment collection and proposal management
  - Client: `stripe` 20.3.1 package
  - Auth: `STRIPE_SECRET_KEY` (sk_* format)
  - Webhook: `src/app/api/stripe/webhook/route.ts`
  - Webhook Secret: `STRIPE_WEBHOOK_SECRET` env var (whsec_* format)
  - Events: `checkout.session.completed` triggers proposal paid status and onboarding email
  - Data: Stores `stripeSessionId`, `stripePaymentLink` in Proposal model

**Communication & Collaboration:**
- Slack - Team channel creation and notifications
  - Client: `@slack/web-api` 7.14.1 package (WebClient)
  - Auth: `SLACK_BOT_TOKEN` env var (xoxb-* format)
  - Functions: `src/lib/slack.ts` - channel creation, user lookup, invitations, messaging
  - Usage: Client workspace channels, reply notifications, approval notifications
  - Required scopes: `conversations:write`, `conversations:connect:write`, `users:read.email`, `chat:write`, `groups:write`

**Web Content Extraction:**
- Firecrawl - Website scraping and markdown extraction
  - Client: `@mendable/firecrawl-js` 4.13.2 package
  - Implementation: `src/lib/firecrawl/client.ts`
  - Auth: `FIRECRAWL_API_KEY` env var
  - Usage:
    - `src/lib/icp/crawl-cache.ts` - crawl client websites for ICP scoring
    - `src/lib/enrichment/providers/firecrawl-company.ts` - company homepage data
  - Methods: `crawlWebsite()` (max 10 pages), `scrapeUrl()` (single page to markdown)

**Domain & DNS:**
- Porkbun - Domain registration and management
  - Client: `src/lib/porkbun.ts` (custom HTTP wrapper)
  - Auth: `PORKBUN_API_KEY`, `PORKBUN_SECRET_KEY` env vars
  - API Base: `https://api.porkbun.com/api/json/v3`
  - Usage: Domain availability checks, TLD parsing, suggestion generation

## Data Storage

**Databases:**
- PostgreSQL (via Neon)
  - Connection: `DATABASE_URL` env var (postgresql://...)
  - ORM: Prisma 6.19.2 (`@prisma/client`)
  - Schema: `prisma/schema.prisma`
  - Tables: Person (Lead), PersonWorkspace (LeadWorkspace), Company, Campaign, Workspace, WebhookEvent, Proposal, OnboardingInvite, Sender, LinkedInAction, LinkedInDailyUsage, LinkedInConnection, KnowledgeDocument, KnowledgeChunk, AgentRun, EnrichmentLog, EnrichmentJob, etc.
  - Extensions: PostgreSQL vector extension (pgvector) for embeddings (1536 dimensions)
  - Indexes: Applied to frequently queried columns (workspace, status, source, company, vertical)

**File Storage:**
- Local filesystem only (no cloud storage detected)
- Knowledge base documents stored as TEXT in `KnowledgeDocument.content` and `KnowledgeDocument.chunks`
- Vercel deployment has ephemeral storage

**Caching:**
- None detected at the infrastructure level
- In-memory session stores only
- Prisma client-side caching via `revalidate` option in API routes

## Authentication & Identity

**Session Management:**
- Admin portal: Cookie-based with HMAC-signing
  - Secret: `ADMIN_SESSION_SECRET` env var
  - Implementation: `src/lib/admin-auth.ts`, `src/lib/admin-auth-edge.ts`
  - Password: `ADMIN_PASSWORD` env var (plaintext comparison)

- Client portal: Token-based sessions
  - Secret: `PORTAL_SESSION_SECRET` env var
  - Implementation: `src/lib/portal-auth.ts`, `src/lib/portal-auth-edge.ts`
  - Magic links: `src/lib/tokens.ts` generates time-limited tokens

- LinkedIn worker: Bearer token scheme
  - Secret: `WORKER_API_SECRET` env var
  - Worker URL: `LINKEDIN_WORKER_URL` env var (Railway Docker service)
  - Implementation: `src/lib/linkedin/auth.ts`

**LinkedIn Access:**
- Credentials stored encrypted in `Sender` model
  - `linkedinPassword` - AES-256-GCM encrypted
  - `totpSecret` - AES-256-GCM encrypted
  - `sessionData` - AES-256-GCM encrypted JSON (cookies, etc.)
  - Encryption key: `LINKEDIN_SESSION_KEY` env var
  - Implementation: `src/lib/crypto.ts`

## Monitoring & Observability

**Error Tracking:**
- Not detected - no Sentry, Datadog, or error monitoring service integrated

**Logs:**
- Console-based logging (console.log, console.warn, console.error) throughout codebase
- No centralized logging framework (Pino, Winston, etc.)
- Vercel's built-in logs available via Vercel dashboard

**Metrics:**
- EmailBison campaign metrics fetched via API
- Cached metrics: `CachedMetrics` table in Prisma for workspace-specific aggregations
- Cost tracking: `DailyCostTotal`, `EnrichmentLog` tables for enrichment spending

## CI/CD & Deployment

**Hosting:**
- Vercel (main Next.js application at `admin.outsignal.ai` / `cold-outbound-dashboard.vercel.app`)
- Railway (LinkedIn worker service - Docker container)

**CI Pipeline:**
- None detected in codebase (no GitHub Actions workflows)
- Deployment: Manual via `git push` to Vercel (auto-deploy configured)
- Database: Prisma migrations run on deploy via `prisma generate` in postinstall script

**Cron Jobs:**
- Configured in `vercel.json`:
  - `/api/enrichment/jobs/process` - Daily at 6am UTC
  - Handler: `src/app/api/enrichment/jobs/process/route.ts`
  - Auth: `CRON_SECRET` env var verification

**Worker Service:**
- Railway deployment: `worker/Dockerfile` + `worker/railway.toml`
- Build: Dockerfile builder with TypeScript compilation
- Restart policy: Always

## Environment Configuration

**Required env vars:**
- `DATABASE_URL` - PostgreSQL connection
- `ANTHROPIC_API_KEY` - Claude API
- `RESEND_API_KEY`, `RESEND_FROM` - Email service
- `SLACK_BOT_TOKEN` - Slack bot
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` - Payment processing
- `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET` - Admin auth
- `PORTAL_SESSION_SECRET` - Client portal auth
- `EMAILBISON_WORKSPACES` - Client workspace configs (JSON)
- `OPENAI_API_KEY` - Embeddings
- `FIRECRAWL_API_KEY` - Web scraping
- `PROSPEO_API_KEY`, `LEADMAGIC_API_KEY`, `FINDYMAIL_API_KEY`, `AIARK_API_KEY` - Enrichment providers
- `WORKER_API_SECRET`, `LINKEDIN_WORKER_URL`, `LINKEDIN_SESSION_KEY` - LinkedIn automation
- `CRON_SECRET` - Cron authentication
- `PORKBUN_API_KEY`, `PORKBUN_SECRET_KEY` - Domain registration

**Optional env vars:**
- `ENRICHMENT_DAILY_CAP_USD` - Daily budget control (defaults to $5)
- `NEXT_PUBLIC_APP_URL` - Public app URL (defaults to `http://localhost:3000`)
- `NEXT_PUBLIC_PORTAL_URL` - Client portal URL (defaults to `https://portal.outsignal.ai`)
- `NODE_ENV` - Environment mode (development/production)

**Secrets location:**
- `.env` and `.env.local` (local development - NOT committed)
- Vercel environment variables (production - set via Vercel dashboard)
- No .env.* files committed to git

## Webhooks & Callbacks

**Incoming:**
- EmailBison webhook: `GET /api/webhooks/emailbison?workspace={slug}`
  - Events: LEAD_REPLIED, LEAD_INTERESTED, UNTRACKED_REPLY_RECEIVED
  - Verification: Workspace slug parameter (no signature validation yet - TODO)
  - Storage: WebhookEvent table, triggers Slack + email notifications
  - Implementation: `src/app/api/webhooks/emailbison/route.ts`

- Stripe webhook: `POST /api/stripe/webhook`
  - Events: `checkout.session.completed`
  - Verification: HMAC signature validation using `STRIPE_WEBHOOK_SECRET`
  - Logic: Updates Proposal payment status, sends onboarding email
  - Implementation: `src/app/api/stripe/webhook/route.ts`

- Clay webhooks (future):
  - Person enrichment: `POST /api/people/enrich` - receives person data
  - Company enrichment: `POST /api/companies/enrich` - receives company data

**Outgoing:**
- EmailBison API: Pushes campaign sequence data, creates leads, updates custom variables
  - Triggered by campaign deployment and configuration
  - Implementation: `src/lib/emailbison/client.ts` methods

- LinkedIn worker calls: API calls from main app to worker
  - Endpoint: `LINKEDIN_WORKER_URL` env var (Railway service)
  - Auth: Bearer token via `WORKER_API_SECRET`
  - Methods: Schedule actions, query status
  - Implementation: `src/lib/linkedin/actions.ts`

- Slack notifications: Posts messages and creates channels
  - Triggered by reply events and approvals
  - Implementation: `src/lib/slack.ts` and `src/lib/notifications.ts`

- Resend emails: Sends transactional emails
  - Triggered by payment completion, onboarding, replies
  - Implementation: `src/lib/resend.ts` and `src/lib/notifications.ts`

## Enrichment Data Providers

**Email Finders (LinkedIn → Email):**
- Prospeo - Email finding via LinkedIn URL or name+company lookup
  - API: `POST https://api.prospeo.io/enrich-person`
  - Auth: `X-KEY` header with `PROSPEO_API_KEY`
  - Implementation: `src/lib/enrichment/providers/prospeo.ts`
  - Cost: Tracked in `EnrichmentLog` table
  - Timeout: 10 seconds

- LeadMagic - Email from LinkedIn profile URL
  - API: `POST https://api.leadmagic.io/v1/people/b2b-profile-to-email`
  - Auth: `X-API-Key` header with `LEADMAGIC_API_KEY`
  - Implementation: `src/lib/enrichment/providers/leadmagic.ts`
  - Requires LinkedIn URL (returns null without API call if not provided)
  - Timeout: 10 seconds

- FindYmail - Email finding provider
  - Auth: `FINDYMAIL_API_KEY` env var
  - Implementation: `src/lib/enrichment/providers/findymail.ts`
  - Timeout: 10 seconds

**Company Data Providers:**
- AI Ark - Company information (headcount, industry, description)
  - API: `POST https://api.ai-ark.com/api/developer-portal/v1/companies`
  - Auth: `X-TOKEN` header with `AIARK_API_KEY` (LOW confidence - may need update if returning 401/403)
  - Implementation: `src/lib/enrichment/providers/aiark.ts`, `aiark-person.ts`
  - Cost: Tracked in `EnrichmentLog` table
  - Timeout: 10 seconds

- Firecrawl - Company homepage data
  - Crawls company website to extract markdown content
  - Implementation: `src/lib/enrichment/providers/firecrawl-company.ts`
  - Cache: `Company.crawlMarkdown` and `crawledAt` timestamp

**Clay Integration (Webhook Receivers):**
- Person enrichment: `POST /api/people/enrich`
  - Body: Person data with snake_case fields (Clay API format)
  - Auto-derives `companyDomain` from email
  - Storage: Upserts Person and PersonWorkspace records

- Company enrichment: `POST /api/companies/enrich`
  - Body: Company data with snake_case fields
  - Storage: Upserts Company record, backfills vertical on people with matching domain

**Enrichment Job Management:**
- Queue-based waterfall: `src/lib/enrichment/waterfall.ts`
- Daily cap: `ENRICHMENT_DAILY_CAP_USD` (default $5)
- Cron runner: `/api/enrichment/jobs/process` at 6am UTC via `vercel.json`
- Cost tracking: `DailyCostTotal` table tracks daily spend per provider
- Tables: `EnrichmentLog`, `DailyCostTotal`, `EnrichmentJob`
- Providers available: Prospeo, LeadMagic, FindYmail, AI Ark (person), AI Ark (company), Firecrawl (company)

---

*Integration audit: 2026-03-01*
