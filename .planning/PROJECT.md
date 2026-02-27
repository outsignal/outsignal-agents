# Outsignal Lead Engine

## What This Is

A self-hosted lead database and enrichment engine that replaces Clay for Outsignal's cold outbound operation. Combines multi-source enrichment (Prospeo, AI Ark, LeadMagic, FindyMail, Firecrawl), AI-powered data normalization and ICP qualification, lead search/filtering, list building, and verified export to EmailBison — all on top of a 14k+ person / 17k+ company database. Includes an MCP-powered Leads Agent for natural language pipeline access. Built on Next.js 16 with Prisma/PostgreSQL, deployed on Vercel.

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

### Active

<!-- Current scope. Building toward these. -->

- [ ] LinkedIn sequencer — profile-first targeting with agent-browser (send messages, connection requests, profile views)
- [ ] Lead scoring 1-10 based on signal overlap (cold email framework tiers)

### Out of Scope

- Campaign Agent (auto-create and launch campaigns — future milestone)
- Real-time intent signals (RB2B, Warmly, Vector, Trigify — future milestone, high complexity)
- Domain infrastructure management — handled externally (PlusVibe)
- CRM integration (HubSpot) — not needed, EmailBison is the system of record
- Replacing EmailBison as sending infrastructure

## Current State

**Shipped:** v1.0 Lead Engine (2026-02-27) — 7 phases, 22 plans, 29/29 requirements
**Next:** LinkedIn sequencer rewrite (agent-browser + profile-first targeting)

**Codebase:** ~26,600 LOC TypeScript/TSX across 451 files
**Stack:** Next.js 16, Prisma 6, PostgreSQL (Neon), Vercel
**Data:** 14,563 people, 16,941 companies, 6 client workspaces

**Tech debt (12 items, non-blocking):** AI Ark auth header LOW confidence, FindyMail schema MEDIUM confidence, costs page not in sidebar, webhook no signature verification, daily cron only (Hobby plan). Full list in `milestones/v1.0-MILESTONE-AUDIT.md`.

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

---
*Last updated: 2026-02-27 after v1.0 milestone*
