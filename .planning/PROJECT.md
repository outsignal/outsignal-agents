# Outsignal Lead Engine

## What This Is

A self-hosted outbound lead engine that replaces Clay for Outsignal's cold outbound operation. Full pipeline from lead discovery through campaign deployment: multi-source lead discovery (Apollo, Prospeo, AI Ark, Exa.ai, Serper.dev, Apify), enrichment waterfall, AI-powered ICP qualification, signal-driven targeting (PredictLeads), Creative Ideas copy generation via CLI agent teams (Nova), client portal with dual approval, auto-deploy to EmailBison + LinkedIn, sender health monitoring, and Chrome extension for LinkedIn cookie management. Nova agents run as Claude Code CLI skills with persistent per-client memory, 55 CLI wrapper scripts, and feature-flagged routing with API fallback. Built on Next.js 16 with Prisma/PostgreSQL, deployed on Vercel.

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
- 10 active client workspaces (Rise, Lime Recruitment, YoopKnows, Outsignal, MyAcq, 1210 Solutions, BlankTag, Covenco, Situ, Ladder Group)
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
- ✓ Reply storage with full body text, AI classification (9-intent taxonomy + sentiment + objection subtype) — v3.0
- ✓ Campaign analytics engine with daily snapshot cron, rankings, per-step analysis, strategy comparison — v3.0
- ✓ Copy performance analysis with AI body element classification, subject line rankings, element correlation multipliers — v3.0
- ✓ Cross-workspace benchmarking with industry reference bands, ICP calibration, signal effectiveness ranking — v3.0
- ✓ AI insight generation (weekly per workspace, 3-5 actionable cards, approve/dismiss/snooze queue) — v3.0
- ✓ Intelligence Hub dashboard with bento grid, KPI row, donut charts, mini gauges, enhanced weekly digest — v3.0
- ✓ .claudeignore + sanitize-output.ts protecting secrets/credentials from CLI agent context — v7.0
- ✓ Shared rules architecture (.claude/rules/) — 7 specialist rule files governing agent behaviour — v7.0
- ✓ Per-workspace flat-file memory namespace (.nova/memory/{slug}/) with profile, campaigns, feedback, learnings files — v7.0
- ✓ 55 CLI wrapper scripts (scripts/cli/) with tsup build pipeline exposing DB, EmailBison, discovery, KB tools to agents — v7.0
- ✓ 8 Claude Code skill files (orchestrator + 7 specialists: writer, research, campaign, leads, deliverability, intelligence, onboarding) — v7.0
- ✓ cli-spawn.ts with feature-flagged routing (NOVA_CLI_ENABLED) + Anthropic API fallback — v7.0
- ✓ Memory accumulation validated against Rise — persistent client-specific intelligence across sessions, ~11,500 token budget — v7.0

### Active

<!-- Next milestone TBD — see /gsd:new-milestone -->

### Future

- [ ] Multi-source lead discovery (Apollo, Prospeo Search, AI Ark Search, Exa.ai, Serper.dev, Apify LinkedIn)
- [ ] Agent-driven source selection based on ICP type (enterprise vs niche vs local vs ultra-niche)
- [ ] Signal monitoring via PredictLeads (job changes, funding, hiring spikes, tech adoption, company news)
- [ ] Social listening via Serper.dev (Reddit/Twitter competitor mentions)
- [ ] Evergreen signal campaigns with auto-pipeline (signal → enrich → score → campaign → copy → portal)
- [ ] Creative Ideas copy framework (3 constrained, personalized ideas per prospect)
- [ ] Per-client Creative Ideas examples (AI-generated drafts, admin review, KB-tagged)
- [ ] Custom directory scraping via Firecrawl for niche lists
- [ ] Signal dashboard (live feed, per-client breakdown, cost tracking, long-term data collection)
- [ ] Knowledge base tool added to Research Agent
- [ ] Enrichment waterfall reordered to actual cheapest-first

### Out of Scope

- First-party website visitor identification (RB2B, Warmly, Vector, Trigify — requires pixel/JS install on client sites)
- Domain infrastructure management — monitoring only, not replacing PlusVibe for provisioning
- CRM integration (HubSpot) — not needed, EmailBison is the system of record
- Replacing EmailBison as sending infrastructure
- Per-lead approve/reject in portal — binary list-level approval only
- FullEnrich — redundant, we have our own enrichment waterfall
- StoreLeads — $75-950/mo, Serper.dev covers ecommerce discovery via Google queries
- Campaign builder UI — all campaign operations through Nova CLI agent teams (Cmd+J / CLI skills)

## Current Milestone

Next milestone TBD — see `/gsd:new-milestone`. v7.0 Nova CLI Agent Teams shipped 2026-03-24.

## Current State

**Shipped:** v7.0 Nova CLI Agent Teams (2026-03-24) — 6 phases (46-51), CLI agent architecture with persistent memory
**Previous:** v3.0 Campaign Intelligence Hub (2026-03-10), v2.0 Lead Discovery & Intelligence (2026-03-04), v1.1 Outbound Pipeline (2026-03-03), v1.0 Lead Engine (2026-02-27)

**Codebase:** ~146,700 LOC TypeScript/TSX across 940+ files
**Stack:** Next.js 16, Prisma 6, PostgreSQL (Neon), Vercel, Railway (LinkedIn worker)
**Data:** 14,563 people, 16,941 companies, 10 client workspaces
**Nova agents:** 7 specialist skills + orchestrator, 55 CLI wrapper scripts, 10 workspace memory namespaces
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
| Keep Clay running during transition | De-risk migration, fall back if new pipeline has gaps | ✓ Done — Clay cancelled 2026-03-18, own pipeline fully operational |
| Provider-agnostic enrichment architecture | Future-proof against API changes, easy to add new providers | ✓ Good — adapter types, easy to swap |
| db push over migrate dev | No migration history, 14k+ records, db push is safer | ✓ Good — used consistently across all 7 phases |
| TargetList model for lists | Junction table over PersonWorkspace.tags for proper relational modeling | ✓ Good — clean export path, MCP consistent |
| Hard email verification gate | No unverified emails ever exported — strict deliverability policy | ✓ Good — prevents sending to invalid addresses |
| Campaign as first-class entity | Owns leads (TargetList) + content (email/LinkedIn sequences) + deploy tracking | ✓ Good — clean separation, supports multi-channel |
| AI agents via Claude Code, not dashboard | Avoids Anthropic API costs — Claude Code Max Plan covers it | ✓ Good — saves $300+/mo in API costs |
| Dual approval (leads + content separate) | Clients review independently, deploy on both approved | ✓ Good — flexible approval workflow |
| Voyager API over browser automation | HTTP calls safer than headless Chrome for LinkedIn | ✓ Good — lower detection risk |
| Chrome extension for cookie capture | One-click LinkedIn connect, no DevTools needed | ✓ Good — reduces friction for clients |

| Daily CachedMetrics snapshots over real-time queries | Pre-compute avoids slow analytics queries, 60s cron on Vercel | ✓ Good — fast dashboard loads |
| AI classification via Haiku (generateObject + Zod) | Structured output, cheap, type-safe, consistent | ✓ Good — reply + body element + insight classification all use this |
| Bento grid Intelligence Hub as separate page | Executive summary page linking to analytics tabs for detail | ✓ Good — clean separation of overview vs deep-dive |
| Hardcoded industry benchmarks per vertical | Only 1 workspace per vertical, not enough data for computed averages | ✓ Good — easy to update later with real data |
| Insight dedup with 2-week window | Prevents spamming admin with same insight, but allows recurrence | ✓ Good — balances freshness with noise reduction |
| CLI skills over Anthropic API for agents | Claude Code Max Plan covers compute — saves $300+/mo in API costs, enables persistent memory | ✓ Good — 7 specialists + orchestrator shipped, API fallback preserved |
| Per-workspace flat-file memory (.nova/memory/{slug}/) | Agents need client-specific context (tone, wins, ICP learnings) that persists across sessions | ✓ Good — validated on Rise, memory accumulates, ~11,500 token budget |
| 55 CLI wrapper scripts via tsup build pipeline | Agents need DB/API access but cannot import app code directly — thin Bash-callable wrappers | ✓ Good — clean separation, sanitize-output.ts strips secrets |
| Feature-flagged routing (NOVA_CLI_ENABLED) | Gradual rollout, API fallback if CLI fails, zero-downtime migration path | ✓ Good — cli-spawn.ts routes per-flag, existing API code untouched |
| .claudeignore + sanitize-output.ts for security | CLI agents must not see .env, credentials, or raw DB connection strings | ✓ Good — defence in depth, output sanitisation as safety net |
| Shared rules architecture (.claude/rules/) | Consistent agent behaviour without duplicating instructions across skills | ✓ Good — 7 rule files, memory write governance per agent |
| Multi-source discovery over single-provider | No single provider has all leads — agent picks best source per ICP type | — Pending |
| Exa.ai for semantic company search | Replaces Disco/Ocean.io lookalikes, more flexible, API-first, MCP server | — Pending |
| Signals for timing not hooks | Everyone sends "congrats on funding" — use signals invisibly for targeting, not as email hook | — Pending |
| Creative Ideas framework | Per-client constrained ideas outperform generic signal-based copy (Growth Engine X, 3x reply rates) | — Pending |
| PredictLeads for signal intelligence | API-first, pay-per-use, 5 signal types, 100M companies, designed for agents | — Pending |
| Serper.dev over dedicated scrapers | One provider for Google search + Maps + social monitoring — replaces Apify Maps, StoreLeads | — Pending |
| Railway for signal monitoring | Vercel Hobby 2-cron limit, Railway already running LinkedIn worker, needs continuous background process | — Pending |

---
*Last updated: 2026-03-24 after v7.0 milestone*
