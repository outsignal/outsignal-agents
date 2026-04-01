---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: Agent Quality Overhaul
status: unknown
last_updated: "2026-04-01T18:57:36.138Z"
progress:
  total_phases: 59
  completed_phases: 57
  total_plans: 166
  completed_plans: 167
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-30)

**Core value:** Make agent team produce campaign-ready output without manual QA — expert lead sourcing, first-time-right copy, validated pipeline.
**Current focus:** v8.0 Phase 60 — Intelligence Closed Loop

## Current Position

Phase: 61 of 61 (Complete Agent Memory Coverage)
Plan: 2 of 2 complete
Status: Phase Complete
Last activity: 2026-04-01 — 61-02 wire orchestrator delegation + chat.ts memory writes

Progress: [████░░░░░░] ~45% (4.5/7 phases)

## Performance Metrics

**Velocity:**
- Total plans completed: 114 (v1.0-v7.0 across 51 phases + 52-01, 52-02)
- Average duration: ~15 min
- Total execution time: ~28 hours

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 52    | 01   | 3min     | 1     | 2     |
| 52    | 02   | 2min     | 2     | 7     |
| 54.1  | 01   | 1min     | 2     | 3     |
| 54.1  | 02   | 2min     | 2     | 4     |

**Recent Trend:**
- v7.0 (6 phases, 46-51) shipped cleanly; Nova CLI agent teams live
- Trend: Stable

*Updated after each plan completion*
| 59    | 01   | 3min     | 2     | 2     |
| Phase 59 P02 | 2min | 2 tasks | 3 files |
| 60    | 01   | 4min     | 2     | 3     |
| 60    | 02   | 4min     | 2     | 3     |
| 60    | 03   | 5min     | 3     | 3     |
| 61    | 01   | 4min     | 2     | 4     |
| 61    | 02   | 4min     | 2     | 2     |

## Accumulated Context

### Decisions

Key v8.0 pre-milestone decisions:
- [v8.0]: Leads agent quality is TOP PRIORITY — $100 burnt on junk data, zero usable leads
- [v8.0]: Extend copy-quality.ts first (zero risk, unblocks validator) — research confirmed
- [v8.0]: Platform expertise goes in leads-rules.md (text edits, immediate startup load via loadRules())
- [v8.0]: Validator agent uses Opus 4.6 via Claude Code CLI (per CROSS-01) — stateless, best model for semantic quality detection
- [v8.0]: Writer retry loop: max 2 validation retries, carry-forward context, escalate to admin on failure
- [v8.0]: Word count thresholds tiered by strategy: PVP 70, Creative Ideas 90, One-liner 50, LinkedIn 100
- [v8.0]: CROSS-01 (Opus 4.6 everywhere) in Phase 52 alongside copy-quality.ts — improves everything downstream
- [v8.0]: BounceBan adapter deferred to v8.2 — LEAD-06 uses routing logic only, not full adapter
- [Phase 52]: NOVA_MODEL constant in types.ts for centralised model management across all agents
- [Phase 52]: BANNED_CTA_PATTERNS kept internal to checkCTAFormat; word-boundary free pattern avoids false positives
- [Phase 54.1]: appendToMemory never throws -- best-effort with console warnings on failure
- [Phase 54.1]: onComplete hook runs in success path only, wrapped in own try/catch
- [Phase 54.1]: MemoryFile type excludes profile.md (seed-only per governance rules)
- [Phase 54.1]: Writer/campaign -> campaigns.md, leads/research -> learnings.md (per governance rules)
- [Phase 54.1]: Campaign hook skips noisy list/get/unknown actions to avoid filling 200-line cap
- [Phase 59]: Memory files (.nova/memory/) are gitignored by design -- cleanup is local-only, isValidEntry() guard in source prevents future corruption
- [Phase 59-01]: Memory loaded in parallel via Promise.all for all 3 layers
- [Phase 59-01]: XML-style tags for context delimitation, centralized injection in runner.ts
- [Phase 59-01]: Seed-only files detected via hasRealEntries() regex and skipped
- [Phase 60-01]: Standalone backfill script (not extending backfill-all-replies.ts) for single-purpose clarity
- [Phase 60-01]: In-memory cache per emailBisonCampaignId to avoid repeated EB API calls during backfill
- [Phase 60-01]: Off-by-one position fallback for EB API indexing mismatch
- [Phase 60-02]: appendToGlobalMemory uses bare timestamp prefix (no dash) to match global-insights.md convention
- [Phase 60-02]: Reply analysis queries run in parallel via Promise.all for performance
- [Phase 60-02]: synthesizeInsights returns empty arrays on LLM parse failure (best-effort)
- [Phase 60-03]: Insight DB storage uses real Insight schema (category, observation, evidence JSON, dedupKey) not simplified type/content
- [Phase 60-03]: Hybrid sync pattern: Trigger.dev stores to DB, local sync script pulls to .nova/memory/ files
- [Phase 60-03]: Weekly cron Monday 09:00 UTC via Trigger.dev, after generate-insights at 08:10
- [Phase 61-01]: BounceSnapshot queried by workspaceSlug directly (no Sender relation in schema)
- [Phase 61-01]: Intelligence agent global-insights write gated by keyword heuristic (benchmark, cross-client patterns)
- [Phase 61-01]: memberInvite tool is a stub returning not_yet_implemented (no auth system for invites yet)
- [Phase 61]: delegateTo prefix filter for memory write gating in chat.ts

### Pending Todos

None.

### Roadmap Evolution

- Phase 54.1 inserted after Phase 54: Agent Memory Write-Back (URGENT) — v7.0 gap fix: memory reads/seeds work but writes were never implemented. Agents load memory context but never persist insights after runs. ~100 lines: onComplete post-hook in runner.ts + appendToMemory utility + insight extraction per specialist agent.
- Phase 60 added: Intelligence Closed Loop
- Phase 61 added: Complete Agent Memory Coverage

### Blockers/Concerns

- Phase 55 (Validator Agent) needs Zod schema design decision for ValidationResult before implementation — research flagged this
- Phase 57 (Portal hard-block) requires frontend portal error-state handling — minor but must be planned

## Session Continuity

Last session: 2026-04-01
Stopped at: Completed 61-02-PLAN.md -- orchestrator wiring + chat.ts memory writes (Phase 61 complete)
Resume file: None
