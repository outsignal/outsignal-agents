# Phase 68: LinkedIn Action Chaining Architecture - Research

**Researched:** 2026-04-07
**Domain:** LinkedIn action scheduling, campaign deployment pipeline
**Confidence:** HIGH

## Summary

The current LinkedIn campaign deploy pipeline has a backwards scheduling bug: `deploy.ts` schedules the connection_request as the primary action, then `pre-warm.ts` retrofits a profile_view 1-2 days BEFORE it. When connections are scheduled with minimal lead time (e.g. early stagger slots), the profile_view calculation can land in the past, causing intermittent failures where profile views either don't fire or fire after the connection.

The fix flips the model: schedule the FIRST action in the campaign sequence (e.g. profile_view) as the primary scheduled action, then chain follow-up actions (e.g. connection_request) with a 0-2 day randomised forward delay. This is fundamentally simpler -- all scheduling is forward-looking, eliminating the "schedule in the past" failure class entirely.

Three code paths create LinkedIn actions. Two need fixing (deploy.ts, signal-campaigns.ts), one must not be touched (linkedin-fast-track.ts). The existing codebase already has sequencing infrastructure (CampaignSequenceRule, evaluateSequenceRules) that handles follow-up actions triggered by events -- the chaining architecture extends this with deploy-time forward scheduling.

**Primary recommendation:** Use deploy-time scheduling (Option B from the brief) -- schedule all actions at deploy with correct relative offsets. This avoids worker-side complexity and keeps the chaining logic centralised in deploy.ts and signal-campaigns.ts.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CHAIN-01 | Campaign deploy schedules the FIRST action in the sequence as the primary action; follow-up actions chain from it with a 0-2 day randomised delay | Deploy-time scheduling: `deploy.ts:280-304` and `signal-campaigns.ts:412-438` both need the scheduling order flipped. Schedule first sequence step at stagger time T, chain follow-ups at T + random(0-2 days). See Architecture Pattern 1. |
| CHAIN-02 | The campaign sequence definition dictates what the first action is (profile_view, connect, message) -- not hardcoded | `linkedinSequence[0].type` already drives the first action type in both deploy.ts and signal-campaigns.ts. The fix removes the hardcoded "if connect, prepend profile_view" logic from pre-warm.ts. Sequence order is purely data-driven. |
| CHAIN-03 | Reply-triggered P1 connections (linkedin-fast-track.ts) are completely untouched -- no pre-warming, immediate execution | `trigger/linkedin-fast-track.ts` is a separate code path that calls `enqueueAction` directly with priority=1 and `scheduledFor: new Date()`. It never calls `scheduleProfileViewBeforeConnect`. No changes needed -- verify with a grep that no new imports are added. |
| CHAIN-04 | Profile views reliably fire before connections in campaign flows where that's the sequence order | Forward scheduling guarantees this: profile_view at T, connection at T + random(0-2 days). Unlike the current backwards model, there is zero possibility of the view being scheduled after the connect. |
| CHAIN-05 | Existing pending actions are migrated to the new chaining model without data loss | Migration script needed: for pending actions with `sequenceStepRef = 'pre_warm_view'`, verify their scheduling is correct relative to the associated connect action. No data loss risk -- migration only adjusts `sequenceStepRef` labelling and optionally adds `parentActionId` FK. See Migration section. |
</phase_requirements>

## Standard Stack

### Core

No new libraries needed. This is a pure refactor of existing scheduling logic using existing Prisma models and the `enqueueAction` function.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Prisma | 6.x (existing) | LinkedInAction model, queries | Already used throughout |
| @trigger.dev/sdk | existing | Trigger.dev tasks (fast-track is here) | Already used |

### Supporting

None -- no new dependencies.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Deploy-time scheduling (Option B) | Worker-side chaining (Option A) | Worker-side is more flexible (can react to action outcomes) but adds complexity to the worker, which is a separate Railway service. Deploy-time is simpler, centralised, and sufficient since we only need time-based chaining, not outcome-based chaining for campaign flows. |

**Installation:**
```bash
# No new packages needed
```

## Architecture Patterns

### Recommended Changes

```
src/lib/
├── campaigns/
│   └── deploy.ts              # MODIFY: flip scheduling order
├── linkedin/
│   ├── pre-warm.ts            # DEPRECATE: no longer needed
│   ├── queue.ts               # MINOR: add parentActionId to enqueueAction params
│   ├── chain.ts               # NEW: chainFollowUpActions() helper
│   ├── rate-limiter.ts        # UNCHANGED
│   ├── sequencing.ts          # UNCHANGED
│   └── types.ts               # MINOR: add parentActionId to EnqueueActionParams
├── pipeline/
│   └── signal-campaigns.ts    # MODIFY: same fix as deploy.ts
prisma/
└── schema.prisma              # MINOR: add parentActionId field to LinkedInAction
trigger/
└── linkedin-fast-track.ts     # DO NOT TOUCH
```

### Pattern 1: Deploy-Time Forward Chaining

**What:** At deploy time, schedule ALL actions in the sequence with correct relative time offsets. The first action fires at stagger time T. Each subsequent action fires at the previous action's time + random(0-2 days).

**When to use:** Campaign deploy (deploy.ts) and signal campaign deploy (signal-campaigns.ts).

**Current code (deploy.ts:280-304):**
```typescript
// CURRENT: Backwards -- schedules connect first, then retrofits profile_view before it
await enqueueAction({
  actionType: firstStep.type, // e.g. "connect"
  scheduledFor,
});
if (firstStep.type === "connect") {
  await scheduleProfileViewBeforeConnect({ connectScheduledFor: scheduledFor });
}
```

**New pattern:**
```typescript
// NEW: Forward -- schedules ALL steps in sequence order
const steps = linkedinSequence.sort((a, b) => a.position - b.position);
let cumulativeDelay = 0;

for (const step of steps) {
  const stepScheduledFor = new Date(
    baseScheduledFor.getTime() + cumulativeDelay
  );

  await enqueueAction({
    actionType: step.type as LinkedInActionType,
    messageBody: step.body,
    scheduledFor: stepScheduledFor,
    sequenceStepRef: `linkedin_${step.position}`,
    // Optional: link to previous action for observability
    // parentActionId: previousActionId,
  });

  // Add 0-2 day random delay for next step
  const delayDays = step.delayDays ?? (Math.random() * 2); // 0-2 days
  cumulativeDelay += delayDays * 24 * 60 * 60 * 1000;
}
```

### Pattern 2: Shared Chaining Helper

**What:** Extract the chaining logic into a reusable `chainFollowUpActions()` function in `src/lib/linkedin/chain.ts` so both deploy.ts and signal-campaigns.ts use identical logic.

**When to use:** Any code path that deploys a multi-step LinkedIn sequence for a single lead.

```typescript
// src/lib/linkedin/chain.ts
export interface ChainActionsParams {
  senderId: string;
  personId: string;
  workspaceSlug: string;
  sequence: Array<{
    position: number;
    type: string;
    body?: string;
    delayDays?: number;
  }>;
  baseScheduledFor: Date;
  priority: number;
  campaignName?: string;
}

export async function chainActions(params: ChainActionsParams): Promise<string[]> {
  const { sequence, baseScheduledFor, ...common } = params;
  const sorted = [...sequence].sort((a, b) => a.position - b.position);
  const actionIds: string[] = [];
  let cumulativeMs = 0;

  for (const step of sorted) {
    if (step.position > 1) {
      // Random 0-2 day delay between steps (configurable via step.delayDays)
      const delayDays = step.delayDays ?? (Math.random() * 2);
      cumulativeMs += delayDays * 24 * 60 * 60 * 1000;
    }

    const scheduledFor = new Date(baseScheduledFor.getTime() + cumulativeMs);

    const actionId = await enqueueAction({
      ...common,
      actionType: step.type as LinkedInActionType,
      messageBody: step.body,
      scheduledFor,
      sequenceStepRef: `linkedin_${step.position}`,
    });

    actionIds.push(actionId);
  }

  return actionIds;
}
```

### Anti-Patterns to Avoid

- **Backwards scheduling:** Never schedule an action in the past relative to a reference point. The entire point of this phase is eliminating this pattern.
- **Modifying linkedin-fast-track.ts:** This is a P1 reply-triggered flow that works correctly. Adding pre-warming or chaining to it would slow down warm lead connections.
- **Worker-side chaining for campaign flows:** The worker runs on Railway and doesn't have access to campaign sequence definitions. Keep chaining logic in the Next.js app.
- **Hardcoding action order:** The sequence definition (linkedinSequence array) must drive the order. Don't hardcode "profile_view always comes first".

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Action enqueueing | Custom DB insert | `enqueueAction()` from queue.ts | Handles dedup, all field defaults, cross-campaign dedup |
| Rate limiting | Custom budget logic | `checkBudget()` from rate-limiter.ts | Handles warmup tiers, jitter, P1 reservation, circuit breaker |
| Follow-up sequencing (event-triggered) | Custom event handler | `evaluateSequenceRules()` + `CampaignSequenceRule` | Already handles connection_accepted and email_sent triggers |

**Key insight:** The existing sequencing infrastructure (`CampaignSequenceRule`, `evaluateSequenceRules`) handles EVENT-triggered follow-ups (e.g. "send message after connection accepted"). The new chaining handles TIME-triggered follow-ups at deploy time (e.g. "view profile, then connect 1-2 days later"). These are complementary, not competing systems.

## Common Pitfalls

### Pitfall 1: Dedup Blocking Chained Actions
**What goes wrong:** `enqueueAction` has cross-campaign dedup that blocks actions of the same type for the same person within 30 days. If a profile_view is enqueued for person X, and then a second campaign also tries to enqueue a profile_view for person X, it gets silently deduped.
**Why it happens:** The dedup logic (queue.ts:32-55) checks `personId + workspaceSlug + actionType` regardless of campaign.
**How to avoid:** This is actually correct behaviour -- we DON'T want to view the same profile twice from the same workspace. But be aware that chained actions of DIFFERENT types (profile_view then connect) won't trigger dedup because they're different actionTypes.
**Warning signs:** Action counts in deploy logs don't match expected counts.

### Pitfall 2: Stagger Time + Chain Delay Interaction
**What goes wrong:** The stagger (15 min per lead) spaces out the FIRST action. If the chain delay is 0 days (minimum of the 0-2 range), the second action fires at the same stagger time as the first, which could cause a burst of second actions.
**Why it happens:** Random(0, 2) can produce values very close to 0.
**How to avoid:** Set a minimum chain delay of e.g. 4 hours to ensure actions are always meaningfully separated. Or accept that the stagger already spaces things out adequately per lead.
**Warning signs:** Daily rate limit exhaustion on the second action type.

### Pitfall 3: Migration Breaks In-Flight Actions
**What goes wrong:** Existing pending pre_warm_view actions have their scheduling based on the OLD model. Adding a parentActionId column doesn't retroactively fix their timing.
**Why it happens:** Schema migration adds a column but doesn't re-calculate scheduling.
**How to avoid:** The migration script should identify pending pre_warm_view actions and verify they fire BEFORE their associated connect. If any are scheduled AFTER the connect, fix the timing. Most will be fine since they were scheduled correctly when created.
**Warning signs:** Profile views firing after connections in the days following deployment.

### Pitfall 4: Signal Campaign Priority Interaction
**What goes wrong:** Signal campaigns use priority 3 (higher than campaign P5). If both a campaign and signal try to chain actions for the same person, the signal's P3 action could fire before the campaign's P5 profile_view.
**Why it happens:** Priority ordering in getNextBatch (queue.ts:114) ranks P3 above P5.
**How to avoid:** This is actually correct -- signal-triggered actions SHOULD take priority. But document this interaction clearly.
**Warning signs:** None -- this is expected behaviour.

## Code Examples

### Current Backwards Flow (deploy.ts:280-304) -- TO BE REPLACED

```typescript
// Lines 280-304 of deploy.ts -- THE BUG
await enqueueAction({
  actionType: firstStep.type as LinkedInActionType, // "connect"
  scheduledFor,                                      // T
});

// Pre-warm: schedule a profile_view BEFORE connect (backwards)
if (firstStep.type === "connect" || firstStep.type === "connection_request") {
  await scheduleProfileViewBeforeConnect({
    connectScheduledFor: scheduledFor,  // T
    // Calculates: T - random(1-2 days) -- CAN BE IN THE PAST
  });
}
```

### Identical Pattern in signal-campaigns.ts:412-438

```typescript
// Lines 412-438 of signal-campaigns.ts -- SAME BUG
const connectScheduledFor = new Date(Date.now() + leadsDeployed * 15 * 60 * 1000);
await enqueueAction({
  actionType: firstStep.type as LinkedInActionType,
  scheduledFor: connectScheduledFor,
});
if (firstStep.type === "connect" || firstStep.type === "connection_request") {
  await scheduleProfileViewBeforeConnect({
    connectScheduledFor,
  });
}
```

### linkedin-fast-track.ts -- DO NOT TOUCH

```typescript
// This is correct and must remain unchanged:
const actionId = await enqueueAction({
  actionType: "connect",
  priority: 1,
  scheduledFor: new Date(), // ASAP, no chaining, no pre-warming
});
```

### EnqueueActionParams (types.ts) -- Minor Addition

```typescript
export interface EnqueueActionParams {
  // ... existing fields ...
  parentActionId?: string; // Optional: links chained actions for observability
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Schedule connect first, backfill profile_view before it | Schedule first sequence action, chain follow-ups forward | Phase 68 | Eliminates "scheduled in the past" failure class |
| pre-warm.ts with backwards time calculation | chain.ts with forward time offsets | Phase 68 | Simpler, no edge cases around short lead times |
| Hardcoded "if connect, add profile_view" | Sequence-defined action order | Phase 68 | Supports any action ordering (e.g. [message, connect] or [view, connect, message]) |

**Deprecated/outdated:**
- `src/lib/linkedin/pre-warm.ts`: Will be deprecated. The `scheduleProfileViewBeforeConnect` function is the root of the backwards scheduling bug. All callers (deploy.ts and signal-campaigns.ts) will be updated to use the new chainActions helper instead. The file can be kept but marked as deprecated with a TODO to remove once no pending actions reference `pre_warm_view`.

## Migration Strategy

### Schema Change
Add optional `parentActionId` field to `LinkedInAction` for observability (not functional -- purely for tracking which actions were chained together):

```prisma
model LinkedInAction {
  // ... existing fields ...
  parentActionId String? // ID of the action this was chained from (null for primary actions)
}
```

This is a nullable field addition -- no data migration needed for existing records.

### Pending Action Migration
For existing pending actions with `sequenceStepRef = 'pre_warm_view'`:
1. Query all pending `pre_warm_view` actions
2. For each, find the associated connect action (same personId + senderId + campaignName, status=pending)
3. Verify the profile_view is scheduled BEFORE the connect
4. If not, adjust the profile_view to fire 1-4 hours before the connect (or 5 min before if connect is imminent)
5. Log any corrections made

Expected volume: low (only actions scheduled since last deploy that haven't executed yet).

### Rollout Safety
- Deploy the code change first (new deploys use forward chaining)
- Run the migration script to fix any in-flight backwards-scheduled actions
- Monitor for 48 hours: verify profile_views fire before connections in logs
- After validation period, mark pre-warm.ts as deprecated

## Open Questions

1. **Minimum chain delay**
   - What we know: Random(0, 2) days can produce very small values (minutes)
   - What's unclear: Should there be a minimum gap between chained actions (e.g. 4 hours)?
   - Recommendation: Set minimum to 4 hours (configurable). This ensures meaningful separation without being too long. If the user prefers a different minimum, it can be adjusted in the chain helper.

2. **parentActionId: functional or observability-only?**
   - What we know: Adding a parentActionId FK would let us query "what was chained from what"
   - What's unclear: Is this worth the schema change, or is sequenceStepRef sufficient?
   - Recommendation: Add it as a nullable string field (no FK constraint) for observability. The planner can decide to skip it if the overhead isn't justified. It has no functional impact on scheduling.

3. **Should pre-warm.ts be deleted or deprecated?**
   - What we know: No callers will use it after the fix
   - What's unclear: Are there any pending actions with `pre_warm_view` that reference it?
   - Recommendation: Keep the file but add a deprecation comment. Delete in a future cleanup phase once no pending actions reference `pre_warm_view`.

## Sources

### Primary (HIGH confidence)
- `src/lib/campaigns/deploy.ts` (lines 210-344) -- campaign LinkedIn deployment, the bug site
- `src/lib/linkedin/pre-warm.ts` (full file) -- backwards scheduling logic
- `src/lib/linkedin/queue.ts` (full file) -- enqueueAction, dedup, batch selection
- `src/lib/pipeline/signal-campaigns.ts` (lines 390-447) -- identical bug in signal campaigns
- `trigger/linkedin-fast-track.ts` (full file) -- P1 fast-track, must not be modified
- `src/lib/linkedin/sequencing.ts` (full file) -- CampaignSequenceRule evaluation
- `src/lib/linkedin/types.ts` (full file) -- type definitions, EnqueueActionParams
- `prisma/schema.prisma` (LinkedInAction model, lines 952-995) -- current schema, no parentActionId

### Secondary (MEDIUM confidence)
- `worker/src/worker.ts` (lines 1-60) -- worker polls getNextBatch, executes actions. Worker doesn't need changes.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new libraries, pure refactor of existing code
- Architecture: HIGH - all source files read and understood, clear bug site and fix pattern
- Pitfalls: HIGH - identified from direct code analysis (dedup logic, stagger interaction, migration)

**Research date:** 2026-04-07
**Valid until:** 2026-05-07 (stable -- internal codebase, no external dependency changes)
