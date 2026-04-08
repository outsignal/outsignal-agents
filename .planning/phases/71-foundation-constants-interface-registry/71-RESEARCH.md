# Phase 71: Foundation -- Constants, Interface & Registry - Research

**Researched:** 2026-04-08
**Domain:** TypeScript adapter pattern -- constants extraction, interface definition, registry factory
**Confidence:** HIGH

## Summary

Phase 71 creates the foundational infrastructure for the entire v10.0 milestone: a constants file eliminating raw string comparisons, a ChannelAdapter interface, unified types, and a registry factory. This is pure infrastructure work -- zero behaviour changes, zero user-facing changes, zero schema migrations. Every file created in this phase is new (no existing files to modify), making it low-risk and high-value.

The codebase already proves this exact pattern works. `src/lib/discovery/types.ts` defines a `DiscoveryAdapter` interface (lines 89-108) with 10 concrete implementations resolved by name. Phase 71 follows the identical approach: a TypeScript interface, shared types, and a `Map<ChannelType, ChannelAdapter>` registry. Zero new npm packages are required.

The highest-risk decision in this phase is getting the string constants exhaustive and the interface shape channel-agnostic. Codebase analysis reveals 5 distinct string enum domains that need extraction: channel types (3 values), LinkedIn action types (5 values), LinkedIn action statuses (6 values), sender statuses (4 values + 5 health statuses), and campaign statuses (8 values + 5 deploy channel statuses). All are currently scattered as raw string literals across 36+ files.

**Primary recommendation:** Create `src/lib/channels/` directory with 4 files: `constants.ts`, `types.ts`, `registry.ts`, and an `index.ts` barrel export. Constants file must be comprehensive and derived from grep analysis of actual production values, not from memory. Interface must be validated by mentally implementing the LinkedIn adapter first -- if any method feels awkward for LinkedIn, the interface is too email-shaped.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FOUND-01 | All channel types, action types, and sender types extracted into typed constants (no raw strings in business logic) | Constants extraction section below catalogs all 5 string enum domains with exact values from codebase grep. See "String Enum Inventory" for exhaustive list. |
| FOUND-02 | ChannelAdapter interface defined with methods: getLeads, getActions, getMetrics, deploy, pause, resume, getSequenceSteps | Interface design section provides channel-agnostic method signatures with input/output types. Validated against both email and LinkedIn data shapes. |
| FOUND-03 | Adapter registry (Map<ChannelType, ChannelAdapter>) with getAdapter(channel) resolver | Registry pattern section shows exact implementation following DiscoveryAdapter precedent. Includes error handling for unknown channels. |
| FOUND-04 | Unified type definitions: UnifiedLead, UnifiedAction, UnifiedMetrics, UnifiedStep, CampaignChannelRef | Unified types section defines each type with fields that work for both channels, using optional fields for channel-specific data. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | ^5 | Interface definitions, const assertions, discriminated unions | Already installed. No alternative needed. |
| vitest | ^4.0.18 | Unit tests for registry and type guards | Already installed, project standard. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Zod | ^4.3.6 | Runtime validation at adapter boundaries (future phases) | Phase 72 when implementing adapters. Not needed in Phase 71. |

### Alternatives Considered
None. This phase uses only TypeScript language features (interfaces, const assertions, type guards). No libraries required.

**Installation:**
```bash
# No new packages required
```

## Architecture Patterns

### Recommended Project Structure
```
src/lib/channels/
  constants.ts        # All string enums as const objects (FOUND-01)
  types.ts            # ChannelAdapter interface + unified types (FOUND-02, FOUND-04)
  registry.ts         # Map-based factory + getAdapter() (FOUND-03)
  index.ts            # Barrel export
  __tests__/
    constants.test.ts # Exhaustiveness checks
    registry.test.ts  # getAdapter resolution + unknown channel error
```

### Pattern 1: Const Object with Type Derivation (for constants)
**What:** Use `as const` objects instead of TypeScript enums. Derive the union type from the object values.
**When to use:** Every string enum domain in this phase.
**Why:** Enums generate runtime code and have quirky reverse-mapping. Const objects are pure types at compile time and allow iteration over values at runtime (for exhaustiveness checks and grep replacement).
**Example:**
```typescript
// Source: TypeScript handbook + project convention (no enums used anywhere in codebase)
export const CHANNEL_TYPES = {
  EMAIL: "email",
  LINKEDIN: "linkedin",
} as const;

export type ChannelType = (typeof CHANNEL_TYPES)[keyof typeof CHANNEL_TYPES];
// Result: "email" | "linkedin"

// For queries needing the "both" case on Sender model:
export const SENDER_CHANNEL_VALUES = {
  EMAIL: "email",
  LINKEDIN: "linkedin",
  BOTH: "both",
} as const;

export type SenderChannel = (typeof SENDER_CHANNEL_VALUES)[keyof typeof SENDER_CHANNEL_VALUES];
```

### Pattern 2: DiscoveryAdapter-Style Interface (for ChannelAdapter)
**What:** Interface with readonly channel discriminator and async methods returning typed results.
**When to use:** The ChannelAdapter interface definition.
**Why:** Matches the proven `DiscoveryAdapter` pattern at `src/lib/discovery/types.ts:89-108`. Team already knows this pattern.
**Example:**
```typescript
// Source: src/lib/discovery/types.ts (existing pattern in codebase)
export interface ChannelAdapter {
  readonly channel: ChannelType;
  deploy(params: DeployParams): Promise<DeployResult>;
  pause(ref: CampaignChannelRef): Promise<void>;
  resume(ref: CampaignChannelRef): Promise<void>;
  getMetrics(ref: CampaignChannelRef): Promise<UnifiedMetrics>;
  getLeads(ref: CampaignChannelRef): Promise<UnifiedLead[]>;
  getActions(ref: CampaignChannelRef): Promise<UnifiedAction[]>;
  getSequenceSteps(ref: CampaignChannelRef): Promise<UnifiedStep[]>;
}
```

### Pattern 3: Map-Based Registry Factory
**What:** A `Map<ChannelType, ChannelAdapter>` with `registerAdapter()` and `getAdapter()`.
**When to use:** The adapter registry (FOUND-03).
**Why:** Simple, no DI framework, matches existing patterns. The codebase has zero DI container usage across 940+ files.
**Example:**
```typescript
const adapters = new Map<ChannelType, ChannelAdapter>();

export function registerAdapter(adapter: ChannelAdapter): void {
  adapters.set(adapter.channel, adapter);
}

export function getAdapter(channel: ChannelType): ChannelAdapter {
  const adapter = adapters.get(channel);
  if (!adapter) {
    throw new Error(
      `No adapter registered for channel "${channel}". ` +
      `Available: [${[...adapters.keys()].join(", ")}]`
    );
  }
  return adapter;
}
```

### Anti-Patterns to Avoid
- **TypeScript enums:** The codebase uses zero enums. Do not introduce them. Use `as const` objects.
- **DI container:** Do not introduce tsyringe, inversify, or awilix. The Map registry is sufficient.
- **Email-shaped interface methods:** Do not include `getSubjectLines()`, `getOpenRate()`, or `getBounceRate()` on the interface. These are email-specific and belong in optional fields on `UnifiedMetrics`.
- **Import from `src/lib/emailbison/` or `src/lib/linkedin/` in types.ts:** The types file must be dependency-free. It defines the contract, not the implementation.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| String enum validation | Custom validator functions | `as const` objects + TypeScript type narrowing | Compiler catches mismatches at build time |
| Adapter resolution | Switch statement in every consumer | `getAdapter()` registry factory | Single resolution point, extensible without modifying consumers |
| Channel-specific type guards | Manual `if (channel === "email")` checks | Discriminated union on `channel` field | TypeScript narrows types automatically in switch/if blocks |

## Common Pitfalls

### Pitfall 1: Incomplete String Enum Extraction
**What goes wrong:** Constants file misses some string values. Raw string comparisons persist in business logic.
**Why it happens:** Developer catalogs strings from memory instead of running grep on the actual codebase. Misses edge cases like `"connection_request"` vs `"connect"` dual representation.
**How to avoid:** Use the String Enum Inventory below (derived from grep analysis). After creating constants.ts, run `grep -rn 'actionType === \|channel === \|status === ' src/` to verify no raw strings remain in business logic.
**Warning signs:** Any `=== "connect"` or `=== "email"` in business logic outside the constants file.

### Pitfall 2: Interface Too Email-Shaped
**What goes wrong:** `UnifiedMetrics` requires fields like `openRate`, `bounceRate`, `subjectLine` that LinkedIn does not have.
**Why it happens:** Developer thinks about email first (it was built first).
**How to avoid:** Define the interface with ONLY shared fields as required. Channel-specific metrics are optional. Mentally implement the LinkedIn adapter while designing the interface -- if any method feels forced, the interface is wrong.
**Warning signs:** More than 3 optional fields on the interface methods. Any field with "email" or "linkedin" in its name on the shared interface.

### Pitfall 3: CampaignChannelRef Missing LinkedIn's Lookup Pattern
**What goes wrong:** `CampaignChannelRef` only carries `emailBisonCampaignId`. LinkedIn adapter cannot look up its data because LinkedIn actions are matched by `campaignName + workspaceSlug`, not by an external ID.
**Why it happens:** Developer models the ref after email's lookup pattern (external ID).
**How to avoid:** `CampaignChannelRef` must carry ALL identifiers needed by ANY adapter: `campaignId` (internal), `workspaceSlug`, `campaignName` (for LinkedIn), and `emailBisonCampaignId?` (for email, optional).

### Pitfall 4: Circular Import Between Constants and Types
**What goes wrong:** `types.ts` imports from `constants.ts` for type definitions, and `constants.ts` imports from `types.ts` for type annotations, creating a cycle.
**How to avoid:** One-way dependency: `types.ts` imports from `constants.ts` (for `ChannelType` derivation). `constants.ts` never imports from `types.ts`. `registry.ts` imports from both. Enforce with barrel export ordering in `index.ts`.

### Pitfall 5: Sender Channel "both" Value Not Addressed
**What goes wrong:** Constants define `ChannelType = "email" | "linkedin"` but the `Sender` model has a third value `"both"`. Queries using the new constants miss dual-channel senders.
**Why it happens:** The `"both"` value is a Sender-specific concept, not a general channel type.
**How to avoid:** Define TWO separate types: `ChannelType` (the adapter discriminator: `"email" | "linkedin"`) and `SenderChannel` (the Sender model's values: `"email" | "linkedin" | "both"`). Provide helper functions: `senderMatchesChannel(senderChannel: SenderChannel, target: ChannelType): boolean` that handles the tri-state logic. This helper is what Phase 72 adapters will use internally.

## String Enum Inventory (FOUND-01 Evidence)

All values derived from grep analysis of the live codebase. This is the exhaustive list for `constants.ts`.

### Channel Types
```typescript
// Used on: Campaign.channels (JSON array), CampaignDeploy, deploy.ts channel param
export const CHANNEL_TYPES = {
  EMAIL: "email",
  LINKEDIN: "linkedin",
} as const;
```

### Sender Channel Values
```typescript
// Used on: Sender.channel (includes "both" for dual-channel senders)
export const SENDER_CHANNELS = {
  EMAIL: "email",
  LINKEDIN: "linkedin",
  BOTH: "both",
} as const;
```

### Workspace Package Values
```typescript
// Used on: Workspace.package
export const WORKSPACE_PACKAGES = {
  EMAIL: "email",
  LINKEDIN: "linkedin",
  EMAIL_LINKEDIN: "email_linkedin",
  CONSULTANCY: "consultancy",
} as const;
```

### LinkedIn Action Types
```typescript
// Used on: LinkedInAction.actionType
// NOTE: "connect" and "connection_request" are BOTH used for connection requests
// (historical inconsistency -- both must be constants, queries use { in: [...] })
export const LINKEDIN_ACTION_TYPES = {
  CONNECT: "connect",
  CONNECTION_REQUEST: "connection_request",
  MESSAGE: "message",
  PROFILE_VIEW: "profile_view",
  CHECK_CONNECTION: "check_connection",
} as const;

// Helper: all values that mean "connection request" (for Prisma { in: [...] } queries)
export const CONNECTION_REQUEST_TYPES = [
  LINKEDIN_ACTION_TYPES.CONNECT,
  LINKEDIN_ACTION_TYPES.CONNECTION_REQUEST,
] as const;
```

### LinkedIn Action Statuses
```typescript
// Used on: LinkedInAction.status
export const LINKEDIN_ACTION_STATUSES = {
  PENDING: "pending",
  RUNNING: "running",
  COMPLETE: "complete",
  FAILED: "failed",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
} as const;
```

### Sender Statuses
```typescript
// Used on: Sender.status
export const SENDER_STATUSES = {
  SETUP: "setup",
  ACTIVE: "active",
  PAUSED: "paused",
  DISABLED: "disabled",
} as const;
```

### Sender Health Statuses
```typescript
// Used on: Sender.healthStatus, SenderHealthEvent.status
export const SENDER_HEALTH_STATUSES = {
  HEALTHY: "healthy",
  WARNING: "warning",
  PAUSED: "paused",
  BLOCKED: "blocked",
  SESSION_EXPIRED: "session_expired",
} as const;
```

### Campaign Statuses
```typescript
// Used on: Campaign.status (static campaigns)
export const CAMPAIGN_STATUSES = {
  DRAFT: "draft",
  INTERNAL_REVIEW: "internal_review",
  PENDING_APPROVAL: "pending_approval",
  APPROVED: "approved",
  DEPLOYED: "deployed",
  ACTIVE: "active",
  PAUSED: "paused",
  COMPLETED: "completed",
  ARCHIVED: "archived",
} as const;
```

### Deploy Channel Statuses
```typescript
// Used on: CampaignDeploy.emailStatus, CampaignDeploy.linkedinStatus
export const DEPLOY_CHANNEL_STATUSES = {
  PENDING: "pending",
  RUNNING: "running",
  COMPLETE: "complete",
  FAILED: "failed",
  SKIPPED: "skipped",
} as const;
```

### Deploy Overall Statuses
```typescript
// Used on: CampaignDeploy.status
export const DEPLOY_STATUSES = {
  PENDING: "pending",
  RUNNING: "running",
  COMPLETE: "complete",
  PARTIAL_FAILURE: "partial_failure",
  FAILED: "failed",
} as const;
```

### Connection Statuses
```typescript
// Used on: PersonWorkspace connection tracking
export const CONNECTION_STATUSES = {
  NONE: "none",
  PENDING: "pending",
  CONNECTED: "connected",
  FAILED: "failed",
  EXPIRED: "expired",
} as const;
```

### Session Statuses
```typescript
// Used on: Sender LinkedIn session status
export const SESSION_STATUSES = {
  NOT_SETUP: "not_setup",
  ACTIVE: "active",
  EXPIRED: "expired",
} as const;
```

## Unified Type Definitions (FOUND-04)

### UnifiedLead
```typescript
export interface UnifiedLead {
  id: string;                    // Person ID (internal)
  email?: string;                // Email address (email channel)
  linkedInUrl?: string;          // LinkedIn profile URL (linkedin channel)
  name?: string;
  company?: string;
  title?: string;
  channel: ChannelType;          // Which channel this lead record comes from
  status: string;                // Channel-specific status (e.g., EB lead status or LinkedIn action status)
  addedAt?: Date;
}
```

### UnifiedAction
```typescript
export interface UnifiedAction {
  id: string;
  channel: ChannelType;
  actionType: string;            // "email_sent", "connect", "message", "profile_view", etc.
  status: string;                // "complete", "failed", "pending", etc.
  personId?: string;
  personName?: string;
  personEmail?: string;
  detail?: string;               // Subject line (email) or message snippet (linkedin)
  performedAt: Date;
  campaignName?: string;
}
```

### UnifiedMetrics
```typescript
export interface UnifiedMetrics {
  channel: ChannelType;
  // Shared metrics (required)
  sent: number;
  replied: number;
  replyRate: number;
  // Email-specific (optional)
  opened?: number;
  openRate?: number;
  bounced?: number;
  bounceRate?: number;
  // LinkedIn-specific (optional)
  connectionsSent?: number;
  connectionsAccepted?: number;
  acceptRate?: number;
  messagesSent?: number;
  profileViews?: number;
}
```

### UnifiedStep
```typescript
export interface UnifiedStep {
  stepNumber: number;
  channel: ChannelType;
  type: string;                  // "email" for email steps, action type for LinkedIn
  delayDays: number;             // Delay from previous step (0 for first)
  // Email-specific (optional)
  subjectLine?: string;
  bodyHtml?: string;
  // LinkedIn-specific (optional)
  messageBody?: string;
  triggerEvent?: string;         // "connection_accepted", "timeout", etc.
}
```

### CampaignChannelRef
```typescript
export interface CampaignChannelRef {
  campaignId: string;            // Internal Campaign.id (cuid)
  workspaceSlug: string;
  campaignName: string;          // Used by LinkedIn (LinkedInAction.campaignName)
  emailBisonCampaignId?: number; // Used by Email (EmailBison API lookups)
}
```

## Code Examples

### constants.ts -- Complete Structure
```typescript
// src/lib/channels/constants.ts

// --- Channel Types ---
export const CHANNEL_TYPES = { EMAIL: "email", LINKEDIN: "linkedin" } as const;
export type ChannelType = (typeof CHANNEL_TYPES)[keyof typeof CHANNEL_TYPES];

// --- Sender Channel (includes "both" tri-state) ---
export const SENDER_CHANNELS = { EMAIL: "email", LINKEDIN: "linkedin", BOTH: "both" } as const;
export type SenderChannel = (typeof SENDER_CHANNELS)[keyof typeof SENDER_CHANNELS];

/**
 * Helper: does this sender's channel value include the target channel?
 * Encapsulates the tri-state "both" logic so no consumer ever writes
 * `channel: { in: ["linkedin", "both"] }` directly.
 */
export function senderMatchesChannel(
  senderChannel: SenderChannel,
  target: ChannelType,
): boolean {
  if (senderChannel === SENDER_CHANNELS.BOTH) return true;
  return senderChannel === target;
}

// ... (remaining const objects as listed in String Enum Inventory)
```

### registry.ts -- Complete Structure
```typescript
// src/lib/channels/registry.ts
import type { ChannelType } from "./constants";
import type { ChannelAdapter } from "./types";

const adapters = new Map<ChannelType, ChannelAdapter>();

export function registerAdapter(adapter: ChannelAdapter): void {
  adapters.set(adapter.channel, adapter);
}

export function getAdapter(channel: ChannelType): ChannelAdapter {
  const adapter = adapters.get(channel);
  if (!adapter) {
    throw new Error(
      `No adapter registered for channel "${channel}". ` +
      `Registered: [${[...adapters.keys()].join(", ")}]. ` +
      `Did you call initAdapters()?`
    );
  }
  return adapter;
}

/** Returns all registered adapters (for iteration in deploy loops, metrics collection) */
export function getAllAdapters(): ChannelAdapter[] {
  return [...adapters.values()];
}

/** Clear registry (for testing only) */
export function clearAdapters(): void {
  adapters.clear();
}
```

### types.ts -- Interface Definition
```typescript
// src/lib/channels/types.ts
import type { ChannelType } from "./constants";

export interface CampaignChannelRef {
  campaignId: string;
  workspaceSlug: string;
  campaignName: string;
  emailBisonCampaignId?: number;
}

export interface DeployParams {
  deployId: string;
  campaignId: string;
  campaignName: string;
  workspaceSlug: string;
  sequence: UnifiedStep[];
}

export interface DeployResult {
  success: boolean;
  error?: string;
}

export interface ChannelAdapter {
  readonly channel: ChannelType;
  deploy(params: DeployParams): Promise<DeployResult>;
  pause(ref: CampaignChannelRef): Promise<void>;
  resume(ref: CampaignChannelRef): Promise<void>;
  getMetrics(ref: CampaignChannelRef): Promise<UnifiedMetrics>;
  getLeads(ref: CampaignChannelRef): Promise<UnifiedLead[]>;
  getActions(ref: CampaignChannelRef): Promise<UnifiedAction[]>;
  getSequenceSteps(ref: CampaignChannelRef): Promise<UnifiedStep[]>;
}

// ... UnifiedLead, UnifiedAction, UnifiedMetrics, UnifiedStep as above
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `actionType === "connect"` raw strings | `actionType === LINKEDIN_ACTION_TYPES.CONNECT` | Phase 71 | Eliminates string mismatch bugs (6 confirmed production bugs) |
| Channel-specific imports (EmailBisonClient, LinkedInAction) in consumers | `getAdapter(channel)` resolution | Phase 71 (interface), Phase 72 (implementation) | Single entry point for all channel operations |
| TypeScript enums | `as const` objects + derived types | Project convention | Better tree-shaking, no runtime reverse-mapping |

## Open Questions

1. **Should `getActions` be on the interface or deferred to Phase 72?**
   - What we know: Requirements say FOUND-02 includes `getActions`. The research confirms both channels have "action" concepts (email sends, LinkedIn actions).
   - What's unclear: The exact return shape for email "actions" (are they individual sends? campaign-level events?) needs investigation when implementing.
   - Recommendation: Define the method signature in Phase 71 (it's on the interface). The implementation details are Phase 72's concern.

2. **Should `senderMatchesChannel()` helper live in constants.ts or a separate helpers.ts?**
   - What we know: It's a pure function depending only on constants.
   - Recommendation: Keep in `constants.ts` -- it's closely related to the sender channel type and prevents consumers from reimplementing the tri-state logic.

3. **Should the existing `LinkedInActionType` in `src/lib/linkedin/types.ts` be replaced or re-exported?**
   - What we know: `src/lib/linkedin/types.ts` already defines `LinkedInActionType` as a union type. Phase 71 creates equivalent constants.
   - Recommendation: In Phase 71, create the constants in `constants.ts`. In Phase 72, update `src/lib/linkedin/types.ts` to re-export from constants. Do NOT modify existing files in Phase 71 -- this phase is additive only.

## Sources

### Primary (HIGH confidence)
- Codebase: `src/lib/discovery/types.ts` lines 89-108 -- DiscoveryAdapter interface pattern
- Codebase: `src/lib/linkedin/types.ts` -- all LinkedIn type definitions (action types, statuses, sender types)
- Codebase: `src/lib/campaigns/deploy.ts` lines 540-610 -- channel retry pattern, status values
- Codebase: `src/lib/campaigns/operations.ts` lines 86-105 -- campaign status state machine
- Codebase: `prisma/schema.prisma` -- Sender (line 837), Campaign (line 678), CampaignDeploy (line 771), Workspace (line 35)
- Grep analysis: `actionType ===` across 36+ files, `channel ===` across 71 files

### Secondary (MEDIUM confidence)
- Milestone research: `.planning/research/SUMMARY.md`, `STACK.md`, `ARCHITECTURE.md`, `PITFALLS.md` -- all HIGH confidence, derived from same codebase analysis

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- zero new dependencies, all TypeScript language features
- Architecture: HIGH -- follows proven DiscoveryAdapter pattern already in codebase
- Pitfalls: HIGH -- all grounded in actual grep counts and confirmed production bugs
- String enum inventory: HIGH -- derived from live grep analysis of codebase

**Research date:** 2026-04-08
**Valid until:** No expiry -- this is internal codebase analysis, not external library research
