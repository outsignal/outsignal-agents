# Project Research Summary

**Project:** Outsignal Agents -- v10.0 Unified Outbound Architecture
**Domain:** Multi-channel outbound platform (adapter pattern retrofit)
**Researched:** 2026-04-08
**Confidence:** HIGH

## Executive Summary

v10.0 is a refactoring milestone, not a feature milestone. The goal is to introduce a `ChannelAdapter` interface that normalises how the system interacts with email (via EmailBison) and LinkedIn (via DB + Railway worker), eliminating scattered `if channel === 'email' ... else` branching across 65+ files. The codebase already proves the adapter pattern works -- `src/lib/discovery/types.ts` defines a `DiscoveryAdapter` interface with 10 concrete implementations. The outbound channel adapter follows the exact same approach: a TypeScript interface, concrete classes, and a Map-based registry to resolve adapters by channel name. Zero new npm packages are required.

The recommended approach is "adapter as facade" -- thin wrappers over existing EmailBisonClient and LinkedIn Prisma queries that provide a uniform access pattern without rewriting business logic. The existing Campaign model is already channel-agnostic (`channels` JSON array, separate `emailSequence`/`linkedinSequence` fields, per-channel deploy status on CampaignDeploy). The Sender model already discriminates by channel. No schema migration is needed for the core adapter work. The phasing is: interface + implementations first (pure infrastructure, zero user-facing changes), then portal consumption through adapters (read-path unification), then analytics unification (background operations).

The key risks are all related to the migration itself, not the pattern. Six confirmed production bugs from the April 8 session provide concrete evidence: string enum sprawl across 36+ files causing silent data exclusion, portal pages hardcoded to EmailBison showing blank for LinkedIn campaigns, and analytics pipelines tightly coupled to EmailBison's API shape. The biggest trap is designing an adapter interface that unconsciously mirrors EmailBison's data shape -- the LinkedIn adapter should be written FIRST to validate the interface is truly channel-agnostic. The second biggest trap is the dual-write window during migration where some code paths use adapters while others still use direct EmailBison calls, creating split-brain metrics.

## Key Findings

### Recommended Stack

No new dependencies. All adapter work uses existing TypeScript interfaces, Prisma queries, and vitest for testing. The codebase has 940+ files and zero DI container usage -- introducing tsyringe/inversify would be a foreign pattern. A simple `Map<ChannelType, ChannelAdapter>` registry is the right approach, consistent with how `DiscoveryAdapter` already works.

**Core technologies (all already installed):**
- TypeScript ^5: Interface definitions and type safety for the adapter contract
- Prisma ^6.19.2: Minor additive column changes only (no structural migration)
- Zod ^4.3.6: Runtime validation at adapter boundaries (input/output contracts)
- vitest ^4.0.18: Adapter unit and integration tests, mock adapters via `vi.fn()`

### Expected Features

**Must have (table stakes):**
- Channel adapter interface -- common contract: `deploy()`, `pause()`, `resume()`, `getMetrics()`, `getLeads()`, `getSequenceSteps()`
- Email adapter -- thin wrapper around existing EmailBisonClient
- LinkedIn adapter -- thin wrapper around existing LinkedInAction queries + Railway worker coordination
- Adapter registry/factory -- `getAdapter(channel)` as single resolution point
- Unified campaign metrics -- portal and admin show combined stats without channel branching
- Per-channel deploy status -- formalise existing `emailStatus`/`linkedinStatus` on CampaignDeploy
- Workspace channel configuration -- reads existing `Workspace.package` field to determine enabled adapters
- String enum constants file -- single source of truth for all channel/actionType/status strings

**Should have (differentiators):**
- Unified activity timeline -- cross-channel activity for a person in one feed
- Channel fallback rules -- email bounce triggers LinkedIn connect, timeout triggers email-only follow-up
- Channel performance comparison -- side-by-side reply rates per channel for same ICP
- Per-channel sequence versioning (already built -- adapters preserve it)
- Capability flags on adapters -- `hasOpenTracking`, `hasBounceRate`, `hasAcceptRate` for conditional UI rendering

**Defer (v2+):**
- Cross-channel attribution (multi-touch, not just last-touch)
- SMS/cold call adapters (no client demand)
- Unified sequence builder UI (campaigns go through Nova CLI, not drag-and-drop)
- Real-time channel switching mid-sequence (latency makes it meaningless)
- Visual sequence builder (months of UI work for a feature the admin doesn't use)

### Architecture Approach

The adapter is a new `src/lib/channels/` directory containing the interface, registry, and two concrete adapters. It does NOT replace `src/lib/emailbison/` or `src/lib/linkedin/` -- those remain as low-level implementation details that adapters wrap. The Campaign model, Sender model, and Prisma schema require no structural changes. Consumers (deploy.ts, portal pages, Trigger.dev tasks, analytics snapshot) are migrated incrementally from direct channel-specific calls to adapter calls.

**Major components:**
1. `src/lib/channels/types.ts` -- ChannelAdapter interface, ChannelMetrics, CampaignRef, ChannelSender, ChannelReply shared types
2. `src/lib/channels/registry.ts` -- Map-based factory, `getAdapter(channel)`, `getEnabledChannels(workspace)`
3. `src/lib/channels/email-adapter.ts` -- wraps EmailBisonClient for deploy, metrics, senders, replies
4. `src/lib/channels/linkedin-adapter.ts` -- wraps Prisma queries for LinkedInAction, LinkedInConversation, Sender
5. `src/lib/channels/constants.ts` -- single source of truth for ALL string enums (channel types, action types, statuses)

**Key patterns:**
- Adapter as Facade: delegates to existing modules, never contains business logic
- CampaignRef as Universal Identifier: carries all IDs needed across channels
- Channel-Agnostic Rendering: portal components receive `ChannelMetrics[]` and render generically
- Registry Factory: never instantiate adapters directly, always `getAdapter(channel)`

### Critical Pitfalls

1. **String enum sprawl (ALREADY HIT)** -- `actionType === "connect"` mismatch found in 7 files, `channel: 'linkedin'` queries missing `'both'` senders. Prevention: create `constants.ts` with all string enums as the FIRST task, before any adapter work. Every raw string comparison becomes a constant reference.

2. **Adapter interface too email-shaped** -- unconsciously mirroring EmailBison's API shape (open rate, bounce rate, subject lines) makes LinkedIn a second-class citizen. Prevention: write the LinkedIn adapter FIRST. If the interface feels awkward for LinkedIn, it is too email-shaped. Use optional fields and capability flags, not forced shared types.

3. **Dual-write window during migration** -- some code paths use adapters while others use direct EmailBison calls, creating split-brain metrics and double notifications. Prevention: adapter wraps existing code (not replaces), so both paths produce identical results. Feature flag per workspace: a workspace is ALL-old or ALL-new, never mixed.

4. **Portal hardcoded to EmailBison (ALREADY HIT)** -- campaign detail, activity feeds, lead lists all query EmailBison directly. LinkedIn campaigns show blank. Prevention: portal MUST consume adapter interface. Test matrix: email-only, LinkedIn-only, and dual-channel campaigns.

5. **EmailBison IDs hardwired into campaign identity** -- `emailBisonCampaignId` referenced in 10 files, 38 occurrences. Prevention: adapter reads these internally via CampaignRef. New code uses adapter methods, never reaches for raw EB IDs. Deprecate the fields with JSDoc comments.

## Implications for Roadmap

Based on combined research, the adapter work follows a strict dependency chain: interface before implementations before consumers. Each phase builds on the previous one. The total estimated effort is 30-40 hours across all phases.

### Phase 1: Foundation (Constants + Interface + Registry)
**Rationale:** String enum sprawl (Pitfall 1) must be fixed BEFORE any adapter work begins. The interface design (Pitfall 3) must be validated before implementations are built. These are the two highest-risk decisions in the entire milestone.
**Delivers:** `constants.ts` with all string enums as single source of truth; `types.ts` with ChannelAdapter interface and shared types; `registry.ts` with factory and workspace channel resolution; grep-based lint check for raw string literals
**Addresses:** Channel adapter interface (table stakes), adapter registry (table stakes), string enum constants (table stakes)
**Avoids:** String enum sprawl (Pitfall 1), adapter interface too email-shaped (Pitfall 3), import cycles (Pitfall 11)

### Phase 2: Adapter Implementations
**Rationale:** Implementations come after interface is validated. LinkedIn adapter should be built FIRST (or at least concurrently) to validate the interface is channel-agnostic. Both adapters start with `getMetrics()` and `getSenders()` only, providing testable value without touching deploy logic.
**Delivers:** `email-adapter.ts` wrapping EmailBisonClient; `linkedin-adapter.ts` wrapping Prisma + LinkedIn helpers; `deploy()`, `pause()`, `resume()`, `getMetrics()`, `getSenders()` on both; vitest tests for both adapters; mock adapter for consumer tests
**Addresses:** Email adapter (table stakes), LinkedIn adapter (table stakes), unified campaign metrics (table stakes)
**Avoids:** Sender tri-state problem (Pitfall 7 -- adapters encapsulate `in: ['linkedin', 'both']` queries), over-abstracting channel differences (anti-pattern)

### Phase 3: Deploy Through Adapters
**Rationale:** Deploy is the highest-risk integration point. Get it right early before touching UI. The existing deploy logic is already cleanly separated by channel (`deployEmailChannel` + `deployLinkedInChannel`), making this a safe mechanical refactor -- logic moves into adapter classes, behaviour stays identical.
**Delivers:** `executeDeploy()` refactored to loop over channels calling `adapter.deploy()`; `retryDeployChannel()` working through adapter; `pause()` and `resume()` wired end-to-end
**Addresses:** Per-channel deploy status (table stakes), deploy via adapters
**Avoids:** Dual-write window (Pitfall 4 -- adapter wraps same deploy functions, identical behaviour)

### Phase 4: Portal Unification
**Rationale:** UI changes are lower risk (read-only) and can be done incrementally page by page. This phase ensures LinkedIn campaigns no longer show blank in the portal -- directly addressing the confirmed production bug.
**Delivers:** Campaign detail page using adapters for data fetching; `ChannelMetricsCards` component for unified rendering; portal dashboard aggregating metrics across channels; activity page merging email + LinkedIn activity; sender-health page querying through adapters
**Addresses:** Unified activity timeline (differentiator), portal channel parity
**Avoids:** Portal hardcoded to EmailBison (Pitfall 5 -- all portal pages go through adapters)

### Phase 5: Analytics + Notifications
**Rationale:** Background operations. Getting them wrong has lower immediate impact than deploy or portal. Analytics unification requires the adapter to be stable and the portal to be consuming it.
**Delivers:** `snapshot-metrics.ts` snapshotting per-channel via adapters; `channel` context added to notification functions; reply processing normalised through adapters; CachedMetrics backwards compatibility (existing keys stay, new keys use channel prefix)
**Addresses:** Channel-aware notifications (table stakes), analytics pipeline unification
**Avoids:** Analytics tightly coupled to EmailBison (Pitfall 9), notification format assumes email (Pitfall 8)

### Phase Ordering Rationale

- Constants + interface first because every subsequent phase depends on them, and both highest-risk pitfalls (string sprawl, email-shaped interface) are Phase 1 decisions
- Adapters before consumers because the interface must be implemented and tested before anything reads from it
- Deploy before portal because deploy is the highest-risk write path -- validate it before lower-risk read paths
- Portal before analytics because portal is user-facing (clients see blank pages NOW), analytics is background
- Feature flag per workspace enables incremental rollout without dual-write conflicts

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3 (Deploy Through Adapters):** `deploy.ts` is the most complex file to refactor. The existing `deployEmailChannel` and `deployLinkedInChannel` functions are 80+ lines each with retry logic, error handling, and CampaignDeploy status updates. Research the exact function boundaries before starting.
- **Phase 4 (Portal Unification):** Portal pages have significant UI branching based on channel. The `CampaignDetailTabs` component likely has channel-specific tab rendering that needs auditing before the adapter migration.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Foundation):** Well-documented TypeScript interface + factory pattern. The `DiscoveryAdapter` in the codebase is the exact template.
- **Phase 2 (Adapter Implementations):** Thin wrappers around existing code. The EmailBisonClient API surface and LinkedIn Prisma queries are fully documented in the codebase.
- **Phase 5 (Analytics + Notifications):** Additive changes to existing background jobs. CachedMetrics model is already channel-agnostic with generic `metricType` + `data` JSON.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Zero new dependencies. All versions verified against installed packages. |
| Features | HIGH | Feature set derived from existing codebase capabilities + market analysis of Reply.io, Lemlist, Instantly, Smartlead. Market research is MEDIUM confidence (training data, not live verification) but the core feature set is validated by the codebase. |
| Architecture | HIGH | Based on direct codebase analysis of 940+ files. Campaign model, Sender model, deploy logic, portal pages, Trigger.dev tasks all inspected. |
| Pitfalls | HIGH | All 13 pitfalls grounded in actual codebase evidence: 6 confirmed production bugs from April 8 session, grep analysis (297 EmailBison references across 65 files, 122 actionType references across 36 files). |

**Overall confidence:** HIGH

### Gaps to Address

- **CachedMetrics channel discriminator:** Need to decide on metric key naming convention (`email:Rise Q1` vs `linkedin:Rise Q1`) and ensure backwards compatibility with existing keys. Design in Phase 1, implement in Phase 5.
- **Feature flag mechanism:** The per-workspace `USE_CHANNEL_ADAPTER` flag needs a storage decision (env var, Workspace model column, or JSON config). Low complexity but must be decided before Phase 3 deploy migration.
- **CampaignChannelRef table vs. keeping emailBisonCampaignId:** PITFALLS.md suggests a generic `CampaignChannelRef` table. STACK.md says existing columns are fine for v10.0. Recommendation: keep existing columns, add generic table only if a third channel is introduced.
- **Webhook handler exclusion:** Webhooks are INBOUND (EmailBison pushes events to us). They cannot go through the adapter interface (which is OUTBOUND). Must be communicated clearly to prevent confusion during implementation.

## Sources

### Primary (HIGH confidence)
- Existing codebase: `src/lib/discovery/types.ts` lines 89-108 (DiscoveryAdapter interface pattern)
- Existing codebase: `src/lib/discovery/adapters/` (10 concrete adapter implementations)
- Existing codebase: `src/lib/campaigns/deploy.ts` (deployEmailChannel + deployLinkedInChannel)
- Existing codebase: `prisma/schema.prisma` (Campaign, Sender, CampaignDeploy, Workspace models)
- Existing codebase: `src/lib/emailbison/client.ts` (EmailBison API client)
- Existing codebase: `src/lib/linkedin/types.ts`, `chain.ts`, `sequencing.ts`, `sender.ts`
- Existing codebase: `src/app/(portal)/portal/campaigns/[id]/page.tsx` (portal channel branching)
- Confirmed production bugs: 6 bugs from 2026-04-08 session
- Grep analysis: 297 EmailBison references across 65 files, 122 actionType references across 36 files

### Secondary (MEDIUM confidence)
- Domain expertise on Reply.io, Lemlist, Instantly, Smartlead, Apollo, Expandi, Waalaxy (training data, not live verification)
- PROJECT.md v10.0 milestone specification

---
*Research completed: 2026-04-08*
*Ready for roadmap: yes*
