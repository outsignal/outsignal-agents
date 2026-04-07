---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: Monty — Platform Engineering Agent Team
status: unknown
last_updated: "2026-04-07T13:06:25.035Z"
progress:
  total_phases: 67
  completed_phases: 65
  total_plans: 186
  completed_plans: 187
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-03)

**Core value:** Build a Dev Orchestrator team (Monty) that handles all platform engineering work with clear boundary from Nova (campaign ops).
**Current focus:** v9.0 Phase 63 — Dev CLI Tools & Entry Point

## Current Position

Phase: 70 of 70 (LinkedIn State Machine Sequencing)
Plan: 2 of 3 complete
Status: In Progress
Last activity: 2026-04-07 — Completed 70-02 (Counters, Cancellation, Timeout Verification)

Progress: [██████░░░░] 67%

## Performance Metrics

**Velocity:**
- Total plans completed: 114+ (v1.0-v8.1 across 61 phases)
- Average duration: ~15 min
- Total execution time: ~28+ hours

**Recent Trend:**
- v8.1 (3 phases, 59-61) shipped cleanly; agent memory system live
- Trend: Stable

*Updated after each plan completion*

## Accumulated Context

### Decisions

Key v9.0 execution decisions:
- [62-01]: Monty memory is topic-based (5 global files) vs Nova workspace-slug-based; write path stays Nova-only until Phase 67
- [62-01]: DEFAULT_MEMORY_ROOT rename for clarity; MemoryOptions interface for read-path parameterization
- [62-02]: Rules files mirror Nova pattern but cover platform engineering domain exclusively
- [62-02]: Dev-cli harness is functionally identical to Nova's — namespace separation only
- [62-03]: Monty tools use inputSchema (AI SDK v6) with z.record(z.string(), z.unknown()) for Zod v4 compat
- [62-03]: Bidirectional boundary: Nova rejects platform eng (suggests monty.ts), Monty rejects campaign ops (suggests chat.ts)

Key v9.0 pre-milestone decisions:
- [v9.0]: 4 agents not 5 — Dev Generalist merges Backend+Frontend+Infra; split only if coordination overhead justifies it
- [v9.0]: Boundary enforced by tool surface, not just rules — Nova bypass on 2026-04-02 proves soft rules fail under task pressure
- [v9.0]: Action tier model — Tier 1 read-only (autonomous), Tier 2 reversible (logged), Tier 3 gated (explicit approval)
- [v9.0]: `.monty/memory/` is topic-based (backlog, decisions, incidents, architecture, security), not workspace-slug-based like Nova
- [v9.0]: Zero new npm packages except eslint-plugin-security (dev only, ESLint v9 compat needs verification in Phase 63)
- [v9.0]: Cross-team notifications use existing memory files — no new infrastructure needed
- [Phase 63]: [63-02]: Monty CLI entry point (scripts/monty.ts) uses .monty/memory namespace, no workspace state, sessions saved as agent=monty-orchestrator
- [Phase 63]: [63-01]: 9 dev-cli scripts with runWithHarness envelope; no dotenv except deploy-status; maxBuffer 10MB; simple argv parsing
- [Phase 64]: [64-01]: appendToMontyMemory is workspace-agnostic (topic-based); MontyDevOutput includes affectsNova for cross-team notifications
- [Phase 64]: [64-02]: All 9 dev tools are Tier 1 read-only; tier boundaries enforced in system prompt, not tool restrictions
- [Phase 64]: [64-03]: delegateToDevAgent wraps runMontyDevAgent with error envelope; backlog helpers are module-private; Quality Pipeline logs intent to backlog until QA/Security built
- [Phase 65]: [65-01]: QA agent gets 6 of 9 dev tools (no gitStatus/gitLog/deployStatus); minimum 3 findings enforced via prompt; onComplete writes critical/high to incidents.md
- [Phase 65]: [65-02]: delegateToQA wired to runMontyQAAgent with error envelope; system prompt updated to route dev output through QA; Security stub preserved for Phase 66
- [Phase 66]: [66-01]: MontyMemoryFile already includes security.md; npmAudit handles non-zero exit via error.stdout; no minimum findings rule for security; severity excludes info level
- [Phase 66]: [66-02]: delegateToSecurity wired to runMontySecurityAgent with error envelope; blockDeploy enforcement is prompt-level; all three specialist delegations use identical pattern
- [Phase 67]: [67-01]: Cross-team prefix format: [CROSS-TEAM] [Source: X] [Type: Y] with optional [Workspace: Z]; Nova-to-Monty writes target incidents.md; parseCrossTeamEntries handles both separator formats
- [Phase 67]: [67-02]: Line-count comparison (not timestamp) for new entry detection; marker file at .monty/memory/.last-cross-team-poll.json; getCrossTeamUpdates never throws
- [Phase 68]: [68-01]: chainActions() uses forward cumulative delays with 4-hour minimum gap; parentActionId is observability-only (no FK); sequence order driven by position field not action type
- [Phase 68]: [68-02]: Event-triggered follow-ups (connection_accepted, email_sent) kept as CampaignSequenceRules complementary to time-based chainActions; pre-warm.ts deprecated not deleted for pending action safety
- [Phase 68]: [68-03]: Migration script uses select-only queries to avoid parentActionId not yet in DB; 4-hour reschedule gap matches chainActions MIN_GAP_MS; all 1011 pending actions already correctly ordered
- [Phase 69]: [69-02]: Used all-time date range for getWorkspaceStats to match all-time totalReplies; renamed linkedInTotals.connections to connectionsSent for clarity
- [Phase 69]: LinkedInDailyUsage replaces LinkedInAction for admin dashboard LinkedIn stats; pending/failed KPIs set to 0
- [Phase 69]: EmailBison API for sent count with WebhookEvent fallback; Reply table canonical for all reply counts
- [Phase 69]: [69-03]: PeriodSelector reused from portal (route-agnostic); workspace overview uses same canonical sources and period filtering as portal dashboard
- [Phase 70]: [70-01]: Connection gate split — deploy engine uses findLastIndex for connect step, pre-connect to chainActions, post-connect to CampaignSequenceRules with connection_accepted; createSequenceRulesForCampaign always called for idempotent redeploy
- [Phase 70]: [70-02]: connectionsAccepted uses midnight-UTC upsert pattern; reply cancellation is non-blocking (try/catch); timeout logic verified unchanged

### Roadmap Evolution
- Phase 68 added: LinkedIn Action Chaining Architecture — flip action ordering so first sequence action is primary, follow-ups chain from it with 0-2 day delay. Fixes pre-warm.ts backwards scheduling causing intermittent profile_view failures.
- Phase 69 added: Data Consistency — Canonical Metric Sources. 11 inconsistencies found where admin/portal/workspace views query different tables for the same metric. Standardise on canonical sources: LinkedInDailyUsage for LinkedIn, EmailBison API for sent, Reply table for replies, consistent thresholds.
- Phase 70 added: LinkedIn State Machine Sequencing. Industry research confirms all LinkedIn automation tools (Expandi, Waalaxy, Dripify, etc.) use state machines, not pre-scheduled calendars. Follow-up messages must only fire after connection acceptance. chainActions pre-scheduling replaced with event-driven progression.

### Pending Todos

None.

### Blockers/Concerns

- ESLint v9 + `eslint-plugin-security` flat config compatibility is MEDIUM confidence — verify in Phase 63 before Phase 66 depends on it
- Dev generalist vs specialist split decision point not defined — track orchestration overhead in Phase 64

## Session Continuity

Last session: 2026-04-07
Stopped at: Completed 70-02-PLAN.md (Counters, Cancellation, Timeout Verification)
Resume file: None
