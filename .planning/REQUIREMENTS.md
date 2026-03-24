# Requirements: Outsignal Lead Engine — v7.0

**Defined:** 2026-03-23
**Core Value:** Convert Nova agents from paid API calls to Claude Code CLI skills with persistent client-specific memory, eliminating Opus API costs while accumulating intelligence per workspace.

## v7.0 Requirements

### Security & Architecture

- [x] **SEC-01**: `.claudeignore` prevents `.env*` files and secrets from being loaded into agent context
- [x] **SEC-02**: `sanitize-output.ts` utility strips credentials, DB URLs, and API keys from all CLI wrapper stdout
- [x] **SEC-03**: Skill content budget documented and enforced (200-line max per skill file)
- [x] **SEC-04**: Dual-mode strategy decided and documented (shared rules vs time-boxed fallback)
- [x] **SEC-05**: `.claude/rules/` directory houses shared behavioral rules importable by both CLI skills and API agents

### Client Memory

- [x] **MEM-01**: Per-workspace memory directory structure exists for all 8 client workspaces (`.nova/memory/{slug}/`)
- [x] **MEM-02**: Memory schema defined with named sections (profile, tone, icp-learnings, copy-wins, campaign-history, feedback, approval-patterns)
- [x] **MEM-03**: All 8 workspace memory files seeded with initial content from existing DB fields (ICP, tone prompt, recent campaigns)
- [x] **MEM-04**: Memory files gitignored with directory structure preserved via `.gitkeep`
- [x] **MEM-05**: Memory read at skill invocation start via shell injection — every session is client-aware from first turn
- [x] **MEM-06**: Memory accumulation instructions wired into all specialist skills — agents write learnings after sessions
- [x] **MEM-07**: Approval pattern tracking in per-client feedback memory (what copy/leads the client approved or rejected)
- [x] **MEM-08**: Cross-client global learning namespace (`global-insights.md`) for patterns that apply across all workspaces

### CLI Wrappers

- [x] **CLI-01**: `scripts/cli/` wrapper scripts created for tool functions across all 7 agents (workspace-get, campaign-list, people-search, kb-search, campaign-performance, workspace-intelligence, sequence-steps, existing-drafts, campaign-context, save-sequence, sender-health, domain-health, bounce-stats, inbox-status, workspace-create, member-invite, notification-health, cached-metrics, insight-list)
- [x] **CLI-02**: All wrapper scripts compiled to `dist/cli/*.js` to avoid npx tsx cold-start latency
- [x] **CLI-03**: All wrapper scripts import and apply `sanitize-output.ts` to stdout
- [x] **CLI-04**: Each wrapper script independently testable via `node dist/cli/<script>.js <args>`

### Skill Definitions

- [x] **SKL-01**: `nova-writer.md` skill file with writer agent prompt, tool invocation instructions, and memory read/write rules
- [x] **SKL-02**: `nova-research.md` skill file with research agent prompt and tool invocation instructions
- [x] **SKL-03**: `nova-leads.md` skill file with leads agent prompt and tool invocation instructions
- [x] **SKL-04**: `nova-campaign.md` skill file with campaign agent prompt and tool invocation instructions
- [ ] **SKL-05**: `nova-deliverability.md` skill file for inbox health monitoring, domain diagnostics, warmup strategy, and sender rotation recommendations
- [ ] **SKL-06**: `nova-onboarding.md` skill file for new client workspace setup, domain configuration, inbox provisioning, and initial campaign scaffolding
- [ ] **SKL-07**: `nova-intelligence.md` skill file for analytics, cross-client benchmarking, performance insights, and campaign analysis
- [ ] **SKL-08**: Existing `nova.md` updated with memory injection via `!` syntax and delegation to all 7 specialist skills
- [x] **SKL-09**: All skill files within 200-line budget with overflow content in `.claude/rules/` reference files

### Dashboard Bridge

- [ ] **BRG-01**: Dashboard chat delegates to CLI agents for writer and orchestrator paths
- [ ] **BRG-02**: API agent fallback preserved and verified working when `USE_CLI_AGENTS=false`
- [ ] **BRG-03**: Dashboard bridge extended to all 7 specialist agents
- [ ] **BRG-04**: `cli-spawn.ts` utility handles subprocess creation, 300s timeout, stdout buffering, error translation
- [ ] **BRG-05**: AgentRun audit logging preserved for CLI-invoked agent sessions

### Validation

- [ ] **VAL-01**: End-to-end campaign generation session tested via CLI (research → leads → writer → campaign)
- [ ] **VAL-02**: Dashboard chat verified working with CLI delegation enabled
- [ ] **VAL-03**: API fallback verified working with `USE_CLI_AGENTS=false`
- [ ] **VAL-04**: Memory accumulation verified — run 2+ sessions and confirm memory files grow with relevant intelligence
- [ ] **VAL-05**: No context overflow during full orchestrated session with memory loaded

## Future Requirements

### Memory Intelligence (v7.1+)

- **MINT-01**: Copy wins feedback loop — correlate campaign metrics with copy patterns stored in memory
- **MINT-02**: Memory-driven copy strategy auto-selection based on historical approval patterns
- **MINT-03**: Automated memory pruning beyond inline agent instructions (staleness detection, dedup)
- **MINT-04**: Memory search/query tool for agents to find specific past learnings

## Out of Scope

| Feature | Reason |
|---------|--------|
| Delete existing API agent code | Kept as fallback per user decision — evaluate deletion after 30 days of stable CLI usage |
| Database-backed memory | Flat files are simpler, inspectable, correctable by admin. DB adds operational overhead without clear benefit |
| Custom agent runtime | Claude Code's skill system + Agent tool handles all orchestration needs |
| Real-time memory sync across machines | Gitignored memory is machine-local by design. Backup via separate mechanism if needed |
| Signal campaign runtime conversion | Signal auto-fire stays on lightweight Haiku API — only setup/copy moves to CLI |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SEC-01 | Phase 46 | Complete |
| SEC-02 | Phase 46 | Complete |
| SEC-03 | Phase 46 | Complete |
| SEC-04 | Phase 46 | Complete |
| SEC-05 | Phase 46 | Complete |
| MEM-01 | Phase 47 | Complete |
| MEM-02 | Phase 47 | Complete |
| MEM-03 | Phase 47 | Complete |
| MEM-04 | Phase 47 | Complete |
| MEM-05 | Phase 47 | Complete |
| MEM-06 | Phase 47 | Complete |
| MEM-07 | Phase 47 | Complete |
| MEM-08 | Phase 47 | Complete |
| CLI-01 | Phase 48 | Complete |
| CLI-02 | Phase 48 | Complete |
| CLI-03 | Phase 48 | Complete |
| CLI-04 | Phase 48 | Complete |
| SKL-01 | Phase 49 | Complete |
| SKL-02 | Phase 49 | Complete |
| SKL-03 | Phase 49 | Complete |
| SKL-04 | Phase 49 | Complete |
| SKL-05 | Phase 49 | Pending |
| SKL-06 | Phase 49 | Pending |
| SKL-07 | Phase 49 | Pending |
| SKL-08 | Phase 49 | Pending |
| SKL-09 | Phase 49 | Complete |
| BRG-01 | Phase 50 | Pending |
| BRG-02 | Phase 50 | Pending |
| BRG-03 | Phase 50 | Pending |
| BRG-04 | Phase 50 | Pending |
| BRG-05 | Phase 50 | Pending |
| VAL-01 | Phase 51 | Pending |
| VAL-02 | Phase 51 | Pending |
| VAL-03 | Phase 51 | Pending |
| VAL-04 | Phase 51 | Pending |
| VAL-05 | Phase 51 | Pending |

**Coverage:**
- v7.0 requirements: 36 total
- Mapped to phases: 36
- Unmapped: 0

---
*Requirements defined: 2026-03-23*
*Last updated: 2026-03-23 after initial definition*
