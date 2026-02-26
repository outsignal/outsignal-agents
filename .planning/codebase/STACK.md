# Technology Stack

**Analysis Date:** 2026-02-26

## Languages

**Primary:**
- TypeScript 5.x - All application code, API routes, components, utilities
- JavaScript (Node.js) - Build scripts, configuration files

**Secondary:**
- SQL (via Prisma) - Database queries
- JSX/TSX - React components

## Runtime

**Environment:**
- Node.js (latest LTS) - Backend runtime via Next.js

**Package Manager:**
- npm (v10+) - Primary package manager
- Lockfile: `package-lock.json` present

## Frameworks

**Core:**
- Next.js 16.1.6 - Full-stack framework (API routes, React components, SSR)
- React 19.2.3 - UI component framework
- React DOM 19.2.3 - React rendering

**Testing:**
- Vitest 4.0.18 - Unit and integration test runner
- @testing-library/react 16.3.2 - React component testing
- @testing-library/jest-dom 6.9.1 - DOM matchers
- jsdom 28.1.0 - DOM implementation for testing

**Build/Dev:**
- Tailwind CSS 4.x - Utility-first CSS framework
- PostCSS 4.x - CSS processing
- ESLint 9.x - Code linting with Next.js config
- TypeScript Compiler - Type checking

**UI Components:**
- Shadcn/UI (v3.8.5) - Accessible component library
- Radix UI 1.4.3 - Headless UI primitives
- Lucide React 0.575.0 - Icon library
- Class Variance Authority 0.7.1 - Component variant management
- Clsx 2.1.1 - Conditional classname utility
- Tailwind Merge 3.5.0 - Intelligent CSS merge utility
- tw-animate-css 1.4.0 - Tailwind animation utilities

**Data Visualization:**
- Recharts 3.7.0 - React charting library

**Markdown:**
- React Markdown 10.1.0 - Markdown to React component rendering
- Remark GFM 4.0.1 - GitHub Flavored Markdown support

## Key Dependencies

**Critical:**
- Prisma 6.19.2 - ORM for PostgreSQL, type-safe database queries
- @prisma/client 6.19.2 - Prisma database client
- Zod 4.3.6 - TypeScript-first schema validation

**AI & LLM:**
- @ai-sdk/anthropic 3.0.46 - Anthropic Claude API SDK
- @ai-sdk/react 3.0.99 - React hooks for Vercel AI SDK
- ai 6.0.97 - Vercel AI SDK framework

**Infrastructure:**
- @slack/web-api 7.14.1 - Slack API client for channel/message operations
- resend 6.9.2 - Email delivery service
- stripe 20.3.1 - Stripe payment processing SDK
- @mendable/firecrawl-js 4.13.2 - Web scraping and crawling SDK

## Configuration

**Environment:**
- Configuration via `.env.local` file (not committed)
- Required vars: `DATABASE_URL`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `SLACK_BOT_TOKEN`, `EMAILBISON_WORKSPACES`
- Optional vars: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `FIRECRAWL_API_KEY`, `PORKBUN_API_KEY`, `PORKBUN_SECRET_KEY`
- Reference: `.env.example` in project root

**Build:**
- `tsconfig.json` - TypeScript strict mode, ES2017 target, module resolution: bundler
- `eslint.config.mjs` - ESLint Next.js config
- `postcss.config.mjs` - PostCSS with Tailwind
- `components.json` - Shadcn/UI component configuration
- `vitest.config.ts` - Test runner configuration with jsdom environment

## Database

**Primary:**
- PostgreSQL (via Neon or Supabase) - Production database
- Prisma 6.19.2 ORM with type-safe client generation
- Schema: `prisma/schema.prisma` (14+ tables: Workspace, Person, PersonWorkspace, Proposal, OnboardingInvite, AgentRun, WebhookEvent, etc.)
- Local SQLite option via `prisma/dev.db` for development

## Platform Requirements

**Development:**
- Node.js 18+ (with npm 9+)
- PostgreSQL-compatible database (Neon, Supabase, or local Postgres)
- Environment variables (.env.local)

**Production:**
- Deployment target: Vercel (Next.js native platform)
- Database: Neon or Supabase (PostgreSQL)
- Environment variables configured in Vercel dashboard

---

*Stack analysis: 2026-02-26*
