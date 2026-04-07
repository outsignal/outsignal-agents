# Requirements: v9.0 Monty — Platform Engineering Agent Team

**Defined:** 2026-04-03
**Core Value:** Build a Dev Orchestrator team (Monty) that handles all platform engineering work with clear structural boundary from Nova (campaign ops), preventing PM bypass violations and ensuring quality gates on all code changes.

## v9.0 Requirements

### Foundation

- [x] **FOUND-01**: `.monty/memory/` namespace exists with seed files (backlog.json, decisions.md, incidents.md, architecture.md, security.md)
- [x] **FOUND-02**: Memory seed script (`scripts/monty-memory.ts`) creates initial memory structure
- [x] **FOUND-03**: `loadMemoryContext()` in memory.ts accepts optional `memoryRoot` parameter (defaults to `.nova/memory`, Monty passes `.monty/memory`)
- [x] **FOUND-04**: `scripts/dev-cli/*.ts` tool wrapper directory exists with shared harness pattern matching Nova's `scripts/cli/`
- [x] **FOUND-05**: Rules files created for each agent (`.claude/rules/monty-orchestrator-rules.md`, `monty-dev-rules.md`, `monty-qa-rules.md`, `monty-security-rules.md`)
- [x] **FOUND-06**: Boundary enforcement via tool scoping — Monty orchestratorTools contains NONE of Nova's delegation tools, Nova orchestratorTools contains NONE of Monty's
- [x] **FOUND-07**: Both Nova and Monty orchestrator system prompts include boundary check — reject misrouted tasks with explanation and route suggestion
- [x] **FOUND-08**: Boundary rejections written to memory (`.monty/memory/decisions.md` or `.nova/memory/global-insights.md`) so orchestrators learn what is/isn't their domain
- [x] **FOUND-09**: Cross-team notification system — Monty agents write platform changes to `.nova/memory/global-insights.md`, Nova agents write platform issues to `.monty/memory/incidents.md`
- [x] **FOUND-10**: Monty Radar polls cross-team memory files hourly for new entries — alerts user via ntfy/Slack with which orchestrator is being notified and a summary of the update (e.g., "Notifying Nova Orchestrator: enrichment decoupled from discovery — adapters no longer run inline enrichment"), AND triggers the receiving team's orchestrator to read and acknowledge the update

### Dev Orchestrator (PM)

- [x] **ORCH-01**: Triage incoming work as bug / feature / improvement with severity/priority classification
- [x] **ORCH-02**: Route to correct specialist via delegation tools (delegateToDevAgent, delegateToQA, delegateToSecurity)
- [x] **ORCH-03**: Maintain backlog in `.monty/memory/backlog.json` — capture, prioritise, track status of future work
- [x] **ORCH-04**: Sequential quality pipeline enforcement — Dev Generalist output reviewed by QA before deploy, auth-touching changes reviewed by Security
- [x] **ORCH-05**: Pre-approval gate — state what's about to happen, estimate impact, wait for human approval before execution
- [x] **ORCH-06**: `scripts/monty.ts` CLI entry point (interactive chat, matching `scripts/chat.ts` pattern)
- [x] **ORCH-07**: AgentConfig with name, model, systemPrompt (from rules file), tools, maxSteps, onComplete hook
- [x] **ORCH-08**: onComplete writes session summary to `.monty/memory/decisions.md`

### Dev Generalist Agent

- [x] **DEV-01**: Backend work — API routes, Prisma schema/queries, server logic, Trigger.dev tasks
- [x] **DEV-02**: Frontend/UI work — React components, pages, design system, uses UI UX Pro Max skill
- [x] **DEV-03**: Infrastructure work — deploy config, Railway, Vercel, Trigger.dev configuration, DNS
- [x] **DEV-04**: Action tier model — read-only operations always allowed, reversible operations logged, destructive/gated operations require explicit approval
- [x] **DEV-05**: Memory-informed — reads past decisions, incidents, architecture patterns from `.monty/memory/` before acting
- [x] **DEV-06**: Automatically notifies Nova about platform changes via `.nova/memory/global-insights.md` — Nova reads this on every session so cross-team awareness is automatic. Actual rules/tools edits remain a PM decision.
- [x] **DEV-09**: Writes platform change notifications to `.nova/memory/global-insights.md` when changes affect Nova agent behaviour (e.g., "Enrichment decoupled from discovery — adapters no longer run inline enrichment")
- [x] **DEV-07**: AgentConfig with tools wrapping `scripts/dev-cli/*.ts` commands
- [x] **DEV-08**: onComplete writes what was changed and why to `.monty/memory/decisions.md`

### QA Agent

- [x] **QA-01**: Code review — TypeScript compilation check, pattern consistency with existing codebase, banned pattern detection
- [x] **QA-02**: Adversarial review — minimum 3 findings per review, actively looks for problems (not just confirmation)
- [x] **QA-03**: Test validation — run existing tests (`vitest`), verify changes don't break existing functionality
- [x] **QA-04**: Review API integrations for pagination handling, error handling, and rate limit compliance
- [x] **QA-05**: Detect dead code paths — endpoints with no callers, functions with no imports, orphaned files
- [x] **QA-06**: AgentConfig with review tools
- [x] **QA-07**: onComplete writes review findings to `.monty/memory/incidents.md` if issues found
- [x] **QA-08**: Writes to `.nova/memory/global-insights.md` when QA findings affect Nova agent behaviour

### Security Agent

- [x] **SEC-01**: OWASP Top 10:2025 compliance check on code changes touching auth, input handling, or data access
- [x] **SEC-02**: Credential exposure detection — scan for hardcoded secrets, API keys in source, `.env` values in logs
- [x] **SEC-03**: Auth flow review — authentication, session handling, API key management, token storage
- [x] **SEC-04**: On-call gate — changes touching auth/credentials/session management are blocked until Security Agent reviews
- [x] **SEC-05**: AgentConfig with security scanning tools (npm audit, eslint-plugin-security if ESLint v9 compatible)
- [x] **SEC-06**: onComplete writes security findings to `.monty/memory/security.md`
- [x] **SEC-07**: Writes to `.nova/memory/global-insights.md` when security findings affect Nova agent behaviour (e.g., API key rotation, auth flow changes)

## Data Consistency Requirements

- [x] **CONSIST-01**: LinkedIn stats (KPIs + time-series) use `LinkedInDailyUsage` table in admin dashboard — replace `LinkedInAction` queries
- [x] **CONSIST-02**: Email "Sent" count uses EmailBison API `getWorkspaceStats()` as primary source with `WebhookEvent` fallback in admin dashboard
- [x] **CONSIST-03**: Reply count uses `Reply` table (direction=inbound) everywhere — admin dashboard stops counting WebhookEvents as replies
- [x] **CONSIST-04**: Reply rate formula is `replies / sent * 100` in portal analytics — stops dividing by total people
- [x] **CONSIST-05**: Bounce rate warning threshold aligned to >2% warning, >5% critical across portal and admin
- [x] **CONSIST-06**: "Connections Made" on portal dashboard uses `connectionsAccepted` from LinkedInDailyUsage, not `connectionsSent`
- [x] **CONSIST-07**: Admin workspace overview shows period-filtered stats (7/14/30/90 days with selector) instead of all-time campaign totals

## Future Requirements

- **FUT-01**: Split Dev Generalist into Backend + Frontend/UI + Infrastructure specialists if generalist becomes a bottleneck
- **FUT-02**: Automated regression test generation after QA reviews
- **FUT-03**: Integration with GitHub Issues / Linear for external backlog sync
- **FUT-04**: Cross-team orchestration — Monty Dev Agent automatically updates Nova rules when platform changes affect agents

## Out of Scope

| Feature | Reason |
|---------|--------|
| CI/CD pipeline automation | Overkill for current scale — manual deploy with human approval is safer |
| Autonomous deploys | Non-negotiable — human approval required before every deploy (Vercel Pro credits) |
| Replicate GSD planning | GSD already handles phased planning — Monty handles execution within phases |
| Nova agent modification | Monty builds platform, Nova handles campaigns — structural boundary |
| Database migration automation | Too risky for autonomous agents — manual Prisma migrations only |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 | Phase 62 | Complete |
| FOUND-02 | Phase 62 | Complete |
| FOUND-03 | Phase 62 | Complete |
| FOUND-04 | Phase 62 | Complete |
| FOUND-05 | Phase 62 | Complete |
| FOUND-06 | Phase 62 | Complete |
| FOUND-07 | Phase 62 | Complete |
| FOUND-08 | Phase 62 | Complete |
| FOUND-09 | Phase 67 | Complete |
| FOUND-10 | Phase 67 | Complete |
| ORCH-01 | Phase 64 | Complete |
| ORCH-02 | Phase 64 | Complete |
| ORCH-03 | Phase 64 | Complete |
| ORCH-04 | Phase 64 | Complete |
| ORCH-05 | Phase 64 | Complete |
| ORCH-06 | Phase 63 | Complete |
| ORCH-07 | Phase 64 | Complete |
| ORCH-08 | Phase 64 | Complete |
| DEV-01 | Phase 64 | Complete |
| DEV-02 | Phase 64 | Complete |
| DEV-03 | Phase 64 | Complete |
| DEV-04 | Phase 64 | Complete |
| DEV-05 | Phase 64 | Complete |
| DEV-06 | Phase 64 | Complete |
| DEV-07 | Phase 63 | Complete |
| DEV-08 | Phase 64 | Complete |
| DEV-09 | Phase 64 | Complete |
| QA-01 | Phase 65 | Complete |
| QA-02 | Phase 65 | Complete |
| QA-03 | Phase 65 | Complete |
| QA-04 | Phase 65 | Complete |
| QA-05 | Phase 65 | Complete |
| QA-06 | Phase 65 | Complete |
| QA-07 | Phase 65 | Complete |
| QA-08 | Phase 65 | Complete |
| SEC-01 | Phase 66 | Complete |
| SEC-02 | Phase 66 | Complete |
| SEC-03 | Phase 66 | Complete |
| SEC-04 | Phase 66 | Complete |
| SEC-05 | Phase 66 | Complete |
| SEC-06 | Phase 66 | Complete |
| SEC-07 | Phase 66 | Complete |
| CONSIST-01 | Phase 69 | Planned |
| CONSIST-02 | Phase 69 | Planned |
| CONSIST-03 | Phase 69 | Planned |
| CONSIST-04 | Phase 69 | Planned |
| CONSIST-05 | Phase 69 | Planned |
| CONSIST-06 | Phase 69 | Planned |
| CONSIST-07 | Phase 69 | Planned |

**Coverage:**
- v9.0 requirements: 42 total (complete)
- Data consistency requirements: 7 total (planned)
- Mapped to phases: 49
- Unmapped: 0

---
*Requirements defined: 2026-04-03*
*Last updated: 2026-04-07 after Phase 69 planning*
