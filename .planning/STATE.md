---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: Outbound Pipeline
status: in_progress
last_updated: "2026-02-27T21:30:00.000Z"
progress:
  total_phases: 5
  completed_phases: 1
  total_plans: 6
  completed_plans: 5
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-27)

**Core value:** Own the lead data pipeline end-to-end so we never pay for the same lead twice and can cancel the $300+/month Clay subscription.
**Current focus:** v1.1 — Phases 7.1-10 (Outbound Pipeline)

## Current Position

Phase: 7.1 of 10 (Leads Agent Integration Fixes — in progress)
Plan: 1 of 2 in current phase (Plan 01 complete, Plan 02 next)
Status: In Progress
Last activity: 2026-02-27 — Executed Plan 01: three integration fixes (apiToken check, conversationContext wiring, scoreList confirm gate)

Progress: [██░░░░░░░░] 20% (v1.1 — Phase 7 complete, 7.1-10 remaining)

## Accumulated Context

### Decisions

v1.0 decisions archived in PROJECT.md Key Decisions table.

**v1.1 scoping (2026-02-27):**
- Leads Agent: AI SDK tool() wrappers backed by shared operations.ts — never bridge MCP types
- Client portal: separate lead + content approvals per campaign (not binary list-level)
- Deploy: fire-and-forget on dual approval (both leads + content approved), auto-triggered
- Portal auth: getPortalSession() called first in every /api/portal/* route (not just middleware)
- Deploy dedup: Campaign.status === 'deployed' is the mutex — prevents re-deploy on approval refresh
- EmailBison spike: sequence step schema verified, no campaign-lead assignment endpoint (405)
- Campaign is first-class entity in Outsignal — owns TargetList (leads) + email/LinkedIn sequences (content)
- Writer agent has two modes: proactive (campaign sequences) and reactive (reply suggestions)
- Writer style rules: no em dashes, no AI/robotic tone, natural simple language, clear offering, avoid spam triggers
- Writer interaction is conversational — admin reviews + iterates via Cmd+J
- Reply suggestions surfaced in Slack notifications on LEAD_REPLIED / LEAD_INTERESTED webhooks
- Unified inbox deferred to v1.3, payment integration deferred to future milestone
- Onboarding → agent pipeline: manual CLI trigger for now, automated in v1.2

**Phase 7 decisions (2026-02-27):**
- [07-01]: operations.ts is single source of truth for all lead pipeline DB queries; agent tools will be thin wrappers; credit-gate on export; icpScoredAt skip guard on scoring
- [07-03]: delegateToLeads limit param removed from inputSchema — Leads Agent handles pagination internally; workspaceSlug made optional
- [07-03]: maxDuration = 300 on chat route — worst-case scoring for large lists can approach 300s
- [07-04]: getSequenceSteps broken path fixed to /campaigns/campaignId/sequence-steps (confirmed correct via live API probe)

**Phase 7.1 decisions (2026-02-27):**
- [07.1-01]: apiToken check placed at call site in exportListToEmailBison, not in getClientForWorkspace — avoids changing shared utility used by many other tools
- [07.1-01]: conversationContext gap was only in orchestrator schema; leads.ts already handled it — one-file fix
- [07.1-01]: scoreList confirm defaults to true — backward-compatible, existing agent wrapper unchanged

### Blockers/Concerns

- EmailBison campaign-lead assignment API — RESOLVED (07-04): No assignment endpoint exists; UI-only. Phase 10 must accept manual campaign assignment or find alternative. User has contacted EmailBison support.
- EmailBison sequence step schema — RESOLVED (07-04): Full schema verified via live probe. See .planning/spikes/emailbison-api.md.
- Vercel timeout — RESOLVED (07-03): maxDuration = 300 added to src/app/api/chat/route.ts

## Session Continuity

Last session: 2026-02-27
Stopped at: Completed 07.1-01-PLAN.md (3 fixes: apiToken check, conversationContext wiring, scoreList confirm gate). Plan 02 (MCP migration) is next.
Resume file: None
