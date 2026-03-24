---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: Trigger.dev Migration — Background Jobs Infrastructure
status: unknown
last_updated: "2026-03-24T08:51:10.165Z"
progress:
  total_phases: 45
  completed_phases: 43
  total_plans: 134
  completed_plans: 135
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-23)

**Core value:** Own the lead data pipeline end-to-end so we never pay for the same lead twice and can cancel the $300+/month Clay subscription.
**Current focus:** v7.0 Phase 49 — Specialist CLI Skill Files

## Current Position

Phase: 49 of 51 (Specialist CLI Skill Files)
Plan: 02 of 3 complete
Status: In progress
Last activity: 2026-03-24 — Phase 49 Plan 02 complete (4 specialist CLI skill files: nova-writer, nova-research, nova-leads, nova-campaign)

Progress: v7.0 [█░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] ~3%

## Performance Metrics

**Velocity:**
- Total plans completed: 112 (v1.0: 22, v1.1: 40, v2.0: 26, v3.0: 16, v4.0: 11, v5.0: 11 + 3 quick tasks)
- Average duration: ~15 min
- Total execution time: ~28 hours

**Recent Trend:**
- v6.0 (8 phases, Phases 38-45) shipped cleanly; Trigger.dev migration complete
- Trend: Stable

*Updated after each plan completion*

## Accumulated Context

### Decisions

Key v7.0 pre-milestone decisions:
- [v7.0 Pre-Milestone]: CLI skills run via Claude Code Max Plan — zero Anthropic API cost vs ~$15/MTok for Opus calls
- [v7.0 Pre-Milestone]: Memory stored as flat markdown files per workspace — not DB-backed; inspectable and correctable by admin
- [v7.0 Pre-Milestone]: Existing API agent code preserved as fallback — controlled via USE_CLI_AGENTS env var, not deleted
- [v7.0 Pre-Milestone]: Signal campaign runtime stays on Haiku API — only setup/copy planning moves to CLI
- [v7.0 Pre-Milestone]: .claudeignore must exist before first CLI agent session — CVE-2025-59536 credential exposure risk
- [v7.0 Pre-Milestone]: Dual-mode strategy decision gates Phase 46 — shared rules vs time-boxed fallback must be locked before any skill file is authored
- [Phase 46]: Secrets-only sanitization scope: PII preserved intentionally
- [Phase 46]: sanitizeOutput is a pure function — no process.env access
- [Phase 46-02]: Dual-mode strategy locked: .claude/rules/ is single source of truth for both CLI skills and API agents
- [Phase 46-02]: loadRules reads at invocation time so prompts always pick up latest rules
- [Phase 46-02]: USER_INPUT_GUARD kept in TS agent configs, not in rules files (security boundary, not behavioral rule)
- [Phase 46-02]: campaign-rules.md combines orchestrator + campaign behavioral rules (same workflow)
- [Phase 47]: profile.md always overwritten on re-seed; other files skip if they exist to preserve accumulated intelligence
- [Phase 47]: Governance headers embedded in every memory file to instruct agents on correct write behavior
- [Phase 47]: Reply rate figures in campaigns.md are raw EmailBison format (values stored as whole-number percentages); no script bug
- [Phase 47]: Vercel Blob backup deferred — removed from ARCHITECTURE.md, not implemented in this phase
- [Phase 48-01]: PROJECT_ROOT set unconditionally in cli-harness.ts before any imports — prevents load-rules.ts __dirname hazard in dist/cli/ context
- [Phase 48-01]: workspace-get uses direct Prisma query (not writer tool) for smoke test — validates pipeline without writer agent complexity
- [Phase 48-01]: tsup esbuildOptions.alias maps '@' to path.resolve(__dirname, 'src') — tsup does not auto-read tsconfig.json paths for bundling
- [Phase 48-02]: writerTools/researchTools/campaignTools imported directly from agent files — guaranteed parity, no logic reimplementation
- [Phase 48-02]: JSON-file input pattern for 6 scripts with complex object inputs — agents write to /tmp/<uuid>.json before calling
- [Phase 48-02]: kb-search is a single shared script for writer/leads/orchestrator agents (searchKnowledgeBase from shared-tools.ts)
- [Phase 48-02]: signal-campaign-pause validates pause|resume enum before calling tool — catches invalid args with clear error before DB call
- [Phase 48-03]: leadsTools exported from leads.ts to enable thin wrappers without reimplementing tool logic
- [Phase 48-03]: Deliverability scripts use direct Prisma queries (not AI SDK tools) — computeDomainRollup, evaluateSender are internal library helpers
- [Phase 48-03]: insight-list lists existing DB records (read-only, no LLM cost) — generateInsights runs via Trigger.dev cron only
- [Phase 49-02]: $ARGUMENTS[0] used for slug in shell injection — first positional token ensures cat paths never contain spaces
- [Phase 49-02]: All 4 memory files injected for every specialist agent — full workspace context per locked research decision
- [Phase 49-02]: Skill file = identity + tools + memory only — behavioral rules overflow to .claude/rules/ via @ reference

### Pending Todos

None.

### Roadmap Evolution

- v7.0 roadmap created 2026-03-23: 6 phases (46-51), 36 requirements mapped
- Phase 46: Skill Architecture Foundation (SEC-01 to SEC-05)
- Phase 47: Client Memory Namespace (MEM-01 to MEM-08)
- Phase 48: CLI Wrapper Scripts (CLI-01 to CLI-04)
- Phase 49: Specialist CLI Skill Files (SKL-01 to SKL-09)
- Phase 50: Orchestrator CLI Spawn Integration (BRG-01 to BRG-05)
- Phase 51: Memory Accumulation and Full Validation (VAL-01 to VAL-05)

### Blockers/Concerns

- Phase 50 (Bridge) needs a planning pass on Trigger.dev task queue pattern for dashboard-to-CLI delegation before implementation — exact task schema and polling mechanism are unspecified
- Phase 48 (Wrappers) pipeline blocker RESOLVED: @/ aliases, Prisma external, dotenv all confirmed working in compiled dist/cli/ output
- Phase 50 (Bridge) needs a planning pass on Trigger.dev task queue pattern for dashboard-to-CLI delegation before implementation — exact task schema and polling mechanism are unspecified

## Session Continuity

Last session: 2026-03-24
Stopped at: Completed 49-02-PLAN.md (4 specialist CLI skill files: nova-writer, nova-research, nova-leads, nova-campaign) — Phase 49 Plan 02 complete
Resume file: None
