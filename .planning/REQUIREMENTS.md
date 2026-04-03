# Requirements: v9.0 Monty — Platform Engineering Agent Team

**Defined:** 2026-04-03
**Core Value:** Build a Dev Orchestrator team (Monty) that handles all platform engineering work with clear structural boundary from Nova (campaign ops), preventing PM bypass violations and ensuring quality gates on all code changes.

## v9.0 Requirements

### Foundation

- [ ] **FOUND-01**: `.monty/memory/` namespace exists with seed files (backlog.json, decisions.md, incidents.md, architecture.md, security.md)
- [ ] **FOUND-02**: Memory seed script (`scripts/monty-memory.ts`) creates initial memory structure
- [ ] **FOUND-03**: `loadMemoryContext()` in memory.ts accepts optional `memoryRoot` parameter (defaults to `.nova/memory`, Monty passes `.monty/memory`)
- [ ] **FOUND-04**: `scripts/dev-cli/*.ts` tool wrapper directory exists with shared harness pattern matching Nova's `scripts/cli/`
- [ ] **FOUND-05**: Rules files created for each agent (`.claude/rules/monty-orchestrator-rules.md`, `monty-dev-rules.md`, `monty-qa-rules.md`, `monty-security-rules.md`)
- [ ] **FOUND-06**: Boundary enforcement via tool scoping — Monty orchestratorTools contains NONE of Nova's delegation tools, Nova orchestratorTools contains NONE of Monty's
- [ ] **FOUND-07**: Both Nova and Monty orchestrator system prompts include boundary check — reject misrouted tasks with explanation and route suggestion
- [ ] **FOUND-08**: Boundary rejections written to memory (`.monty/memory/decisions.md` or `.nova/memory/global-insights.md`) so orchestrators learn what is/isn't their domain
- [ ] **FOUND-09**: Cross-team notification system — Monty agents write platform changes to `.nova/memory/global-insights.md`, Nova agents write platform issues to `.monty/memory/incidents.md`
- [ ] **FOUND-10**: Monty Radar polls cross-team memory files hourly for new entries — alerts user via ntfy/Slack with which orchestrator is being notified and a summary of the update (e.g., "Notifying Nova Orchestrator: enrichment decoupled from discovery — adapters no longer run inline enrichment"), AND triggers the receiving team's orchestrator to read and acknowledge the update

### Dev Orchestrator (PM)

- [ ] **ORCH-01**: Triage incoming work as bug / feature / improvement with severity/priority classification
- [ ] **ORCH-02**: Route to correct specialist via delegation tools (delegateToDevAgent, delegateToQA, delegateToSecurity)
- [ ] **ORCH-03**: Maintain backlog in `.monty/memory/backlog.json` — capture, prioritise, track status of future work
- [ ] **ORCH-04**: Sequential quality pipeline enforcement — Dev Generalist output reviewed by QA before deploy, auth-touching changes reviewed by Security
- [ ] **ORCH-05**: Pre-approval gate — state what's about to happen, estimate impact, wait for human approval before execution
- [ ] **ORCH-06**: `scripts/monty.ts` CLI entry point (interactive chat, matching `scripts/chat.ts` pattern)
- [ ] **ORCH-07**: AgentConfig with name, model, systemPrompt (from rules file), tools, maxSteps, onComplete hook
- [ ] **ORCH-08**: onComplete writes session summary to `.monty/memory/decisions.md`

### Dev Generalist Agent

- [ ] **DEV-01**: Backend work — API routes, Prisma schema/queries, server logic, Trigger.dev tasks
- [ ] **DEV-02**: Frontend/UI work — React components, pages, design system, uses UI UX Pro Max skill
- [ ] **DEV-03**: Infrastructure work — deploy config, Railway, Vercel, Trigger.dev configuration, DNS
- [ ] **DEV-04**: Action tier model — read-only operations always allowed, reversible operations logged, destructive/gated operations require explicit approval
- [ ] **DEV-05**: Memory-informed — reads past decisions, incidents, architecture patterns from `.monty/memory/` before acting
- [ ] **DEV-06**: Updates affected Nova agent rules files and tools when platform changes impact agent behaviour (e.g., new CLI script → add as agent tool, API change → update adapter)
- [ ] **DEV-09**: Writes platform change notifications to `.nova/memory/global-insights.md` when changes affect Nova agent behaviour (e.g., "Enrichment decoupled from discovery — adapters no longer run inline enrichment")
- [ ] **DEV-07**: AgentConfig with tools wrapping `scripts/dev-cli/*.ts` commands
- [ ] **DEV-08**: onComplete writes what was changed and why to `.monty/memory/decisions.md`

### QA Agent

- [ ] **QA-01**: Code review — TypeScript compilation check, pattern consistency with existing codebase, banned pattern detection
- [ ] **QA-02**: Adversarial review — minimum 3 findings per review, actively looks for problems (not just confirmation)
- [ ] **QA-03**: Test validation — run existing tests (`vitest`), verify changes don't break existing functionality
- [ ] **QA-04**: Review API integrations for pagination handling, error handling, and rate limit compliance
- [ ] **QA-05**: Detect dead code paths — endpoints with no callers, functions with no imports, orphaned files
- [ ] **QA-06**: AgentConfig with review tools
- [ ] **QA-07**: onComplete writes review findings to `.monty/memory/incidents.md` if issues found
- [ ] **QA-08**: Writes to `.nova/memory/global-insights.md` when QA findings affect Nova agent behaviour

### Security Agent

- [ ] **SEC-01**: OWASP Top 10:2025 compliance check on code changes touching auth, input handling, or data access
- [ ] **SEC-02**: Credential exposure detection — scan for hardcoded secrets, API keys in source, `.env` values in logs
- [ ] **SEC-03**: Auth flow review — authentication, session handling, API key management, token storage
- [ ] **SEC-04**: On-call gate — changes touching auth/credentials/session management are blocked until Security Agent reviews
- [ ] **SEC-05**: AgentConfig with security scanning tools (npm audit, eslint-plugin-security if ESLint v9 compatible)
- [ ] **SEC-06**: onComplete writes security findings to `.monty/memory/security.md`
- [ ] **SEC-07**: Writes to `.nova/memory/global-insights.md` when security findings affect Nova agent behaviour (e.g., API key rotation, auth flow changes)

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
| FOUND-01 | Phase 62 | Pending |
| FOUND-02 | Phase 62 | Pending |
| FOUND-03 | Phase 62 | Pending |
| FOUND-04 | Phase 62 | Pending |
| FOUND-05 | Phase 62 | Pending |
| FOUND-06 | Phase 62 | Pending |
| FOUND-07 | Phase 62 | Pending |
| FOUND-08 | Phase 62 | Pending |
| FOUND-09 | Phase 67 | Pending |
| FOUND-10 | Phase 67 | Pending |
| ORCH-01 | Phase 64 | Pending |
| ORCH-02 | Phase 64 | Pending |
| ORCH-03 | Phase 64 | Pending |
| ORCH-04 | Phase 64 | Pending |
| ORCH-05 | Phase 64 | Pending |
| ORCH-06 | Phase 63 | Pending |
| ORCH-07 | Phase 64 | Pending |
| ORCH-08 | Phase 64 | Pending |
| DEV-01 | Phase 64 | Pending |
| DEV-02 | Phase 64 | Pending |
| DEV-03 | Phase 64 | Pending |
| DEV-04 | Phase 64 | Pending |
| DEV-05 | Phase 64 | Pending |
| DEV-06 | Phase 64 | Pending |
| DEV-07 | Phase 63 | Pending |
| DEV-08 | Phase 64 | Pending |
| DEV-09 | Phase 64 | Pending |
| QA-01 | Phase 65 | Pending |
| QA-02 | Phase 65 | Pending |
| QA-03 | Phase 65 | Pending |
| QA-04 | Phase 65 | Pending |
| QA-05 | Phase 65 | Pending |
| QA-06 | Phase 65 | Pending |
| QA-07 | Phase 65 | Pending |
| QA-08 | Phase 65 | Pending |
| SEC-01 | Phase 66 | Pending |
| SEC-02 | Phase 66 | Pending |
| SEC-03 | Phase 66 | Pending |
| SEC-04 | Phase 66 | Pending |
| SEC-05 | Phase 66 | Pending |
| SEC-06 | Phase 66 | Pending |
| SEC-07 | Phase 66 | Pending |

**Coverage:**
- v9.0 requirements: 42 total
- Mapped to phases: 42
- Unmapped: 0

---
*Requirements defined: 2026-04-03*
*Last updated: 2026-04-02 after roadmap creation*
