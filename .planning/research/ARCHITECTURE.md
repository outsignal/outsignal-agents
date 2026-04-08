# Architecture Patterns: Channel Adapter Integration

**Domain:** Multi-channel outbound platform (adapter pattern retrofit)
**Researched:** 2026-04-08
**Confidence:** HIGH -- based on direct codebase analysis, not external sources

## Recommended Architecture

The adapter pattern introduces a `ChannelAdapter` interface that normalises how the system interacts with email (EmailBison) and LinkedIn (DB + Railway worker). Every call site currently doing channel-specific branching (`if channel === 'email' ... else if channel === 'linkedin'`) gets replaced with a single adapter call. The adapter is resolved per-channel, so the system never cares which channel it is talking to.

### Where the Adapter Interface Lives

```
src/lib/channels/
  types.ts              -- ChannelAdapter interface + shared types
  registry.ts           -- getAdapter(channel): ChannelAdapter
  email-adapter.ts      -- EmailAdapter implements ChannelAdapter (wraps EmailBisonClient)
  linkedin-adapter.ts   -- LinkedInAdapter implements ChannelAdapter (wraps Prisma + worker)
```

This is a new directory. It does NOT replace `src/lib/emailbison/` or `src/lib/linkedin/` -- those remain as low-level implementation details. The adapters are a thin orchestration layer on top.

### ChannelAdapter Interface

```typescript
interface ChannelAdapter {
  channel: 'email' | 'linkedin';

  // --- Deployment ---
  deploy(ctx: DeployContext): Promise<DeployResult>;
  pause(campaignRef: CampaignRef): Promise<void>;
  resume(campaignRef: CampaignRef): Promise<void>;

  // --- Metrics ---
  getMetrics(campaignRef: CampaignRef): Promise<ChannelMetrics>;
  getActivity(campaignRef: CampaignRef, opts: PaginationOpts): Promise<ActivityEntry[]>;

  // --- Senders ---
  getSenders(workspaceSlug: string): Promise<ChannelSender[]>;
  getSenderHealth(workspaceSlug: string): Promise<SenderHealthReport>;

  // --- Replies/Conversations ---
  getReplies(workspaceSlug: string, opts: PaginationOpts): Promise<ChannelReply[]>;
}

interface DeployContext {
  deployId: string;
  campaignId: string;
  campaignName: string;
  workspaceSlug: string;
  sequence: SequenceStep[];
  targetListId: string;
  hasOtherChannel: boolean; // for LinkedIn deploy, knows if email is also deploying
}

interface ChannelMetrics {
  channel: 'email' | 'linkedin';
  sent: number;
  replied: number;
  replyRate: number;
  // Channel-specific extras as optional fields
  opened?: number;             // email only
  openRate?: number;           // email only
  bounced?: number;            // email only
  bounceRate?: number;         // email only
  connectionsSent?: number;    // linkedin only
  connectionsAccepted?: number; // linkedin only
  acceptRate?: number;         // linkedin only
}

interface ChannelSender {
  id: string;
  name: string;
  channel: 'email' | 'linkedin';
  identifier: string;    // email address or LinkedIn profile URL
  status: string;
  healthStatus: string;
}

interface ChannelReply {
  id: string;
  channel: 'email' | 'linkedin';
  from: string;
  fromName?: string;
  body: string;
  receivedAt: Date;
  campaignName?: string;
  isOutbound: boolean;
}
```

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `src/lib/channels/types.ts` | Interface contract, shared types | All consumers |
| `src/lib/channels/registry.ts` | Factory: resolves channel string to adapter instance | Consumers call this |
| `src/lib/channels/email-adapter.ts` | Wraps EmailBisonClient for deploy, metrics, senders, replies | `src/lib/emailbison/client.ts`, Prisma (Reply, Sender, BounceSnapshot) |
| `src/lib/channels/linkedin-adapter.ts` | Wraps Prisma queries for LinkedIn actions, conversations, senders | Prisma (LinkedInAction, LinkedInConversation, LinkedInMessage, Sender, LinkedInDailyUsage) |
| `src/lib/campaigns/deploy.ts` | Orchestrates multi-channel deploy -- EXISTING, refactored to use adapters | `registry.ts` |
| `trigger/*.ts` | Trigger.dev tasks -- select tasks call adapters instead of direct EmailBison/Prisma | `registry.ts` |
| Portal pages | Fetch data via adapters, render channel-agnostic UI | `registry.ts` via server components |
| `src/lib/notifications.ts` | Sends channel-aware notifications | Reads channel from event context |

### Data Flow

#### Unified Campaign Deployment

Current flow has two parallel functions (`deployEmailChannel` + `deployLinkedInChannel`) in `src/lib/campaigns/deploy.ts`. The adapter pattern replaces this:

```
executeDeploy(campaignId, deployId)
  |
  +-- parse campaign.channels JSON array
  |
  +-- for each channel in channels:
  |     adapter = getAdapter(channel)
  |     adapter.deploy(ctx)
  |
  +-- update CampaignDeploy record with per-channel status
```

The existing `deployEmailChannel()` and `deployLinkedInChannel()` functions become the internal implementation of `EmailAdapter.deploy()` and `LinkedInAdapter.deploy()` respectively. This is a refactor, not a rewrite -- the logic moves, the behaviour stays identical.

#### Portal Data Queries

Current: portal campaign detail page has two separate code paths -- one querying EmailBison API (lines 54-72 in campaign/[id]/page.tsx) and another querying Prisma for LinkedIn stats (lines 83-100+). With adapters:

```typescript
// In portal campaign detail server component
const channels = JSON.parse(campaign.channels) as string[];
const metrics = await Promise.all(
  channels.map(ch => getAdapter(ch).getMetrics({ campaignId, workspaceSlug }))
);
// Merge and pass to client component
```

#### Analytics Pipeline

`snapshot-metrics.ts` currently only snapshots EmailBison campaign data via `snapshotWorkspaceCampaigns()`. With adapters:

```
for each workspace:
  for each enabled channel:
    adapter = getAdapter(channel)
    metrics = adapter.getMetrics(campaignRef)
    upsert into CachedMetrics with metricKey = `${channel}:${campaignName}`
```

This unifies the metrics table. LinkedIn daily usage data (currently in `LinkedInDailyUsage`) gets surfaced through the adapter rather than queried separately.

## How Existing Code Paths Migrate

### Priority 1: Campaign Deploy (deploy.ts)

**Current state:** `deploy.ts` has `deployEmailChannel()` and `deployLinkedInChannel()` as separate 80+ line functions with channel-specific logic.

**Migration:** Move each function body into the corresponding adapter class. The `executeDeploy()` orchestrator becomes a loop over `campaign.channels` calling `adapter.deploy()`. The `retryDeployChannel()` function becomes `getAdapter(channel).deploy(ctx)` with retry context.

**Risk:** LOW. The deploy logic is already cleanly separated by channel. Moving it into adapter classes is mechanical.

### Priority 2: Portal Campaign Detail (portal/campaigns/[id]/page.tsx)

**Current state:** Lines 47-100+ have two branching code paths: one for EmailBison stats (when `emailBisonCampaignId` exists) and one for LinkedIn stats (direct Prisma queries). These are interleaved with conditionals.

**Migration:** Replace both paths with:
```typescript
const channelList = JSON.parse(campaign.channels) as ('email' | 'linkedin')[];
const [metrics, activity] = await Promise.all([
  Promise.all(channelList.map(ch => getAdapter(ch).getMetrics(ref))),
  Promise.all(channelList.map(ch => getAdapter(ch).getActivity(ref, opts))),
]);
```

**Risk:** MEDIUM. The portal page has significant UI branching based on channel. The data fetching is straightforward to unify, but the `CampaignDetailTabs` component likely has channel-specific tab rendering that needs updating.

### Priority 3: Sender Management

**Current state:** The `Sender` model is a shared table with `channel: 'email' | 'linkedin' | 'both'`. Admin and portal pages scatter `channel` filter logic everywhere. The CLI scripts (`sender-health.js`, `inbox-status.js`, `domain-health.js`) are email-specific.

**Migration:** Adapters provide `getSenders()` and `getSenderHealth()` per channel. The `Sender` table stays as-is (no schema change needed). The adapter filters by channel internally:
- `EmailAdapter.getSenders()` filters `channel IN ('email', 'both')`
- `LinkedInAdapter.getSenders()` filters `channel IN ('linkedin', 'both')`

**Risk:** LOW. This is read-path only. No data model changes.

### Priority 4: Notifications

**Current state:** `notifications.ts` has 17 notification types. Most are email-centric (reply notifications reference EmailBison reply IDs, inbox URLs). LinkedIn notifications exist but are handled through a different path (LinkedIn reply -> process-reply task).

**Migration:** Add a `channel` field to notification context. The `notifyReply()` function already receives enough context to determine channel. The notification template varies by channel (email replies link to `app.outsignal.ai/inbox`, LinkedIn replies could link to conversation view). This is additive, not destructive.

**Risk:** LOW. Notifications are already workspace-scoped. Adding channel awareness is a small extension.

### Priority 5: Trigger.dev Tasks

**Current state:** Tasks are channel-specific:
- `poll-replies.ts` -- email only (polls EmailBison)
- `sync-sent-emails.ts` -- email only
- `bounce-monitor.ts` -- email only
- `process-reply.ts` -- handles both but with channel branching
- `generate-suggestion.ts` -- email reply suggestions

**Migration:** Most Trigger.dev tasks remain channel-specific because their underlying operations are inherently different (polling an HTTP API vs querying a database). The adapter pattern helps most in `process-reply.ts` and `snapshot-metrics.ts` where the task needs to handle events from multiple channels.

Do NOT try to force all tasks through adapters. `bounce-monitor.ts` is fundamentally an email concern. `linkedin-fast-track.ts` is fundamentally a LinkedIn concern. Adapters help at the orchestration layer, not at the channel-specific operational layer.

**Risk:** LOW. Most tasks stay as-is. Only `process-reply`, `snapshot-metrics`, and `campaign-deploy` change.

### Priority 6: Analytics (CachedMetrics + snapshot)

**Current state:** `CachedMetrics` stores email-centric metrics from EmailBison API. LinkedIn metrics live in `LinkedInDailyUsage` separately. No unified view.

**Migration:** Extend `snapshotWorkspaceCampaigns()` to call each adapter's `getMetrics()`. Store with channel-prefixed `metricKey` (e.g., `email:Rise Q1` vs `linkedin:Rise Q1`). Portal analytics pages read `CachedMetrics` and aggregate across channels when needed.

The `LinkedInDailyUsage` table stays -- it captures per-sender daily granularity that is specific to LinkedIn rate limiting. The adapter surfaces aggregated metrics from it.

**Risk:** MEDIUM. Need to decide on metric key naming convention and ensure backwards compatibility with existing CachedMetrics data.

## Campaign Model Changes

The Campaign model already has multi-channel fields and needs minimal changes:

| Field | Current | Change Needed |
|-------|---------|---------------|
| `channels` | JSON string `["email"]` or `["email","linkedin"]` | No change |
| `emailBisonCampaignId` | Direct EmailBison FK | Keep -- adapter reads this internally |
| `emailSequence` | JSON string | No change -- adapter reads this |
| `linkedinSequence` | JSON string | No change -- adapter reads this |
| `emailBisonSequenceId` | Direct EB FK | Keep -- adapter internal |

The Campaign model is already channel-agnostic in structure. The adapter pattern does NOT require Campaign schema changes.

## Sender Model Evolution

The `Sender` model is the most complex entity because it serves both channels from one table. The adapter pattern does NOT split this table -- that would be a massive migration for minimal gain. Instead:

**Current:** `channel: 'email' | 'linkedin' | 'both'` on the Sender row.

**With adapters:** Each adapter filters the Sender table by channel. The `both` value means the sender appears in both adapters' results. The adapter wraps the raw Sender fields into a `ChannelSender` type that exposes only the relevant fields:

- `EmailAdapter.getSenders()` returns `{ identifier: sender.emailAddress, ... }`
- `LinkedInAdapter.getSenders()` returns `{ identifier: sender.linkedinProfileUrl, ... }`

No Sender schema migration needed.

## Workspace Channel Configuration

The `Workspace.package` field (`"email" | "linkedin" | "email_linkedin" | "consultancy"`) already controls which channels are enabled. The adapter registry uses this:

```typescript
function getEnabledChannels(workspace: Workspace): Channel[] {
  switch (workspace.package) {
    case 'email': return ['email'];
    case 'linkedin': return ['linkedin'];
    case 'email_linkedin': return ['email', 'linkedin'];
    case 'consultancy': return []; // no sending
  }
}

function getAdapter(channel: 'email' | 'linkedin'): ChannelAdapter {
  switch (channel) {
    case 'email': return new EmailAdapter();
    case 'linkedin': return new LinkedInAdapter();
  }
}
```

No Workspace schema changes needed. The `package` field already encodes channel configuration.

## Patterns to Follow

### Pattern 1: Adapter as Facade

The adapter is a thin facade over existing implementation. It does NOT rewrite business logic.

**What:** Each adapter method delegates to existing code (EmailBisonClient methods, Prisma queries, LinkedIn helper functions). The adapter provides a uniform interface but the implementation stays in its original module.

**When:** Always. The adapter never contains substantial business logic.

**Example:**
```typescript
// email-adapter.ts
class EmailAdapter implements ChannelAdapter {
  async getMetrics(ref: CampaignRef): Promise<ChannelMetrics> {
    const workspace = await getWorkspaceBySlug(ref.workspaceSlug);
    if (!workspace?.apiToken) throw new Error('No API token');

    const client = new EmailBisonClient(workspace.apiToken);
    const ebCampaign = await client.getCampaignById(ref.emailBisonCampaignId!);

    return {
      channel: 'email',
      sent: ebCampaign?.stats?.emails_sent ?? 0,
      replied: ebCampaign?.stats?.replied ?? 0,
      replyRate: ebCampaign?.stats?.reply_rate ?? 0,
      opened: ebCampaign?.stats?.opened ?? 0,
      openRate: ebCampaign?.stats?.open_rate ?? 0,
      bounced: ebCampaign?.stats?.bounced ?? 0,
      bounceRate: ebCampaign?.stats?.bounce_rate ?? 0,
    };
  }
}
```

### Pattern 2: Channel-Agnostic Rendering

Portal components receive `ChannelMetrics[]` and render generically.

**What:** Instead of `{isLinkedIn ? <LinkedInStats /> : <EmailStats />}`, components receive an array of channel metrics and render each channel's card/row uniformly.

**When:** Portal pages, admin dashboard, campaign detail views.

**Example:**
```typescript
// components/portal/channel-metrics-cards.tsx
function ChannelMetricsCards({ metrics }: { metrics: ChannelMetrics[] }) {
  return (
    <div className="grid gap-4">
      {metrics.map(m => (
        <Card key={m.channel}>
          <CardHeader>{m.channel === 'email' ? 'Email' : 'LinkedIn'}</CardHeader>
          <CardContent>
            <Stat label="Sent" value={m.sent} />
            <Stat label="Replied" value={m.replied} />
            <Stat label="Reply Rate" value={`${m.replyRate}%`} />
            {m.openRate != null && <Stat label="Open Rate" value={`${m.openRate}%`} />}
            {m.acceptRate != null && <Stat label="Accept Rate" value={`${m.acceptRate}%`} />}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

### Pattern 3: Registry Factory

Never instantiate adapters directly. Always go through the registry.

**What:** `getAdapter(channel)` is the single entry point. This enables future channels (paid ads, cold calls) to be added by registering a new adapter, not modifying consumers.

**When:** Every call site that needs channel-specific behaviour.

### Pattern 4: CampaignRef as Universal Identifier

**What:** A `CampaignRef` object carries all identifiers needed to look up a campaign across channels: `{ campaignId, workspaceSlug, campaignName, emailBisonCampaignId? }`. Each adapter uses whichever identifiers it needs -- EmailAdapter uses `emailBisonCampaignId`, LinkedInAdapter uses `campaignName + workspaceSlug` (since LinkedIn actions are matched by campaign name).

**When:** All adapter methods that operate on a campaign.

```typescript
interface CampaignRef {
  campaignId: string;            // Outsignal internal Campaign.id
  workspaceSlug: string;
  campaignName: string;          // used by LinkedIn (LinkedInAction.campaignName)
  emailBisonCampaignId?: number; // used by Email (EmailBison API)
}
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Over-Abstracting Channel Differences

**What:** Trying to make email and LinkedIn look identical by forcing shared types that do not fit. For example, pretending LinkedIn "connections sent" is equivalent to email "sent" in a generic `sent` field.

**Why bad:** Email and LinkedIn are fundamentally different channels with different metrics, different lifecycle stages, and different operational concerns. Forcing them into one shape loses information and creates confusing UIs.

**Instead:** Use optional/channel-specific fields on ChannelMetrics. Let the UI decide what to show per channel. The adapter normalises the _access pattern_ (how you get data), not the _data shape_ (what data you get).

### Anti-Pattern 2: Moving All Business Logic Into Adapters

**What:** Making the adapter responsible for retry logic, rate limiting, sender assignment, warmup management, etc.

**Why bad:** The adapter becomes a god object. The existing modules (`src/lib/linkedin/chain.ts`, `src/lib/linkedin/sender.ts`, `src/lib/emailbison/client.ts`) already handle these concerns well. Duplicating or moving that logic into adapters creates maintenance burden.

**Instead:** Adapters call existing modules. They are orchestrators, not implementors.

### Anti-Pattern 3: Premature Channel Extraction for Tasks

**What:** Trying to make `bounce-monitor.ts` or `poll-replies.ts` work through adapters when they are inherently single-channel operations.

**Why bad:** Forces artificial abstraction. Bounce monitoring is an email concept -- LinkedIn does not have bounces. LinkedIn session keepalive is a LinkedIn concept -- email does not have sessions.

**Instead:** Only use adapters at integration points where multiple channels converge: deploy, metrics aggregation, portal rendering, notifications. Leave channel-specific tasks as-is.

### Anti-Pattern 4: Database Schema Changes for Adapter Purity

**What:** Splitting the `Sender` table into `EmailSender` and `LinkedInSender`, or creating a `ChannelConfig` table, or normalising `CachedMetrics` with a `channel` column.

**Why bad:** Schema migrations with 15K+ records are risky and unnecessary. The existing schema already supports multi-channel (Sender has `channel` field, Campaign has `channels` JSON, CampaignDeploy has per-channel status). Adding adapter code on top of the existing schema is far safer than restructuring the data layer.

**Instead:** Adapters work with the existing schema. If a new column is needed (e.g., `CachedMetrics.channel`), it is additive and nullable.

## Integration Points: New vs Modified

### New Files (create from scratch)

| File | Purpose |
|------|---------|
| `src/lib/channels/types.ts` | Interface definition, shared types |
| `src/lib/channels/registry.ts` | Factory function, channel resolution |
| `src/lib/channels/email-adapter.ts` | EmailBison adapter implementation |
| `src/lib/channels/linkedin-adapter.ts` | LinkedIn adapter implementation |
| `src/components/portal/channel-metrics-cards.tsx` | Unified metrics display component |

### Modified Files (refactor existing code)

| File | Change | Scope |
|------|--------|-------|
| `src/lib/campaigns/deploy.ts` | `executeDeploy` calls adapters instead of inline channel functions | Core logic moves into adapters, orchestrator simplified |
| `src/app/(portal)/portal/campaigns/[id]/page.tsx` | Replace dual code paths with adapter calls | Data fetching layer only |
| `src/app/(portal)/portal/page.tsx` | Dashboard uses adapter for cross-channel metrics | Data fetching |
| `src/app/(portal)/portal/activity/page.tsx` | Activity feed from both channels via adapter | Data fetching |
| `src/app/(portal)/portal/sender-health/page.tsx` | Sender list through adapters | Data fetching |
| `trigger/campaign-deploy.ts` | No change -- already delegates to `deploy.ts` | None |
| `trigger/snapshot-metrics.ts` | Call adapter.getMetrics per channel | Add channel loop |
| `trigger/process-reply.ts` | Use adapter for reply normalisation | Minor |
| `src/lib/notifications.ts` | Add channel to notification context | Additive |
| `src/lib/analytics/snapshot.ts` | Extend to accept channel parameter | Additive |

### Unchanged Files (adapter does NOT touch these)

| File | Why Unchanged |
|------|---------------|
| `src/lib/emailbison/client.ts` | Low-level API client -- adapter wraps it |
| `src/lib/linkedin/chain.ts` | LinkedIn-specific orchestration -- adapter calls it |
| `src/lib/linkedin/sender.ts` | Sender assignment logic -- adapter calls it |
| `src/lib/linkedin/sequencing.ts` | Sequence rule creation -- adapter calls it |
| `trigger/bounce-monitor.ts` | Email-only concern |
| `trigger/poll-replies.ts` | Email-only concern (polls EB API) |
| `trigger/sync-sent-emails.ts` | Email-only concern |
| `trigger/linkedin-fast-track.ts` | LinkedIn-only concern |
| `trigger/domain-health.ts` | Email-only concern |
| `trigger/inbox-check.ts` | Email-only concern |
| `prisma/schema.prisma` | No schema changes needed |

## Suggested Build Order

Build order follows dependency graph: interface first, then implementations, then consumers.

### Phase 1: Interface + Registry + Adapter Shells

1. Create `src/lib/channels/types.ts` with `ChannelAdapter` interface and all shared types
2. Create `src/lib/channels/registry.ts` with `getAdapter()` factory and `getEnabledChannels()` helper
3. Create `src/lib/channels/email-adapter.ts` -- implement `getMetrics()` and `getSenders()` only
4. Create `src/lib/channels/linkedin-adapter.ts` -- implement `getMetrics()` and `getSenders()` only
5. Write tests for adapters against real schema (vitest)

**Why first:** Everything else depends on the interface. Starting with metrics + senders gives immediate testable value without touching deploy logic.

### Phase 2: Deploy Through Adapters

1. Move `deployEmailChannel()` body into `EmailAdapter.deploy()`
2. Move `deployLinkedInChannel()` body into `LinkedInAdapter.deploy()`
3. Refactor `executeDeploy()` to loop over channels + call adapters
4. Keep `retryDeployChannel()` working through adapter
5. Implement `pause()` and `resume()` on both adapters

**Why second:** Deploy is the highest-risk integration point. Get it right early before touching UI. The existing deploy logic is already cleanly separated, making this a safe mechanical refactor.

### Phase 3: Portal Pages Through Adapters

1. Refactor campaign detail page to use adapters for data fetching
2. Create `ChannelMetricsCards` component for unified rendering
3. Update portal dashboard to aggregate metrics across channels
4. Update activity page to merge email + LinkedIn activity via adapters
5. Update sender-health page to query through adapters

**Why third:** UI changes are lower risk (read-only) and can be done incrementally page by page.

### Phase 4: Analytics + Notifications

1. Extend `snapshot-metrics.ts` to snapshot per-channel via adapters
2. Add `channel` context to notification functions
3. Update reply processing to normalise through adapters
4. Ensure CachedMetrics backwards compatibility (existing keys stay, new keys use channel prefix)

**Why last:** These are background operations. Getting them wrong has lower immediate impact than deploy or portal.

## Scalability Considerations

| Concern | 10 workspaces (now) | 50 workspaces | 200+ workspaces |
|---------|---------------------|---------------|-----------------|
| Adapter instantiation | No concern -- stateless, new per request | Same | Consider adapter pooling if EmailBisonClient connections become costly |
| Metrics aggregation | In-memory merge of 2 channel results | Same | CachedMetrics with channel column, pre-aggregated |
| Deploy parallelism | Sequential per campaign | Same | Consider per-channel deploy tasks (separate Trigger.dev jobs) |
| Future channels | N/A | Add new adapter class + register | Interface may need optional methods or capability flags |

## Sources

- Direct codebase analysis: `prisma/schema.prisma`, `src/lib/campaigns/deploy.ts`, `src/lib/emailbison/client.ts`, `src/app/(portal)/portal/campaigns/[id]/page.tsx`, `trigger/*.ts`
- Existing architecture patterns in the codebase (EmailBison client wrapper, LinkedIn chain/sender modules)
- Campaign model already supports multi-channel (channels JSON, per-channel sequences, CampaignDeploy per-channel status)
