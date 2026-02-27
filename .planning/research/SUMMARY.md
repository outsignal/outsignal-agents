# Project Research Summary

**Project:** Outsignal v1.1 — Outbound Pipeline (Leads Agent + Client Portal + Smart Campaign Deploy)
**Domain:** B2B cold outbound SaaS — agent-driven lead generation with client approval portal and programmatic campaign deployment
**Researched:** 2026-02-27
**Confidence:** HIGH

## Executive Summary

Outsignal v1.1 extends a working v1.0 admin dashboard into a complete outbound pipeline product. The three new capabilities — a Leads Agent accessible via natural language chat, a client-facing approval portal, and programmatic campaign deployment to EmailBison — are all extensions of infrastructure already in place. The defining characteristic of this milestone is that zero new npm packages are required: the AI SDK, Prisma, portal auth middleware, EmailBison client, and agent runner pattern are all installed and proven. The work is entirely in wiring and extending existing seams, not in introducing new technology.

The recommended build order is dependency-driven: Leads Agent first (no external dependencies, produces the TargetList data every other feature consumes), then schema changes and admin promotion UI (unlocks portal status tracking), then client portal review pages (needs the schema and existing auth), and finally the EmailBison deploy service (requires approved data from every prior phase). This sequence means each phase is testable independently and produces visible value before the next phase starts.

The critical risk in this milestone is the EmailBison API surface for campaign-to-lead assignment. Research found confirmed endpoints for campaign creation, lead creation, and lead list attachment, but MEDIUM-confidence findings on the sequence step creation API schema and LOW confidence that a direct lead-to-campaign assignment endpoint exists (it may route through the workspace lead pool instead). The smart deploy feature's automation level depends entirely on what the EmailBison API actually supports. This must be verified as a discovery spike in Phase 1 before Phase 4 design is finalized. Every other risk in this milestone has a clear prevention strategy already identified.

## Key Findings

### Recommended Stack

The existing stack is the stack. All v1.1 features use packages already installed at exact verified versions. The Leads Agent follows the pattern established by `research.ts` and `writer.ts` — using `ai@6.0.97` `tool()` objects, `zod@4.3.6` schemas, and `runner.ts` for AgentRun audit trails. Portal pages use `next@16.1.6` server components with `getPortalSession()` from the existing portal auth infrastructure. The EmailBison client (`src/lib/emailbison/client.ts`) needs three new methods added but the pattern is established. Two new Prisma models are required (`PortalApproval` and `CampaignDeploy`) and `TargetList` needs a `status` field — all deployed via `npx prisma db push` consistent with the v1.0 approach.

**Core technologies:**
- `ai@6.0.97` + `@ai-sdk/anthropic@3.0.46`: Agent runner and chat streaming — `claude-opus-4-20250514` for the Leads Agent (complex multi-step reasoning), Sonnet for orchestrator routing
- `next@16.1.6` App Router: Portal server components, new API routes under `/api/portal/[workspaceSlug]/`
- `prisma@6.19.2` + Neon PostgreSQL: Two new models (`PortalApproval`, `CampaignDeploy`) + `TargetList.status` field added via `npx prisma db push`
- `zod@4.3.6`: Tool input schemas for Leads Agent — same pattern as existing agents
- Existing shadcn/radix-ui + lucide-react + nuqs: All portal UI needs covered by already-installed components (no new libraries)

### Expected Features

**Must have (table stakes) — v1.1 P1:**
- Leads Agent in Cmd+J dashboard — natural language access to search, enrich, score, and list-build; replaces the `delegateToLeads` placeholder in orchestrator
- Client portal — lead list preview with ICP sample (top 10 by score), enrichment stats, and binary approve/reject
- Client portal — copy preview with email drafts grouped by campaign, step-by-step display, and approve/reject with feedback textarea
- Smart deploy (admin-triggered) — check approvals, run verification gate, create EmailBison campaign, push sequence steps, attach verified leads
- Deploy status tracking — `CampaignDeploy` model with status, counts, and error field; visible in admin and portal
- Approval notifications — client approval triggers Slack message to workspace channel via existing `notifications.ts`

**Should have (competitive differentiators) — v1.1.x post-validation:**
- Lead scoring surface in agent responses (ICP score threshold filtering in chat)
- Portal approval history with timestamps and approver email
- Deploy preview confirmation step before live action

**Defer (v2+):**
- Automatic deploy on client approval (removes admin gate — too risky at current 6-client scale)
- Copy revision round-trip in portal (Writer Agent auto-reruns on rejection feedback)
- Client portal campaign performance stats (per-campaign lead-level stats)
- Campaign Agent runner (`delegateToCampaign` stub wired to real agent)

**Anti-features (deliberately excluded):**
- Per-lead approve/reject in portal — PROJECT.md confirmed out-of-scope; binary list-level only
- Copy editing in portal — clients provide feedback via rejection textarea, Writer Agent incorporates on re-run
- Real-time deploy notifications via WebSocket — polling + Slack is sufficient at 6-client scale

### Architecture Approach

The architecture extends the existing agent/portal pattern without introducing new structural concepts. The Leads Agent follows the exact runner convention from `research.ts` and `writer.ts` (same `AgentConfig` shape, same `runAgent()` call, same AgentRun audit trail). Portal pages are read-only server components using `getPortalSession()` for workspace scoping. The deploy service is a standalone module at `src/lib/campaign-deploy/deploy.ts` — portal approval and admin triggers both call it, keeping deploy logic decoupled from agent tools. All portal API routes live under `/api/portal/` (already in `PUBLIC_API_PREFIXES` in middleware) and must verify portal session as their first operation.

**Major components:**
1. `src/lib/agents/leads.ts` (NEW) — Leads Agent with AI SDK tools: searchPeople, enrichPerson, scorePerson, createList, addToList, getList; wired into orchestrator replacing the `delegateToLeads` stub
2. `src/app/(portal)/portal/review/` (NEW) — Leads and copy review pages; server components using `getPortalSession()`; read-only with approve/reject action buttons
3. `src/app/api/portal/[workspaceSlug]/` (NEW) — Portal approval API routes with workspace ownership enforcement; approval sets DB status and fires deploy fire-and-forget
4. `src/lib/campaign-deploy/deploy.ts` (NEW) — Deploy orchestration service: verify approvals, create campaign, add sequence steps, attach leads, update statuses
5. `src/lib/emailbison/client.ts` (MODIFY) — Add `addSequenceStep()`, `assignLeadToCampaign()`, `updateSequenceStep()` methods
6. `prisma/schema.prisma` (MODIFY) — Add `TargetList.status`, `PortalApproval` model, `CampaignDeploy` model

### Critical Pitfalls

1. **MCP tools are not AI SDK tools — do not bridge them** — The existing Leads Agent MCP server (`src/mcp/leads-agent/`) uses `server.tool(...)` which is incompatible with AI SDK's `tool({inputSchema, execute})`. Extract shared logic to `src/lib/leads/operations.ts`; implement AI SDK tool wrappers in `leads.ts` separately. Two registration paths, one underlying implementation.

2. **EmailBison may have no campaign-to-lead assignment API** — `POST /leads` adds leads to the workspace pool, not to a specific campaign. This is documented in the existing `export.ts` "Next Steps" comment. Verify the full API surface against `https://dedi.emailbison.com/api/reference` before designing the deploy flow. If no assignment endpoint exists, deploy must be hybrid: automated campaign + sequence creation, manual lead assignment prompt to admin.

3. **Vercel function timeout on multi-step agent runs** — The Leads Agent with enrichment tasks can exceed the Hobby plan's 60s limit and risk Pro plan's 300s limit. Fix: `export const maxDuration = 300` on every agent route immediately; Leads Agent tools dispatch `EnrichmentJob` records rather than calling enrichment providers inline during a chat turn.

4. **Portal approval endpoints need in-handler auth — not just middleware** — `/api/portal/*` is in `PUBLIC_API_PREFIXES` (bypasses admin auth). Every portal API route must call `getPortalSession()` as its first line and extract `workspaceSlug` from the session — never from the request body. Cross-client data exposure is a HIGH recovery-cost pitfall with a simple prevention.

5. **Duplicate deployment race condition** — Both leads approval and copy approval can trigger `deployCampaign()`. Without deduplication, a workspace with both approved simultaneously could create two campaigns. Convention: leads approval fires deploy if copy is already approved; copy approval fires deploy if leads are already approved. Use `TargetList.status === 'deployed'` as a mutex to prevent re-deploy on refresh.

## Implications for Roadmap

Based on research, the following 4-phase structure is recommended. The ordering is dependency-driven: each phase produces data or capabilities consumed by the next. Phase 5 is optional.

### Phase 1: Leads Agent Dashboard Integration + EmailBison API Discovery Spike

**Rationale:** No external dependencies — Leads Agent only touches existing Prisma models and follows the proven agent runner pattern. This produces the TargetList data that every subsequent phase consumes. The EmailBison API discovery spike must happen in this phase before Phase 4 design is locked in; the entire automation level of smart deploy depends on what the API actually supports.

**Delivers:** Natural language lead search, enrich, score, and list-build via Cmd+J chat; `delegateToLeads` stub replaced with real agent; `maxDuration = 300` set on chat route; idempotent list creation (name+workspace uniqueness check); EmailBison API surface documented (sequence steps + lead assignment endpoints verified or absence confirmed)

**Addresses:** Leads Agent in Cmd+J (P1 table stakes)

**Avoids:** MCP/AI SDK tool type mismatch (build AI SDK tools from start, never bridge); Vercel timeout (set maxDuration before first deploy); agent state loss on page reload (idempotent list creation, AgentRun status surfaced in chat)

**Research flag:** Skip `/gsd:research-phase` for the agent itself — patterns are fully established. EmailBison spike is implementation discovery against the live API reference, not research.

---

### Phase 2: Schema Migration + Admin Promotion UI

**Rationale:** Portal review pages cannot function without `TargetList.status`. Admin needs a way to promote lists from `building` to `pending_review` and drafts from `draft` to `review` before client-facing features are testable. This phase unlocks all subsequent phases.

**Delivers:** `TargetList.status` field with full lifecycle (`building | pending_review | approved | rejected | deployed`); `PortalApproval` and `CampaignDeploy` models added; admin list detail page gains promote/share buttons; `npx prisma db push` applied

**Addresses:** Admin visibility of approval state (P1 table stakes); deploy status tracking (P1)

**Implements:** Schema foundation consumed by Phase 3 (portal) and Phase 4 (deploy)

**Research flag:** Skip — `npx prisma db push` is the established pattern; schema shapes are fully defined in STACK.md research

---

### Phase 3: Client Portal Review Pages + Approval API Routes

**Rationale:** Needs Phase 2 schema. Portal pages are read-only server components with simple approval actions — the pattern matches existing `/portal/page.tsx` exactly. Security model (workspace ownership check in every API route) is the critical correctness requirement; the implementation pattern is straightforward.

**Delivers:** `/portal/review/leads` — lead sample preview (top 10 by ICP score, enrichment summary, approve/reject); `/portal/review/copy` — EmailDraft preview grouped by campaign, approve/reject with feedback textarea; portal API routes under `/api/portal/[workspaceSlug]/` with workspace ownership enforcement; Slack notification on client approval via existing `notifications.ts`

**Addresses:** Client portal lead list preview + approve (P1); client portal copy preview + approve (P1); approval notifications (P1)

**Avoids:** Portal auth gap (every route calls `getPortalSession()` first); cross-workspace data leak (workspaceSlug from session only, never request body); blocking portal response on deploy (approval sets DB status, deploy is fire-and-forget `void` call)

**Research flag:** Skip — portal server component pattern is established; security model is fully documented in PITFALLS.md

---

### Phase 4: EmailBisonClient Extensions + Deploy Service

**Rationale:** Requires approved data from Phases 2+3. The EmailBisonClient extensions need verification against the live API — sequence step creation and lead assignment endpoint shapes are MEDIUM confidence. Build with error handling and logging before wiring to the approval UI. This is the highest-risk phase technically, which is why the API discovery spike in Phase 1 is critical.

**Delivers:** `EmailBisonClient.addSequenceStep()`, `assignLeadToCampaign()`, `updateSequenceStep()` methods; `src/lib/campaign-deploy/deploy.ts` service; `/api/lists/[id]/deploy` admin-triggered deploy endpoint; deploy status visible in admin (`CampaignDeploy` records); pre-deploy dedup check against EmailBison lead pool; hard email verification gate inherited from existing `getListExportReadiness()`; fire-and-forget wired into Phase 3 approval handlers

**Addresses:** Smart deploy admin-triggered (P1 table stakes); deploy status tracking (P1); dedup of already-contacted leads

**Avoids:** Duplicate deploy race (status-as-mutex); leads-in-pool-not-campaign confusion (verify assignment API, surface hybrid flow if needed); empty sequence steps on deploy (post-create verification check); blocking response on deploy (fire-and-forget in approval handler, 60-300s deploy runs async)

**Research flag:** Needs implementation spike against live EmailBison API — sequence step schema and campaign-lead assignment endpoint are MEDIUM/LOW confidence. Verify at `https://dedi.emailbison.com/api/reference` before writing deploy logic. The white-label instance at `app.outsignal.ai/api` must be tested directly, not assumed identical to docs.

---

### Phase 5: Campaign Agent Runner (Optional Enhancement)

**Rationale:** The full pipeline works without it — deploy can be triggered via portal approval or admin button. Campaign Agent adds chat-driven deployment ("deploy the Rise Q1 campaign" via Cmd+J) but is low priority relative to the core pipeline being functional. Wire the `delegateToCampaign` orchestrator stub to a real agent that calls the Phase 4 deploy service.

**Delivers:** Chat-driven campaign deployment via Cmd+J; `runCampaignAgent()` wrapping the deploy service from Phase 4

**Addresses:** Natural language campaign management (differentiator, not table stakes)

**Research flag:** Skip — follows identical agent runner pattern to Phase 1; deploy service from Phase 4 is the implementation; Campaign Agent is a thin wrapper

---

### Phase Ordering Rationale

- Leads Agent first because it has zero dependencies and produces the TargetList data consumed by all other phases; it is also testable immediately via Cmd+J without any portal or deploy infrastructure
- Schema before portal because portal status filtering requires `TargetList.status` to exist in the database — a portal page built without the status field would need a rewrite
- Portal before deploy because approval state must be settable by clients before the deploy can be triggered from that approval
- Deploy last because it requires all prior phases to have produced data (approved lists, approved copy) and because the EmailBison API verification from Phase 1 informs whether deploy is fully automated or hybrid automated/manual

### Research Flags

Needs deeper research or implementation spike:
- **Phase 1 (EmailBison API spike):** Verify `POST /campaigns/sequence-steps` request schema and `POST /campaigns/{id}/leads` campaign assignment endpoint against live API reference before Phase 4 design is locked. If assignment API is absent, Phase 4 scope changes from fully automated to hybrid (automated campaign + sequence, manual lead assignment prompt).
- **Phase 4 (Deploy Service):** Begin with a test harness against live EmailBison API at `app.outsignal.ai/api` to confirm endpoint shapes before building the full deploy service. White-label instances may have edge cases vs. official docs.

Standard patterns (skip research phase):
- **Phase 1 (Leads Agent):** Identical to existing research/writer agent pattern — `AgentConfig`, `runAgent()`, `tool()`, `zod` schemas are all established
- **Phase 2 (Schema):** `npx prisma db push` is the established approach; schema shapes are fully specified in STACK.md
- **Phase 3 (Portal):** Server component + `getPortalSession()` pattern matches existing `/portal/page.tsx`; security model is documented
- **Phase 5 (Campaign Agent):** Thin wrapper over Phase 4 deploy service; follows Phase 1 pattern exactly

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All packages verified from live `package.json` and `node_modules`; exact versions confirmed; no new dependencies needed |
| Features | HIGH | Requirements from PROJECT.md are authoritative; EmailBison API capabilities verified from existing client.ts and official docs; industry approval UX from multiple sources |
| Architecture | HIGH | Based on direct codebase inspection of all integration points; build order is dependency-driven and verified against actual file contents |
| Pitfalls | HIGH | Grounded in codebase analysis; critical gaps (MCP/AI SDK types, EmailBison API surface) verified against official documentation |

**Overall confidence:** HIGH

### Gaps to Address

- **EmailBison campaign-lead assignment API** (LOW confidence): The most critical unknown. The existing export tool documents a manual step ("import leads from pool into campaign") suggesting no API exists, but this has not been conclusively confirmed. Discovery spike in Phase 1 is mandatory before finalizing Phase 4 scope. If absent: deploy flow becomes campaign creation + sequence steps (automated) + admin prompt to assign in EmailBison UI (manual gate displayed in admin dashboard).

- **EmailBison `POST /campaigns/sequence-steps` request schema** (MEDIUM confidence): Endpoint is listed in docs but full request body schema (campaign_id, position, subject, body, delay_days) has not been verified against the live API. Must be tested against the white-label instance before building `createSequenceStep()`.

- **White-label API response parity** (LOW confidence): The EmailBison instance at `app.outsignal.ai/api` is white-labeled. Error codes and field shapes should be verified against the live instance, not assumed identical to official docs.

- **Vercel function timeout for sequential deploy** (identified, mitigation known): Sequential lead assignment at 100-500 leads per campaign takes 30-120 seconds. Within the 5-minute Vercel Pro limit but requires `maxDuration = 300` to be set. Fire-and-forget pattern is the architectural mitigation already designed — portal approval returns immediately, deploy runs async. No action needed beyond confirming `maxDuration` is set.

## Sources

### Primary (HIGH confidence)
- Live codebase: `src/lib/agents/orchestrator.ts`, `runner.ts`, `research.ts`, `writer.ts`, `types.ts` — agent runner pattern and delegation stubs confirmed
- Live codebase: `src/lib/emailbison/client.ts` — confirmed existing methods and signatures; missing methods identified
- Live codebase: `prisma/schema.prisma` — full data model including EmailDraft status values (`draft|review|approved|deployed`), TargetList, AgentRun
- Live codebase: `src/middleware.ts` — portal/admin auth boundaries, `PUBLIC_API_PREFIXES` confirmed
- Live codebase: `src/app/(portal)/portal/page.tsx` — server component pattern, `getPortalSession()` usage confirmed
- Live codebase: `src/app/api/lists/[id]/export/route.ts` — email verification gate pattern to replicate in deploy
- Live codebase: `package.json` — all exact package versions verified
- `.planning/PROJECT.md` — authoritative requirements, binary approval confirmed out-of-scope, `db push` pattern confirmed

### Secondary (MEDIUM confidence)
- [EmailBison docs](https://emailbison-306cc08e.mintlify.app/campaigns/adding-leads-to-a-campaign) — `attach-leads` and `attach-lead-list` endpoints confirmed
- [EmailBison developer page](https://emailbison.com/developers) — API overview, sequence-steps endpoint listed (schema not fully verified)
- [Vercel AI SDK docs](https://ai-sdk.dev/docs/troubleshooting/timeout-on-vercel) — `maxDuration` configuration, Hobby/Pro plan limits
- [Next.js MCP guide](https://nextjs.org/docs/app/guides/mcp) — confirms MCP server tools and AI SDK tools are distinct APIs requiring separate implementations

### Tertiary (LOW confidence)
- Industry approval UX research (QuantumByte, ColdIQ) — agency approval workflow stages; confirms no cold email tool implements native client portal approval natively
- EmailBison campaign-lead assignment API — no endpoint found in public docs; absence not conclusively confirmed; needs direct API verification against live instance

---
*Research completed: 2026-02-27*
*Ready for roadmap: yes*
