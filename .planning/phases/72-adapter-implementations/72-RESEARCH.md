# Phase 72: Adapter Implementations - Research

**Researched:** 2026-04-08
**Domain:** Channel adapter pattern -- concrete implementations wrapping EmailBison + LinkedIn
**Confidence:** HIGH

## Summary

Phase 72 implements the two concrete channel adapters (email and LinkedIn) against the ChannelAdapter interface defined in Phase 71, plus channel-aware sender query helpers and workspace channel configuration. The interface contract is already locked: 7 methods (`deploy`, `pause`, `resume`, `getMetrics`, `getLeads`, `getActions`, `getSequenceSteps`) plus a readonly `channel` discriminator. Five unified types (`UnifiedLead`, `UnifiedAction`, `UnifiedMetrics`, `UnifiedStep`, `CampaignChannelRef`) define the data shapes.

The critical insight from milestone research is: **build the LinkedIn adapter FIRST**. The interface was designed to be channel-agnostic, but the risk of unconscious email bias is real. If the LinkedIn adapter feels awkward to implement, the interface needs adjustment before the email adapter cements it. Both adapters are thin facades -- they delegate to existing modules (`EmailBisonClient` for email, Prisma queries + `src/lib/linkedin/` helpers for LinkedIn) and contain zero new business logic.

**Primary recommendation:** Implement LinkedIn adapter first to validate interface shape, then email adapter (which is mechanically simpler), then sender helpers and workspace channel config, then shared test suite.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ADAPT-01 | LinkedIn adapter implementing full ChannelAdapter interface | Wraps existing Prisma queries (LinkedInAction, LinkedInConnection, LinkedInDailyUsage) + chain.ts/sender.ts/sequencing.ts. All source code reviewed and mapped to interface methods below. |
| ADAPT-02 | Email adapter implementing full ChannelAdapter interface | Wraps existing EmailBisonClient methods (getCampaignById, getCampaignLeads, getSequenceSteps, pauseCampaign, resumeCampaign). All methods verified in client.ts. |
| ADAPT-03 | Adapter unit tests with mock implementations validating interface contract | Existing registry.test.ts has createMockAdapter pattern. Vitest + vi.fn() confirmed. Shared test suite pattern documented below. |
| SEND-01 | Sender queries use channel-aware helpers | 12 files contain `channel: { in: ['linkedin', 'both'] }` pattern. senderMatchesChannel() helper already exists in constants.ts. Need query helpers wrapping this. |
| SEND-02 | Workspace channel configuration | Workspace.package field already encodes channels ("email", "linkedin", "email_linkedin", "consultancy"). Need getEnabledChannels(workspace) function. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | ^5 | Adapter class implementation | Already in project, strict mode |
| Prisma | ^6.19.2 | LinkedIn adapter DB queries | Existing ORM, all models already defined |
| vitest | ^4.0.18 | Adapter test suite | Already configured with path aliases |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| EmailBisonClient | local | Email adapter wraps this | All email adapter methods |
| src/lib/linkedin/* | local | LinkedIn adapter wraps these | chain.ts, sender.ts, sequencing.ts, queue.ts |

**No new dependencies required.** Zero npm installs for this phase.

## Architecture Patterns

### Recommended File Structure
```
src/lib/channels/
  constants.ts          # EXISTS (Phase 71)
  types.ts              # EXISTS (Phase 71)
  registry.ts           # EXISTS (Phase 71)
  index.ts              # EXISTS (Phase 71) -- add new exports
  linkedin-adapter.ts   # NEW -- LinkedInAdapter class
  email-adapter.ts      # NEW -- EmailAdapter class
  sender-helpers.ts     # NEW -- channel-aware sender query functions
  workspace-channels.ts # NEW -- getEnabledChannels + initAdapters
  __tests__/
    constants.test.ts   # EXISTS (Phase 71)
    registry.test.ts    # EXISTS (Phase 71)
    adapter-contract.test.ts  # NEW -- shared test suite both adapters pass
    sender-helpers.test.ts    # NEW -- sender query helper tests
    workspace-channels.test.ts # NEW -- channel config tests
```

### Pattern 1: Adapter as Thin Facade
**What:** Each adapter method delegates to existing code. The adapter never contains business logic.
**When:** Always. Adapters are orchestrators, not implementors.

LinkedIn adapter method mapping (verified against codebase):

| Interface Method | LinkedIn Implementation |
|-----------------|------------------------|
| `deploy(params)` | Delegates to `deployLinkedInChannel()` from deploy.ts (but in Phase 72, only the adapter shell -- actual deploy wiring is Phase 73) |
| `pause(ref)` | Cancel all pending LinkedInActions for the campaign: `prisma.linkedInAction.updateMany({ where: { campaignName, workspaceSlug, status: 'pending' }, data: { status: 'cancelled' } })` |
| `resume(ref)` | No direct LinkedIn resume (actions are one-shot). Return void or re-enqueue cancelled actions if needed. |
| `getMetrics(ref)` | Count LinkedInActions by status + type for campaign. Use same queries as snapshot.ts lines 131-169. |
| `getLeads(ref)` | Query LinkedInActions with distinct personId for the campaign, join Person table. |
| `getActions(ref)` | Query LinkedInActions for the campaign, map to UnifiedAction. |
| `getSequenceSteps(ref)` | Query CampaignSequenceRules for campaignName + workspaceSlug, map to UnifiedStep. Also parse campaign.linkedinSequence JSON. |

Email adapter method mapping (verified against EmailBisonClient):

| Interface Method | Email Implementation |
|-----------------|---------------------|
| `deploy(params)` | Delegates to `deployEmailChannel()` from deploy.ts (Phase 73 wiring) |
| `pause(ref)` | `client.pauseCampaign(ref.emailBisonCampaignId!)` |
| `resume(ref)` | `client.resumeCampaign(ref.emailBisonCampaignId!)` |
| `getMetrics(ref)` | `client.getCampaignById(ref.emailBisonCampaignId!)` then map stats to UnifiedMetrics |
| `getLeads(ref)` | `client.getCampaignLeads(ref.emailBisonCampaignId!)` then map to UnifiedLead |
| `getActions(ref)` | No direct equivalent in EmailBison API. Query local Reply table for the campaign + return as UnifiedAction. |
| `getSequenceSteps(ref)` | `client.getSequenceSteps(ref.emailBisonCampaignId!)` then map to UnifiedStep. Or parse campaign.emailSequence JSON. |

### Pattern 2: Workspace Channel Resolution
**What:** `getEnabledChannels()` reads the existing `Workspace.package` field to determine which adapters are available.
**When:** Any code that needs to know which channels a workspace supports.

```typescript
// workspace-channels.ts
import { WORKSPACE_PACKAGES, type ChannelType, CHANNEL_TYPES } from './constants';

export function getEnabledChannels(pkg: string): ChannelType[] {
  switch (pkg) {
    case WORKSPACE_PACKAGES.EMAIL: return [CHANNEL_TYPES.EMAIL];
    case WORKSPACE_PACKAGES.LINKEDIN: return [CHANNEL_TYPES.LINKEDIN];
    case WORKSPACE_PACKAGES.EMAIL_LINKEDIN: return [CHANNEL_TYPES.EMAIL, CHANNEL_TYPES.LINKEDIN];
    case WORKSPACE_PACKAGES.CONSULTANCY: return [];
    default: return [CHANNEL_TYPES.EMAIL]; // safe default
  }
}
```

### Pattern 3: Channel-Aware Sender Helpers
**What:** Encapsulate the `channel: { in: ['linkedin', 'both'] }` pattern into reusable query helpers.
**When:** Any code that queries senders by channel (12 files currently have this pattern).

```typescript
// sender-helpers.ts
import { SENDER_CHANNELS, type ChannelType } from './constants';

/** Prisma where clause for senders matching a target channel. */
export function senderChannelFilter(target: ChannelType) {
  return { in: [target, SENDER_CHANNELS.BOTH] as string[] };
}

/** Count active senders for a channel in a workspace. */
export async function countActiveSenders(workspaceSlug: string, channel: ChannelType): Promise<number> {
  return prisma.sender.count({
    where: {
      workspaceSlug,
      status: 'active',
      channel: senderChannelFilter(channel),
    },
  });
}

/** Get active senders for a channel in a workspace. */
export async function getActiveSendersForChannel(workspaceSlug: string, channel: ChannelType) {
  return prisma.sender.findMany({
    where: {
      workspaceSlug,
      status: 'active',
      channel: senderChannelFilter(channel),
    },
    orderBy: { createdAt: 'asc' },
  });
}
```

### Pattern 4: Shared Adapter Contract Test Suite
**What:** One test file that both adapters must pass. Tests verify interface conformance, not implementation details.
**When:** Both adapters run against the same describe block with parameterised test factory.

```typescript
// adapter-contract.test.ts
function runAdapterContractTests(name: string, createAdapter: () => ChannelAdapter) {
  describe(`${name} adapter contract`, () => {
    it('has a readonly channel property', () => { ... });
    it('deploy returns DeployResult', () => { ... });
    it('getMetrics returns UnifiedMetrics with required fields', () => { ... });
    it('getLeads returns UnifiedLead[]', () => { ... });
    it('getActions returns UnifiedAction[]', () => { ... });
    it('getSequenceSteps returns UnifiedStep[]', () => { ... });
  });
}
```

### Anti-Patterns to Avoid
- **Moving business logic into adapters:** deploy.ts has 80+ line functions with retry logic, staggering, sequence splitting. Do NOT move that logic into the adapter in Phase 72. The adapter's `deploy()` will stub/throw until Phase 73 wires it.
- **Adapter instantiation with state:** Adapters should be stateless or near-stateless. The EmailAdapter needs a workspace's apiToken to create an EmailBisonClient -- pass it per-call or resolve it inside the method, do not store it as constructor state.
- **Touching deploy.ts:** Phase 72 creates adapters. Phase 73 wires deploy.ts to use them. Do not refactor deploy.ts in this phase.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Channel filter logic | Inline `{ in: ['linkedin', 'both'] }` | `senderChannelFilter()` helper | 12 files already have this pattern scattered; centralise it |
| Workspace channel detection | Switch statements in every consumer | `getEnabledChannels(workspace.package)` | Single function, tested, used everywhere |
| EmailBison API calls | Raw fetch() | `EmailBisonClient` methods | Client handles auth, pagination, retry, rate limits |
| LinkedIn metric aggregation | Raw Prisma counts | Adapter's `getMetrics()` | Encapsulates the 4 parallel count queries already in snapshot.ts |

## Common Pitfalls

### Pitfall 1: EmailBisonClient Needs API Token
**What goes wrong:** EmailAdapter methods need an EmailBisonClient, which requires the workspace's apiToken. If the adapter is instantiated without it, every call fails.
**Why it happens:** The interface contract has no provision for credentials -- CampaignChannelRef carries campaignId and workspaceSlug but not apiToken.
**How to avoid:** EmailAdapter resolves the workspace inside each method: `const ws = await prisma.workspace.findUnique({ where: { slug: ref.workspaceSlug } })`. This matches how snapshot.ts already works (line 68-71). Alternatively, pass apiToken in the adapter constructor and create adapters per-request.
**Recommendation:** Resolve workspace inside each method (stateless adapter pattern). Creating adapters per-workspace adds complexity for no gain at 10 workspaces.

### Pitfall 2: LinkedIn getMetrics Counts Accepted Connections Wrong
**What goes wrong:** The snapshot.ts code (line 163-168) counts `connectionsAccepted` by checking `result: { contains: '"accepted"' }` which is fragile string matching on the JSON result field.
**Why it happens:** LinkedIn connection acceptance is tracked via LinkedInConnection table (status = "connected"), but the snapshot code queries LinkedInAction result field instead.
**How to avoid:** LinkedIn adapter's getMetrics should use `prisma.linkedInConnection.count({ where: { status: 'connected', sender: { workspaceSlug } } })` cross-referenced with campaign context, not the fragile `result` string match. However, for Phase 72, **preserve existing behaviour exactly** -- use the same queries as snapshot.ts to avoid regression. Flag as future improvement.

### Pitfall 3: LinkedIn Adapter Has No External API for pause/resume
**What goes wrong:** Email has explicit pause/resume API calls (EmailBisonClient.pauseCampaign/resumeCampaign). LinkedIn has no equivalent -- actions are queued in DB and the Railway worker picks them up.
**Why it happens:** LinkedIn is DB-driven, not API-driven. "Pausing" a LinkedIn campaign means cancelling pending actions.
**How to avoid:** LinkedIn pause = `updateMany` pending actions to cancelled. LinkedIn resume = no standard operation (actions are one-shot; new deploy creates new actions). Document this asymmetry clearly. The resume method can be a no-op or throw an error explaining LinkedIn campaigns must be re-deployed.

### Pitfall 4: Email Adapter getActions Has No Direct EmailBison API
**What goes wrong:** The ChannelAdapter interface has `getActions()` but EmailBison's API does not expose per-lead activity timeline. Email "actions" are really just sequence step sends.
**Why it happens:** The interface was designed to be channel-agnostic, but email activity tracking works differently from LinkedIn's per-action model.
**How to avoid:** For email, `getActions()` queries the local Reply table (which stores received replies) and returns them as UnifiedAction entries. Sent email actions are not individually tracked locally -- EmailBison handles that. Return replies as the email channel's activity feed.

### Pitfall 5: Campaign Lookup Differs Between Channels
**What goes wrong:** Email adapter uses `emailBisonCampaignId` (numeric) to look up campaigns in EmailBison. LinkedIn adapter uses `campaignName + workspaceSlug` to query LinkedInAction records. CampaignChannelRef carries both, but forgetting to include one breaks the adapter.
**Why it happens:** EmailBison is an external API with its own IDs. LinkedIn actions are local DB records matched by campaign name string.
**How to avoid:** CampaignChannelRef (defined in Phase 71) already carries all identifiers: `campaignId`, `workspaceSlug`, `campaignName`, `emailBisonCampaignId?`. Each adapter uses whichever fields it needs. Factory code that creates CampaignChannelRef must populate ALL fields from the Campaign model.

### Pitfall 6: deploy() in Phase 72 Should NOT Wire Full Deploy Logic
**What goes wrong:** The implementer tries to move deployEmailChannel/deployLinkedInChannel into adapters, breaking deploy.ts prematurely.
**Why it happens:** The adapter interface has `deploy()` and the implementer wants to fill it in completely.
**How to avoid:** In Phase 72, adapter `deploy()` methods should be implemented as stubs that throw `new Error('Deploy wiring is Phase 73')` or as thin delegates that call the existing deploy functions. Phase 73 handles the actual refactoring of deploy.ts to use adapters. Phase 72 focuses on read-path methods (getMetrics, getLeads, getActions, getSequenceSteps) and sender/workspace helpers.

## Code Examples

### LinkedIn Adapter getMetrics (verified pattern from snapshot.ts)

```typescript
// linkedin-adapter.ts
import { prisma } from '@/lib/db';
import { CHANNEL_TYPES, CONNECTION_REQUEST_TYPES, LINKEDIN_ACTION_TYPES } from './constants';
import type { ChannelAdapter, CampaignChannelRef, UnifiedMetrics } from './types';

export class LinkedInAdapter implements ChannelAdapter {
  readonly channel = CHANNEL_TYPES.LINKEDIN;

  async getMetrics(ref: CampaignChannelRef): Promise<UnifiedMetrics> {
    const where = {
      workspaceSlug: ref.workspaceSlug,
      campaignName: ref.campaignName,
      status: 'complete' as const,
    };

    const [connectionsSent, messagesSent, profileViews, connectionsAccepted] =
      await Promise.all([
        prisma.linkedInAction.count({
          where: { ...where, actionType: { in: [...CONNECTION_REQUEST_TYPES] } },
        }),
        prisma.linkedInAction.count({
          where: { ...where, actionType: LINKEDIN_ACTION_TYPES.MESSAGE },
        }),
        prisma.linkedInAction.count({
          where: { ...where, actionType: LINKEDIN_ACTION_TYPES.PROFILE_VIEW },
        }),
        // Match existing snapshot.ts pattern for backwards compat
        prisma.linkedInAction.count({
          where: {
            ...where,
            actionType: { in: [...CONNECTION_REQUEST_TYPES] },
            result: { contains: '"accepted"' },
          },
        }),
      ]);

    const sent = connectionsSent + messagesSent;
    const replied = 0; // LinkedIn replies tracked via LinkedInConversation, not here
    const replyRate = sent > 0 ? (replied / sent) * 100 : 0;
    const acceptRate = connectionsSent > 0 
      ? (connectionsAccepted / connectionsSent) * 100 : 0;

    return {
      channel: CHANNEL_TYPES.LINKEDIN,
      sent,
      replied,
      replyRate: Math.round(replyRate * 100) / 100,
      connectionsSent,
      connectionsAccepted,
      acceptRate: Math.round(acceptRate * 100) / 100,
      messagesSent,
      profileViews,
    };
  }

  // ... other methods
}
```

### Email Adapter getMetrics (verified pattern from snapshot.ts + EmailBisonClient)

```typescript
// email-adapter.ts
import { prisma } from '@/lib/db';
import { EmailBisonClient } from '@/lib/emailbison/client';
import { CHANNEL_TYPES } from './constants';
import type { ChannelAdapter, CampaignChannelRef, UnifiedMetrics } from './types';

export class EmailAdapter implements ChannelAdapter {
  readonly channel = CHANNEL_TYPES.EMAIL;

  private async getClient(workspaceSlug: string): Promise<EmailBisonClient> {
    const ws = await prisma.workspace.findUniqueOrThrow({
      where: { slug: workspaceSlug },
      select: { apiToken: true },
    });
    if (!ws.apiToken) {
      throw new Error(`Workspace '${workspaceSlug}' has no API token`);
    }
    return new EmailBisonClient(ws.apiToken);
  }

  async getMetrics(ref: CampaignChannelRef): Promise<UnifiedMetrics> {
    if (!ref.emailBisonCampaignId) {
      return {
        channel: CHANNEL_TYPES.EMAIL,
        sent: 0, replied: 0, replyRate: 0,
      };
    }

    const client = await this.getClient(ref.workspaceSlug);
    const eb = await client.getCampaignById(ref.emailBisonCampaignId);

    if (!eb) {
      return {
        channel: CHANNEL_TYPES.EMAIL,
        sent: 0, replied: 0, replyRate: 0,
      };
    }

    return {
      channel: CHANNEL_TYPES.EMAIL,
      sent: eb.emails_sent ?? 0,
      replied: eb.replied ?? 0,
      replyRate: eb.reply_rate ?? 0,
      opened: eb.opened ?? 0,
      openRate: eb.open_rate ?? 0,
      bounced: eb.bounced ?? 0,
      bounceRate: eb.bounce_rate ?? 0,
    };
  }

  // ... other methods
}
```

### Sender Channel Filter Helper

```typescript
// sender-helpers.ts
import { prisma } from '@/lib/db';
import { SENDER_CHANNELS, type ChannelType } from './constants';

/**
 * Prisma `where.channel` clause that matches senders serving the target channel.
 * Handles the "both" tri-state: a sender with channel="both" serves both email and linkedin.
 */
export function senderChannelFilter(target: ChannelType) {
  return { in: [target, SENDER_CHANNELS.BOTH] as string[] };
}

/** Get all active senders for a specific channel in a workspace. */
export async function getActiveSendersForChannel(
  workspaceSlug: string,
  channel: ChannelType,
) {
  return prisma.sender.findMany({
    where: {
      workspaceSlug,
      status: 'active',
      channel: senderChannelFilter(channel),
    },
    orderBy: { createdAt: 'asc' },
  });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Raw `channel: { in: ['linkedin', 'both'] }` in 12 files | `senderChannelFilter()` helper | Phase 72 (this phase) | Single point of change for channel logic |
| Direct EmailBisonClient calls from portal/analytics | EmailAdapter.getMetrics() | Phase 72 (this phase) | Uniform access pattern |
| Direct Prisma LinkedIn queries from portal/analytics | LinkedInAdapter.getMetrics() | Phase 72 (this phase) | Uniform access pattern |
| No workspace channel resolution | `getEnabledChannels(workspace.package)` | Phase 72 (this phase) | Consumers know which adapters to query |

## Open Questions

1. **LinkedIn adapter deploy() scope in Phase 72**
   - What we know: Phase 73 handles deploy wiring through adapters
   - What's unclear: Should Phase 72's deploy() be a stub (throws), a passthrough (calls existing deployLinkedInChannel), or omitted?
   - Recommendation: Implement as a stub that throws with a descriptive message. The test suite can skip deploy tests or expect the throw. Phase 73 fills in the real implementation.

2. **LinkedIn replies as metrics**
   - What we know: LinkedIn replies are tracked via LinkedInConversation + LinkedInMessage tables, not via LinkedInAction result field
   - What's unclear: Should getMetrics include reply count from LinkedInConversation, or is that a separate concern?
   - Recommendation: Include LinkedIn reply count from LinkedInConversation table where `lastMessageIsInbound = true` (if such a field exists), matching against campaign context via the person's LinkedInAction records. Flag as potentially incomplete -- exact query needs validation.

3. **initAdapters() bootstrap**
   - What we know: The registry uses registerAdapter() and getAdapter() throws if no adapter is registered
   - What's unclear: Where and when should initAdapters() be called? At app startup? Lazily on first getAdapter() call?
   - Recommendation: Create an `initAdapters()` function in workspace-channels.ts that registers both adapters. Call it lazily (on first getAdapter call via a flag) or in a top-level module initialization. Keep it simple -- two `registerAdapter()` calls.

## Sources

### Primary (HIGH confidence)
- `src/lib/channels/types.ts` -- ChannelAdapter interface (7 methods, 5 unified types)
- `src/lib/channels/constants.ts` -- 13 typed constant objects, senderMatchesChannel helper
- `src/lib/channels/registry.ts` -- Map-based registry with getAdapter/registerAdapter
- `src/lib/emailbison/client.ts` -- EmailBisonClient: getCampaignById, getCampaignLeads, getSequenceSteps, pauseCampaign, resumeCampaign
- `src/lib/campaigns/deploy.ts` -- deployEmailChannel (lines 79-204), deployLinkedInChannel (lines 210-355)
- `src/lib/linkedin/queue.ts` -- enqueueAction, getNextBatch, markComplete, markFailed, cancelAction, cancelActionsForPerson
- `src/lib/linkedin/sender.ts` -- getActiveSenders with `channel: { in: ['linkedin', 'both'] }` pattern
- `src/lib/linkedin/connection-poller.ts` -- processConnectionCheckResult, getConnectionsToCheck
- `src/lib/analytics/snapshot.ts` -- snapshotWorkspaceCampaigns: email + LinkedIn metric collection pattern
- `prisma/schema.prisma` -- Sender, Campaign, CampaignDeploy, LinkedInAction, LinkedInDailyUsage, LinkedInConnection, CampaignSequenceRule, Workspace models
- Grep analysis: 12 files with `channel: { in: ['linkedin', 'both'] }` pattern

### Secondary (MEDIUM confidence)
- `.planning/research/SUMMARY.md` -- milestone research with pitfall analysis
- `.planning/research/ARCHITECTURE.md` -- adapter architecture patterns

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- zero new dependencies, all existing code verified
- Architecture: HIGH -- interface locked in Phase 71, adapter pattern follows existing DiscoveryAdapter precedent
- Pitfalls: HIGH -- all 6 pitfalls grounded in actual codebase evidence (grep analysis, file inspection)

**Research date:** 2026-04-08
**Valid until:** 2026-05-08 (stable -- internal refactoring, no external dependency changes)
