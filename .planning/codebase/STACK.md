# Technology Stack

**Analysis Date:** 2026-03-01

## Languages

**Primary:**
- TypeScript 5.x - All application code, API routes, components, utilities
- JavaScript (React) - Frontend components and client-side logic

**Secondary:**
- Dockerfile - Worker service containerization
- TOML - Railway deployment configuration
- SQL (via Prisma) - Database queries

## Runtime

**Environment:**
- Node.js (LTS via package.json) - Backend runtime
- Server-side: Next.js 16 running on Vercel
- Worker: Node.js Docker container on Railway

**Package Manager:**
- npm (v10+) - Primary package manager
- Lockfile: `package-lock.json` (present)

## Frameworks

**Core:**
- Next.js 16.1.6 - Full-stack framework with API routes, server components, React 19
- React 19.2.3 - UI library with concurrent rendering
- React DOM 19.2.3 - React rendering

**Testing:**
- Vitest 4.0.18 - Unit/integration testing with jsdom environment
- @testing-library/react 16.3.2 - Component testing utilities
- @testing-library/jest-dom 6.9.1 - DOM matchers

**Build/Dev:**
- Tailwind CSS 4 - Utility-first CSS framework
- PostCSS 4 - CSS processing
- ESLint 9 - Code linting with Next.js config
- tsx 4.21.0 - TypeScript executor for CLI scripts
- TypeScript 5.x - Type checking

**UI Components:**
- Shadcn/ui 3.8.5 - High-quality component library
- Radix UI 1.4.3 - Unstyled, accessible components (basis for shadcn/ui)
- Lucide React 0.575.0 - Icon library
- Class Variance Authority 0.7.1 - Component variant management
- Clsx 2.1.1 - Conditional CSS class merging
- Tailwind Merge 3.5.0 - Intelligent CSS merge utility
- tw-animate-css 1.4.0 - Tailwind animation utilities

**Data Visualization:**
- Recharts 3.7.0 - React charting library

**Markdown:**
- React Markdown 10.1.0 - Markdown to React component rendering
- Remark GFM 4.0.1 - GitHub Flavored Markdown support

## Key Dependencies

**Critical (AI & Core Logic):**
- @ai-sdk/anthropic 3.0.46 - Anthropic API integration for Claude models
- @ai-sdk/react 3.0.99 - React hooks for AI streaming
- ai 6.0.97 - Vercel AI SDK (LLM orchestration)
- openai 6.25.0 - OpenAI API client for embeddings

**Database & ORM:**
- @prisma/client 6.19.2 - Type-safe database client
- prisma 6.19.2 - ORM and schema management
- PostgreSQL (via DATABASE_URL) - Primary data store

**Web Scraping & Content:**
- @mendable/firecrawl-js 4.13.2 - Website crawling (markdown extraction)
- react-markdown 10.1.0 - Markdown rendering in React
- dompurify 3.3.1 - HTML sanitization

**External Services:**
- stripe 20.3.1 - Stripe payment processing
- @slack/web-api 7.14.1 - Slack bot API
- resend 6.9.2 - Transactional email service

**MCP (Model Context Protocol):**
- @modelcontextprotocol/sdk 1.27.1 - Native MCP server for Claude integration

**LinkedIn Automation (Worker):**
- agent-browser 0.15.1 - Headless browser for LinkedIn (worker/src)
- otpauth 9.5.0 - TOTP secret generation/verification
- ws 8.18.0 - WebSocket client for worker communication

**Utilities:**
- zod 4.3.6 - Schema validation and TypeScript inference
- nuqs 2.8.8 - Next.js URL query state management
- use-debounce 10.1.0 - React debounce hook

## Configuration

**Environment:**
- `.env` file (local development)
- `.env.local` file (local overrides)
- Vercel environment variables (production)

**Key configs required (see .env.example):**
- `DATABASE_URL` - PostgreSQL connection string
- `ANTHROPIC_API_KEY` - Claude API access
- `RESEND_API_KEY`, `RESEND_FROM` - Email service
- `SLACK_BOT_TOKEN` - Slack bot authentication
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` - Stripe payment processing
- `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET` - Admin dashboard auth
- `PORTAL_SESSION_SECRET` - Client portal session signing
- `EMAILBISON_WORKSPACES` - JSON array of workspace configs
- `OPENAI_API_KEY` - For knowledge base embeddings
- `FIRECRAWL_API_KEY` - Website scraping
- Enrichment provider keys: `PROSPEO_API_KEY`, `LEADMAGIC_API_KEY`, `FINDYMAIL_API_KEY`, `AIARK_API_KEY`
- `WORKER_API_SECRET`, `LINKEDIN_WORKER_URL`, `LINKEDIN_SESSION_KEY` - LinkedIn automation
- `CRON_SECRET` - Cron job authentication
- `ENRICHMENT_DAILY_CAP_USD` - Daily enrichment spending limit (optional, defaults to $5)
- `PORKBUN_API_KEY`, `PORKBUN_SECRET_KEY` - Domain registration

**Build:**
- `tsconfig.json` - TypeScript strict mode, ES2017 target, bundler module resolution
- `next.config.ts` - Next.js configuration
- `vitest.config.ts` - Vitest configuration with jsdom environment
- `vercel.json` - Vercel-specific config (crons)
- `eslint.config.mjs` - Linting rules (ESLint 9)
- `postcss.config.mjs` - PostCSS configuration
- `components.json` - shadcn/ui component configuration

## Platform Requirements

**Development:**
- Node.js 18+
- npm 9+
- PostgreSQL 13+ (local or Neon)

**Production:**
- Vercel (Next.js app hosting at `admin.outsignal.ai`)
- PostgreSQL on Neon (DATABASE_URL managed by Vercel)
- Railway (LinkedIn worker service - Docker container)
- Stripe (payment processing)
- Resend (email notifications)
- Slack (workspace integration)
- OpenAI (embeddings API)
- Firecrawl (web scraping)
- Various enrichment provider APIs (Prospeo, LeadMagic, FindYmail, AI Ark)

---

*Stack analysis: 2026-03-01*
