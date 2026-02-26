# External Integrations

**Analysis Date:** 2026-02-26

## APIs & External Services

**AI & LLM:**
- Anthropic Claude API - AI chat, agent framework, research, writing assistance
  - SDK: `@ai-sdk/anthropic`, `ai` (Vercel AI SDK)
  - Auth: `ANTHROPIC_API_KEY` (env var, `sk-ant-...` format)
  - Used in: `src/app/api/chat/route.ts`, `src/lib/agents/` (runner, orchestrator, research, writer)

**Email Marketing & Outreach:**
- EmailBison (Outsignal) - Campaign management, lead tracking, reply handling
  - SDK: Custom `EmailBisonClient` in `src/lib/emailbison/client.ts`
  - Auth: Per-workspace API tokens in `EMAILBISON_WORKSPACES` JSON array
  - API Base: `https://app.outsignal.ai/api`
  - Endpoints: `/campaigns`, `/replies`, `/leads`, `/sender-emails`, `/tags`, `/campaign/sequence-steps`
  - Used in: Workspace configuration, lead sync, reply notifications
  - Format: Token format `1|your-token-here`

**Communication:**
- Slack - Channel creation, user invitations, message delivery, notifications
  - SDK: `@slack/web-api` (WebClient)
  - Auth: `SLACK_BOT_TOKEN` (xoxb- format)
  - Operations: Create private channels, invite workspace members, send Slack Connect invites to external emails
  - Used in: `src/lib/slack.ts`, `src/lib/notifications.ts`
  - Requires scopes: `conversations:manage`, `users:read.email`, `groups:write`, `chat:write`, `conversations.connect:write` (for Slack Connect on paid plans)

**Email Delivery:**
- Resend - Transactional email sending for notifications and onboarding
  - SDK: `resend` package
  - Auth: `RESEND_API_KEY` (re_... format)
  - Config: `RESEND_FROM` email address (default: "Outsignal <notifications@notification.outsignal.ai>")
  - Used in: `src/lib/resend.ts`, `src/lib/notifications.ts`
  - Sends: Reply notifications, onboarding invites, payment confirmations

**Web Scraping:**
- Firecrawl (Mendable) - Website crawling and content extraction
  - SDK: `@mendable/firecrawl-js`
  - Auth: `FIRECRAWL_API_KEY` (env var)
  - Used in: `src/lib/firecrawl/client.ts`
  - Operations: `crawlWebsite()` (up to 10 pages default), `scrapeUrl()` (single URL)
  - Output format: Markdown content extraction

**Payment Processing:**
- Stripe - Subscription and proposal payment handling
  - SDK: `stripe` package
  - Auth: `STRIPE_SECRET_KEY` (sk_... format)
  - Webhook validation: `STRIPE_WEBHOOK_SECRET` (whsec_... format)
  - Used in: `src/lib/stripe.ts`, `src/app/api/stripe/`
  - Events: `checkout.session.completed` triggers onboarding invite

**Lead Enrichment:**
- Clay - Contact and company data enrichment (future Leads Agent)
  - Integration: `src/lib/clay/sync.ts`
  - Functions: `importClayContacts()`, `importClayCompanies()`
  - Webhook ingestion: `/api/people/enrich`, `/api/companies/enrich`

**Domain Management:**
- Porkbun - Domain availability checking and suggestions
  - SDK: Custom HTTP client in `src/lib/porkbun.ts`
  - Auth: `PORKBUN_API_KEY`, `PORKBUN_SECRET_KEY` (env vars)
  - API Base: `https://api.porkbun.com/api/json/v3`
  - Operations: Domain availability checks, TLD parsing, suggestion generation

## Data Storage

**Databases:**
- PostgreSQL (Neon or Supabase) - Primary production database
  - Connection: `DATABASE_URL` (postgresql://... with sslmode=require)
  - ORM: Prisma 6.19.2 with type-safe client generation
  - Schema location: `prisma/schema.prisma`
  - Models: Workspace, Person, PersonWorkspace, Proposal, OnboardingInvite, AgentRun, WebhookEvent, etc.

**File Storage:**
- Local filesystem only for development
- Production: Vercel blob storage (if needed for files)
- No explicit S3 or cloud storage configured

**Caching:**
- Next.js request caching - Via Prisma client `revalidate` option in API routes
- No separate Redis/Memcached layer

## Authentication & Identity

**Auth Provider:**
- Custom token-based authentication for proposals and onboarding
  - Implementation: `src/lib/tokens.ts` - Generates unique tokens for proposal links and onboarding invites
  - No OAuth/SSO integration
  - Token routes: `/o/[token]` (proposals), `/p/[token]` (onboarding)

## Monitoring & Observability

**Error Tracking:**
- None detected - No Sentry, Rollbar, or equivalent configured
- Console logging for errors and warnings

**Logs:**
- Console.log/console.error - Development and production logging
- Vercel function logs - Accessible via Vercel dashboard
- No structured logging framework (Pino, Winston, etc.)

## CI/CD & Deployment

**Hosting:**
- Vercel - Next.js serverless platform
- Deployment: `git push` triggers automatic builds
- Preview deployments for PRs
- Production URL: `https://cold-outbound-dashboard.vercel.app`

**CI Pipeline:**
- GitHub (implied) - Source control
- Vercel CI/CD integration - Automatic on push

## Environment Configuration

**Required env vars (critical):**
- `DATABASE_URL` - PostgreSQL connection string with SSL
- `ANTHROPIC_API_KEY` - Claude API access
- `RESEND_API_KEY` - Email delivery
- `SLACK_BOT_TOKEN` - Slack integration
- `EMAILBISON_WORKSPACES` - JSON array of workspace configs

**Optional env vars:**
- `STRIPE_SECRET_KEY` - Payment processing
- `STRIPE_WEBHOOK_SECRET` - Stripe webhook validation
- `FIRECRAWL_API_KEY` - Web scraping
- `PORKBUN_API_KEY`, `PORKBUN_SECRET_KEY` - Domain checking
- `RESEND_FROM` - Email sender address override
- `NEXT_PUBLIC_APP_URL` - Application base URL (defaults to localhost:3000)

**Secrets location:**
- Development: `.env.local` file (git-ignored)
- Production: Vercel Environment Variables dashboard
- Workspace config: `EMAILBISON_WORKSPACES` JSON array in env

## Webhooks & Callbacks

**Incoming (Webhook Receivers):**
- `/api/webhooks/emailbison` - EmailBison reply webhook
  - Query param: `workspace={slug}`
  - Events: `LEAD_REPLIED`, `LEAD_INTERESTED`, `UNTRACKED_REPLY_RECEIVED`
  - Payload: Campaign, lead, reply data; updates Person status and sends notifications
  - Skips automated replies

- `/api/stripe/webhook` - Stripe payment events
  - Event: `checkout.session.completed`
  - Validates signature with `STRIPE_WEBHOOK_SECRET`
  - Action: Updates proposal to "paid" status, sends onboarding email

- `/api/people/enrich` - Clay enrichment webhook (future)
  - Ingests enriched contact data

- `/api/companies/enrich` - Clay enrichment webhook (future)
  - Ingests enriched company data

**Outgoing (Webhook Callers):**
- EmailBison API - Reads campaigns, replies, leads, tags
- Slack WebClient - Sends messages, creates channels
- Resend API - Sends emails
- Firecrawl API - Crawls/scrapes websites
- Stripe API - Creates checkout sessions, retrieves session data
- Anthropic API - Streams AI responses for chat and agent operations

## Integration Flow Patterns

**Reply Notification Flow:**
1. EmailBison webhook hits `/api/webhooks/emailbison?workspace={slug}`
2. Event logged to `WebhookEvent` table
3. Person status updated to "replied" or "interested"
4. `notifyReply()` called from `src/lib/notifications.ts`
5. Slack message posted to `workspace.slackChannelId` (if configured)
6. Email sent to recipients in `workspace.notificationEmails` (if configured)
7. Both point to `https://app.outsignal.ai/inbox`

**Payment & Onboarding Flow:**
1. User creates proposal in UI
2. Clicks "Send payment link"
3. Stripe checkout session created
4. Client completes payment
5. Stripe webhook hits `/api/stripe/webhook`
6. Proposal status → "paid", `paidAt` set
7. Resend sends onboarding invite email to client
8. Client visits `/p/{token}/onboard` to complete questionnaire

---

*Integration audit: 2026-02-26*
