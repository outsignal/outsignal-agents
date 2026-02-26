# Outsignal Lead Engine

## What This Is

A self-hosted lead database and enrichment engine that replaces Clay for Outsignal's cold outbound operation. Combines multi-source enrichment (Prospeo, AI Ark, LeadMagic, Firecrawl), AI-powered data normalization and qualification, lead search/filtering, and list building — all on top of the existing 14k+ person / 17k+ company database. Built on Next.js 16 with Prisma/PostgreSQL, deployed on Vercel.

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

### Active

<!-- Current scope. Building toward these. -->

- [ ] Multi-source enrichment pipeline — waterfall strategy across Prospeo, AI Ark, LeadMagic, Firecrawl + Claude
- [ ] Dedup check before enrichment — query local DB before hitting paid APIs
- [ ] AI-powered data normalization — industry classification, field extraction, company name cleanup (replace Clay AI)
- [ ] Lead qualification with Firecrawl + Haiku — classify if prospects actually fit ICP based on web research
- [ ] Lead search and filter UI — browse people/companies by name, company, vertical, enrichment status
- [ ] List building — create target lists from DB matching ICP criteria, signal-based segmentation
- [ ] List export to EmailBison — push qualified lists directly to campaigns
- [ ] Lead scoring — score prospects by signal overlap (1-10 based on cold email framework)
- [ ] Direct API integrations — Prospeo (email finding), AI Ark (company/person data), LeadMagic (email verification)
- [ ] Email finding/validation pipeline — Prospeo + LeadMagic to find and verify emails before outreach

### Out of Scope

- Campaign Agent (auto-create and launch campaigns — future milestone)
- Real-time intent signals (RB2B, Warmly, Vector, Trigify — future milestone, high complexity)
- LinkedIn automation (HeyReach — separate tool, compliance risk)
- Domain infrastructure management — handled externally (PlusVibe)
- CRM integration (HubSpot) — not needed, EmailBison is the system of record
- Replacing EmailBison as sending infrastructure

## Current Milestone: v1.0 Lead Engine (Cancel Clay)

**Goal:** Replace Clay entirely by building own enrichment pipeline, lead search, and list building. Save $300+/month while getting better control over lead data.

**Target features:**
- Multi-source enrichment pipeline (Prospeo, AI Ark, LeadMagic, Firecrawl + Claude)
- Lead qualification: Firecrawl + Haiku to classify ICP fit from web research
- Email finding/validation: Prospeo to find, LeadMagic to verify
- AI normalization: Claude replaces Clay's AI (industry, company name, field extraction)
- Dedup-first: always check local DB before calling paid APIs
- Lead search UI: browse, filter, query the 14k+ people / 17k+ companies
- List building: create target lists by ICP criteria and signal-based segmentation
- Export to EmailBison: push qualified lists to campaigns
- Lead scoring: 1-10 based on signal overlap (cold email framework tiers)

## Context

- Currently paying $300+/mo for Clay but only using it lightly for enrichment and AI personalization
- A lead gen agency validated this approach on LinkedIn: replaced Clay with Prospeo + AI Ark for list building, Firecrawl + Haiku for qualification, TryKitt/Icypeas/LeadMagic for email, Supabase as master DB, push to EmailBison
- Existing agent architecture is well-established: orchestrator dispatches to specialist agents, each with custom tools and audit trail
- Cold email framework (`/tmp/cold-email-engine-framework.md`) defines signal layers (Company Fundamentals → Decision-Maker Readiness → Timing Triggers), 4-tier lead qualification, and list building strategy (3,000-7,500 prospects per campaign, segment by signals not just industry)
- Person model is workspace-agnostic (unique by email) with PersonWorkspace junction for per-workspace metadata
- Firecrawl already integrated for website scraping — reuse for prospect research and qualification
- Company name normalization already exists in `src/lib/normalize.ts`
- Clay can stay running during transition as fallback

## Constraints

- **Stack**: Next.js 16, Prisma 6, PostgreSQL (Neon), Vercel — must stay consistent with existing codebase
- **Agent pattern**: Must follow existing agent architecture (config + runner + tools pattern)
- **Extensibility**: Enrichment provider integration must be pluggable — new APIs can be added without restructuring
- **Cost awareness**: External API calls cost money — agent should be smart about when and what to enrich
- **Data model**: Leverage existing Person/Company models, extend rather than replace

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Replace Clay with own pipeline | Save $300+/mo, own the data, dedup leads, better control | — Pending |
| Waterfall enrichment (cheapest first) | Minimize API costs, only hit expensive sources when cheap ones fail | — Pending |
| Prospeo + AI Ark + LeadMagic stack | Industry standard for lead gen, validated by agencies, cheaper than Clay | — Pending |
| Firecrawl + Haiku for qualification | Already have Firecrawl, Haiku is cheap — classify ICP fit from web data | — Pending |
| AI normalization via Claude | Already have Anthropic integration, Claude more capable than Clay AI | — Pending |
| Keep Clay running during transition | De-risk migration, fall back if new pipeline has gaps | — Pending |
| Provider-agnostic enrichment architecture | Future-proof against API changes, easy to add new providers | — Pending |

---
*Last updated: 2026-02-26 after initialization (replaces previous v1.0 scope)*
