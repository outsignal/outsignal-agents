# Phase 73: Campaign Deploy Refactor - Research

**Researched:** 2026-04-08
**Domain:** Campaign deployment write path refactoring (adapter pattern integration)
**Confidence:** HIGH

## Summary

Phase 73 is the highest-risk phase in the v10.0 milestone because it touches the write path that creates real EmailBison campaigns, pushes real leads, and enqueues real LinkedIn actions. The existing `deploy.ts` file (632 lines) contains two cleanly separated channel functions (`deployEmailChannel` at line 79 and `deployLinkedInChannel` at line 210), an orchestrator (`executeDeploy` at line 411), a retry function (`retryDeployChannel` at line 547), and a status finalizer (`finalizeDeployStatus` at line 362). Each channel function manages its own CampaignDeploy status updates, error handling, and retry logic. The refactor moves channel-specific logic into the adapter classes (whose `deploy()` methods are currently stubs throwing "Phase 73" errors) while preserving the orchestrator, finalizer, and Trigger.dev task shell unchanged.

The `DeployParams` type defined in `types.ts` does NOT match what the existing deploy functions actually need. `deployEmailChannel` requires `apiToken` and the full email sequence with A/B variants. `deployLinkedInChannel` requires `hasEmailChannel` flag and the LinkedIn sequence with trigger events. The adapter `deploy()` signature must be extended or the adapters must resolve these internally. The cleanest approach: adapters resolve their own dependencies (workspace apiToken, campaign sequences, target list) from the database, keeping the `DeployParams` lean and the orchestrator simple.

**Primary recommendation:** Move channel function bodies into adapter classes, extend `DeployParams` to carry `deployId` for CampaignDeploy status updates, and have adapters resolve their own workspace/sequence dependencies internally -- preserving every status update, error handler, retry delay, and notification exactly as-is.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CAMP-01 | Campaign deployment uses adapters (`executeDeploy` resolves adapter per channel, no direct EmailBison/LinkedIn calls) | Full function-by-function mapping of `deployEmailChannel` (lines 79-204) and `deployLinkedInChannel` (lines 210-355) into adapter classes; `executeDeploy` orchestrator becomes a channel loop calling `getAdapter(ch).deploy()` |
| CAMP-02 | Campaign pause/resume uses adapters | `EmailAdapter.pause()` and `resume()` already implemented (lines 54-78 of email-adapter.ts); `LinkedInAdapter.pause()` already implemented (line 44); bounce-monitor.ts direct `pauseCampaign`/`resumeCampaign` calls are OUT OF SCOPE (channel-specific operational task, per anti-pattern 3 from ARCHITECTURE.md) |
| CAMP-03 | `CampaignChannelRef` replaces direct `emailBisonCampaignId` lookups across the codebase | 38 references to `emailBisonCampaignId` across 14 files; Phase 73 scope is deploy.ts and retry paths only; portal/analytics references are Phase 74/75 scope |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | ^5 | Type-safe adapter interface and deploy logic | Already installed, strict mode |
| Prisma | ^6.19.2 | CampaignDeploy status updates, Campaign reads | Existing ORM, no migration needed |
| @trigger.dev/sdk | existing | campaign-deploy task shell (unchanged) | Already wired, no changes needed |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | ^4.0.18 | Unit tests for refactored deploy logic | Adapter contract tests already exist from Phase 72 |

**Installation:** No new packages required.

## Architecture Patterns

### Current Deploy Flow (MUST preserve exactly)

```
API Route (POST /api/campaigns/[id]/deploy)
  |-- Validates approvals, creates CampaignDeploy record
  |-- Triggers "campaign-deploy" Trigger.dev task
  |
  v
trigger/campaign-deploy.ts
  |-- Calls executeDeploy() or retryDeployChannel()
  |
  v
executeDeploy(campaignId, deployId)
  |-- Mark deploy status "running"
  |-- Load campaign via getCampaign()
  |-- Validate status === "deployed" or "active"
  |-- Load workspace apiToken
  |-- Parse channels array
  |-- if email: deployEmailChannel(deployId, campaignId, name, slug, sequence, apiToken)
  |-- else: mark emailStatus "skipped"
  |-- if linkedin: deployLinkedInChannel(deployId, campaignId, slug, sequence, hasEmail)
  |-- else: mark linkedinStatus "skipped"
  |-- finalizeDeployStatus(deployId, channels)
  |-- notifyDeploy() + notifyCampaignLive() (non-blocking)
  |-- catch: mark status "failed" if still "running"
```

### Target Deploy Flow (after refactor)

```
executeDeploy(campaignId, deployId)   <-- SAME public API
  |-- Mark deploy status "running"     <-- SAME
  |-- Load campaign via getCampaign()  <-- SAME
  |-- Validate status                  <-- SAME
  |-- Parse channels array             <-- SAME
  |-- initAdapters()                   <-- NEW (one line)
  |-- for each channel:
  |     if channel in campaign.channels:
  |       adapter = getAdapter(channel)
  |       adapter.deploy(params)       <-- NEW (replaces inline channel call)
  |     else:
  |       mark channelStatus "skipped" <-- SAME
  |-- finalizeDeployStatus()           <-- SAME
  |-- notifyDeploy() + notifyCampaignLive()  <-- SAME
  |-- catch: same error handler        <-- SAME
```

### Pattern 1: Adapter Deploy with Internal Dependency Resolution

**What:** Each adapter's `deploy()` method resolves its own dependencies (apiToken, sequences, target list leads) from the database rather than receiving them as parameters.

**When to use:** Always for deploy -- the alternative (passing everything through DeployParams) creates a massive parameter object that differs per channel and defeats the purpose of the adapter pattern.

**Example:**
```typescript
// EmailAdapter.deploy() — resolves its own dependencies
async deploy(params: DeployParams): Promise<DeployResult> {
  const { deployId, campaignId, campaignName, workspaceSlug } = params;

  // Mark channel running
  await prisma.campaignDeploy.update({
    where: { id: deployId },
    data: { emailStatus: "running" },
  });

  // Resolve dependencies internally
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { slug: workspaceSlug },
    select: { apiToken: true },
  });
  if (!workspace.apiToken) throw new Error(`No API token for ${workspaceSlug}`);

  const campaign = await getCampaign(campaignId);
  const emailSequence = (campaign?.emailSequence ?? []) as EmailSequenceStep[];

  const ebClient = new EmailBisonClient(workspace.apiToken);

  try {
    // ... exact same logic as deployEmailChannel lines 97-191 ...

    await prisma.campaignDeploy.update({
      where: { id: deployId },
      data: { emailStatus: "complete", emailStepCount, leadCount, emailError: null },
    });
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.campaignDeploy.update({
      where: { id: deployId },
      data: { emailStatus: "failed", emailError: message },
    });
    return { success: false, error: message };
  }
}
```

### Pattern 2: DeployParams Extension

**What:** `DeployParams` (from types.ts) needs `deployId` added. The current type has `deployId` but is missing some context the orchestrator should pass.

**Current DeployParams:**
```typescript
export interface DeployParams {
  deployId: string;
  campaignId: string;
  campaignName: string;
  workspaceSlug: string;
  sequence: UnifiedStep[];  // <-- PROBLEM: not what deploy needs
}
```

**Required changes:**
- Remove `sequence: UnifiedStep[]` -- adapters resolve their own sequences from the DB
- Add `hasOtherChannels?: Record<string, boolean>` -- LinkedIn needs to know if email is also deploying (affects sender assignment mode)

**Recommended DeployParams:**
```typescript
export interface DeployParams {
  deployId: string;
  campaignId: string;
  campaignName: string;
  workspaceSlug: string;
  channels: string[];  // all channels being deployed (adapter uses for cross-channel awareness)
}
```

### Pattern 3: Status Update Ownership

**What:** Each adapter owns its channel's status updates on CampaignDeploy. The orchestrator owns the overall status.

**Critical detail:** `deployEmailChannel` writes `emailBisonCampaignId` to BOTH `CampaignDeploy` AND `Campaign` records (lines 103-111). This dual write MUST be preserved in EmailAdapter.deploy().

### Anti-Patterns to Avoid

- **Moving orchestrator logic into adapters:** The `executeDeploy` orchestrator (status validation, channel loop, finalization, notifications) stays in `deploy.ts`. Adapters only own channel-specific execution.
- **Changing error semantics:** Currently `deployEmailChannel` throws on failure (after updating CampaignDeploy to "failed"). The orchestrator catches at the top level. This throw-through pattern must be preserved OR the adapter must return `DeployResult.success = false` and the orchestrator must check it. Recommend: adapter catches internally, updates CampaignDeploy, returns DeployResult. Orchestrator checks `result.success` and throws if needed.
- **Touching the Trigger.dev task:** `trigger/campaign-deploy.ts` calls `executeDeploy()` and `retryDeployChannel()` -- these public APIs stay unchanged. The task file needs zero modifications.

## Function-by-Function Migration Map

This is the critical reference for the planner. Every function, every status update, every error handler.

### deployEmailChannel (lines 79-204) -> EmailAdapter.deploy()

| Line(s) | What it does | Migration |
|----------|-------------|-----------|
| 88 | Update emailStatus to "running" | Move into adapter |
| 93 | Create EmailBisonClient with apiToken | Adapter resolves apiToken internally |
| 97-100 | Create EB campaign with retry | Move into adapter (keep withRetry) |
| 103-111 | Store ebCampaignId on CampaignDeploy AND Campaign | Move into adapter (CRITICAL: dual write) |
| 116-126 | Create sequence steps with retry | Move into adapter |
| 129-132 | Load campaign + validate targetListId | Move into adapter |
| 134-141 | Query TargetListPerson with Person + workspace join | Move into adapter |
| 147-181 | Push leads serially (dedup, 100ms throttle) | Move into adapter (keep exact timing) |
| 183-192 | Update emailStatus "complete" with counts | Move into adapter |
| 193-203 | Catch block: update emailStatus "failed", re-throw | Move into adapter |

### deployLinkedInChannel (lines 210-355) -> LinkedInAdapter.deploy()

| Line(s) | What it does | Migration |
|----------|-------------|-----------|
| 218 | Update linkedinStatus to "running" | Move into adapter |
| 221-227 | Load campaign + validate targetListId | Move into adapter |
| 229-232 | Query TargetListPerson with Person | Move into adapter |
| 234-245 | Handle empty sequence (mark complete, clean up rules) | Move into adapter |
| 254-258 | Ensure profile_view first step | Move into adapter |
| 261-268 | Connection gate split (pre/post connect) | Move into adapter |
| 273-316 | Lead loop: assign sender, stagger timing, chainActions | Move into adapter (keep exact jitter + stagger) |
| 322-334 | Create CampaignSequenceRules for post-connect | Move into adapter |
| 336-342 | Update linkedinStatus "complete" | Move into adapter |
| 343-354 | Catch block: update linkedinStatus "failed", re-throw | Move into adapter |

### executeDeploy (lines 411-541) -> STAYS in deploy.ts (refactored)

| Line(s) | What it does | Migration |
|----------|-------------|-----------|
| 418 | Mark status "running" | Keep |
| 423-428 | Load campaign, validate | Keep |
| 435-441 | Load workspace apiToken | REMOVE (adapters resolve internally) |
| 447-448 | Parse channels | Keep |
| 452-468 | Email deploy or skip | Replace with adapter call or skip |
| 470-484 | LinkedIn deploy or skip | Replace with adapter call or skip |
| 487 | finalizeDeployStatus | Keep |
| 490-514 | Notifications | Keep |
| 517-540 | Top-level error handler | Keep (may need adjustment if adapters return result vs throw) |

### retryDeployChannel (lines 547-621) -> STAYS in deploy.ts (refactored)

| Line(s) | What it does | Migration |
|----------|-------------|-----------|
| 551-559 | Load deploy record | Keep |
| 561 | Parse channels | Keep |
| 565-579 | Reset channel status | Keep |
| 582-590 | Load workspace apiToken | REMOVE (adapters resolve internally) |
| 593-596 | Load campaign | Keep (still needed for validation) |
| 598-617 | Call channel-specific function | Replace with adapter call |
| 620 | Finalize | Keep |

### finalizeDeployStatus (lines 362-398) -> STAYS in deploy.ts (unchanged)

No changes needed. It reads per-channel statuses from CampaignDeploy and computes overall status.

### withRetry (lines 55-73) -> STAYS in deploy.ts OR moves to shared util

The retry helper is used by both channel functions. If it moves into adapters, each adapter needs access. Options:
1. Keep in deploy.ts and export it (adapters import it) -- SIMPLEST
2. Move to a shared util like `src/lib/utils/retry.ts`
3. Duplicate in each adapter -- BAD

**Recommendation:** Export from deploy.ts or move to `src/lib/utils/retry.ts`.

## CAMP-03: CampaignChannelRef Scope for Phase 73

The `CampaignChannelRef` type already exists in `types.ts`:
```typescript
export interface CampaignChannelRef {
  campaignId: string;
  workspaceSlug: string;
  campaignName: string;
  emailBisonCampaignId?: number;
}
```

**Phase 73 scope for CAMP-03:**
- `deploy.ts` lines 103-111: `emailBisonCampaignId` write moves inside EmailAdapter (adapter-internal, consumers never see it)
- `retryDeployChannel` lines 551-559: reads `campaignName`, `workspaceSlug` from CampaignDeploy -- should construct a CampaignChannelRef
- `executeDeploy` passes ref to adapters via DeployParams (which carries campaignId, campaignName, workspaceSlug)

**NOT Phase 73 scope** (14+ files with emailBisonCampaignId refs):
- `snapshot.ts` (Phase 75)
- `outbound-copy-lookup.ts` (future)
- Portal pages (Phase 74)
- Webhook handler (out of scope per REQUIREMENTS.md)
- `DeployHistory.tsx` (read-only UI, low priority)

## CAMP-02: Pause/Resume Through Adapters

**Current state:** `EmailAdapter.pause()` and `resume()` are already implemented in Phase 72. `LinkedInAdapter.pause()` cancels pending actions; `resume()` is a no-op with warning.

**Missing piece:** No API route or business logic currently calls `adapter.pause()` or `adapter.resume()`. The `status/route.ts` handles campaign STATUS transitions (draft -> active -> paused) but does NOT call EmailBison pause/resume.

**What Phase 73 needs to build:**
1. A `pauseCampaign(campaignId)` function that resolves adapters and calls `adapter.pause()` for each channel
2. A `resumeCampaign(campaignId)` function that does the same for `adapter.resume()`
3. Wire these into the campaign status transition (when status changes to "paused", call pause; when "active" from "paused", call resume)

**Important nuance:** The bounce-monitor.ts directly calls `ebClient.pauseCampaign()` and `ebClient.resumeCampaign()` -- this is an email-only operational concern and should NOT be changed (per anti-pattern 3: don't force channel-specific tasks through adapters).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Retry with backoff | Custom retry in each adapter | Existing `withRetry()` helper from deploy.ts | Already handles exponential backoff (1s/5s/15s), proven in production |
| Channel resolution | Inline if/else on channel string | `getAdapter(channel)` from registry | Single dispatch point, extensible for future channels |
| Status finalization | Per-adapter overall status logic | Existing `finalizeDeployStatus()` | Complex multi-channel status matrix already correct |
| Adapter initialization | Per-call adapter creation | `initAdapters()` singleton pattern | Already built in Phase 71, handles idempotent init |

## Common Pitfalls

### Pitfall 1: Breaking the emailBisonCampaignId Dual Write
**What goes wrong:** EmailAdapter.deploy() stores the new EB campaign ID on CampaignDeploy but forgets to also write it to Campaign.emailBisonCampaignId. Portal, analytics, and webhook handler all read from Campaign.emailBisonCampaignId.
**Why it happens:** Easy to miss that deploy.ts lines 103-111 write to BOTH records.
**How to avoid:** Verify the dual write in EmailAdapter.deploy(). Test: after deploy, both `CampaignDeploy.emailBisonCampaignId` and `Campaign.emailBisonCampaignId` must be set.
**Warning signs:** Portal shows blank stats for newly deployed email campaigns.

### Pitfall 2: Adapter Throws vs Returns DeployResult
**What goes wrong:** The current deploy functions throw on failure (after updating CampaignDeploy status). If the adapter returns `{ success: false }` instead of throwing, the orchestrator's top-level catch block never fires, and the overall deploy status is never set to "failed".
**Why it happens:** Mismatch between adapter return pattern and orchestrator error handling pattern.
**How to avoid:** Choose ONE pattern and use it consistently. Recommendation: adapter catches internally, updates channel status, then RE-THROWS so the orchestrator catch block still works. This matches existing behavior exactly.
**Warning signs:** Deploy fails silently -- CampaignDeploy status stuck at "running".

### Pitfall 3: Lost withRetry in Adapter Migration
**What goes wrong:** The retry wrapper (`withRetry`) wrapping EB API calls (createCampaign, createSequenceStep, createLead) gets dropped during migration because it looks like scaffolding.
**Why it happens:** Developer moves the "business logic" but not the retry wrapping.
**How to avoid:** Map every `withRetry(() => ...)` call in the original and verify it appears in the adapter. There are 4 in deployEmailChannel: createCampaign, createSequenceStep (in loop), createLead (in loop).
**Warning signs:** Transient EB API failures cause full deploy failures instead of being retried.

### Pitfall 4: LinkedIn Sender Assignment Mode
**What goes wrong:** `assignSenderForPerson` is called with `mode: hasEmailChannel ? "email_linkedin" : "linkedin_only"`. If the adapter doesn't know whether email is also being deployed, it uses the wrong mode, potentially assigning senders that conflict with email senders.
**Why it happens:** `hasEmailChannel` is a cross-channel concern -- it depends on what OTHER channels are deploying.
**How to avoid:** Pass `channels: string[]` in DeployParams so LinkedInAdapter can derive `hasEmailChannel` from `channels.includes("email")`.
**Warning signs:** Dual-channel campaigns get sender conflicts.

### Pitfall 5: 100ms Lead Throttle Dropped
**What goes wrong:** The 100ms delay between lead pushes in deployEmailChannel (line 180) gets dropped. EmailBison API gets hammered, leads get rate-limited or rejected.
**Why it happens:** Looks like a minor implementation detail, easy to forget.
**How to avoid:** Verify the `await new Promise(resolve => setTimeout(resolve, 100))` is preserved in EmailAdapter.deploy().
**Warning signs:** Deploy works in test (few leads), fails in production (hundreds of leads).

### Pitfall 6: initAdapters() Not Called
**What goes wrong:** `getAdapter(channel)` throws "No adapter registered" because `initAdapters()` was never called before the deploy flow.
**Why it happens:** The adapter registry is empty until `initAdapters()` bootstraps it.
**How to avoid:** Call `initAdapters()` at the top of `executeDeploy()` and `retryDeployChannel()`. It's idempotent (safe to call multiple times).
**Warning signs:** ALL deploys fail with "No adapter registered for channel" error.

## Code Examples

### Refactored executeDeploy (target state)
```typescript
export async function executeDeploy(
  campaignId: string,
  deployId: string,
): Promise<void> {
  initAdapters(); // Ensure adapters registered

  await prisma.campaignDeploy.update({
    where: { id: deployId },
    data: { status: "running" },
  });

  try {
    const campaign = await getCampaign(campaignId);
    if (!campaign) throw new Error(`Campaign not found: ${campaignId}`);
    if (campaign.status !== "deployed" && campaign.status !== "active") {
      throw new Error(`Campaign not in deployable status (got '${campaign.status}')`);
    }

    const channels = campaign.channels;

    // Deploy each channel via adapter
    for (const channel of ["email", "linkedin"] as const) {
      if (channels.includes(channel)) {
        const adapter = getAdapter(channel);
        await adapter.deploy({
          deployId,
          campaignId,
          campaignName: campaign.name,
          workspaceSlug: campaign.workspaceSlug,
          channels,  // LinkedInAdapter needs this for sender mode
        });
      } else {
        // Mark skipped
        const statusField = channel === "email" ? "emailStatus" : "linkedinStatus";
        await prisma.campaignDeploy.update({
          where: { id: deployId },
          data: { [statusField]: "skipped" },
        });
      }
    }

    // Finalize + notify (unchanged)
    await finalizeDeployStatus(deployId, channels);
    // ... notification logic unchanged ...
  } catch (err) {
    // ... same top-level error handler ...
  }
}
```

### CampaignChannelRef Construction Helper
```typescript
function buildChannelRef(campaign: CampaignDetail): CampaignChannelRef {
  return {
    campaignId: campaign.id,
    workspaceSlug: campaign.workspaceSlug,
    campaignName: campaign.name,
    emailBisonCampaignId: campaign.emailBisonCampaignId ?? undefined,
  };
}
```

### Pause/Resume Orchestrator
```typescript
export async function pauseCampaignChannels(campaignId: string): Promise<void> {
  initAdapters();
  const campaign = await getCampaign(campaignId);
  if (!campaign) throw new Error(`Campaign not found: ${campaignId}`);

  const ref = buildChannelRef(campaign);

  for (const channel of campaign.channels) {
    const adapter = getAdapter(channel as ChannelType);
    await adapter.pause(ref);
  }
}

export async function resumeCampaignChannels(campaignId: string): Promise<void> {
  initAdapters();
  const campaign = await getCampaign(campaignId);
  if (!campaign) throw new Error(`Campaign not found: ${campaignId}`);

  const ref = buildChannelRef(campaign);

  for (const channel of campaign.channels) {
    const adapter = getAdapter(channel as ChannelType);
    await adapter.resume(ref);
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Inline `deployEmailChannel()` / `deployLinkedInChannel()` in deploy.ts | Adapter.deploy() with registry dispatch | Phase 73 (this phase) | Deploy logic encapsulated per-channel, extensible for future channels |
| Direct `emailBisonCampaignId` lookups | CampaignChannelRef abstraction | Phase 73 (partial, deploy scope only) | Deploy path uses ref, portal/analytics migrate in Phase 74/75 |
| No campaign pause/resume at adapter level | adapter.pause() / adapter.resume() wired to status transitions | Phase 73 (this phase) | Pause/resume works through unified interface |

## Open Questions

1. **DeployParams.sequence removal**
   - What we know: The current `DeployParams` type has `sequence: UnifiedStep[]` but deploy functions need raw email/LinkedIn sequence types (with A/B variants, trigger events, etc.)
   - What's unclear: Whether to update `DeployParams` to remove `sequence` or keep it for non-deploy uses
   - Recommendation: Remove `sequence` from `DeployParams`, add `channels: string[]`. Adapters resolve their own sequences from the DB. This keeps the interface clean and avoids type gymnastics.

2. **Error semantics: throw vs return**
   - What we know: Current channel functions throw after updating status. Orchestrator has a catch block.
   - What's unclear: Whether adapter.deploy() should throw (matching current behavior) or return DeployResult
   - Recommendation: Throw on failure (after updating channel status), matching current behavior. DeployResult.success is redundant if exceptions are the error path. This preserves the orchestrator's catch block unchanged.

3. **Status route pause/resume wiring**
   - What we know: The status/route.ts handles state transitions and auto-triggers deploy, but never calls EB pause/resume
   - What's unclear: Whether Phase 73 should wire pause/resume into the status transition or leave it for future work
   - Recommendation: Wire it in Phase 73 -- CAMP-02 requires it. When status transitions to "paused", call `pauseCampaignChannels()`. When transitioning from "paused" to "active", call `resumeCampaignChannels()`.

## Sources

### Primary (HIGH confidence)
- `src/lib/campaigns/deploy.ts` -- Full deploy logic, 632 lines, every function mapped
- `src/lib/channels/types.ts` -- DeployParams and CampaignChannelRef types
- `src/lib/channels/email-adapter.ts` -- Current stub deploy, working pause/resume
- `src/lib/channels/linkedin-adapter.ts` -- Current stub deploy, working pause
- `src/lib/channels/registry.ts` -- getAdapter() factory
- `src/lib/channels/constants.ts` -- All channel/status constants
- `src/app/api/campaigns/[id]/deploy/route.ts` -- Deploy API entry point
- `trigger/campaign-deploy.ts` -- Trigger.dev task shell
- `src/app/api/campaigns/[id]/status/route.ts` -- Status transitions + auto-deploy
- `prisma/schema.prisma` -- CampaignDeploy and Campaign models
- `src/lib/campaigns/operations.ts` -- getCampaign() return type

### Secondary (MEDIUM confidence)
- `.planning/research/ARCHITECTURE.md` -- Deploy flow analysis and migration patterns
- `.planning/research/SUMMARY.md` -- v10.0 architecture decisions and pitfalls

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- zero new dependencies, all codebase-verified
- Architecture: HIGH -- every function line-mapped from source, deploy flow traced end-to-end
- Pitfalls: HIGH -- all 6 pitfalls grounded in actual code patterns observed during research

**Research date:** 2026-04-08
**Valid until:** 2026-05-08 (stable domain, internal refactor)
