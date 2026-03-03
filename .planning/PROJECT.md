# Outsignal Lead Engine

## What This Is

A self-hosted outbound lead engine that replaces Clay for Outsignal's cold outbound operation. Full pipeline from enrichment to campaign deployment: multi-source enrichment (Prospeo, AI Ark, LeadMagic, FindyMail, Firecrawl), AI-powered ICP qualification, campaign creation via AI agents (leads + writer), client portal with dual approval, auto-deploy to EmailBison + LinkedIn, sender health monitoring, and Chrome extension for LinkedIn cookie management. Built on Next.js 16 with Prisma/PostgreSQL, deployed on Vercel. 48k+ LOC across 305 files.

## Core Value

Own the lead data pipeline end-to-end so we never pay for the same lead twice and can cancel the $300+/month Clay subscription.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- Agent framework with orchestrator, runner, typed configs, and audit trail (AgentRun)
- Research Agent: Firecrawl website crawling, ICP extraction, website analysis storage
- Writer Agent: email/LinkedIn copy generation, knowledge base search, draft management
- Knowledge Base: 46 documents ingested, chunked search, tag filtering
- Dashboard with chat interface and agent delegation (Sonnet 4 orchestrator)
- EmailBison webhook handling (LEAD_REPLIED, LEAD_INTERESTED, UNTRACKED_REPLY_RECEIVED)
- Lead/Company data model: Person (workspace-agnostic), PersonWorkspace junction, Company
- Clay sync endpoints for inbound enrichment data (/api/people/enrich, /api/companies/enrich)
- Slack + email reply notifications per workspace
- Customer onboarding flow (proposals, Stripe payments, questionnaire)
- 6 active client workspaces (Rise, Lime Recruitment, YoopKnows, Outsignal, MyAcq, 1210 Solutions)
- ✓ Multi-source enrichment waterfall (Prospeo → AI Ark → LeadMagic → FindyMail, cheapest first) — v1.0
- ✓ Dedup-first enrichment (local DB check before paid APIs) — v1.0
- ✓ AI normalization via Claude (industry, company name, job title classification) — v1.0
- ✓ ICP qualification via Firecrawl + Haiku (web research scoring) — v1.0
- ✓ Lead search and filter UI (people + companies, 14k+ dataset, pagination) — v1.0
- ✓ List building (named target lists, bulk add, enrichment summary) — v1.0
- ✓ Export to EmailBison campaigns with hard email verification gate — v1.0
- ✓ CSV export for external tools — v1.0
- ✓ 5 provider integrations (Prospeo, AI Ark, LeadMagic, FindyMail, Firecrawl) — v1.0
- ✓ MCP Leads Agent (enrich, search, score, list build, export via Claude Code) — v1.0
- ✓ API security (CRON_SECRET auth on enrichment routes, timing-safe comparison) — v1.0
- ✓ Leads Agent in admin dashboard — natural language campaign pipeline via chat — v1.1
- ✓ Campaign entity with AI writer — email/LinkedIn sequence generation — v1.1
- ✓ Client portal with dual approval — separate lead + content approval flow — v1.1
- ✓ Smart campaign deployment — auto-deploy to EmailBison + LinkedIn on approval — v1.1
- ✓ Admin command center — KPIs, charts, agent monitoring, sender management — v1.1
- ✓ LinkedIn Voyager API — HTTP-based LinkedIn automation — v1.1
- ✓ Automated sender health — detection, rotation, reassignment, notifications — v1.1
- ✓ Chrome extension — one-click LinkedIn cookie capture with expiry detection — v1.1

### Active

<!-- Next milestone scope. -->

(To be defined in next milestone — run `/gsd:new-milestone`)

### Out of Scope

- Real-time intent signals (RB2B, Warmly, Vector, Trigify — future milestone, high complexity)
- Domain infrastructure management — handled externally (PlusVibe)
- CRM integration (HubSpot) — not needed, EmailBison is the system of record
- Replacing EmailBison as sending infrastructure
- Per-lead approve/reject in portal — binary list-level approval only

## Current State

**Shipped:** v1.1 Outbound Pipeline (2026-03-03) — 9 phases, 40 plans, 87/87 requirements
**Previous:** v1.0 Lead Engine (2026-02-27) — 7 phases, 22 plans
**Next:** TBD — run `/gsd:new-milestone`

**Codebase:** ~48,200 LOC TypeScript/TSX across 305 files
**Stack:** Next.js 16, Prisma 6, PostgreSQL (Neon), Vercel, Railway (LinkedIn worker)
**Data:** 14,563 people, 16,941 companies, 6 client workspaces
**Chrome extension:** Manifest V3, vanilla JS, 3 files

**Tech debt (v1.0 carried):** AI Ark auth header LOW confidence, FindyMail schema MEDIUM confidence, costs page not in sidebar, webhook no signature verification. See `milestones/v1.0-MILESTONE-AUDIT.md`.

## Constraints

- **Stack**: Next.js 16, Prisma 6, PostgreSQL (Neon), Vercel — must stay consistent with existing codebase
- **Agent pattern**: Must follow existing agent architecture (config + runner + tools pattern)
- **Extensibility**: Enrichment provider integration must be pluggable — new APIs can be added without restructuring
- **Cost awareness**: External API calls cost money — agent should be smart about when and what to enrich
- **Data model**: Leverage existing Person/Company models, extend rather than replace

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Replace Clay with own pipeline | Save $300+/mo, own the data, dedup leads, better control | ✓ Good — v1.0 shipped, pipeline functional |
| Waterfall enrichment (cheapest first) | Minimize API costs, only hit expensive sources when cheap ones fail | ✓ Good — 4-provider email waterfall + 2-provider company waterfall |
| Prospeo + AI Ark + LeadMagic stack | Industry standard for lead gen, validated by agencies, cheaper than Clay | ✓ Good — all integrated, AI Ark auth LOW confidence |
| Firecrawl + Haiku for qualification | Already have Firecrawl, Haiku is cheap — classify ICP fit from web data | ✓ Good — ICP scorer works, crawl cache prevents re-crawling |
| AI normalization via Claude | Already have Anthropic integration, Claude more capable than Clay AI | ✓ Good — rule-based fast path + Haiku fallback |
| Keep Clay running during transition | De-risk migration, fall back if new pipeline has gaps | ⚠️ Revisit — Clay still running, ready to cancel |
| Provider-agnostic enrichment architecture | Future-proof against API changes, easy to add new providers | ✓ Good — adapter types, easy to swap |
| db push over migrate dev | No migration history, 14k+ records, db push is safer | ✓ Good — used consistently across all 7 phases |
| TargetList model for lists | Junction table over PersonWorkspace.tags for proper relational modeling | ✓ Good — clean export path, MCP consistent |
| Hard email verification gate | No unverified emails ever exported — strict deliverability policy | ✓ Good — prevents sending to invalid addresses |
| Campaign as first-class entity | Owns leads (TargetList) + content (email/LinkedIn sequences) + deploy tracking | ✓ Good — clean separation, supports multi-channel |
| AI agents via Claude Code, not dashboard | Avoids Anthropic API costs — Claude Code Max Plan covers it | ✓ Good — saves $300+/mo in API costs |
| Dual approval (leads + content separate) | Clients review independently, deploy on both approved | ✓ Good — flexible approval workflow |
| Voyager API over browser automation | HTTP calls safer than headless Chrome for LinkedIn | ✓ Good — lower detection risk |
| Chrome extension for cookie capture | One-click LinkedIn connect, no DevTools needed | ✓ Good — reduces friction for clients |

---
*Last updated: 2026-03-03 after v1.1 milestone completion*
