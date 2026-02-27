# Pitfalls Research

**Domain:** Cold outbound platform — agent dashboard integration, client approval portal, smart campaign auto-deployment
**Researched:** 2026-02-27
**Confidence:** HIGH — grounded in full codebase analysis; critical gaps verified via EmailBison docs and Vercel AI SDK documentation

---

## Critical Pitfalls

### Pitfall 1: Leads Agent Tool Set Is an MCP Server — Not a Vercel AI SDK Tool Set

**What goes wrong:**
The existing Leads Agent lives in `src/mcp/leads-agent/` and is registered as an MCP server using `@modelcontextprotocol/sdk`. When wiring it into the dashboard's chat interface (which uses Vercel AI SDK's `streamText`), developers assume they can "import the tools and pass them to streamText." They cannot. MCP server tools and AI SDK `tool()` objects are incompatible types. The MCP server runs as a separate stdio process; the AI SDK chat route runs as a Next.js API handler. Attempting to bridge them without a proper adapter results in runtime errors or silent tool failures.

**Why it happens:**
The MCP tools in `src/mcp/leads-agent/tools/` (search, enrich, score, lists, export) are registered via `server.tool(name, description, schema, handler)` — the MCP SDK's registration API. The orchestrator in `src/lib/agents/orchestrator.ts` expects `Record<string, Tool>` where `Tool` is Vercel AI SDK's type from `"ai"`. These are distinct interfaces. The pattern used for Research and Writer agents (wrapping in `tool({ inputSchema, execute })`) must be duplicated for Leads Agent — but developers will try to reuse the MCP registrations directly.

**How to avoid:**
Build a parallel Leads Agent tool set in `src/lib/agents/leads.ts` using Vercel AI SDK's `tool()` function — mirroring the MCP tool logic but implementing it as AI SDK tools. This is not a bridge or adapter; it is a second implementation of the same logic with a different registration API. The MCP server remains for Claude Code / CLI usage. The AI SDK tool set serves the dashboard chat. Both call the same underlying DB/service functions.

**Warning signs:**
- TypeScript error: "Argument of type X is not assignable to parameter of type Tool" when passing MCP server tools to `streamText`
- The `delegateToLeads` tool in orchestrator.ts currently returns `status: "not_available"` — this is the placeholder that needs replacing
- Runtime silent failures where the agent reports tool execution but no DB writes occur

**Phase to address:**
Phase 1 (Leads Agent Dashboard Integration) — must resolve the tool type mismatch before any agent wiring. The refactoring plan: (1) extract shared DB logic to `src/lib/leads/operations.ts`, (2) create MCP registrations that call those functions, (3) create AI SDK tool objects that call the same functions.

---

### Pitfall 2: EmailBison Has No Campaign-to-Lead Assignment API — Leads Go to Pool

**What goes wrong:**
The smart campaign deployment flow creates a campaign in EmailBison, then calls `createLead()` for each person. The assumption is that leads pushed via `POST /leads` will land in that specific campaign. They do not. EmailBison's API creates leads in the **workspace-level lead pool**, not in any campaign. The campaign has zero leads despite a "successful" push. The "Export Complete" message in `export.ts` lines 225-237 already reflects this — step 3 says "Import the leads from the workspace lead pool into this campaign" — meaning this is a known manual step.

The auto-deployment feature (client approves → campaigns deploy automatically) cannot fully automate if there is no API endpoint to assign leads to campaigns. The current workaround (duplicate a template campaign) inherits the sequence but still leaves leads unassigned to that specific campaign.

**Why it happens:**
EmailBison's API design treats leads as workspace-scoped entities, not campaign-scoped. Campaign membership is managed in the UI, not via a direct assignment endpoint. This was documented in the original export tool but has not been verified as "definitely unfixable via API" — it may exist as an undocumented endpoint, or may require a workaround (CSV import via API, or campaign-specific bulk upload).

**How to avoid:**
Before building "smart campaign deployment" as an atomic automated flow, **verify the EmailBison API surface area exhaustively**. Steps:
1. Check the EmailBison API reference at `https://dedi.emailbison.com/api/reference` for any campaign-lead association endpoint
2. Contact EmailBison support to confirm or deny: "Is there an API endpoint to add a specific lead (by ID) to a specific campaign?"
3. If confirmed missing: design the deployment flow as a two-step process — (a) create campaign + push leads to pool (automated), (b) prompt admin to assign in EmailBison UI (manual gate). Surface a clear "action required" notification in the admin dashboard.
4. If found: use it and mark the current `export.ts` "Next Steps" guidance as obsolete.

The campaign duplication approach (`duplicateCampaign`) inherits sequence steps but requires manual lead assignment in the EmailBison UI regardless.

**Warning signs:**
- Export logs show `successCount > 0` but the EmailBison campaign shows `total_leads: 0`
- Admin assumes campaign is live-ready but leads are sitting in the pool unassigned
- Client approves content and expects sends to start automatically, but nothing happens

**Phase to address:**
Phase 3 (Smart Campaign Deployment) — this is the central constraint. Do not design the auto-deploy flow until the API surface is confirmed. If no assignment endpoint exists, the roadmap must reflect a hybrid automated/manual flow.

---

### Pitfall 3: Vercel Streaming Timeout on Multi-Step Leads Agent Runs

**What goes wrong:**
The Leads Agent dashboard runner will execute multi-step tasks (search → enrich → score → add to list → export) via `streamText` with up to 12 steps. Each step may involve DB queries, enrichment API calls (Prospeo, AI Ark), or EmailBison calls. A full pipeline run can exceed 5 minutes. On Vercel Hobby plan, the maximum function duration is 60 seconds. Even on Pro, the default is 300 seconds (5 minutes) — a complex agent run with enrichment easily exceeds this.

**Why it happens:**
The current `/api/chat/route.ts` uses `streamText` without a `maxDuration` export. Without an explicit override, Vercel applies its plan default. The orchestrator's `stopWhen: stepCountIs(12)` means up to 12 tool calls can run sequentially. If enrichment is involved (Prospeo: 2-5s per lead, batch of 50 leads = 100-250s just for that step), the total easily exceeds the Hobby limit and can exceed the Pro default.

**How to avoid:**
1. Add `export const maxDuration = 300` to `/api/chat/route.ts` immediately (Hobby plan cap)
2. For multi-lead enrichment tasks, the Leads Agent tools must be non-blocking: enqueue an `EnrichmentJob` and return a job ID rather than waiting for completion. The agent reports "I've queued enrichment for 50 leads, job ID: X. Check back via the dashboard or ask me for status."
3. For the dedicated Leads Agent runner (separate from the orchestrator chat), use `generateText` (not `streamText`) with a POST endpoint that returns when complete — and set `maxDuration = 300` there too.
4. Flag in the roadmap: enrichment-heavy agent tasks require the job-queue pattern already established in `EnrichmentJob` model — the Leads Agent should dispatch jobs, not perform enrichment inline.

**Warning signs:**
- Vercel function logs show 504/FUNCTION_INVOCATION_TIMEOUT errors during agent runs
- Agent responses cut off mid-stream without a natural ending
- `AgentRun` records stuck in `running` status indefinitely after a timeout

**Phase to address:**
Phase 1 (Leads Agent Dashboard Integration) — set `maxDuration` before first deployment. Design agent tools to be non-blocking before multi-step pipelines are activated.

---

### Pitfall 4: Portal Approval Actions Need Server-Side Auth — API Routes Without Admin Gate Leak to Clients

**What goes wrong:**
The client portal runs on the same deployment as the admin dashboard. New API routes created for the approval flow (e.g., `POST /api/portal/approve-list`, `POST /api/portal/approve-copy`) must authenticate against the **portal session** (client-scoped), not the admin session. If a developer creates these routes under `/api/` without explicitly adding portal auth, the middleware routes them through the admin auth check — which portal users fail, getting a 401. Conversely, if they accidentally scope a portal approval route without workspace isolation, a client could approve (or view) another client's list.

There is also a reverse risk: a portal-visible API endpoint that performs admin actions (e.g., triggering campaign deployment) must not be accessible via portal session alone — it should require an admin session or a scoped service token.

**Why it happens:**
The middleware in `middleware.ts` has a clear split: `/portal/*` routes → portal session, `/api/*` routes → admin session (unless in `PUBLIC_API_PREFIXES`). But `/api/portal/*` is in `PUBLIC_API_PREFIXES` — it bypasses admin auth. New portal API routes placed under `/api/portal/` will bypass admin auth entirely and must implement their own portal session verification inside the route handler. Developers forget this and ship routes with no auth.

**How to avoid:**
- All new portal-facing API routes must go under `/api/portal/` AND call `getPortalSession()` inside the handler as the first operation
- Portal actions (approve list, approve copy) must be scoped to the `workspaceSlug` from the portal session — never accept `workspaceSlug` from the request body, always use the session value
- Campaign deployment triggered by portal approval must be a two-step process: (1) portal marks approval in DB, (2) admin receives notification and triggers deploy (or a separate webhook/cron runs the deploy). Clients should never directly invoke EmailBison API calls via portal routes
- Add to code review checklist: every new `/api/portal/*` route must have `getPortalSession()` as its first line

**Warning signs:**
- Portal routes returning 401 on client login (route placed outside `/api/portal/` prefix)
- No workspace scoping on approval endpoints (client A can approve client B's list)
- Approval triggers an immediate EmailBison API call from a portal route handler

**Phase to address:**
Phase 2 (Client Portal Review) — establish the portal API security pattern before building any approval endpoints. Document the auth model explicitly in a comment at the top of each portal API route.

---

### Pitfall 5: Binary List Approval With No "Already Contacted" Dedup = Re-Sending to Existing Contacts

**What goes wrong:**
The client reviews a list of 500 leads and approves it. The system auto-deploys to EmailBison. But 80 of those leads were already contacted in a previous campaign (they're in the workspace's lead pool with `status: "contacted"` or already exist in EmailBison). The new campaign now cold-emails people who have already received outreach from the same sender, which looks unprofessional and can cause unsubscribes or spam reports.

**Why it happens:**
The list approval flow is designed as binary (approve/reject the whole list). There is no pre-deploy dedup check against EmailBison's existing lead pool. The hard email verification gate (`getListExportReadiness`) checks for verified emails but does not check for "has this lead already been exported to EmailBison for this workspace?" The `PersonWorkspace.status` field tracks local status but is not always synced back from EmailBison after sends.

**How to avoid:**
Before the portal approval step renders the lead list preview:
1. Query EmailBison's lead pool (`client.getLeads()`) to get the set of emails already in the workspace
2. Cross-reference the TargetList members against that set
3. Mark any matches as `already_in_emailbison` in the preview UI
4. On deploy, skip leads already present (or surface as a warning requiring admin override)

This pre-deploy check should be part of the campaign deployment step, not a client-facing concern.

**Warning signs:**
- EmailBison campaign shows a new lead with `status: "contacted"` on day 1 (was already sent to previously)
- Clients receive replies from prospects referencing multiple outreach attempts from the same sender
- `PersonWorkspace.status` shows "contacted" for leads that appear in a newly approved list

**Phase to address:**
Phase 3 (Smart Campaign Deployment) — add dedup check as a pre-deploy validation step, surfaced in the admin dashboard before confirming the campaign activation.

---

### Pitfall 6: Campaign Duplication Produces "Copy of X" Names — Sequence Steps May Be Empty

**What goes wrong:**
The `duplicateCampaign()` method in `client.ts` is explicitly documented: "Note: name param is IGNORED by API — always produces 'Copy of {original}'." When a campaign is duplicated for auto-deployment, it inherits this name. If the client's approval references a campaign name, the deployed campaign has a different name. More critically, if the template campaign has no sequence steps configured, the duplicated campaign also has no sequence steps — but EmailBison will still mark leads as "active" and begin sending... nothing.

**Why it happens:**
Campaign duplication is the only API-available way to inherit sequence steps. The alternative (creating a campaign and adding sequence steps via API) depends on whether EmailBison exposes a `POST /sequence-steps` endpoint — which has not been confirmed. If that endpoint exists, fresh campaign creation with sequence step injection is cleaner. If it doesn't, duplication is the only path, and its naming limitation and empty-sequence risk are inherited.

**How to avoid:**
1. Verify: does EmailBison expose a `POST /campaigns/{id}/sequence-steps` or equivalent endpoint? Check `https://dedi.emailbison.com/api/reference`. If yes, use fresh campaign creation with step injection (cleaner, controllable names). If no, accept duplication with the known limitations.
2. After duplication, call `getSequenceSteps(campaign.id)` to verify the duplicated campaign has at least one step before proceeding with lead assignment or deployment notification
3. Rename the campaign after duplication using a `PATCH /campaigns/{id}` endpoint if one exists — otherwise, store the generated name in the DB and use that as the source of truth
4. Include a "sequence steps: N" count in the deployment confirmation UI so the admin can verify before activating

**Warning signs:**
- Deployed campaign name is "Copy of [template name]" instead of the workspace-derived name
- `getSequenceSteps(newCampaignId)` returns an empty array
- EmailBison shows campaign as "active" but emails_sent remains 0 after 48 hours

**Phase to address:**
Phase 3 (Smart Campaign Deployment) — verify the sequence step API surface before designing the deployment flow. This is a blocking discovery.

---

### Pitfall 7: Agent Conversation State Not Preserved Across Tab Reloads in Dashboard Chat

**What goes wrong:**
The admin starts a Leads Agent task via the Cmd+J chat panel: "Find 200 ICP leads for Rise and build a list called Rise-Feb-2026." The agent starts working (multi-step: search → filter → add to list). The admin switches tabs or reloads the page. The conversation state is gone — the chat history is lost. But the agent run is still in progress (or may have completed). The admin doesn't know if the list was created, re-runs the task, and creates duplicate lists with overlapping leads.

**Why it happens:**
The current `/api/chat/route.ts` is stateless — messages are passed in the request body on each turn. There is no server-side conversation persistence for the chat interface. This is fine for the orchestrator's current use cases (quick queries, Research/Writer delegation). For a Leads Agent that performs multi-step DB writes over 30-90 seconds, the lack of conversation persistence becomes a reliability issue.

**How to avoid:**
1. Persist AgentRun IDs in localStorage or a URL parameter so the admin can reconnect to an in-progress run after reload
2. The Leads Agent tools should be idempotent: "create list called Rise-Feb-2026" should check if a list with that name already exists for the workspace before creating a new one; `add_to_list` already uses `skipDuplicates: true`
3. Display active AgentRun records in the chat panel sidebar so the admin can see "Leads Agent: running (started 45s ago)" even after reload
4. Use AgentRun.status to distinguish "running" (in-progress, don't re-trigger), "complete" (show results), "failed" (safe to retry)

**Warning signs:**
- Multiple TargetLists with nearly identical names for the same workspace
- Admin reports "I kicked off the agent twice" resulting in doubled leads in a list
- AgentRun records in "running" state > 10 minutes (indicates orphaned runs after timeout/reload)

**Phase to address:**
Phase 1 (Leads Agent Dashboard Integration) — design the chat UI to surface AgentRun status before enabling multi-step tasks. Idempotency in list creation is essential from day one.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Reuse MCP tool logic by duplicating it for AI SDK | Ships faster, avoids shared-module refactor | Two code paths for same logic, diverge over time; bug fixed in one not the other | Never — extract to shared `src/lib/leads/operations.ts` from the start |
| Hard-code `workspaceSlug` from portal session into approval API | Simple, no injection risk | Need to support admin acting on behalf of portal (e.g., forced approve) | MVP only; add admin override path in Phase 4 |
| Approval status as a string field on TargetList | No new model needed | Can't track who approved, when, with what feedback | MVP only; add ApprovalRecord model if audit trail needed |
| Use `duplicateCampaign` with known name limitation | Only available API for inheriting sequence | Campaign names in EB don't match internal names; confusion, support overhead | Acceptable if a rename endpoint exists; document clearly otherwise |
| Skip "already in EmailBison" dedup on first deploy | Simpler launch | First real campaigns may re-contact existing leads | Never for production; add dedup before first client-facing deploy |

---

## Integration Gotchas

Common mistakes when connecting to external services.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| EmailBison `createLead` | Assuming the lead lands in the campaign being created in the same flow | `POST /leads` adds to workspace pool only. Campaign assignment (if API exists) is a separate step. Always verify with `getLeads()` after push. |
| EmailBison `duplicateCampaign` | Trusting the response `name` field to reflect the intended name | API ignores the `name` param and returns "Copy of {original}". Store returned `id` and `name` from the response, not your intended name. |
| EmailBison sequence steps | Assuming duplicated campaign inherits a complete sequence | Always call `getSequenceSteps(newCampaignId)` post-duplication to verify step count > 0. |
| Vercel AI SDK `streamText` | Not exporting `maxDuration` from the route file | Without explicit `maxDuration`, Hobby plan defaults to 60s, Pro to 300s. Long agent runs timeout silently mid-stream. Add `export const maxDuration = 300` to every agent route. |
| Portal session in API routes | Reading `workspaceSlug` from request body instead of session | A client could forge the body to target another workspace. Always use `const { workspaceSlug } = await getPortalSession()` — never trust client-provided workspace. |
| Vercel AI SDK tool calls | Passing MCP server tool registrations directly | MCP tools (`server.tool(...)`) and AI SDK tools (`tool({inputSchema, execute})`) are different APIs. They cannot be used interchangeably. Build separate AI SDK tool objects. |
| EmailBison API (white-labeled) | Assuming responses match the official EmailBison docs exactly | The API is accessed at `app.outsignal.ai/api` — a white-labeled instance. Responses should be identical, but edge cases in white-label configuration may produce different error codes or field shapes. Test every endpoint directly against the live instance, not just against docs. |

---

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Agent performs synchronous enrichment during chat turn | 504 timeouts, truncated agent responses, stuck AgentRun records | Leads Agent tools dispatch `EnrichmentJob` records instead of calling provider APIs inline | Immediately with batches > 10 leads |
| `client.getLeads()` called to check existing leads before each export | Slow — fetches ALL workspace leads page by page (could be thousands) | Cache the workspace lead email set (Redis/DB temp table) or scope the pre-deploy check to only the N leads being exported | Noticeable when workspace has > 500 leads in pool |
| Portal page renders lead list by fetching all list members inline | Page load slow for lists > 200 people | Paginate the lead preview: show first 50 with "load more", use `summary` counts for the approval decision | Lists > 200 people |
| Multiple simultaneous agent runs for same workspace | DB contention, duplicate list creation, redundant API calls | Guard at tool level: check for active AgentRun with same workspace before starting a new one; surface as "another run is in progress" | First time a user double-clicks the submit button |
| Copy approval triggers immediate campaign deploy | Client sees instant "deploy" but the EmailBison call may fail silently | Use a two-phase approach: approval sets DB status, a separate async step does the deploy with retry logic and status polling | Any network hiccup during the deploy API call |

---

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Portal approval API routes placed outside `/api/portal/` prefix | Admin session required — portal users get 401. Or worse: if accidentally placed in a fully public prefix, unauthenticated access | All portal action routes must be under `/api/portal/` AND verify portal session inside the handler |
| `workspaceSlug` accepted from portal request body for approval actions | Client A could approve or view client B's list by changing the body parameter | Extract `workspaceSlug` exclusively from `getPortalSession()` — ignore any body-provided value |
| Admin API routes that trigger campaign deployment accessible from portal | A compromised portal session could trigger unintended campaign launches | Campaign deployment must be admin-only. Portal approval only sets a DB flag. A separate admin confirmation (or background job with admin audit) executes the deploy. |
| Agent runs store full tool outputs in `AgentRun.output` JSON | If the Leads Agent returns lead data (emails, names) in its output, that PII is stored indefinitely in the `AgentRun` table | Cap output size, redact PII fields from AgentRun storage, or add a TTL/cleanup job for AgentRun records > 90 days old |
| Portal magic link tokens not expiring | Stale tokens allow re-authentication long after intent | `MagicLinkToken` model has `expiresAt` — verify it is enforced at verify endpoint, not just stored |

---

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Binary approve/reject with no preview of what's being approved | Client approves a list of 500 leads without knowing who they are (or who they're NOT) | Show a sample of the list (first 20, sortable by score) with enrichment summary: industry breakdown, score distribution, geographic breakdown |
| Approval action with no confirmation state feedback | Client clicks "Approve List" and the button does nothing visibly for 3 seconds (API call in progress) | Immediate optimistic UI: button goes to "Approving..." state, then "Approved" with a timestamp. Use server action or API with loading state. |
| No notification to admin when client approves | Admin has to manually check if clients have completed their review | Trigger a Slack/email notification to admin workspace channel on client approval (same notification system used for reply alerts) |
| Chat panel Leads Agent asks clarifying questions the admin already answered | Admin says "find leads for Rise" and the agent asks "what workspace?" — the current workspace context should be in scope | Pass `workspaceSlug` from the current admin page context to the chat API on every turn (already scaffolded in `context.workspaceSlug` in the chat route) |
| Client portal shows all campaigns including failed/test campaigns | Client confused by "Copy of test_campaign" artifacts from API testing | Filter portal campaign list: only show campaigns with `status: "active"` or `emails_sent > 0`. Hide draft/test campaigns. |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Leads Agent in chat:** The `delegateToLeads` tool exists in orchestrator.ts but returns `status: "not_available"`. Verify it calls a real `runLeadsAgent()` function with actual DB tools, not a stub.
- [ ] **Campaign deployment:** Export logs show `Export Complete` and a campaign ID. Verify the campaign actually has `total_leads > 0` in EmailBison, not just that the API calls returned 200.
- [ ] **Sequence steps on deployed campaign:** Campaign was created or duplicated. Verify `getSequenceSteps(campaign.id).length > 0` before marking deployment as complete.
- [ ] **Portal approval scoped to correct workspace:** Client approves a list. Verify the approval in DB references `workspaceSlug` from the portal session, not a request body field.
- [ ] **Admin notification on approval:** Client clicks "Approve." Verify Slack/email notification fires to the admin channel for that workspace.
- [ ] **Idempotent list creation:** Leads Agent runs "create list for Rise-Feb-2026." Run it twice. Verify only one list exists, not two with the same name.
- [ ] **Portal preview is paginated:** List has 500 people. Verify the portal page loads in < 3 seconds and shows paginated results, not all 500 inline.
- [ ] **Campaign dedup before deploy:** 80 leads in the approved list are already in the EmailBison workspace pool. Verify the deploy step surfaces this, skips them, or prompts admin.

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| MCP/AI SDK tool type mismatch found after integration attempt | LOW | (1) Delete the broken bridge code. (2) Extract shared logic to `src/lib/leads/operations.ts`. (3) Re-implement as AI SDK tools. No data loss. |
| Campaign deployed with 0 leads (missed assignment step) | LOW | (1) Manually assign leads in EmailBison UI. (2) Add API check to deployment flow before marking complete. No data loss, just manual work. |
| Campaign deployed with sequence steps missing | MEDIUM | (1) Pause the campaign immediately in EmailBison. (2) Configure sequence steps manually. (3) Resume. (4) Add post-deploy sequence step count verification. |
| Client portal shows another client's data (workspace scoping bug) | HIGH | (1) Immediately disable the affected portal route. (2) Audit access logs for cross-client data exposure. (3) Notify affected clients if PII was visible. (4) Fix workspace scoping and redeploy. |
| Admin is re-contacted after already being in a previous campaign | MEDIUM | (1) Identify affected leads from EmailBison reply data. (2) Pause campaign. (3) Add dedup check to all future deployments. Reputation impact depends on volume. |
| Agent conversation lost mid-run, duplicate lists created | LOW | (1) Manually delete duplicate lists via `/lists` admin UI. (2) Add idempotent list creation check. (3) Add AgentRun status persistence to chat UI. |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| MCP vs AI SDK tool type mismatch | Phase 1: Leads Agent Dashboard | `delegateToLeads` in orchestrator calls real `runLeadsAgent()`, TypeScript compiles without errors |
| EmailBison no campaign assignment API | Phase 1: Discovery spike | API surface documented before Phase 3 design; deployment flow reflects what's actually possible |
| Vercel streaming timeout on agent runs | Phase 1: Leads Agent Dashboard | `maxDuration = 300` exported from chat route; enrichment-heavy tasks dispatch jobs rather than blocking |
| Portal auth missing on approval endpoints | Phase 2: Client Portal Review | Every `/api/portal/approve-*` route calls `getPortalSession()` on first line; workspace from session only |
| Re-contacting existing EmailBison leads | Phase 3: Smart Campaign Deploy | Pre-deploy check compares list emails against EmailBison pool; surfaced in admin before confirmation |
| Duplicated campaign naming + empty sequence | Phase 3: Smart Campaign Deploy | Post-duplication `getSequenceSteps()` check; campaign name verified in DB before admin notified |
| Agent state loss on page reload | Phase 1: Leads Agent Dashboard | AgentRun status surfaced in chat UI; list creation idempotent by name+workspace |
| Cross-workspace data in portal | Phase 2: Client Portal Review | `workspaceSlug` always from session — no request body param accepted; code review gate |

---

## Sources

- Codebase analysis: `/Users/jjay/programs/outsignal-agents/src/lib/agents/orchestrator.ts` — `delegateToLeads` stub, tool registration pattern
- Codebase analysis: `/Users/jjay/programs/outsignal-agents/src/mcp/leads-agent/tools/export.ts` — EmailBison lead push + documented campaign assignment limitation
- Codebase analysis: `/Users/jjay/programs/outsignal-agents/src/lib/emailbison/client.ts` — `duplicateCampaign` name limitation comment, `createLead` implementation
- Codebase analysis: `/Users/jjay/programs/outsignal-agents/src/middleware.ts` — portal vs admin auth routing, `PUBLIC_API_PREFIXES`
- Codebase analysis: `/Users/jjay/programs/outsignal-agents/src/lib/portal-session.ts` — `getPortalSession()` implementation
- Codebase analysis: `/Users/jjay/programs/outsignal-agents/src/app/api/chat/route.ts` — stateless chat, no `maxDuration` export
- Codebase analysis: `/Users/jjay/programs/outsignal-agents/prisma/schema.prisma` — TargetList, AgentRun, EmailDraft models
- Vercel AI SDK docs: https://ai-sdk.dev/docs/troubleshooting/timeout-on-vercel — Hobby plan 60s/300s max, `maxDuration` configuration (HIGH confidence)
- EmailBison docs: https://emailbison-306cc08e.mintlify.app/workspaces/overview — workspace-scoped API, lead pool architecture (MEDIUM confidence — docs incomplete on campaign assignment endpoint)
- WebSearch: EmailBison campaign assignment API — no evidence of a direct lead-to-campaign assignment endpoint found in public docs (LOW confidence — absence of evidence, not confirmed absence)
- Next.js CVE-2025-29927: https://projectdiscovery.io/blog/nextjs-middleware-authorization-bypass — middleware bypass vulnerability; not applicable (Vercel-hosted), but informs why portal auth must be in-handler not only in middleware (HIGH confidence)
- MCP + Next.js integration: https://nextjs.org/docs/app/guides/mcp — confirms MCP server tools and AI SDK tools are distinct APIs (HIGH confidence)

---

*Pitfalls research for: v1.1 Outbound Pipeline — agent dashboard, client portal, smart campaign deployment*
*Researched: 2026-02-27*
