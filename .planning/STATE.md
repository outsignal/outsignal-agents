---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: Outbound Pipeline
status: unknown
last_updated: "2026-03-03T12:22:03.068Z"
progress:
  total_phases: 11
  completed_phases: 9
  total_plans: 40
  completed_plans: 41
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-27)

**Core value:** Own the lead data pipeline end-to-end so we never pay for the same lead twice and can cancel the $300+/month Clay subscription.
**Current focus:** v1.1 — Phases 7.1-10 (Outbound Pipeline)

## Current Position

Phase: 14 of 14 (LinkedIn Cookie Chrome Extension — Plan 03 COMPLETE: service worker background.js with alarm-based cookie health checks)
Plan: 3 of ? in current phase (14-01 done: extension-auth.ts + 7 API endpoints; 14-02 done: popup.html/js/css + icons; 14-03 done: background.js service worker)
Status: Phase 14 — Plan 03 done. Service worker complete: 4-hour alarm, li_at expiry detection, badge+notification+API expiry call.
Last activity: 2026-03-03 — Executed Plan 10-05: DeployButton (conditional on status=approved, confirmation modal with stats), DeployHistory (status badges, retry per failed channel), admin campaign detail page at (admin)/campaigns/[id]. Phase 10 all 5 plans complete.

Progress: [████░░░░░░] 40% (v1.1 — Phase 8 complete)

## Accumulated Context

### Roadmap Evolution
- Phase 11 added: LinkedIn Voyager API Client — replace browser automation with HTTP-based Voyager API calls for account safety
- Phase 12 added: Dashboard & Admin UX — operational command center with activity graphs, agent monitoring, sender management, proposal CRUD, document ingest
- Phase 13 added: Smart Sender Health — auto-detect flagged senders, remove from campaign rotation, reassign actions, Slack notifications, swap workflow

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
- [Phase 12-04]: AgentRunTable uses single expandedId state — only one row open at a time; clicking active row closes it (toggle pattern)
- [Phase 12-04]: Auto-refresh (30s) only activates when data includes a run with status=running — no unnecessary polling on idle views
- [Phase 12-04]: Workspace filter options populated from first-page API fetch — no separate workspace list endpoint needed
- [Phase 12-08]: OnboardPageClient client component wraps all interactive UI; page.tsx stays as server component fetching data
- [Phase 12-08]: pdf-parse v2 dynamic import with any cast to avoid @types/pdf-parse v1 conflict
- [Phase 12-08]: OnboardingInvite DELETE blocks on completed status only; draft/sent/viewed are deletable
- [Phase 12-01]: Dashboard page converted to "use client" for nuqs URL state — API types exported from route.ts and imported by components
- [Phase 12-01]: recharts AreaChart used (not LineChart) — filled area improves visual density; custom tooltip uses plain interface not recharts 3.x TooltipContentProps generic
- [Phase 12-01]: Alerts positioned above KPIs — critical items need immediate visibility; LEAD_INTERESTED counted as reply in time-series
- [Phase 12]: Kept Linkedin icon (deprecated hint not error) — no non-deprecated replacement in lucide-react v0.575.0

**Phase 10 decisions (2026-03-03):**
- [10-01]: deployEmailChannel stores emailBisonCampaignId on both CampaignDeploy and Campaign — enables webhook matching in Plan 03
- [10-01]: LinkedIn-only first step enqueued at deploy; email_sent-triggered steps deferred to webhook handler (Plan 03)
- [10-01]: Outsignal-side lead dedup via WebhookEvent EMAIL_SENT check; EmailBison's own dedup is fallback
- [10-01]: Lead push serial with 100ms throttle — prevents EmailBison rate-limiting on large lists
- [10-01]: finalizeDeployStatus derives complete/partial_failure/failed from per-channel outcomes after both channels complete
- [10-01]: prisma db push workflow (no migrate dev) — consistent with project's push-based schema approach
- [10-02]: compileTemplate returns raw template on error (graceful fallback, console.warn)
- [10-02]: evaluateSequenceRules is side-effect free — returns descriptors, caller enqueues
- [10-02]: createSequenceRulesForCampaign is idempotent — deletes existing rules first (supports re-deploy)
- [10-02]: MAX_RETRY_ATTEMPTS constant removed — retry tracking uses DB query for sequenceStepRef='connection_retry', not a numeric counter
- [10-02]: actionType cast to LinkedInActionType in processConnectionCheckResult — CampaignSequenceRule.actionType is string in Prisma, EnqueueActionParams requires the union type
- [10-02]: getConnectionsToCheck excludes timed-out connections — those are handled by pollConnectionAccepts(), not the worker's live-check loop
- [10-04]: notifyDeploy uses approvalsSlackChannelId ?? slackChannelId — deploy notifications are ops-level, same channel as approval events
- [10-04]: Email/LinkedIn channel rows suppressed when status is null or 'skipped' — avoids confusing empty sections on single-channel campaigns
- [10-04]: updatedAt used as session age proxy — Sender.updatedAt is @updatedAt so reflects last DB write; cookie save always updates the record
- [10-04]: SenderHealthEvent created on proactive session flag — uniform audit trail regardless of trigger source (reactive health check vs proactive cron)

**Phase 13 decisions (2026-03-02):**
- [13-01]: Minimum 10-send volume gate before bounce rate flagging — avoids false positives from low-volume senders
- [13-01]: Soft flag (bounce_rate) uses healthFlaggedAt for 48h cooldown auto-recovery; hard flags (captcha/restriction/session_expired) require manual admin reactivation regardless of time
- [13-01]: Warning severity keeps sender in rotation — bounce rate 5-7% is monitoring signal, not removal trigger
- [13-01]: healthFlaggedAt only set for soft flags; hard flags don't use it since they require explicit admin reactivation
- [13-01]: Notifications deferred to Plan 02 — detection engine returns HealthCheckResult[] for caller, does not fire Slack/email
- [13-01]: Case-insensitive email matching for senderEmail <-> Sender.emailAddress using .toLowerCase() on both sides
- [13-01]: Least-loaded reassignment scoring: pendingCount - remainingBudget (lower score = better target sender)
- [13-01]: prisma.$transaction for atomic workspace campaign pause when last healthy sender goes down
- [13-03]: Sparkline fetched lazily on expand (not on card mount) — avoids N×30-day DB queries on initial page load with many senders
- [13-03]: statusToNum severity mapping (0/1/2) used for sparkline Y-axis and color — single severity scale
- [13-03]: prisma.$transaction([update, create]) for reactivation — ensures health reset and audit event are always atomically paired
- [13-03]: Link wraps MetricCard for Sender Health KPI — keeps MetricCard as pure display component, navigation at page level
- [13-03]: Reactivate button only renders for healthStatus=blocked|session_expired — soft-flagged senders don't require admin intervention
- [13-02]: notifySenderHealth() uses workspace.slackChannelId (client channel) for alerts — ops channel gets coverage via notify() DB+Slack call
- [13-02]: Email only for critical severity — warning-level bounce rate alerts are low urgency, Slack digest sufficient per CONTEXT.md
- [13-02]: sendSenderHealthDigest() groups by workspaceSlug — one Slack message per workspace regardless of how many senders have warnings
- [13-02]: verifySlackChannel guard uses return (exit function) in notifySenderHealth and continue (skip workspace) in sendSenderHealthDigest loop

**Phase 14-01 decisions (2026-03-03):**
- [14-01]: Extension login uses admin password — extension users are trusted admins/operators; no separate extension credential needed at this stage
- [14-01]: Two-token flow (workspace then sender): workspace-scoped token (senderId='') from login, then sender-scoped token from select-sender — single-sender workspaces auto-skip select-sender step
- [14-01]: senderId="" sentinel for workspace-scoped tokens rather than a separate token type — simpler, avoids a second session interface
- [14-01]: CORS headers on all extension endpoints with Access-Control-Allow-Origin: * — Chrome extension service workers bypass CORS but popup fetch may need it
- [14-01]: Cookie save sets healthStatus=healthy inline on reconnect — clears any prior session_expired flag automatically without a separate reactivation call
- [14-01]: expiry endpoint uses prisma.$transaction — ensures sender status update and SenderHealthEvent creation are always atomic
- [14-01]: li_at warning returned in response but cookies still saved — non-fatal, all captured cookies stored regardless
- [Phase 14-linkedin-cookie-chrome-extension]: CHECK_INTERVAL_MINUTES constant (240) used in alarm creation — readable intent, easy to adjust

**Phase 14-02 decisions (2026-03-03):**
- [14-02]: Icons generated via pure Node.js zlib/Buffer PNG construction — no image library dependency; solid #F0FF7A squares are valid PNGs for Chrome extension loading
- [14-02]: Three-view popup managed by classList hide/show — no framework overhead for a 3-state UI
- [14-02]: Token validation on every popup open — DOMContentLoaded always calls GET /api/extension/status if token exists, ensuring stale tokens are caught immediately
- [14-02]: 401 auto-logout — when status endpoint returns 401, storage is cleared and login view shown automatically
- [Phase 14-linkedin-cookie-chrome-extension]: Extension expiry API call is non-fatal — badge and notification fire regardless of network failure
- [Phase 10-auto-deploy-on-approval]: [10-03]: Deploy route uses next/server after() for fire-and-forget — response returns immediately, executeDeploy runs in background post-response
- [Phase 10-auto-deploy-on-approval]: [10-03]: EMAIL_SENT sequence rule evaluation skips campaigns without LinkedIn channel — avoids unnecessary DB queries for email-only campaigns
- [Phase 10-auto-deploy-on-approval]: [10-05]: DeployButton returns null when not in approved state — no placeholder rendered, header stays clean
- [Phase 10-auto-deploy-on-approval]: [10-05]: Campaign detail page is a server component — getCampaign() called at server, avoids client-side fetch waterfall

### Blockers/Concerns

- EmailBison campaign-lead assignment API — RESOLVED (07-04): No assignment endpoint exists; UI-only. Phase 10 must accept manual campaign assignment or find alternative. User has contacted EmailBison support.
- EmailBison sequence step schema — RESOLVED (07-04): Full schema verified via live probe. See .planning/spikes/emailbison-api.md.
- Vercel timeout — RESOLVED (07-03): maxDuration = 300 added to src/app/api/chat/route.ts
- OPENAI_API_KEY missing (08-02): pgvector migration blocked until key set in Vercel. Keyword search fallback active. Run: `npx tsx scripts/reembed-knowledge.ts` after setting key.

## Session Continuity

Last session: 2026-03-03
Stopped at: Completed 10-05-PLAN.md (Deploy UI: DeployButton component with confirmation modal + DeployHistory table with retry buttons + admin campaign detail page at (admin)/campaigns/[id]).
Resume file: None
