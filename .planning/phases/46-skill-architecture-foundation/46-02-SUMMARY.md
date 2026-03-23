---
phase: 46-skill-architecture-foundation
plan: "02"
subsystem: agents
tags: [nova, cli-skills, rules-architecture, dual-mode, loadRules]
dependency_graph:
  requires: []
  provides:
    - .claude/rules/ shared rules directory (single source of truth for all agent behavioral rules)
    - loadRules() utility for API agents to reference shared rules at runtime
    - .nova/ARCHITECTURE.md locked dual-mode strategy documentation
  affects:
    - src/lib/agents/writer.ts
    - src/lib/agents/leads.ts
    - src/lib/agents/orchestrator.ts
    - src/lib/agents/campaign.ts
    - src/lib/agents/research.ts
tech_stack:
  added:
    - loadRules utility (Node.js fs.readFileSync, deferred to invocation time)
    - .claude/rules/ markdown rules files pattern
    - .nova/ directory for Nova CLI agent team architecture docs
  patterns:
    - Dual-mode rules sharing: CLI skills use ! include syntax, API agents use loadRules()
    - Rules files as single source of truth — no hardcoded prompt blocks in TypeScript
    - PROJECT_ROOT env var fallback for compiled dist/cli/ context
key_files:
  created:
    - src/lib/agents/load-rules.ts
    - .claude/rules/writer-rules.md
    - .claude/rules/leads-rules.md
    - .claude/rules/campaign-rules.md
    - .claude/rules/research-rules.md
    - .claude/rules/deliverability-rules.md
    - .claude/rules/onboarding-rules.md
    - .claude/rules/intelligence-rules.md
    - .nova/ARCHITECTURE.md
  modified:
    - src/lib/agents/writer.ts
    - src/lib/agents/leads.ts
    - src/lib/agents/orchestrator.ts
    - src/lib/agents/campaign.ts
    - src/lib/agents/research.ts
decisions:
  - "Dual-mode strategy locked: .claude/rules/ is single source of truth for both CLI skills (via ! include) and API agents (via loadRules) — zero drift by design"
  - "loadRules reads at invocation time (not module top level) so prompt construction always picks up latest file content"
  - "USER_INPUT_GUARD kept in agent TypeScript configs, not in rules files — it is a security boundary not a behavioral rule"
  - "writer-rules.md exceeds 200 lines due to copy quality detail — acceptable for now, Phase 49 can split"
  - "campaign-rules.md combines orchestrator + campaign behavioral rules — they serve the same workflow"
metrics:
  duration: "14 minutes"
  completed_date: "2026-03-23"
  tasks_completed: 2
  files_created: 9
  files_modified: 5
---

# Phase 46 Plan 02: Shared Rules Architecture Summary

Established `.claude/rules/` as the single source of truth for all Nova agent behavioral rules, with `loadRules()` utility enabling API agents to load rules at runtime and CLI skills to include them via `!` syntax — zero drift between execution modes.

## What Was Built

### Task 1: loadRules Utility + Rules Files

**`src/lib/agents/load-rules.ts`**: Exports `loadRules(filename)` that resolves `.claude/rules/{filename}` relative to project root. Uses `PROJECT_ROOT` env var as fallback for compiled `dist/cli/` context. Reads at invocation time (not module load). Graceful degradation on missing files (warns + returns empty string).

**`.claude/rules/` directory** with 7 files:
- 4 extracted from existing agents: writer, leads, campaign (combines orchestrator+campaign), research
- 3 stubs for Phase 49 agents: deliverability, onboarding, intelligence

**4 agent TypeScript files refactored**: writer.ts, leads.ts, orchestrator.ts, campaign.ts, research.ts all now use `${loadRules('X-rules.md')}` in their system prompt constants instead of hardcoded behavioral rules blocks.

### Task 2: ARCHITECTURE.md

**`.nova/ARCHITECTURE.md`**: 164-line reference document locking the dual-mode strategy as a project decision. Contains:
- Two-mode table (CLI skills = $0 cost, API agents = ~$15/MTok)
- Dual-mode strategy section marked LOCKED DECISION with zero-drift guarantee
- Secret handling rules (.claudeignore, sanitize-output.ts, PII not stripped)
- 200-line skill content budget with enforcement mechanism
- Skill registry: 8 Nova commands with roles
- Memory namespace preview (Phase 47)
- Complete v7.0 directory structure

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check

### Files exist
- `src/lib/agents/load-rules.ts` — FOUND
- `.claude/rules/writer-rules.md` — FOUND
- `.claude/rules/leads-rules.md` — FOUND
- `.claude/rules/campaign-rules.md` — FOUND
- `.claude/rules/research-rules.md` — FOUND
- `.claude/rules/deliverability-rules.md` — FOUND
- `.claude/rules/onboarding-rules.md` — FOUND
- `.claude/rules/intelligence-rules.md` — FOUND
- `.nova/ARCHITECTURE.md` — FOUND

### Commits exist
- `50d6e5f0` — feat(46-02): create loadRules utility and shared rules architecture
- `27b131cc` — feat(46-02): create ARCHITECTURE.md locking dual-mode strategy and skill budget

### Verification
- `loadRules('writer-rules.md')` returns 15,401 chars — PASS
- All 7 rules files non-empty — PASS
- All 5 agent TS files import loadRules — PASS
- ARCHITECTURE.md has dual-mode, 200-line, LOCKED keywords — PASS
- USER_INPUT_GUARD in all 5 agent configs (not in rules files) — PASS

## Self-Check: PASSED
