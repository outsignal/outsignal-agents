---
phase: 08-campaign-entity-writer
plan: "05"
subsystem: api
tags: [campaign, agents, ai-sdk, prisma, next-api-routes, orchestrator]

# Dependency graph
requires:
  - phase: 08-03
    provides: campaigns/operations.ts with all 8 CRUD + lifecycle functions
  - phase: 08-04
    provides: writer.ts with campaignId/stepNumber on WriterInput, getCampaignContext/saveCampaignSequence tools
provides:
  - Campaign Agent (src/lib/agents/campaign.ts) with 6 tools wrapping operations layer
  - Orchestrator now delegates to live Campaign Agent (not stub)
  - Writer delegation passes campaignId for campaign-aware content generation
  - Campaign CRUD API routes: GET/POST /api/campaigns, GET/PATCH/DELETE /api/campaigns/[id], POST /api/campaigns/[id]/publish
affects: [09-client-portal, phase-10-emailbison-deploy, orchestrator, cmd-j-chat]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Agent-per-domain pattern: campaign.ts follows leads.ts exactly (tools -> system prompt -> config -> runXxxAgent -> buildXxxMessage -> exports)
    - Operations-as-source-of-truth: all 3 API routes delegate to campaigns/operations.ts, zero inline Prisma
    - Orchestrator dependency injection: campaign.ts imported and wired via runCampaignAgent, not through shared registry

key-files:
  created:
    - src/lib/agents/campaign.ts
    - src/app/api/campaigns/route.ts
    - src/app/api/campaigns/[id]/route.ts
    - src/app/api/campaigns/[id]/publish/route.ts
  modified:
    - src/lib/agents/types.ts
    - src/lib/agents/orchestrator.ts

key-decisions:
  - "delegateToCampaign now calls runCampaignAgent — stub replaced with full implementation"
  - "delegateToWriter passes campaignId enabling campaign-aware content generation from orchestrator"
  - "findTargetList tool wraps getLists from leads/operations.ts — cross-domain import is intentional (list resolution is a campaign concern)"
  - "publishForReview requires internal_review status — admin must move to internal_review before publishing; enforced at operations layer"

patterns-established:
  - "Agent files follow: tools -> system prompt -> config -> runXxxAgent() -> buildXxxMessage() -> exports"
  - "API routes validate required fields and return 400; operations layer validates business rules and throws; routes catch and return 400/404/500"
  - "Tool wrappers are truly thin — no business logic inside tool execute() closures"

requirements-completed: [CAMP-03, CAMP-05, WRITER-03]

# Metrics
duration: 4min
completed: 2026-03-01
---

# Phase 8 Plan 05: Campaign Agent, Orchestrator Wiring, and CRUD API Routes Summary

**Campaign Agent with 6 tools wired into orchestrator replacing stub, plus CRUD API routes at /api/campaigns/* enabling full Cmd+J campaign lifecycle**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-01T09:16:39Z
- **Completed:** 2026-03-01T09:20:06Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments
- Created Campaign Agent (campaign.ts) with 6 tools: createCampaign, getCampaign, listCampaigns, findTargetList, updateCampaignStatus, publishForReview — all wrapping operations.ts
- Replaced orchestrator's stub `delegateToCampaign` with live `runCampaignAgent` call; added `campaignId` to both `delegateToCampaign` and `delegateToWriter` input schemas
- Updated orchestrator system prompt with campaign workflow guide (5-step Cmd+J flow)
- Created 5 API route handlers across 3 files: GET/POST /api/campaigns, GET/PATCH/DELETE /api/campaigns/[id], POST /api/campaigns/[id]/publish

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Campaign Agent with tools** - `ff99801` (feat)
2. **Task 2: Wire Campaign Agent into orchestrator and update writer delegation** - `20a29bb` (feat)
3. **Task 3: Create Campaign CRUD API routes** - `61994e9` (feat)

## Files Created/Modified
- `src/lib/agents/campaign.ts` - Campaign Agent with 6 tools, system prompt, runCampaignAgent entry point
- `src/lib/agents/types.ts` - CampaignInput updated (add campaignId), CampaignOutput reshaped (action/summary/data)
- `src/lib/agents/orchestrator.ts` - Import runCampaignAgent, replace stub, add campaignId to writer delegation, updated system prompt
- `src/app/api/campaigns/route.ts` - GET list + POST create endpoints
- `src/app/api/campaigns/[id]/route.ts` - GET detail, PATCH update, DELETE remove endpoints
- `src/app/api/campaigns/[id]/publish/route.ts` - POST publish for client review endpoint

## Decisions Made
- `findTargetList` wraps `getLists` from `leads/operations.ts` — cross-domain import is intentional; list name resolution is a campaign concern (the agent needs to go from "fintech CTO list" to a listId before creating the campaign)
- `publishForReview` validation errors caught at route level and returned as 400 (not 500) — operations layer throws meaningful messages that are safe to expose
- Workspace ownership enforcement for now is implicit (listCampaigns filters by workspaceSlug) — explicit session-based enforcement deferred to Phase 9 per plan

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Full campaign lifecycle is operational through Cmd+J: create -> generate content -> iterate -> push for approval
- Campaign CRUD API is live and ready for client portal (Phase 9) to consume
- Phase 9 needs to add: portal session enforcement on /api/portal/campaigns/*, client approval endpoints, and campaign publish notification (email + Slack)

---
*Phase: 08-campaign-entity-writer*
*Completed: 2026-03-01*
