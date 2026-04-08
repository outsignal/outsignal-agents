---
phase: 73-campaign-deploy-refactor
plan: 01
subsystem: api
tags: [deploy, adapter, channel, emailbison, linkedin, retry]

# Dependency graph
requires:
  - phase: 72-adapter-implementations
    provides: EmailAdapter, LinkedInAdapter classes with stub deploy methods
provides:
  - EmailAdapter.deploy() with full email deploy logic
  - LinkedInAdapter.deploy() with full LinkedIn deploy logic
  - Shared withRetry utility at src/lib/utils/retry.ts
  - Adapter-dispatch deploy orchestrator (executeDeploy, retryDeployChannel)
affects: [74-portal-refactor, 75-analytics-refactor]

# Tech tracking
tech-stack:
  added: []
  patterns: [adapter-dispatch for deploy, shared retry utility]

key-files:
  created:
    - src/lib/utils/retry.ts
  modified:
    - src/lib/channels/types.ts
    - src/lib/channels/email-adapter.ts
    - src/lib/channels/linkedin-adapter.ts
    - src/lib/campaigns/deploy.ts
    - src/lib/channels/__tests__/adapter-contract.test.ts

key-decisions:
  - "DeployParams.channels replaces DeployParams.sequence for cross-channel awareness"
  - "Adapters throw on failure (not DeployResult.success=false) to preserve orchestrator catch block"
  - "ChannelAdapter.deploy() returns Promise<DeployResult | void> to support both patterns"
  - "deploy.ts reduced from 650 to 265 lines by moving channel logic to adapters"

patterns-established:
  - "Adapter deploy pattern: adapters resolve their own credentials internally via getClient()"
  - "Cross-channel awareness via DeployParams.channels array (sender assignment mode)"

requirements-completed: [CAMP-01, CAMP-03]

# Metrics
duration: 5min
completed: 2026-04-08
---

# Phase 73 Plan 01: Deploy Adapter Wiring Summary

**Moved email and LinkedIn deploy logic into adapter classes, refactored deploy.ts to use adapter dispatch, and audited emailBisonCampaignId references for CAMP-03 deploy-path cleanup**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-08T14:37:27Z
- **Completed:** 2026-04-08T14:42:41Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments
- EmailAdapter.deploy() contains full email deploy: EB campaign creation, dual ID write, sequence steps, lead push with 100ms throttle, all with withRetry wrapping
- LinkedInAdapter.deploy() contains full LinkedIn deploy: connection gate split, profile_view injection, stagger timing with 15-min jitter, sender assignment mode derived from channels array
- deploy.ts is now channel-agnostic -- loops over channels calling getAdapter(channel).deploy()
- Zero direct EmailBison or LinkedIn imports remain in deploy.ts
- emailBisonCampaignId writes are internal to EmailAdapter (CAMP-03 deploy-path clean)
- trigger/campaign-deploy.ts is completely unmodified

## Task Commits

Each task was committed atomically:

1. **Task 1: Update DeployParams, extract withRetry, implement adapter deploy methods** - `14cc999d` (feat)
2. **Task 2: Refactor executeDeploy and retryDeployChannel to use adapter dispatch** - `095534e6` (feat)
3. **Task 3: Audit emailBisonCampaignId references and document CAMP-03 scope** - No new commit (audit/verification only; comment already included in Task 2 commit)

## Files Created/Modified
- `src/lib/utils/retry.ts` - Shared withRetry helper (exponential backoff: 1s/5s/15s)
- `src/lib/channels/types.ts` - DeployParams updated: sequence replaced with channels array
- `src/lib/channels/email-adapter.ts` - Full email deploy implementation moved from deploy.ts
- `src/lib/channels/linkedin-adapter.ts` - Full LinkedIn deploy implementation moved from deploy.ts
- `src/lib/campaigns/deploy.ts` - Refactored to adapter dispatch (650 -> 265 lines)
- `src/lib/channels/__tests__/adapter-contract.test.ts` - Updated for new DeployParams shape

## Decisions Made
- DeployParams.channels replaces DeployParams.sequence -- adapters load their own sequences internally via getCampaign(), which is cleaner than the orchestrator parsing and passing them
- ChannelAdapter.deploy() return type changed to `Promise<DeployResult | void>` to support both throw-on-failure (deploy) and return-result (future) patterns
- Adapters resolve workspace apiToken internally via getClient() -- the orchestrator no longer loads credentials
- Auto-transition from "deployed" to "active" preserved in orchestrator (was already there, not part of plan but kept intact)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated adapter contract test for new DeployParams**
- **Found during:** Task 1 (DeployParams change)
- **Issue:** Test file referenced `sequence: []` in DeployParams, which no longer exists after the type change
- **Fix:** Changed to `channels: []` and relaxed the error assertion (no longer expects "Phase 73" text since stubs were replaced)
- **Files modified:** src/lib/channels/__tests__/adapter-contract.test.ts
- **Verification:** `npx tsc --noEmit` passes
- **Committed in:** 14cc999d (Task 1 commit)

**2. [Rule 3 - Blocking] Updated ChannelAdapter interface return type**
- **Found during:** Task 1 (adapter deploy implementations)
- **Issue:** Interface declared `deploy(): Promise<DeployResult>` but adapters return `Promise<void>` (throw on failure, matching existing behavior)
- **Fix:** Changed to `Promise<DeployResult | void>` to support both patterns
- **Files modified:** src/lib/channels/types.ts
- **Verification:** `npx tsc --noEmit` passes
- **Committed in:** 14cc999d (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both fixes necessary to maintain type safety. No scope creep.

## CAMP-03 Audit Results

**Deploy-path cleanup (Phase 73 scope):** COMPLETE
- `deploy.ts`: Zero code references (only audit comment)
- `email-adapter.ts`: Contains dual write (internal to adapter)
- `types.ts`: CampaignChannelRef type definition

**Deferred references (Phase 74/75 scope):**
- `src/lib/analytics/snapshot.ts` -- Phase 75
- `src/lib/outbound-copy-lookup.ts` -- future
- `src/app/(portal)/portal/campaigns/` -- Phase 74
- `src/app/api/portal/campaigns/` -- Phase 74
- `src/app/api/webhooks/emailbison/route.ts` -- out of scope per REQUIREMENTS.md
- `src/app/(admin)/campaigns/[id]/DeployHistory.tsx` -- read-only UI, low priority
- `src/lib/campaigns/operations.ts` -- type defs + formatter, Phase 74/75

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Adapter deploy methods are wired and type-safe
- deploy.ts is channel-agnostic, ready for future channel additions
- Phase 73 Plan 02 can proceed with any remaining deploy refactor tasks
- Phase 74 (portal refactor) can migrate remaining emailBisonCampaignId references

---
*Phase: 73-campaign-deploy-refactor*
*Completed: 2026-04-08*
