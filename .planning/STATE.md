---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: Outbound Pipeline
status: unknown
last_updated: "2026-03-01T09:26:00Z"
progress:
  total_phases: 4
  completed_phases: 2
  total_plans: 7
  completed_plans: 9
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-27)

**Core value:** Own the lead data pipeline end-to-end so we never pay for the same lead twice and can cancel the $300+/month Clay subscription.
**Current focus:** v1.1 — Phases 7.1-10 (Outbound Pipeline)

## Current Position

Phase: 8 of 10 (Campaign Entity Writer — 08-01, 08-02, 08-03, 08-04 complete, 08-05 through 08-06 remaining)
Plan: 4 of 6 in current phase (08-01, 08-02, 08-03, 08-04 done)
Status: In Progress (Phase 8 — Writer Agent upgraded with production quality rules and campaign awareness)
Last activity: 2026-03-01 — Executed Plan 04: Writer Agent upgraded with 11 hardcoded quality rules (PVP framework, spintax, 70-word limit, merge token format {FIRSTNAME}), getCampaignContext and saveCampaignSequence tools added, campaignId and stepNumber fields on WriterInput, smart iteration and reply suggestion mode

Progress: [██░░░░░░░░] 26% (v1.1 — Phase 8 in progress)

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

**Phase 8 decisions (2026-03-01):**
- [08-01]: Campaign stores email/LinkedIn sequences as JSON String columns (not relational EmailDraft rows) — simpler for writer agent output and client review flow
- [08-01]: targetListId nullable — Campaign can exist before lead list is attached
- [08-01]: @@unique([workspaceSlug, name]) enforced at DB level to prevent accidental duplicate campaign names
- [08-01]: channels stored as JSON string defaulting to ["email"] — supports email, linkedin, or both
- [08-02]: pgvector via Unsupported('vector(1536)') in Prisma — all vector reads/writes use raw SQL with ::vector cast
- [08-02]: OpenAI client uses lazy init — not instantiated at module load, avoids crash if OPENAI_API_KEY absent
- [08-02]: ingestDocument() embedding failure is non-fatal — warns to console, keyword fallback still works
- [08-02]: searchKnowledgeBase shared in shared-tools.ts — extract cross-agent tools here, not inline in each agent
- [08-03]: State machine as VALID_TRANSITIONS Record<string, string[]>; any->completed always allowed via early-return check
- [08-03]: parseJsonArray helper returns null on invalid JSON (not throws) — safe for legacy/corrupt data
- [08-03]: formatCampaignDetail centralizes JSON parsing and shaping — all 8 functions reuse single helper
- [08-03]: deleteCampaign restricted to draft/internal_review only — protects active campaigns
- [08-04]: getCampaignContext and saveCampaignSequence use dynamic import to avoid circular dependency at module load
- [08-04]: saveCampaignSequence coexists with saveDraft — system prompt guides agent to choose based on campaignId presence
- [08-04]: stepNumber added to WriterInput for targeted single-step regeneration without rebuilding full sequence
- [08-04]: Reply suggestion mode scoped to rules 2/5/6/7 only — no PVP or spintax for reactive replies

**Phase 7.1 decisions (2026-02-27):**
- [07.1-01]: apiToken check placed at call site in exportListToEmailBison, not in getClientForWorkspace — avoids changing shared utility used by many other tools
- [07.1-01]: conversationContext gap was only in orchestrator schema; leads.ts already handled it — one-file fix
- [07.1-01]: scoreList confirm defaults to true — backward-compatible, existing agent wrapper unchanged
- [07.1-02]: status post-filter in search_people MCP tool — operations.searchPeople has no status param; total count inaccurate when filtering but acceptable (full status support deferred)
- [07.1-02]: view_list retains both operations.getList and getListExportReadiness — readiness provides verification/enrichment metadata not in ListDetail
- [07.1-02]: batch_score_list workspace scope retained (not migrated to operations.scoreList) — different granularity; scoring via shared scorePersonIcp satisfies LEAD-05
- [07.1-02]: export_to_emailbison confirm=true path not replaced — MCP is superset (campaign management + custom variables); unified in Phase 8
- [07.1-03]: SC-1 reframed from "zero divergent implementations" to accepted-exclusions — batch_score_list (workspace-level) and export campaign management are formally deferred to Phase 8; LEAD-05 remains checked
- [07.1-03]: SCOPE comments replace NOTE comments in score.ts and export.ts — scope-as-documentation pattern with explicit LEAD-05 references

### Blockers/Concerns

- EmailBison campaign-lead assignment API — RESOLVED (07-04): No assignment endpoint exists; UI-only. Phase 10 must accept manual campaign assignment or find alternative. User has contacted EmailBison support.
- EmailBison sequence step schema — RESOLVED (07-04): Full schema verified via live probe. See .planning/spikes/emailbison-api.md.
- Vercel timeout — RESOLVED (07-03): maxDuration = 300 added to src/app/api/chat/route.ts
- OPENAI_API_KEY missing (08-02): pgvector migration blocked until key set in Vercel. Keyword search fallback active. Run: `npx tsx scripts/reembed-knowledge.ts` after setting key.

## Session Continuity

Last session: 2026-03-01
Stopped at: Completed 08-04-PLAN.md (Writer Agent quality rules, getCampaignContext, saveCampaignSequence, smart iteration, reply mode). Phase 8 Plan 4 complete. Next: Phase 8 Plan 5 (Campaign API routes).
Resume file: None
