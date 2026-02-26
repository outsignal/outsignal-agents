# Outsignal Agents

## What This Is

An AI-powered cold outbound platform that manages the full campaign lifecycle for multiple clients. Specialist AI agents handle research, copywriting, lead sourcing, and campaign management — orchestrated through a chat interface and dashboard. Built on Next.js 16 with Prisma/PostgreSQL, deployed on Vercel.

## Core Value

Automate the intelligence-heavy parts of cold outbound — finding the right prospects, writing compelling copy, and managing campaigns — so operators can focus on strategy and client relationships.

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

- [ ] Leads Agent: full lead sourcing pipeline (find, enrich, personalize, score, qualify)
- [ ] Dashboard UI for lead review and approval

### Out of Scope

- Campaign Agent (Iteration 4 — EmailBison campaign management via agent)
- Real-time signal tools (RB2B, Warmly, Vector, Trigify — future integration)
- Apollo integration (future — may add as additional lead source)
- Replacing EmailBison as sending infrastructure

## Current Milestone: v1.0 Leads Agent

**Goal:** Build a Leads Agent that replaces Clay's role — finds companies/people matching workspace ICP, enriches with verified contact data, personalizes with AI intelligence, scores against ICP, and surfaces leads in a dashboard UI for approval.

**Target features:**
- Leads Agent with tool-calling pipeline (SerperDev, Prospeo, LeadMagic, FindyMail, AI Ark)
- ICP-aware lead scoring and qualification (signal layers, tier system)
- AI-powered personalization (industry detection, job title normalization, company name cleanup)
- Dashboard leads view (browse, filter, approve/reject)
- Provider-agnostic enrichment architecture (easy to add new APIs later)

## Context

- Existing agent architecture is well-established: orchestrator dispatches to specialist agents, each with custom tools and audit trail
- Currently using Clay lightly for finding companies/people (free) + 3rd party APIs for email enrichment
- The agent can produce better personalization than Clay because it has full workspace ICP context
- Cold email framework document defines signal layers (Company Fundamentals → Decision-Maker Readiness → Timing Triggers) and 4-tier lead qualification
- Person model is workspace-agnostic (unique by email) with PersonWorkspace junction for per-workspace metadata
- Firecrawl already integrated for website scraping — can be reused for prospect research

## Constraints

- **Stack**: Next.js 16, Prisma 6, PostgreSQL (Neon), Vercel — must stay consistent with existing codebase
- **Agent pattern**: Must follow existing agent architecture (config + runner + tools pattern)
- **Extensibility**: Enrichment provider integration must be pluggable — new APIs can be added without restructuring
- **Cost awareness**: External API calls cost money — agent should be smart about when and what to enrich
- **Data model**: Leverage existing Person/Company models, extend rather than replace

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Replace Clay with agent-driven pipeline | Agent has better ICP context, reduces external dependency and cost | — Pending |
| Provider-agnostic enrichment architecture | Future-proof against API changes, easy to add new providers | — Pending |
| Dashboard UI for lead approval | Human-in-the-loop before leads enter campaigns | — Pending |
| Use SerperDev for prospect research | Google search API for finding companies by signals, cost-effective | — Pending |

---
*Last updated: 2026-02-26 after milestone v1.0 initialization*
