---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: Outbound Pipeline
status: unknown
last_updated: "2026-03-02T11:52:32.655Z"
progress:
  total_phases: 7
  completed_phases: 4
  total_plans: 21
  completed_plans: 21
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-27)

**Core value:** Own the lead data pipeline end-to-end so we never pay for the same lead twice and can cancel the $300+/month Clay subscription.
**Current focus:** v1.1 — Phases 7.1-10 (Outbound Pipeline)

## Current Position

Phase: 11 of 11 (LinkedIn Voyager API Client — Plan 03 COMPLETE: Worker Voyager integration)
Plan: 3 of 3 in current phase (11-01 done: VoyagerClient, 11-02 done: cookie bridge + endpoints, 11-03 done: worker integration)
Status: Phase 11 COMPLETE. All 3 plans done. LinkedIn action execution now via VoyagerClient HTTP (not browser automation).
Last activity: 2026-03-02 — Executed Plan 03: worker.ts uses VoyagerClient for all action execution, LinkedInBrowser demoted to cookie capture only, getOrCreateVoyagerClient/loginAndExtractCookies/executeAction(senderId) implemented.

Progress: [████░░░░░░] 40% (v1.1 — Phase 8 complete)

## Accumulated Context

### Roadmap Evolution
- Phase 11 added: LinkedIn Voyager API Client — replace browser automation with HTTP-based Voyager API calls for account safety

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
- Writer interaction is conversational — admin reviews + iterates via Claude Code (not dashboard chat)
- Reply suggestions surfaced in Slack notifications on LEAD_REPLIED / LEAD_INTERESTED webhooks
- Unified inbox deferred to v1.3, payment integration deferred to future milestone
- Onboarding → agent pipeline: manual CLI trigger for now, automated in v1.2
- **Admin interface decision (2026-03-01)**: All AI agent interaction (leads, writer, campaign) happens through Claude Code (VSCode), NOT through the dashboard Cmd+J chat. Dashboard is display-only UI (view campaigns, lists, stats). This avoids Anthropic API costs — covered by Claude Code Max Plan 20x. The /api/chat route and orchestrator wiring remain functional but are accessed via Claude Code MCP tools, not a web chat UI.
- Knowledge base: 126 documents (pgvector embeddings ready for Phase 8 writer)
- LinkedIn agent-browser rewrite complete (profile-first targeting, like/comment actions added)

**Phase 7 decisions (2026-02-27):**
- [07-01]: operations.ts is single source of truth for all lead pipeline DB queries; agent tools will be thin wrappers; credit-gate on export; icpScoredAt skip guard on scoring
- [07-03]: delegateToLeads limit param removed from inputSchema — Leads Agent handles pagination internally; workspaceSlug made optional
- [07-03]: maxDuration = 300 on chat route — worst-case scoring for large lists can approach 300s
- [07-04]: getSequenceSteps broken path fixed to /campaigns/campaignId/sequence-steps (confirmed correct via live API probe)

**Phase 9 decisions (2026-03-01):**
- [09-01]: prisma db push used instead of migrate dev — project has no migrations directory, uses push-based schema workflow
- [09-01]: getCampaignLeadSample fetches all members then sorts/slices in JS — Prisma can't order by related model field; acceptable for target list sizes
- [09-01]: substituteTokens returns tokensFound list — enables future UI highlighting of resolved tokens on portal campaign detail page
- [09-01]: Dual approval auto-transition: when both leadsApproved + contentApproved become true in pending_approval, status auto-advances to approved
- [09-01]: Feedback cleared (null) on approval — approval replaces a rejection, no stale feedback displayed
- [09-04]: PreviewText highlights tokens by regex-scanning post-spintax string, wrapping each known token replacement in <mark> with token name as title — enables granular JSX highlighting without losing text structure
- [09-04]: accordion openStep uses index (0 = first open by default, -1 = all closed); clicking active step sets openStep to -1
- [09-04]: T1+T2+T3 committed together — page.tsx imports both client components so they must coexist; single atomic commit avoids broken intermediate state
- [09-05]: approvalsSlackChannelId used via direct property access — Prisma client regenerated in 09-01 has field typed correctly, no safe cast needed
- [09-05]: T1+T2 committed together — notifyApproval function and route wiring are tightly coupled; single atomic commit avoids broken intermediate state
- [09-05]: Dual approval fires both_approved by reading updated.status from operations return value — no extra DB query needed

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
- [08-06]: generateReplySuggestion extracts emailSteps[0].body first, falls back to reviewNotes — handles both agent output paths
- [08-06]: UNTRACKED_REPLY_RECEIVED excluded from reply suggestion trigger — per CONTEXT.md decision
- [08-06]: textBody guard on suggestion trigger — no point calling writer if no reply body present
- [08-06]: Tasks 1+2 committed together — webhook notifyReply call requires updated function signature to type-check

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
- [Phase 08-05]: delegateToCampaign now calls runCampaignAgent — stub fully replaced with live Campaign Agent
- [Phase 08-05]: delegateToWriter passes campaignId enabling campaign-aware content generation from the orchestrator
- [Phase 09]: Portal route pattern: getPortalSession() first with 401 on failure; workspaceSlug ownership check with 403 on mismatch
- [Phase 09]: Detail route combines campaign + leadSample in one GET response to avoid frontend round-trips
- [Phase 11-01]: Use Node.js native global fetch (not undici import) — compiles cleanly with @types/node 22
- [Phase 11-01]: ConnectionStatus defined locally in voyager-client.ts matching worker/linkedin-browser.ts (not shared server type)
- [Phase 11-01]: dispatcher: proxyAgent as any — SocksProxyAgent implements undici.Dispatcher but TypeScript types require cast
- [Phase 11-01]: viewProfile() always called first in write ops to extract memberUrn from entityUrn in Voyager API response
- [Phase 11-02]: saveVoyagerCookies wraps li_at + JSESSIONID with type:voyager marker in existing session POST array — no endpoint changes needed
- [Phase 11-02]: getVoyagerCookies uses new /cookies GET (not /session GET) — /session GET only returns status fields, not sessionData
- [Phase 11-02]: Health endpoint validates against explicit allowlist: healthy/warning/paused/blocked/session_expired
- [Phase 11-03]: executeAction receives senderId as third param — cleanest approach for activeClients.delete() and updateSenderHealth() without reverse-lookup on the map
- [Phase 11-03]: loginAndExtractCookies wraps browser in try/finally with browser.close() — ensures cleanup even on error; LinkedInBrowser used only here

### Blockers/Concerns

- EmailBison campaign-lead assignment API — RESOLVED (07-04): No assignment endpoint exists; UI-only. Phase 10 must accept manual campaign assignment or find alternative. User has contacted EmailBison support.
- EmailBison sequence step schema — RESOLVED (07-04): Full schema verified via live probe. See .planning/spikes/emailbison-api.md.
- Vercel timeout — RESOLVED (07-03): maxDuration = 300 added to src/app/api/chat/route.ts
- OPENAI_API_KEY missing (08-02): pgvector migration blocked until key set in Vercel. Keyword search fallback active. Run: `npx tsx scripts/reembed-knowledge.ts` after setting key.

## Session Continuity

Last session: 2026-03-02
Stopped at: Completed 11-03-PLAN.md (Worker Voyager Integration). worker.ts fully swapped to VoyagerClient HTTP execution. Phase 11 complete: all 3/3 plans done.
Resume file: None
