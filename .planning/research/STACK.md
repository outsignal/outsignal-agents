# Technology Stack — Channel Adapter Architecture

**Project:** Outsignal Agents — v10.0 Unified Outbound Architecture
**Researched:** 2026-04-08
**Overall confidence:** HIGH

## Executive Summary

The channel adapter pattern requires **zero new dependencies**. The existing TypeScript + Prisma + Next.js stack provides everything needed. The codebase already proves the adapter pattern works -- `src/lib/discovery/types.ts` defines a `DiscoveryAdapter` interface with 10 concrete implementations. The outbound channel adapter should follow the exact same approach: a TypeScript interface, concrete classes, and a factory/registry to resolve adapters by channel name.

Dependency injection frameworks (tsyringe, inversify, etc.) are unnecessary overhead for this project. The codebase uses direct imports and factory functions -- adding a DI container would introduce a foreign pattern that clashes with the existing architecture. TypeScript interfaces + a simple `Map<string, ChannelAdapter>` registry is the right approach, consistent with how `DiscoveryAdapter` already works.

## Recommended Stack Additions

### Zero New Libraries Required

| Category | Recommendation | Why |
|----------|---------------|-----|
| Adapter interface | Plain TypeScript interface | Matches existing `DiscoveryAdapter` pattern. No framework needed. |
| DI / resolution | Factory function + `Map` registry | Codebase uses direct imports everywhere. A DI container would be alien. |
| Testing adapters | vitest (already installed v4.0.18) | Mock adapters via `vi.fn()` and interface conformance. No extra mocking library needed. |
| Schema changes | Prisma 6 (already installed v6.19.2) | Minor column additions only. No structural rewrite. |
| Type validation | Zod 4 (already installed v4.3.6) | Runtime validation of adapter inputs/outputs at boundaries. Already used throughout. |

### Why NOT These Libraries

| Library | Why Skip |
|---------|----------|
| **tsyringe / inversify / awilix** (DI containers) | The project has 940+ files and zero DI container usage. Introducing one creates a parallel pattern that no existing code follows. The adapter registry is a 20-line factory -- a DI container adds build complexity (reflect-metadata, decorators) for zero benefit at this scale. |
| **@nestjs/common** (module system) | This is a Next.js App Router project. Nest patterns don't apply. |
| **msw** (mock service worker) | Adapter tests mock the adapter interface itself, not HTTP calls. The EmailBison client and LinkedIn actions are internal -- vitest mocks are sufficient. |
| **type-di** | Same reasoning as tsyringe. Decorator-based DI is foreign to this codebase. |

## Adapter Interface Design

### Recommended Pattern

Follow the existing `DiscoveryAdapter` interface pattern exactly:

```typescript
// src/lib/channels/types.ts

export type ChannelType = "email" | "linkedin";

export interface ChannelAdapter {
  /** Channel identifier */
  readonly channel: ChannelType;

  /** Deploy a campaign to this channel */
  deploy(params: DeployParams): Promise<DeployResult>;

  /** Pause an active campaign on this channel */
  pause(campaignRef: ChannelCampaignRef): Promise<void>;

  /** Resume a paused campaign on this channel */
  resume(campaignRef: ChannelCampaignRef): Promise<void>;

  /** Get campaign metrics from this channel */
  getMetrics(campaignRef: ChannelCampaignRef): Promise<ChannelMetrics>;

  /** Get leads/contacts and their status on this channel */
  getLeads(campaignRef: ChannelCampaignRef): Promise<ChannelLead[]>;

  /** Get sequence steps configured on this channel */
  getSequenceSteps(campaignRef: ChannelCampaignRef): Promise<ChannelSequenceStep[]>;
}
```

### Resolution Pattern

```typescript
// src/lib/channels/registry.ts

const adapters = new Map<ChannelType, ChannelAdapter>();

export function registerAdapter(adapter: ChannelAdapter): void {
  adapters.set(adapter.channel, adapter);
}

export function getAdapter(channel: ChannelType): ChannelAdapter {
  const adapter = adapters.get(channel);
  if (!adapter) throw new Error(`No adapter registered for channel: ${channel}`);
  return adapter;
}

// Bootstrap -- called once at app startup or lazily on first use
export function initAdapters(): void {
  registerAdapter(new EmailAdapter());
  registerAdapter(new LinkedInAdapter());
}
```

This is the same pattern used in `src/lib/discovery/adapters/` -- concrete classes implementing an interface, resolved by name.

### Why This Pattern

1. **Proven in this codebase**: `DiscoveryAdapter` has 10 implementations, battle-tested over 4+ months
2. **Zero learning curve**: Every contributor already knows this pattern
3. **Testable**: `vi.fn()` can create mock adapters conforming to the interface
4. **Extensible**: Adding a future channel (paid ads, cold calls) = new file + register call

## Prisma Schema Changes

### What Needs to Change

The schema is **already mostly channel-agnostic**. The `Campaign` model has `channels` (JSON array) and separate `emailSequence` / `linkedinSequence` fields. The `Sender` model has a `channel` field. The `CampaignDeploy` model tracks per-channel status.

**Minimal changes needed:**

| Change | Model | Why |
|--------|-------|-----|
| Add `channelConfig` to Workspace | Workspace | Consolidate scattered `enabledModules` + `package` fields into structured per-channel configuration (JSON). The adapter registry reads this to know which adapters to activate for a workspace. |
| Consider `channelRefs` on CampaignDeploy | CampaignDeploy | Store channel-specific external IDs generically (e.g. EB campaign ID, LinkedIn deploy batch ID) in a JSON field. Currently `emailBisonCampaignId` is a hard-coded column -- works but not extensible. Low priority -- existing column is fine for v10.0. |

**What does NOT need to change:**

| Model | Status | Reasoning |
|-------|--------|-----------|
| Campaign | Keep as-is | `channels` JSON array already works. `emailSequence` / `linkedinSequence` are channel-specific content -- adapters read from these. No benefit to abstracting into a generic "sequence" table. |
| Sender | Keep as-is | `channel` field already discriminates. Adapters filter by channel internally. |
| Reply | Keep as-is | Replies are already workspace-scoped. LinkedIn messages are in `LinkedInConversation`. Each channel has its own reply shape -- this is correct. |
| Person | Keep as-is | Channel-agnostic by design. |

### Why NOT a Generic Sequence Table

A common over-engineering trap: replacing `emailSequence` (JSON) and `linkedinSequence` (JSON) with a normalized `CampaignSequenceStep` table with a `channel` discriminator column.

**Don't do this because:**
- Email steps have `subjectLine`, `subjectVariantB`, `bodyHtml` -- LinkedIn steps don't
- LinkedIn steps have `type` (connect/message/profile_view), `triggerEvent` -- email steps don't
- The JSON fields work fine. The Writer agent reads/writes them directly. A table migration would touch 55 CLI scripts, 7 agent skills, and the portal UI
- The adapter reads the appropriate JSON field for its channel -- this is the correct abstraction boundary

## Testing Strategy

### Adapter Testing (No New Libraries)

```typescript
// src/lib/channels/__tests__/email-adapter.test.ts

import { describe, it, expect, vi } from "vitest";
import { EmailAdapter } from "../email-adapter";

describe("EmailAdapter", () => {
  it("implements ChannelAdapter interface", () => {
    const adapter = new EmailAdapter();
    expect(adapter.channel).toBe("email");
    expect(typeof adapter.deploy).toBe("function");
    expect(typeof adapter.getMetrics).toBe("function");
  });
});
```

### Mock Adapter for Integration Tests

```typescript
// src/lib/channels/__tests__/mock-adapter.ts

export function createMockAdapter(channel: ChannelType): ChannelAdapter {
  return {
    channel,
    deploy: vi.fn().mockResolvedValue({ success: true }),
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    getMetrics: vi.fn().mockResolvedValue({ sent: 0, replied: 0 }),
    getLeads: vi.fn().mockResolvedValue([]),
    getSequenceSteps: vi.fn().mockResolvedValue([]),
  };
}
```

vitest v4.0.18 (already installed) handles all of this. No msw, no testcontainers, no jest -- vitest is the project standard.

## Integration Points

### Where Adapters Replace Existing Code

| Current Code | Location | Adapter Replaces |
|--------------|----------|-----------------|
| `deployEmailChannel()` | `src/lib/campaigns/deploy.ts` | `EmailAdapter.deploy()` |
| `deployLinkedInChannel()` | `src/lib/campaigns/deploy.ts` | `LinkedInAdapter.deploy()` |
| Direct EmailBison metric calls in CLI | `scripts/cli/campaigns-get.js` etc. | `getAdapter("email").getMetrics()` |
| Direct Prisma queries for LinkedIn actions | Various files | `getAdapter("linkedin").getLeads()` |

### What Stays Direct (NOT Through Adapters)

| Concern | Why Not Adapter |
|---------|----------------|
| Reply handling (webhooks, poll-replies) | Replies are event-driven, not request/response. Different flow entirely. |
| Sender health monitoring | Runs on a schedule, not per-campaign. Different lifecycle. |
| Session management (LinkedIn cookies) | Infrastructure concern, not campaign-level. |
| Notification dispatch | Channel-aware but dispatches to Slack/email notifications, not outbound channels. |

## File Structure

```
src/lib/channels/
  types.ts              # ChannelAdapter interface, shared types (DeployParams, ChannelMetrics, etc.)
  registry.ts           # Map-based adapter resolution + initAdapters()
  email-adapter.ts      # Wraps EmailBisonClient -- implements deploy/pause/resume/getMetrics/getLeads/getSequenceSteps
  linkedin-adapter.ts   # Wraps LinkedIn action queue + Prisma queries
  __tests__/
    email-adapter.test.ts
    linkedin-adapter.test.ts
    mock-adapter.ts     # Reusable mock for consumer tests
```

This mirrors `src/lib/discovery/adapters/` -- the team already knows where to find things.

## Versions Summary

All pinned to currently installed versions. No upgrades needed.

| Technology | Current Version | Role in Adapter Work |
|------------|----------------|---------------------|
| TypeScript | ^5 | Interface definitions, type safety |
| Next.js | 16.1.6 | App Router unchanged |
| Prisma | ^6.19.2 | Minor schema additions only |
| Zod | ^4.3.6 | Runtime validation at adapter boundaries |
| vitest | ^4.0.18 | Adapter unit + integration tests |
| tsup | ^8.5.1 | CLI script builds (unchanged) |

## Installation

```bash
# No new packages required
# All adapter work uses existing dependencies
```

## Sources

- Existing codebase: `src/lib/discovery/types.ts` lines 89-108 (DiscoveryAdapter interface pattern -- HIGH confidence)
- Existing codebase: `src/lib/discovery/adapters/` (10 concrete adapter implementations -- HIGH confidence)
- Existing codebase: `src/lib/campaigns/deploy.ts` (current deploy logic with `deployEmailChannel` + `deployLinkedInChannel` -- HIGH confidence)
- Existing codebase: `prisma/schema.prisma` (Campaign, Sender, CampaignDeploy, Workspace models -- HIGH confidence)
- Existing codebase: `src/lib/emailbison/client.ts` (EmailBison client wrapping -- HIGH confidence)
- Existing codebase: `src/lib/linkedin/types.ts` (LinkedIn types and action definitions -- HIGH confidence)
- Existing codebase: `src/lib/linkedin/chain.ts`, `sequencing.ts`, `sender.ts` (LinkedIn deploy helpers -- HIGH confidence)
